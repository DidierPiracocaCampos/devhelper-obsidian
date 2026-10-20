import { ItemView, Menu, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import type { PluginSettings } from "../settings";
import type {
  CalendarEventRecord,
  CalendarKind,
  CredentialsRecord,
  CredentialEntry,
  DashboardData,
  DashboardIssue,
  FileRecord,
  NoteRecord,
  ProjectRecord,
  TaskRecord,
} from "../domain/types";
import {
  createSaltB64,
  createVerifier,
  decryptEntryForDisplay,
  deriveKey,
  isEncryptedValue,
  type CredentialDisplay,
} from "../domain/credentialsCrypto";
import type { CredentialSession } from "../data/CredentialSession";
import {
  presentDashboard,
  resolveVisibleCredentialsRecord,
  type DashboardPresentation,
  type DashboardSelection,
} from "../domain/presentDashboard";
import { expandOccurrences, type CalendarOccurrence } from "../domain/calendar";
import { getWeekStrip } from "../domain/weekStrip";
import type {
  ProjectTaskRepository,
  CredentialInput,
} from "../data/ProjectTaskRepository";
import { ProjectFormModal } from "./ProjectFormModal";
import { ProjectPickerModal } from "./ProjectPickerModal";
import { VaultSearchModal } from "./VaultSearchModal";
import { TaskFormModal } from "./TaskFormModal";
import { NoteFormModal } from "./NoteFormModal";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import {
  CredentialDetailModal,
  CredentialFormModal,
  ConfirmModal,
  MasterPasswordModal,
} from "./CredentialFormModal";

export const VIEW_TYPE_DEVHELPER_DASHBOARD = "devhelper-dashboard";

/**
 * Credentials wiring injected by the plugin: the in-memory session plus
 * the persistence callbacks for the key material (salt + verifier live
 * in `data.json` via `plugin.saveData`). The view never sees passwords.
 */
export interface CredentialDeps {
  session: CredentialSession;
  getSaltB64(): string | undefined;
  getVerifier(): string | undefined;
  saveKeyMaterial(saltB64: string, verifier: string): Promise<void>;
  clearKeyMaterial(): Promise<void>;
}

/**
 * Top-level dashboard view. The view owns:
 *
 *  - The currently selected project path (in-memory only - the plan
 *    explicitly says this state is not persisted).
 *  - The DOM tree under `contentEl`.
 *
 * The view NEVER talks to `app.vault.*` directly. All read/write
 * operations are routed through `ProjectTaskRepository` so the same
 * logic is exercised by the fake adapter tests in Task 4 and by the
 * Obsidian adapter at runtime.
 *
 * The view never keeps a private copy of the data either: every
 * render pulls a fresh `repository.load()`. This is what makes
 * external Markdown edits (Task 6 vault listeners) show up in the UI
 * without invalidating a cache.
 */
export class DashboardView extends ItemView {
  private readonly repository: ProjectTaskRepository;
  // `settings` is kept around so the view can re-read folder names if
  // it ever needs to; today the repository owns that mapping.
  private readonly settings: PluginSettings;
  private readonly credentialsDeps: CredentialDeps;

  private selection: DashboardSelection = { kind: "all" };
  private showTaskFilters = false;
  private taskStatusFilter: "all" | "open" | "done" = "all";
  private taskKindFilter: "all" | "task" | "note" = "all";
  private taskQuery = "";
  private showFileFilters = false;
  private fileQuery = "";
  private sideWeekOffset = 0;

  /**
   * Alarma de medianoche para el rail lateral. Sin ella, «hoy» y la semana
   * mostrada quedan congelados en ayer si la pestaña sigue abierta al cruzar
   * la medianoche (el render sólo ocurre por eventos del vault o del usuario).
   */
  private midnightTimer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    repository: ProjectTaskRepository,
    settings: PluginSettings,
    credentialsDeps: CredentialDeps,
    private readonly openCalendar: (isoDate?: string) => void,
  ) {
    super(leaf);
    // The plugin's `app` field is already set by `super(leaf)`.
    this.repository = repository;
    this.settings = settings;
    this.credentialsDeps = credentialsDeps;
  }

  getViewType(): string {
    return VIEW_TYPE_DEVHELPER_DASHBOARD;
  }

  getDisplayText(): string {
    return "Dashboard DevHelper";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  async onOpen(): Promise<void> {
    // Render once on open so the panel isn't blank while the first
    // `load()` resolves. A subsequent `refresh()` will swap in the
    // real content.
    this.renderEmpty();
    this.scheduleMidnightRefresh();
    await this.refresh();
  }

  /**
   * Programa una única alarma para la medianoche local siguiente. Al saltar,
   * repinta el rail con el nuevo «hoy» y se rearma para el día siguiente.
   */
  private scheduleMidnightRefresh(): void {
    this.clearMidnightTimer();
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 1, 0);
    this.midnightTimer = window.setTimeout(() => {
      this.midnightTimer = null;
      // El offset de semana sigue siendo válido (0 = semana actual), así que
      // basta con repintar; un nuevo render recalcula «hoy» y la semana.
      void this.refresh().then(() => this.scheduleMidnightRefresh());
    }, nextMidnight.getTime() - now.getTime());
  }

  private clearMidnightTimer(): void {
    if (this.midnightTimer !== null) {
      window.clearTimeout(this.midnightTimer);
      this.midnightTimer = null;
    }
  }

  async onClose(): Promise<void> {
    this.clearMidnightTimer();
    this.contentEl.empty();
  }

  /**
   * Reload data from the repository and rebuild the DOM. Safe to call
   * from anywhere (command palette, ribbon, vault event handler,
   * in-view modal callbacks).
   */
  async refresh(): Promise<void> {
    const data = await this.repository.load();
    const decrypted = await this.decryptVisibleCredentials(data);
    this.render(data, decrypted);
  }

  /**
   * Update the current scope. Called from the project chips in the top
   * bar (Task 4 will also wire a dedicated "Todas" chip).
   * The selection lives on the view instance so it survives every
   * refresh but does NOT leak into plugin storage. We trigger a full
   * `refresh()` so the re-render uses live vault data instead of a
   * cached snapshot.
   */
  setSelection(selection: DashboardSelection): void {
    this.selection = selection;
    void this.refresh();
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  /**
   * Bloque vacío centrado con icono + texto. Se usa en todos los
   * paneles (tareas, calendario, archivos, contraseñas, sin proyectos)
   * para que los estados vacíos compartan la misma silueta.
   */
  private appendEmptyState(
    parent: HTMLElement,
    icon: string,
    text: string,
  ): HTMLElement {
    const box = parent.createEl("div", { cls: "devhelper-empty-state" });
    const iconEl = box.createEl("span", {
      cls: "devhelper-empty-state-icon",
      attr: { "aria-hidden": "true" },
    });
    setIcon(iconEl, icon);
    box.createEl("p", { cls: "devhelper-empty-state-text", text });
    return box;
  }

  private renderEmpty(): void {
    this.contentEl.empty();
    this.contentEl.addClass("devhelper-dashboard-root");
    const main = this.contentEl.createEl("div", { cls: "devhelper-main" });
    main.createEl("h2", { text: "Dashboard DevHelper" });
    this.appendEmptyState(main, "loader-circle", "Cargando proyectos y tareas…");
  }

  private render(
    data: DashboardData,
    decrypted: Map<string, CredentialDisplay[]>,
  ): void {
    const presentation = presentDashboard(data, this.selection);
    // Keep selection in sync with what the presenter chose. This is
    // how the "project disappeared" fall-back (plan rule) is wired
    // into the view's state.
    this.selection = presentation.selection;

    this.contentEl.removeClass("devhelper-dashboard-root");
    this.contentEl.empty();
    this.contentEl.addClass("devhelper-dashboard-root");

    this.renderTopBar(data, presentation);
    // `showAll === true` ⇒ no hay un proyecto en concreto; renderizamos
    // el panel con la cabecera genérica «Todas las tareas» para que el
    // usuario siempre vea algo. El empty state sólo aparece cuando NO
    // hay proyectos en absoluto.
    const noProjects = data.projects.length === 0;
    if (presentation.showAll && presentation.selectedProject === null && noProjects) {
      this.renderEmptyState();
    } else {
      this.renderTasksPanel(presentation, data);
    }
    this.renderToolbarRail();
    this.renderSideColumn(data);
    this.renderBottomSections(data, presentation, decrypted);
    this.renderIssues(presentation.issues);
  }

  /**
   * Top bar of the layout: project chips on the left, and (pushed to
   * the right edge by `margin-left: auto` on
   * `.devhelper-topbar-controls`) the decorative search input with its
   * hint.
   *
   * The previous "Proyectos" h2, the inert filter button and the
   * project-create FAB have been retired in Task 4: project creation
   * now flows through the favorites row's "+" picker, and the search
   * input is still a placeholder (per the spec).
   */
  private renderTopBar(
    data: DashboardData,
    presentation: DashboardPresentation,
  ): void {
    const topbar = this.contentEl.createEl("div", {
      cls: "devhelper-topbar",
    });

    this.renderProjectChips(presentation, data);

    const controls = topbar.createEl("div", {
      cls: "devhelper-topbar-controls",
    });

    // The search is a decorative button-like box: a loupe icon, the
    // input with its placeholder, and the `Ctrl+K` hint pinned INSIDE
    // on the right (see `styles.css`). Per the design ref, the hint
    // must NEVER overlap the placeholder, which is why the input keeps
    // a roomy `padding-right`.
    //
    // Clicking it opens Obsidian's OWN global search
    // (`global-search:open`, which reveals the native Search view and
    // focuses its input). The field is `readOnly` (not `disabled`) so
    // it stays clickable without popping the on-screen keyboard.
    const searchWrap = controls.createEl("div", {
      cls: "devhelper-search-wrap",
    });
    const searchIcon = searchWrap.createEl("span", {
      cls: "devhelper-search-icon",
      attr: { "aria-hidden": "true" },
    });
    setIcon(searchIcon, "search");
    const search = searchWrap.createEl("input", {
      cls: "devhelper-search",
      type: "search",
      placeholder: "Busca en el vault…",
      attr: { "aria-label": "Búsqueda del workspace", readonly: "true" },
    });
    search.readOnly = true;
    searchWrap.addEventListener("click", () => this.openVaultSearch());
    searchWrap.createEl("span", {
      cls: "devhelper-search-hint",
      text: "Ctrl+K",
    });
  }

  /**
   * Favorites row that replaces the old project `<select>`. Layout:
   *
   *  1. "Todos" chip — selects the `kind: "all"` scope; selected when
   *     `presentation.showAll` is true.
   *  2. One chip per favorite project, ordered with the same
   *     `sortProjectsForSelect` comparator as before. Each chip
   *     carries a `contextmenu` listener that opens the project
   *     context menu (Abrir nota / Abrir carpeta / Quitar de mis
   *     favoritos). The previous status dot and "···" menu button
   *     have been retired per the Task 4 spec.
   *  3. A trailing "+" chip that opens `openAddFavorite()` so the user
   *     can promote a non-favorite project (or create a new one).
   *
   * The "Sin proyectos" placeholder chip is gone — the row is always
   * at least the "Todos" chip + "+".
   */
  private renderProjectChips(
    presentation: DashboardPresentation,
    data: DashboardData,
  ): void {
    const topbar = this.contentEl.querySelector<HTMLElement>(
      ".devhelper-topbar",
    );
    if (topbar === null) return;
    const chipList = topbar.createEl("div", { cls: "devhelper-chip-list" });

    // 1. "Todos" chip.
    const allChip = chipList.createEl("button", {
      cls: "devhelper-chip",
      text: "Todos",
      attr: { "aria-label": "Todos los proyectos", type: "button" },
    });
    if (presentation.showAll) allChip.addClass("is-selected");
    allChip.addEventListener("click", () => this.setSelection({ kind: "all" }));

    // 2. One chip per favorite, in the same order as the old select.
    const favorites = this.sortProjectsForSelect(
      data.projects.filter((p) => p.favorite),
    );
    for (const project of favorites) {
      const chip = chipList.createEl("button", {
        cls: "devhelper-chip",
        text: project.title,
        attr: { "aria-label": project.title, type: "button" },
      });
      if (
        this.selection.kind === "project" &&
        this.selection.path === project.path
      ) {
        chip.addClass("is-selected");
      }

      chip.addEventListener("click", () =>
        this.setSelection({ kind: "project", path: project.path }),
      );

      // Right-click context menu: Abrir nota / Abrir carpeta /
      // Quitar de mis favoritos. We always `preventDefault()` so the
      // native browser menu does not also appear. Each item gets a
      // lucide icon so the options read at a glance (file, folder,
      // bookmark-x for "remove favorite").
      chip.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        const menu = new Menu();
        menu.addItem((item) =>
          item
            .setTitle("Abrir nota")
            .setIcon("file")
            .onClick(() => this.openNote(project.path)),
        );
        menu.addItem((item) =>
          item
            .setTitle("Abrir carpeta")
            .setIcon("folder")
            .onClick(() => this.openProjectFolder(project.folderPath)),
        );
        menu.addItem((item) =>
          item
            .setTitle("Quitar de mis favoritos")
            .setIcon("bookmark-x")
            .onClick(async () => {
              await this.repository.setProjectFavorite(project.path, false);
              if (
                this.selection.kind === "project" &&
                this.selection.path === project.path
              ) {
                this.setSelection({ kind: "all" });
              } else {
                await this.refresh();
              }
            }),
        );
        menu.showAtMouseEvent(evt);
      });
    }

    // 3. "+" icon to add a favorite. Pure icon button - it does NOT
    //    inherit the `.devhelper-chip` pill (no border-radius, no
    //    padding, no background) so the `+` reads as a bare glyph
    //    floating in the favorites row, not as another chip.
    const addChip = chipList.createEl("button", {
      cls: "devhelper-chip-add",
      attr: { "aria-label": "Añadir proyecto a favoritos", type: "button" },
    });
    setIcon(addChip, "plus");
    addChip.addEventListener("click", () => void this.openAddFavorite());
  }

  private renderEmptyState(): void {
    const main = this.contentEl.createEl("section", {
      cls: "devhelper-main",
    });
    this.appendEmptyState(
      main,
      "folder-plus",
      "No hay proyectos todavía. Crea el primero con el botón + de arriba.",
    );
  }

  private renderTasksPanel(
    presentation: DashboardPresentation,
    data: DashboardData,
  ): void {
    const main = this.contentEl.createEl("section", {
      cls: "devhelper-tasks-panel",
    });

    // Header row: fixed «Tareas y notas» title on the left and the current
    // buttons (filter + new task + new note) inline on the right edge.
    const panelHeader = main.createEl("div", {
      cls: "devhelper-tasks-panel-header",
    });
    const projectHeader = panelHeader.createEl("div", {
      cls: "devhelper-project-header",
    });
    projectHeader.createEl("h3", { text: "Tareas y notas" });

    const fabs = panelHeader.createEl("div", {
      cls: "devhelper-panel-fabs",
    });

    const filterButton = fabs.createEl("button", {
      cls: "devhelper-icon-button",
      attr: { "aria-label": "Filtrar", type: "button" },
    });
    setIcon(filterButton, "funnel");
    if (this.showTaskFilters) filterButton.addClass("is-active");
    filterButton.addEventListener("click", () => {
      this.showTaskFilters = !this.showTaskFilters;
      void this.refresh();
    });

    const createTaskButton = fabs.createEl("button", {
      cls: "devhelper-fab",
      attr: { "aria-label": "Nueva tarea", title: "Nueva tarea", type: "button" },
    });
    setIcon(createTaskButton, "plus");
    createTaskButton.addEventListener("click", () =>
      void this.openCreateTask(),
    );

    const createNoteButton = fabs.createEl("button", {
      cls: "devhelper-fab",
      attr: { "aria-label": "Nueva nota", title: "Nueva nota", type: "button" },
    });
    setIcon(createNoteButton, "file-plus");
    createNoteButton.addEventListener("click", () =>
      void this.openCreateNote(),
    );

    // Optional second row: status filter + kind filter + search. Shown
    // only when the funnel is toggled. State lives on the view (in-memory).
    if (this.showTaskFilters) {
      this.renderTaskFilters(main);
    }

    // Apply the in-memory filters before rendering. El filtro de estado
    // sólo aplica a tareas; el filtro de tipo decide si se muestran
    // tareas, notas o ambas.
    const showTasks = this.taskKindFilter !== "note";
    const showNotes = this.taskKindFilter !== "task";
    const tasks = showTasks
      ? this.taskStatusFilter === "all"
        ? presentation.tasks
        : presentation.tasks.filter((t) => t.status === this.taskStatusFilter)
      : [];
    const notes = showNotes ? presentation.notes : [];

    const list = main.createEl("ul", { cls: "devhelper-task-list" });
    if (tasks.length === 0 && notes.length === 0) {
      let emptyText = "Aún no hay tareas ni notas.";
      let emptyIcon = "inbox";
      if (this.taskKindFilter === "task") {
        if (this.taskStatusFilter === "open") {
          emptyText = "No hay tareas abiertas.";
          emptyIcon = "circle-dot";
        } else if (this.taskStatusFilter === "done") {
          emptyText = "No hay tareas terminadas.";
          emptyIcon = "circle-check";
        } else if (presentation.showAll || presentation.selectedProject === null) {
          emptyText = "Aún no hay tareas en ningún proyecto.";
          emptyIcon = "inbox";
        } else {
          emptyText = "Este proyecto aún no tiene tareas.";
          emptyIcon = "inbox";
        }
      } else if (this.taskKindFilter === "note") {
        if (presentation.showAll || presentation.selectedProject === null) {
          emptyText = "Aún no hay notas en ningún proyecto.";
        } else {
          emptyText = "Este proyecto aún no tiene notas.";
        }
        emptyIcon = "sticky-note";
      } else if (presentation.showAll || presentation.selectedProject === null) {
        emptyText = "Aún no hay tareas ni notas en ningún proyecto.";
        emptyIcon = "inbox";
      } else {
        emptyText = "Este proyecto aún no tiene tareas ni notas.";
        emptyIcon = "inbox";
      }
      const emptyItem = list.createEl("li", {
        cls: "devhelper-task-empty",
      });
      this.appendEmptyState(emptyItem, emptyIcon, emptyText);
      // Still apply the query hiding so a stale query never shows
      // rows that should stay hidden.
      this.applyTaskQueryFilter(list);
      return;
    }

    // Per the Task 5 spec: in `showAll` mode every card gets a small
    // pill showing the parent project's title. In project mode the
    // pill would just repeat the panel header, so it is omitted.
    const titleByPath = presentation.showAll
      ? new Map(data.projects.map((p) => [p.path, p.title]))
      : null;

    for (const task of tasks) {
      const projectTitle =
        titleByPath === null
          ? undefined
          : titleByPath.get(task.projectPath) ?? task.projectPath;
      list.appendChild(this.renderTaskCard(task, projectTitle));
    }
    for (const note of notes) {
      const projectTitle =
        titleByPath === null
          ? undefined
          : titleByPath.get(note.projectPath) ?? note.projectPath;
      list.appendChild(this.renderNoteCard(note, projectTitle));
    }
    this.applyTaskQueryFilter(list);
  }

  /**
   * Second header row inside the tasks panel: status select, kind
   * select and search. Re-rendered on every `refresh()` so the selects
   * and the input always reflect the in-memory filter state.
   */
  private renderTaskFilters(main: HTMLElement): void {
    const filters = main.createEl("div", {
      cls: "devhelper-task-filters",
    });

    const statusSelect = filters.createEl("select", {
      cls: "devhelper-task-status-select",
      attr: { "aria-label": "Filtrar por estado" },
    });
    const options: Array<{ value: "all" | "open" | "done"; label: string }> = [
      { value: "all", label: "Todas" },
      { value: "open", label: "Abiertas" },
      { value: "done", label: "Hechas" },
    ];
    for (const option of options) {
      const el = statusSelect.createEl("option", {
        text: option.label,
        value: option.value,
      });
      if (this.taskStatusFilter === option.value) el.selected = true;
    }
    statusSelect.addEventListener("change", (evt) => {
      this.taskStatusFilter = (evt.target as HTMLSelectElement)
        .value as typeof this.taskStatusFilter;
      void this.refresh();
    });

    const kindSelect = filters.createEl("select", {
      cls: "devhelper-task-kind-select",
      attr: { "aria-label": "Filtrar por tipo" },
    });
    const kindOptions: Array<{
      value: "all" | "task" | "note";
      label: string;
    }> = [
      { value: "all", label: "Tareas y notas" },
      { value: "task", label: "Solo tareas" },
      { value: "note", label: "Solo notas" },
    ];
    for (const option of kindOptions) {
      const el = kindSelect.createEl("option", {
        text: option.label,
        value: option.value,
      });
      if (this.taskKindFilter === option.value) el.selected = true;
    }
    kindSelect.addEventListener("change", (evt) => {
      this.taskKindFilter = (evt.target as HTMLSelectElement)
        .value as typeof this.taskKindFilter;
      void this.refresh();
    });

    const search = filters.createEl("input", {
      cls: "devhelper-task-search",
      type: "search",
      placeholder: "Buscar tareas y notas…",
      attr: { "aria-label": "Buscar tareas y notas" },
    });
    search.value = this.taskQuery;
    // Filter in place so the input keeps focus while typing; a full
    // `refresh()` here would recreate the input on every keystroke.
    search.addEventListener("input", (evt) => {
      this.taskQuery = (evt.target as HTMLInputElement).value;
      const list = main.querySelector<HTMLElement>(".devhelper-task-list");
      if (list !== null) this.applyTaskQueryFilter(list);
    });
  }

  /**
   * Hide/show the already rendered cards by title. Keeps a single
   * «Sin resultados» row in sync so an aggressive query never leaves
   * a blank list.
   */
  private applyTaskQueryFilter(list: HTMLElement): void {
    const query = this.taskQuery.trim().toLocaleLowerCase();
    let noResults = list.querySelector<HTMLElement>(
      ".devhelper-task-no-results",
    );
    if (noResults === null) {
      noResults = list.createEl("li", {
        cls: "devhelper-task-empty devhelper-task-no-results",
      });
      this.appendEmptyState(
        noResults,
        "search-x",
        "Sin resultados para esta búsqueda.",
      );
    }
    if (query === "") {
      for (const child of Array.from(list.children)) {
        if (child !== noResults) (child as HTMLElement).style.display = "";
      }
      noResults.style.display = "none";
      return;
    }
    let visible = 0;
    for (const child of Array.from(list.children)) {
      if (child === noResults) continue;
      const el = child as HTMLElement;
      const title = (el.dataset["title"] ?? "").toLocaleLowerCase();
      const match = title.includes(query);
      el.style.display = match ? "" : "none";
      if (match) visible++;
    }
    noResults.style.display = visible === 0 ? "" : "none";
  }

  /**
   * A task gets the red `--attention` ring when it is still open and
   * carries `priority: high` (or `attention: true`) in its frontmatter.
   * Anything else falls back to the plain `--open` ring.
   */
  private isTaskAttention(task: TaskRecord): boolean {
    const priority = task.properties["priority"];
    if (typeof priority === "string" && priority.toLocaleLowerCase() === "high") {
      return true;
    }
    return task.properties["attention"] === true;
  }

  private renderTaskCard(
    task: TaskRecord,
    projectTitle?: string,
  ): HTMLElement {
    const card = createEl("li", { cls: "devhelper-task-card" });
    if (task.status === "done") card.addClass("is-done");
    // Used by the in-place search filter (`applyTaskQueryFilter`).
    card.dataset["title"] = task.title;
    card.dataset["status"] = task.status;

    // Left: title + subtitle stacked. Right (`actions`) stays inline
    // so the card reads as a single horizontal row like the design ref.
    const main = card.createEl("div", { cls: "devhelper-task-main" });

    // Title row: clickable title plus the optional project badge in
    // `showAll` mode (omitted in project mode where it would repeat
    // the panel context).
    const titleRow = main.createEl("div", {
      cls: "devhelper-task-title-row",
    });
    const titleEl = titleRow.createEl("h4", {
      cls: "devhelper-task-title",
      text: task.title,
    });
    titleEl.addEventListener("click", () => this.openNote(task.path));

    if (projectTitle !== undefined) {
      titleRow.createEl("span", {
        cls: "devhelper-task-project-badge",
        text: projectTitle,
      });
    }

    // Placeholder subtitle until the `description` property lands (spec
    // roadmap); always rendered so the card height is stable.
    main.createEl("p", {
      cls: "devhelper-task-subtitle",
      text: "Sin descripción",
    });

    const actions = card.createEl("div", { cls: "devhelper-task-actions" });

    // Delete goes to Obsidian's trash (recoverable) after an explicit
    // confirmation.
    const deleteBtn = actions.createEl("button", {
      cls: "devhelper-icon-button devhelper-task-icon",
      attr: {
        "aria-label": "Eliminar tarea",
        type: "button",
        title: "Mover a la papelera",
      },
    });
    setIcon(deleteBtn, "trash-2");
    deleteBtn.addEventListener("click", () => this.openDeleteTask(task));

    // Edit jumps straight to the note; the title is edited there.
    const editBtn = actions.createEl("button", {
      cls: "devhelper-icon-button devhelper-task-icon",
      attr: { "aria-label": "Editar tarea", type: "button" },
    });
    setIcon(editBtn, "pencil");
    editBtn.addEventListener("click", () => this.openNote(task.path));

    // The status circle carries no text/icon: its appearance is pure
    // CSS (`--open` hollow gray, `--done` filled green, `--attention`
    // red hollow for flagged tasks).
    const attention =
      task.status === "open" && this.isTaskAttention(task);
    if (attention) card.addClass("is-attention");
    const statusCircle = actions.createEl("button", {
      cls: `devhelper-status-circle devhelper-status-circle--${task.status === "done" ? "done" : attention ? "attention" : "open"}`,
      attr: { "aria-label": "Cambiar estado", type: "button" },
    });
    statusCircle.addEventListener("click", () =>
      void this.toggleTaskStatus(task),
    );

    return card;
  }

  private renderNoteCard(
    note: NoteRecord,
    projectTitle?: string,
  ): HTMLElement {
    const card = createEl("li", { cls: "devhelper-task-card devhelper-note-card" });
    card.dataset["title"] = note.title;
    card.dataset["kind"] = "note";

    const main = card.createEl("div", { cls: "devhelper-task-main" });

    const titleRow = main.createEl("div", {
      cls: "devhelper-task-title-row",
    });
    const titleEl = titleRow.createEl("h4", {
      cls: "devhelper-task-title",
      text: note.title,
    });
    titleEl.addEventListener("click", () => this.openNote(note.path));

    titleRow.createEl("span", {
      cls: "devhelper-task-project-badge devhelper-note-badge",
      text: "Nota",
    });
    if (projectTitle !== undefined) {
      titleRow.createEl("span", {
        cls: "devhelper-task-project-badge",
        text: projectTitle,
      });
    }

    main.createEl("p", {
      cls: "devhelper-task-subtitle",
      text: "Nota simple",
    });

    const actions = card.createEl("div", { cls: "devhelper-task-actions" });

    const deleteBtn = actions.createEl("button", {
      cls: "devhelper-icon-button devhelper-task-icon",
      attr: {
        "aria-label": "Eliminar nota",
        type: "button",
        title: "Mover a la papelera",
      },
    });
    setIcon(deleteBtn, "trash-2");
    deleteBtn.addEventListener("click", () => this.openDeleteNote(note));

    const editBtn = actions.createEl("button", {
      cls: "devhelper-icon-button devhelper-task-icon",
      attr: { "aria-label": "Editar nota", type: "button" },
    });
    setIcon(editBtn, "pencil");
    editBtn.addEventListener("click", () => this.openNote(note.path));

    return card;
  }

  private renderIssues(issues: DashboardIssue[]): void {
    if (issues.length === 0) return;
    const panel = this.contentEl.createEl("section", {
      cls: "devhelper-issues",
    });
    panel.createEl("h3", { text: "Notas con problemas" });
    const list = panel.createEl("ul", { cls: "devhelper-issue-list" });
    for (const issue of issues) {
      const item = list.createEl("li", { cls: "devhelper-issue-item" });
      item.createEl("strong", { text: issue.path });
      item.createEl("p", { text: issue.message });
      const openBtn = item.createEl("button", {
        cls: "devhelper-button",
        text: "Abrir nota",
      });
      openBtn.addEventListener("click", () => this.openNote(issue.path));
    }
  }

  /**
   * Columna estrecha de herramientas entre el panel de tareas y el
   * calendario. Contenedor listo para los botones que el usuario pueda
   * configurar en el futuro; por ahora sólo trae el de Ajustes, que
   * abre la pestaña de ajustes del plugin.
   */
  private renderToolbarRail(): void {
    const rail = this.contentEl.createEl("div", {
      cls: "devhelper-toolbar-rail",
    });

    const settingsButton = rail.createEl("button", {
      cls: "devhelper-icon-button",
      attr: {
        "aria-label": "Ajustes",
        title: "Ajustes",
        type: "button",
      },
    });
    setIcon(settingsButton, "settings");
    settingsButton.addEventListener("click", () => this.openPluginSettings());

    // Punto de extensión: aquí irán los botones configurables por el
    // usuario (futuro). No renderizar nada más por ahora.
  }

  /**
   * Abre los ajustes de Obsidian en la pestaña de este plugin. `setting`
   * es API interna (no está en `obsidian.d.ts`), así que se estrecha el
   * tipo vía `unknown` y se protege en runtime. Si no está disponible,
   * degradación elegante con un `Notice` en español.
   */
  private openPluginSettings(): void {
    const setting = this.app as unknown as {
      setting?: {
        open?: () => void;
        openTabById?: (id: string) => void;
      };
    };
    if (
      typeof setting.setting?.open !== "function" ||
      typeof setting.setting?.openTabById !== "function"
    ) {
      new Notice("No se pudo abrir los ajustes del plugin.");
      return;
    }
    try {
      setting.setting.open();
      setting.setting.openTabById("devhelper-dashboard");
    } catch (err) {
      console.error("DevHelper: no se pudo abrir los ajustes", err);
      new Notice("No se pudo abrir los ajustes del plugin.");
    }
  }

  /**
   * Columna derecha del layout: la tarjeta del calendario semanal.
   *
   * Ahora es funcional: navegación de semana en memoria, puntitos por
   * tipo de evento (`data.calendarEvents`) y apertura de la vista mes
   * al pulsar `+` o un día concreto. No muta el repositorio.
   */
  private renderSideColumn(data: DashboardData): void {
    const column = this.contentEl.createEl("div", {
      cls: "devhelper-side-column",
    });

    const today = new Date();
    const base = new Date(today);
    base.setDate(today.getDate() + this.sideWeekOffset * 7);
    const strip = getWeekStrip(base);

    const calendar = column.createEl("section", {
      cls: "devhelper-calendar",
    });

    const header = calendar.createEl("div", {
      cls: "devhelper-calendar-header",
    });
    header.createEl("strong", {
      text: `${strip.monthLabel} ${strip.year}`,
    });

    const prevBtn = header.createEl("button", {
      cls: "devhelper-icon-button",
      attr: {
        type: "button",
        "aria-label": "Semana anterior",
        title: "Semana anterior",
      },
    });
    setIcon(prevBtn, "chevron-left");
    prevBtn.addEventListener("click", () => {
      this.sideWeekOffset--;
      void this.refresh();
    });

    const todayBtn = header.createEl("button", {
      cls: "devhelper-calendar-nav-today",
      text: "Hoy",
      attr: {
        type: "button",
        title: "Ir a la semana actual",
      },
    });
    todayBtn.addEventListener("click", () => {
      this.sideWeekOffset = 0;
      void this.refresh();
    });

    const nextBtn = header.createEl("button", {
      cls: "devhelper-icon-button",
      attr: {
        type: "button",
        "aria-label": "Semana siguiente",
        title: "Semana siguiente",
      },
    });
    setIcon(nextBtn, "chevron-right");
    nextBtn.addEventListener("click", () => {
      this.sideWeekOffset++;
      void this.refresh();
    });

    const addBtn = header.createEl("button", {
      cls: "devhelper-icon-button",
      attr: {
        type: "button",
        "aria-label": "Abrir calendario",
        title: "Abrir calendario",
      },
    });
    setIcon(addBtn, "plus");
    const baseIso = this.toIsoDate(base);
    addBtn.addEventListener("click", () => this.openCalendar(baseIso));

    const weekdays = calendar.createEl("div", {
      cls: "devhelper-calendar-weekdays",
    });
    for (const letter of ["L", "M", "X", "J", "V", "S", "D"]) {
      weekdays.createEl("span", { text: letter });
    }

    const days = calendar.createEl("div", { cls: "devhelper-calendar-days" });
    const events = data.calendarEvents ?? [];
    const monthCache = new Map<string, Map<string, CalendarOccurrence[]>>();

    const monday = new Date(base);
    const offsetToMonday = (base.getDay() + 6) % 7;
    monday.setDate(base.getDate() - offsetToMonday);
    const todayIso = this.toIsoDate(today);

    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      const iso = this.toIsoDate(date);

      const cell = days.createEl("button", {
        cls: "devhelper-calendar-day",
        attr: { type: "button", "aria-label": iso },
      });
      cell.style.flexDirection = "column";
      cell.style.gap = "1px";
      cell.createEl("span", { text: String(date.getDate()) });
      if (iso === todayIso) cell.addClass("is-today");

      const occurrences = this.getDayOccurrences(events, date, monthCache);
      if (occurrences.length > 0) {
        const dots = cell.createEl("div", {
          cls: "devhelper-calendar-dots",
        });
        const seen = new Set<CalendarKind>();
        for (const occurrence of occurrences) {
          const kind = occurrence.event.kind;
          if (seen.has(kind)) continue;
          seen.add(kind);
          dots.createEl("span", {
            cls: `devhelper-calendar-dot devhelper-dot--${kind}`,
          });
        }
      }

      cell.addEventListener("click", () => this.openCalendar(iso));
    }
  }

  private toIsoDate(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  private getDayOccurrences(
    events: CalendarEventRecord[],
    date: Date,
    cache: Map<string, Map<string, CalendarOccurrence[]>>,
  ): CalendarOccurrence[] {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const key = `${year}-${month}`;
    let byDate = cache.get(key);
    if (byDate === undefined) {
      byDate = expandOccurrences(events, year, month);
      cache.set(key, byDate);
    }
    return byDate.get(this.toIsoDate(date)) ?? [];
  }

  private renderBottomSections(
    data: DashboardData,
    presentation: DashboardPresentation,
    decrypted: Map<string, CredentialDisplay[]>,
  ): void {
    const row = this.contentEl.createEl("div", {
      cls: "devhelper-bottom-sections",
    });

    this.renderFilesSection(row, data, presentation);
    this.renderCredentialsSection(row, data, decrypted);
  }

  private renderFilesSection(
    row: HTMLElement,
    data: DashboardData,
    presentation: DashboardPresentation,
  ): void {
    const section = row.createEl("section", { cls: "devhelper-section" });
    const header = section.createEl("div", {
      cls: "devhelper-section-header",
    });
    header.createEl("h3", { text: "Archivos" });

    const fabs = header.createEl("div", { cls: "devhelper-panel-fabs" });

    const filterButton = fabs.createEl("button", {
      cls: "devhelper-icon-button",
      attr: { "aria-label": "Filtrar archivos", title: "Filtrar", type: "button" },
    });
    setIcon(filterButton, "funnel");
    if (this.showFileFilters) filterButton.addClass("is-active");
    filterButton.addEventListener("click", () => {
      this.showFileFilters = !this.showFileFilters;
      void this.refresh();
    });

    // Ámbito de copia: el proyecto en alcance, o General en «Todos».
    // Sin General (hub roto/ausente) el `+` queda deshabilitado.
    const scopePath = this.fileScopePath(data, presentation);
    const addButton = fabs.createEl("button", {
      cls: "devhelper-fab",
      attr: {
        "aria-label": "Añadir archivo",
        title: "Añadir archivo",
        type: "button",
      },
    });
    setIcon(addButton, "plus");
    if (scopePath === null) {
      addButton.disabled = true;
    } else {
      addButton.addEventListener("click", () => this.openAddFiles(scopePath));
    }

    if (this.showFileFilters) {
      this.renderFileFilters(section);
    }

    const list = section.createEl("ul", { cls: "devhelper-file-list" });
    if (presentation.files.length === 0) {
      const emptyItem = list.createEl("li", {
        cls: "devhelper-task-empty",
      });
      this.appendEmptyState(emptyItem, "files", "No hay archivos");
      this.applyFileQueryFilter(list);
      return;
    }

    for (const file of presentation.files) {
      list.appendChild(this.renderFileCard(file));
    }
    this.applyFileQueryFilter(list);
  }

  /**
   * Fila de filtro de archivos: reutiliza las clases de tareas
   * (`.devhelper-task-filters/-search`) para compartir silueta y CSS.
   * Filtra en memoria sin `refresh()` para no robar el foco al teclear.
   */
  private renderFileFilters(section: HTMLElement): void {
    const filters = section.createEl("div", {
      cls: "devhelper-task-filters",
    });
    const search = filters.createEl("input", {
      cls: "devhelper-task-search",
      type: "search",
      placeholder: "Buscar archivos…",
      attr: { "aria-label": "Buscar archivos" },
    });
    search.value = this.fileQuery;
    search.addEventListener("input", (evt) => {
      this.fileQuery = (evt.target as HTMLInputElement).value;
      const list = section.querySelector<HTMLElement>(".devhelper-file-list");
      if (list !== null) this.applyFileQueryFilter(list);
    });
  }

  /**
   * Oculta/muestra las filas ya renderizadas por nombre de fichero
   * (contiene, case-insensitive). Mantiene una fila «Sin resultados»
   * sincronizada para no dejar nunca la lista en blanco.
   */
  private applyFileQueryFilter(list: HTMLElement): void {
    const query = this.fileQuery.trim().toLocaleLowerCase();
    let noResults = list.querySelector<HTMLElement>(
      ".devhelper-file-no-results",
    );
    if (noResults === null) {
      noResults = list.createEl("li", {
        cls: "devhelper-task-empty devhelper-file-no-results",
      });
      this.appendEmptyState(noResults, "search-x", "Sin resultados");
    }
    if (query === "") {
      for (const child of Array.from(list.children)) {
        if (child !== noResults) (child as HTMLElement).style.display = "";
      }
      noResults.style.display = "none";
      return;
    }
    let visible = 0;
    for (const child of Array.from(list.children)) {
      if (child === noResults) continue;
      const el = child as HTMLElement;
      const name = (el.dataset["title"] ?? "").toLocaleLowerCase();
      const match = name.includes(query);
      el.style.display = match ? "" : "none";
      if (match) visible++;
    }
    noResults.style.display = visible === 0 ? "" : "none";
  }

  /**
   * Fila de archivo: reutiliza la silueta de tarjeta de tarea
   * (`.devhelper-task-card`) para compartir el CSS oscuro. El nombre
   * abre el fichero al hacer clic; la lupa de carpeta lo muestra en el
   * explorador; la papelera pide confirmación.
   */
  private renderFileCard(file: FileRecord): HTMLElement {
    const card = createEl("li", {
      cls: "devhelper-task-card devhelper-file-card",
    });
    // Clave del filtro en memoria (`applyFileQueryFilter`).
    card.dataset["title"] = file.name;

    const main = card.createEl("div", { cls: "devhelper-task-main" });
    const titleRow = main.createEl("div", {
      cls: "devhelper-task-title-row",
    });
    const iconEl = titleRow.createEl("span", {
      cls: "devhelper-file-icon",
      attr: { "aria-hidden": "true" },
    });
    setIcon(iconEl, "file");
    const titleEl = titleRow.createEl("h4", {
      cls: "devhelper-task-title",
      text: file.name,
      attr: { title: "Abrir archivo" },
    });
    titleEl.addEventListener("click", () => this.openFile(file.path));

    const actions = card.createEl("div", { cls: "devhelper-task-actions" });

    // Mostrar en el explorador de archivos (revela el fichero).
    const revealBtn = actions.createEl("button", {
      cls: "devhelper-icon-button devhelper-task-icon",
      attr: {
        "aria-label": "Ver en el explorador de archivos",
        type: "button",
        title: "Ver en el explorador de archivos",
      },
    });
    setIcon(revealBtn, "folder-search");
    revealBtn.addEventListener("click", () => this.openFileInExplorer(file.path));

    const deleteBtn = actions.createEl("button", {
      cls: "devhelper-icon-button devhelper-task-icon",
      attr: {
        "aria-label": "Eliminar archivo",
        type: "button",
        title: "Mover a la papelera",
      },
    });
    setIcon(deleteBtn, "trash-2");
    deleteBtn.addEventListener("click", () => this.openDeleteFile(file));

    return card;
  }

  /**
   * Proyecto dueño del ámbito de archivos: el seleccionado en modo
   * proyecto; el proyecto sombra General en modo «Todos». `null` cuando
   * General no existe (el `+` queda deshabilitado).
   */
  private fileScopePath(
    data: DashboardData,
    presentation: DashboardPresentation,
  ): string | null {
    if (!presentation.showAll && presentation.selectedProject !== null) {
      return presentation.selectedProject.path;
    }
    const general = data.projects.find((p) => p.isGeneral === true);
    return general ? general.path : null;
  }

  /**
   * Credentials note the "Contraseña" section shows: the selected
   * project's own record, or General's shared record in "all" mode
   * (pure helper in the presenter layer, unit-tested there).
   */
  private credentialsRecordForSelection(
    data: DashboardData,
  ): { projectPath: string; record: CredentialsRecord | null } | null {
    return resolveVisibleCredentialsRecord(data, this.selection);
  }

  /**
   * Best-effort decrypted rows for the selected project. Empty when the
   * session is locked or there is nothing to show; entries that fail to
   * decrypt are flagged corrupt by `decryptEntryForDisplay`, never throw.
   */
  private async decryptVisibleCredentials(
    data: DashboardData,
  ): Promise<Map<string, CredentialDisplay[]>> {
    const out = new Map<string, CredentialDisplay[]>();
    const key = this.credentialsDeps.session.getKey();
    if (key === null) {
      return out;
    }
    const visible = this.credentialsRecordForSelection(data);
    if (visible === null || visible.record === null) {
      return out;
    }
    const displays = await Promise.all(
      visible.record.entries.map((entry) =>
        decryptEntryForDisplay(entry, key),
      ),
    );
    out.set(visible.record.projectPath, displays);
    return out;
  }

  private renderCredentialsSection(
    row: HTMLElement,
    data: DashboardData,
    decrypted: Map<string, CredentialDisplay[]>,
  ): void {
    const section = row.createEl("section", { cls: "devhelper-section" });
    const header = section.createEl("div", {
      cls: "devhelper-section-header",
    });
    header.createEl("h3", { text: "Contraseña" });

    const salt = this.credentialsDeps.getSaltB64();
    const verifier = this.credentialsDeps.getVerifier();

    if (!salt || !verifier) {
      if (salt || verifier) {
        // Hand-edited data.json with only half of the key material.
        this.appendEmptyState(
          section,
          "triangle-alert",
          "Configuración de cifrado incompleta. Restablece para empezar de cero.",
        );
        this.renderCredentialReset(section);
      } else {
        this.appendEmptyState(
          section,
          "key-round",
          "Protege todas las credenciales con una única contraseña maestra.",
        );
        const createBtn = section.createEl("button", {
          cls: "devhelper-button",
          text: "Crear contraseña maestra",
        });
        createBtn.addEventListener("click", () =>
          this.openCreateMasterPassword(),
        );
      }
      return;
    }

    const visible = this.credentialsRecordForSelection(data);
    if (visible === null) {
      this.appendEmptyState(
        section,
        "key-round",
        "Selecciona un proyecto para ver sus credenciales.",
      );
      return;
    }

    // Cabecera unificada con el resto de paneles (Tareas/Archivos):
    // [+] para añadir + candado para bloquear/desbloquear.
    const isLocked = !this.credentialsDeps.session.isUnlocked();
    const fabs = header.createEl("div", { cls: "devhelper-panel-fabs" });
    const addBtn = fabs.createEl("button", {
      cls: "devhelper-fab",
      attr: {
        "aria-label": "Añadir contraseña",
        title: isLocked ? "Desbloquea para añadir" : "Añadir contraseña",
        type: "button",
      },
    });
    setIcon(addBtn, "plus");
    if (isLocked) {
      addBtn.disabled = true;
    } else {
      addBtn.addEventListener("click", () =>
        this.openCreateCredential(visible.projectPath),
      );
    }
    const lockBtn = fabs.createEl("button", {
      cls: "devhelper-icon-button",
      attr: {
        "aria-label": isLocked ? "Desbloquear" : "Bloquear",
        title: isLocked ? "Desbloquear" : "Bloquear",
        type: "button",
      },
    });
    setIcon(lockBtn, "lock");
    if (isLocked) {
      lockBtn.addEventListener("click", () => this.openUnlockMasterPassword());
    } else {
      lockBtn.addEventListener("click", () => this.lockCredentials());
    }

    if (isLocked) {
      this.renderLockedCredentials(section, visible);
      return;
    }
    this.renderUnlockedCredentials(
      section,
      visible,
      decrypted.get(visible.projectPath) ?? [],
    );
  }

  private renderLockedCredentials(
    section: HTMLElement,
    visible: { projectPath: string; record: CredentialsRecord | null },
  ): void {
    const names = visible.record?.entries.map((e) => e.service) ?? [];
    if (names.length === 0) {
      this.appendEmptyState(
        section,
        "key-round",
        "Este proyecto aún no tiene credenciales.",
      );
    } else {
      const list = section.createEl("ul", {
        cls: "devhelper-credential-list",
      });
      for (const name of names) {
        const item = list.createEl("li", {
          cls: "devhelper-credential-locked",
        });
        const icon = item.createEl("span", {
          cls: "devhelper-credential-lock-icon",
          attr: { "aria-hidden": "true" },
        });
        setIcon(icon, "lock");
        item.createEl("span", { text: name });
      }
    }
    const actions = section.createEl("div", {
      cls: "devhelper-form-actions",
    });
    const forgotBtn = actions.createEl("button", {
      cls: "devhelper-link-button",
      text: "Olvidé mi contraseña",
    });
    forgotBtn.addEventListener("click", () =>
      this.renderCredentialReset(section),
    );
  }

  private renderUnlockedCredentials(
    section: HTMLElement,
    visible: { projectPath: string; record: CredentialsRecord | null },
    displays: CredentialDisplay[],
  ): void {
    const session = this.credentialsDeps.session;
    const mins = Math.ceil(session.msUntilLock() / 60000);
    const status = section.createEl("div", {
      cls: "devhelper-credential-status",
    });
    status.createEl("span", {
      text: `Desbloqueado · se bloquea en ${mins <= 1 ? "menos de un minuto" : `~${mins} min`}`,
    });

    const record = visible.record;
    if (record?.needsMigration) {
      const count = record.entries.filter(
        (e) =>
          typeof e.password === "string" && !isEncryptedValue(e.password),
      ).length;
      const banner = section.createEl("div", {
        cls: "devhelper-migration-banner",
      });
      banner.createEl("span", {
        text: `Tienes ${count} credencial${count === 1 ? "" : "es"} sin cifrar.`,
      });
      const migrateBtn = banner.createEl("button", {
        cls: "devhelper-button",
        text: "Cifrar ahora",
      });
      migrateBtn.addEventListener("click", () =>
        void this.migrateVisibleCredentials(visible.projectPath),
      );
    }

    if (!record || displays.length === 0) {
      this.appendEmptyState(
        section,
        "key-round",
        "Este proyecto aún no tiene credenciales.",
      );
    } else {
      const list = section.createEl("ul", {
        cls: "devhelper-credential-list",
      });
      record.entries.forEach((entry, index) => {
        const display = displays[index] ?? {
          service: entry.service,
          user: null,
          password: null,
          url: null,
          notes: null,
          corrupt: true,
        };
        list.appendChild(
          this.renderCredentialRow(visible.projectPath, index, entry, display),
        );
      });
    }
  }

  /**
   * One credential as a task-like dark card: service as the title, one
   * muted subtitle line per field, icon actions on the right. Reuses the
   * task-card classes so both panels read as the same component.
   */
  /**
   * One credential as a task-like dark card: service as the title, the
   * user as a small subtitle, and a copy button that opens the detail
   * modal (full fields + per-field copy). Edit/delete stay on the card.
   * Reuses the task-card classes so both panels read as the same
   * component.
   */
  private renderCredentialRow(
    projectPath: string,
    index: number,
    entry: CredentialEntry,
    display: CredentialDisplay,
  ): HTMLElement {
    const item = createEl("li", { cls: "devhelper-task-card" });
    const main = item.createEl("div", { cls: "devhelper-task-main" });

    const titleRow = main.createEl("div", {
      cls: "devhelper-task-title-row",
    });
    titleRow.createEl("h4", {
      text: entry.service,
      cls: "devhelper-task-title devhelper-credential-title",
    });

    if (display.corrupt) {
      main.createEl("p", {
        text: "No se pudo descifrar esta entrada (datos corruptos).",
        cls: "devhelper-task-subtitle devhelper-credential-corrupt",
      });
    } else if (display.user !== null) {
      main.createEl("p", {
        text: display.user,
        cls: "devhelper-task-subtitle",
      });
    }

    const actions = item.createEl("div", {
      cls: "devhelper-task-actions",
    });
    if (!display.corrupt) {
      const detailBtn = actions.createEl("button", {
        cls: "devhelper-icon-button devhelper-task-icon",
        attr: { "aria-label": "Ver y copiar credencial", type: "button" },
      });
      setIcon(detailBtn, "copy");
      detailBtn.addEventListener("click", () =>
        this.openCredentialDetail(entry.service, display),
      );
      const editBtn = actions.createEl("button", {
        cls: "devhelper-icon-button devhelper-task-icon",
        attr: { "aria-label": "Editar credencial", type: "button" },
      });
      setIcon(editBtn, "pencil");
      editBtn.addEventListener("click", () =>
        this.openEditCredential(projectPath, index, entry.service, display),
      );
    }
    const deleteBtn = actions.createEl("button", {
      cls: "devhelper-icon-button devhelper-task-icon",
      attr: { "aria-label": "Eliminar credencial", type: "button" },
    });
    setIcon(deleteBtn, "trash-2");
    deleteBtn.addEventListener("click", () =>
      this.openDeleteCredential(projectPath, index, entry.service),
    );
    return item;
  }

  private openCredentialDetail(
    service: string,
    display: CredentialDisplay,
  ): void {
    const modal = new CredentialDetailModal(this.app, {
      service,
      display,
      onCopy: (value) => void this.copySecret(value),
    });
    modal.open();
  }

  /**
   * Danger zone for a forgotten master password. Clearing the key
   * material is irreversible: existing blobs stay on disk but become
   * undecryptable (they surface as corrupt rows the user can delete).
   */
  private renderCredentialReset(section: HTMLElement): void {
    const warn = section.createEl("div", { cls: "devhelper-danger-zone" });
    warn.createEl("p", {
      text: "Sin la contraseña maestra no hay recuperación posible: las credenciales cifradas quedarán ilegibles. Solo sigue si asumes esa pérdida.",
    });
    const confirm = warn.createEl("button", {
      cls: "devhelper-button devhelper-button-danger",
      text: "Restablecer y empezar de cero",
    });
    confirm.addEventListener("click", () => void this.resetKeyMaterial());
  }

  private async resetKeyMaterial(): Promise<void> {
    try {
      await this.credentialsDeps.clearKeyMaterial();
      await this.refresh();
    } catch (err) {
      console.error("DevHelper: failed to reset key material", err);
      new Notice("No se pudo restablecer. Inténtalo de nuevo.");
    }
  }

  private lockCredentials(): void {
    this.credentialsDeps.session.lock();
    void this.refresh();
  }

  private async copySecret(value: string): Promise<void> {
    this.credentialsDeps.session.touch();
    try {
      await navigator.clipboard.writeText(value);
      new Notice("Copiado.");
    } catch {
      new Notice("No se pudo copiar.");
    }
  }

  private async migrateVisibleCredentials(
    projectPath: string,
  ): Promise<void> {
    try {
      const key = this.credentialsDeps.session.getKey();
      const count = await this.repository.migratePlaintextCredentials(
        projectPath,
        key,
      );
      this.credentialsDeps.session.touch();
      new Notice(
        count === 0
          ? "No había credenciales sin cifrar."
          : `Migradas ${count} credencial${count === 1 ? "" : "es"}.`,
      );
      await this.refresh();
    } catch (err) {
      console.error("DevHelper: failed to migrate credentials", err);
      new Notice("No se pudo migrar. Desbloquea e inténtalo de nuevo.");
    }
  }

  private openCreateMasterPassword(): void {
    const modal = new MasterPasswordModal(this.app, {
      mode: "create",
      onSubmit: (password) => {
        void (async () => {
          try {
            const salt = await createSaltB64();
            const key = await deriveKey(password, salt);
            const verifier = await createVerifier(key);
            await this.credentialsDeps.saveKeyMaterial(salt, verifier);
            this.credentialsDeps.session.setTimeoutMinutes(
              this.settings.credentialLockTimeoutMinutes,
            );
            await this.credentialsDeps.session.unlock(password, salt, verifier);
            modal.close();
            await this.refresh();
          } catch (err) {
            console.error("DevHelper: failed to create master password", err);
            modal.showError("No se pudo crear la contraseña maestra.");
          }
        })();
      },
    });
    modal.open();
  }

  /**
   * Ask for the master password. On success the modal closes and either
   * `afterUnlock` runs (chained save from an open credential form) or
   * the view simply refreshes into the unlocked state. Failures keep
   * the modal open with a generic message.
   */
  private openUnlockMasterPassword(afterUnlock?: () => void): void {
    const modal = new MasterPasswordModal(this.app, {
      mode: "unlock",
      onSubmit: (password) => {
        void (async () => {
          const salt = this.credentialsDeps.getSaltB64();
          const verifier = this.credentialsDeps.getVerifier();
          if (!salt || !verifier) {
            modal.showError("Configuración de cifrado incompleta.");
            return;
          }
          try {
            await this.credentialsDeps.session.unlock(password, salt, verifier);
            modal.close();
            if (afterUnlock) {
              afterUnlock();
            } else {
              await this.refresh();
            }
          } catch {
            modal.showError("Contraseña incorrecta.");
          }
        })();
      },
    });
    modal.open();
  }

  private openCreateCredential(projectPath: string): void {
    let modal: CredentialFormModal | null = null;
    modal = new CredentialFormModal(this.app, {
      mode: "create",
      onSubmit: (payload) =>
        this.persistCredential(modal, projectPath, null, null, payload),
    });
    modal.open();
  }

  private openEditCredential(
    projectPath: string,
    index: number,
    service: string,
    display: CredentialDisplay,
  ): void {
    let modal: CredentialFormModal | null = null;
    modal = new CredentialFormModal(this.app, {
      mode: "edit",
      initial: {
        service,
        user: display.user ?? "",
        password: display.password ?? "",
        url: display.url ?? "",
        notes: display.notes ?? "",
      },
      onSubmit: (payload: CredentialInput) =>
        this.persistCredential(modal, projectPath, index, service, payload),
    });
    modal.open();
  }

  /**
   * Persist a credential form. When the session expired while the modal
   * was open, the modal keeps its text and an unlock prompt opens on
   * top: unlocking retries the same payload instead of losing it.
   */
  private async persistCredential(
    modal: CredentialFormModal | null,
    projectPath: string,
    index: number | null,
    expectedService: string | null,
    payload: CredentialInput,
  ): Promise<void> {
    const key = this.credentialsDeps.session.getKey();
    if (key === null) {
      this.openUnlockMasterPassword(() => {
        void this.persistCredential(
          modal,
          projectPath,
          index,
          expectedService,
          payload,
        );
      });
      throw new Error("Sesión bloqueada. Desbloquea para guardar.");
    }
    if (index === null) {
      await this.repository.createCredential(projectPath, payload, key);
    } else {
      await this.repository.updateCredential(
        projectPath,
        index,
        expectedService ?? "",
        payload,
        key,
      );
    }
    this.credentialsDeps.session.touch();
    await this.refresh();
  }

  private openDeleteCredential(
    projectPath: string,
    index: number,
    service: string,
  ): void {
    const modal = new ConfirmModal(this.app, {
      title: "Eliminar credencial",
      message: `¿Eliminar la credencial de «${service}»? Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      onConfirm: async () => {
        await this.repository.deleteCredential(
          projectPath,
          index,
          this.credentialsDeps.session.getKey(),
        );
        this.credentialsDeps.session.touch();
        await this.refresh();
      },
    });
    modal.open();
  }

  // -------------------------------------------------------------------------
  // Sort helper used by the view (the presenter already sorts projects
  // internally; we expose the same ordering here so the project chips
  // match the rest of the dashboard).
  // -------------------------------------------------------------------------

  private sortProjectsForSelect(projects: ProjectRecord[]): ProjectRecord[] {
    return [...projects].sort((a, b) => {
      const al = a.title.toLocaleLowerCase();
      const bl = b.title.toLocaleLowerCase();
      if (al < bl) return -1;
      if (al > bl) return 1;
      if (a.path < b.path) return -1;
      if (a.path > b.path) return 1;
      return 0;
    });
  }

  // -------------------------------------------------------------------------
  // Modal orchestrators
  // -------------------------------------------------------------------------

  private openCreateProject(): void {
    const modal = new ProjectFormModal(this.app, {
      mode: "create",
      onSubmit: async (payload) => {
        try {
          const hubPath = await this.repository.createProject(payload.title);
          // The picker flow (Task 4): a freshly created project is
          // automatically promoted to favorites and selected so the
          // user lands on it instead of staring at "Todos".
          await this.repository.setProjectFavorite(hubPath, true);
          this.setSelection({ kind: "project", path: hubPath });
        } catch (err) {
          // We surface the failure through the console for v1. A
          // dedicated error toast lands in a later iteration.
          console.error("DevHelper: failed to create project", err);
        }
      },
    });
    modal.open();
  }

  /**
   * Reveal a project's folder in the Obsidian file explorer. The
   * `revealInFolder` method is an internal API on the file explorer
   * view (not exposed in `obsidian.d.ts`), so we narrow the type
   * through `unknown` and guard at runtime. Falls back to a `Notice`
   * when the file explorer isn't open or the file isn't found.
   */
  private openProjectFolder(folderPath: string): void {
    this.revealInExplorer(
      folderPath,
      "No se pudo abrir la carpeta en el explorador de archivos.",
    );
  }

  /**
   * Reveal a file in the Obsidian file explorer. Shares the internal
   * `revealInFolder` API with `openProjectFolder`; `revealInFolder`
   * accepts both files and folders.
   */
  private openFileInExplorer(filePath: string): void {
    this.revealInExplorer(
      filePath,
      "No se pudo mostrar el archivo en el explorador.",
    );
  }

  private revealInExplorer(path: string, failureNotice: string): void {
    const abstract = this.app.vault.getAbstractFileByPath(path);
    const leaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
    const view = leaf?.view as unknown as {
      revealInFolder?: (f: unknown) => void;
    };
    if (abstract && view && typeof view.revealInFolder === "function") {
      view.revealInFolder(abstract);
    } else {
      new Notice(failureNotice);
    }
  }

  /**
   * Open the dashboard's own vault search: a fuzzy modal in the same
   * style as the favorites picker. Lists every Markdown note in the
   * vault; picking one opens it.
   */
  private openVaultSearch(): void {
    const modal = new VaultSearchModal(this.app, (file) =>
      this.openNote(file.path),
    );
    modal.open();
  }

  /**
   * Open the fuzzy picker that lets the user promote a non-favorite
   * project to favorites (or create a new one through the synthetic
   * "Crear proyecto nuevo…" entry). The picker always operates on
   * the freshest vault data so a project renamed in another pane
   * shows up immediately.
   */
  private async openAddFavorite(): Promise<void> {
    const projects = (await this.repository.load()).projects
      .filter((p) => !p.favorite && !p.isGeneral)
      .sort((a, b) => {
        const al = a.title.toLocaleLowerCase();
        const bl = b.title.toLocaleLowerCase();
        if (al < bl) return -1;
        if (al > bl) return 1;
        if (a.path < b.path) return -1;
        if (a.path > b.path) return 1;
        return 0;
      });
    const modal = new ProjectPickerModal(this.app, projects, (result) => {
      if (result.kind === "create") {
        this.openCreateProject();
      } else {
        void (async () => {
          await this.repository.setProjectFavorite(result.project.path, true);
          this.setSelection({ kind: "project", path: result.project.path });
        })();
      }
    });
    modal.open();
  }

  private async openCreateTask(): Promise<void> {
    // Pull the project list from the live vault so we never show a
    // stale list (the user might have renamed a project in another
    // pane while this view was hidden).
    const projects = (await this.repository.load()).projects;
    if (projects.length === 0) {
      // Repository would refuse anyway; we make the failure obvious.
      console.warn(
        "DevHelper: cannot create a task without at least one project.",
      );
      return;
    }
    const modal = new TaskFormModal(this.app, {
      mode: "create",
      projects,
      defaultProjectPath:
        this.selection.kind === "project" ? this.selection.path : null,
      onSubmit: async (payload) => {
        try {
          await this.repository.createTask(payload.title, payload.projectPath);
          await this.refresh();
        } catch (err) {
          console.error("DevHelper: failed to create task", err);
        }
      },
    });
    modal.open();
  }

  private async openCreateNote(): Promise<void> {
    const projects = (await this.repository.load()).projects;
    if (projects.length === 0) {
      console.warn(
        "DevHelper: cannot create a note without at least one project.",
      );
      return;
    }
    const modal = new NoteFormModal(this.app, {
      mode: "create",
      projects,
      defaultProjectPath:
        this.selection.kind === "project" ? this.selection.path : null,
      onSubmit: async (payload) => {
        try {
          await this.repository.createNote(payload.title, payload.projectPath);
          await this.refresh();
        } catch (err) {
          console.error("DevHelper: failed to create note", err);
        }
      },
    });
    modal.open();
  }

  private openDeleteNote(note: NoteRecord): void {
    const modal = new ConfirmDeleteModal(this.app, {
      taskTitle: note.title,
      onConfirm: async () => {
        try {
          await this.repository.deleteNote(note.path);
          await this.refresh();
        } catch (err) {
          console.error("DevHelper: failed to delete note", err);
        }
      },
    });
    modal.open();
  }

  private openDeleteTask(task: TaskRecord): void {
    const modal = new ConfirmDeleteModal(this.app, {
      taskTitle: task.title,
      onConfirm: async () => {
        try {
          await this.repository.deleteTask(task.path);
          await this.refresh();
        } catch (err) {
          console.error("DevHelper: failed to delete task", err);
        }
      },
    });
    modal.open();
  }

  /**
   * Copia uno o varios ficheros del sistema al `Archivos/` del proyecto
   * en ámbito. Usa un `<input type=file multiple>` oculto: los bytes se
   * leen con `arrayBuffer()` y entran por `repository.addFile()` (nunca
   * por `app.vault.*` directo). Tras copiar, un `refresh()` muestra las
   * filas nuevas sin recarga manual.
   */
  private openAddFiles(scopePath: string): void {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.display = "none";
    const cleanup = (): void => {
      input.remove();
    };
    input.addEventListener("change", () => {
      const picked = input.files;
      cleanup();
      if (picked === null || picked.length === 0) return;
      void (async () => {
        try {
          for (const pickedFile of Array.from(picked)) {
            const data = await pickedFile.arrayBuffer();
            await this.repository.addFile(
              scopePath,
              pickedFile.name,
              data,
            );
          }
          await this.refresh();
        } catch (err) {
          console.error("DevHelper: no se pudo añadir el archivo", err);
          new Notice("No se pudo añadir el archivo.");
        }
      })();
    });
    // El diálogo puede cancelarse sin `change`: retirar el nodo huérfano.
    input.addEventListener("cancel", cleanup);
    document.body.appendChild(input);
    input.click();
  }

  private openDeleteFile(file: FileRecord): void {
    const modal = new ConfirmDeleteModal(this.app, {
      taskTitle: file.name,
      onConfirm: async () => {
        try {
          await this.repository.deleteFile(file.path);
          await this.refresh();
        } catch (err) {
          console.error("DevHelper: no se pudo mover el archivo a la papelera", err);
          new Notice("No se pudo mover el archivo a la papelera.");
        }
      },
    });
    modal.open();
  }

  private openFile(path: string): void {
    void this.app.workspace
      .openLinkText(path, "")
      .catch(() => new Notice("No se pudo abrir el archivo."));
  }

  private async toggleTaskStatus(task: TaskRecord): Promise<void> {
    const next = task.status === "done" ? "open" : "done";
    try {
      await this.repository.setTaskStatus(task.path, next);
      await this.refresh();
    } catch (err) {
      console.error("DevHelper: failed to toggle task status", err);
    }
  }

  // -------------------------------------------------------------------------
  // Vault helpers
  // -------------------------------------------------------------------------

  private openNote(path: string): void {
    void this.app.workspace.openLinkText(path, "");
  }
}