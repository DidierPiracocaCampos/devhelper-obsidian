import { ItemView, Menu, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import type { PluginSettings } from "../settings";
import type {
  DashboardData,
  DashboardIssue,
  ProjectRecord,
  TaskRecord,
} from "../domain/types";
import {
  presentDashboard,
  type DashboardPresentation,
  type DashboardSelection,
} from "../domain/presentDashboard";
import { getWeekStrip } from "../domain/weekStrip";
import type { ProjectTaskRepository } from "../data/ProjectTaskRepository";
import { ProjectFormModal } from "./ProjectFormModal";
import { ProjectPickerModal } from "./ProjectPickerModal";
import { TaskFormModal } from "./TaskFormModal";

export const VIEW_TYPE_DEVHELPER_DASHBOARD = "devhelper-dashboard";

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

  private selection: DashboardSelection = { kind: "all" };

  constructor(
    leaf: WorkspaceLeaf,
    repository: ProjectTaskRepository,
    settings: PluginSettings,
  ) {
    super(leaf);
    // The plugin's `app` field is already set by `super(leaf)`.
    this.repository = repository;
    this.settings = settings;
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
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /**
   * Reload data from the repository and rebuild the DOM. Safe to call
   * from anywhere (command palette, ribbon, vault event handler,
   * in-view modal callbacks).
   */
  async refresh(): Promise<void> {
    const data = await this.repository.load();
    this.render(data);
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

  private renderEmpty(): void {
    this.contentEl.empty();
    this.contentEl.addClass("devhelper-dashboard-root");
    const main = this.contentEl.createEl("div", { cls: "devhelper-main" });
    main.createEl("h2", { text: "Dashboard DevHelper" });
    main.createEl("p", {
      cls: "devhelper-empty",
      text: "Cargando proyectos y tareas…",
    });
  }

  private render(data: DashboardData): void {
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
    this.renderSideColumn();
    this.renderBottomSections();
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

    // The search field and its `Ctrl+K` hint now sit side-by-side inside
    // the controls (not stacked on top of each other): the input takes
    // its natural width and the hint renders right next to it as a
    // monospace pill. Per the design ref, the hint must NEVER overlap
    // the placeholder, which is why we no longer use absolute
    // positioning here.
    const searchWrap = controls.createEl("div", {
      cls: "devhelper-search-wrap",
    });
    const search = searchWrap.createEl("input", {
      cls: "devhelper-search",
      type: "search",
      placeholder: "Busca en el vault…",
      attr: { "aria-label": "Búsqueda del workspace" },
    });
    search.disabled = true;
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
    main.createEl("p", {
      cls: "devhelper-empty",
      text: "No hay proyectos todavía. Crea el primero con el botón + de arriba.",
    });
  }

  private renderTasksPanel(
    presentation: DashboardPresentation,
    data: DashboardData,
  ): void {
    const tasks = presentation.tasks;
    const main = this.contentEl.createEl("section", {
      cls: "devhelper-tasks-panel",
    });

    // Header row: project title/path on the left (or a generic
    // «Todas las tareas» title in `showAll` mode) and the panel FABs
    // stacked on the right edge. The task list below wraps onto its
    // own row (`.devhelper-task-list` gets `flex-basis: 100%`).
    const panelHeader = main.createEl("div", {
      cls: "devhelper-tasks-panel-header",
    });
    const projectHeader = panelHeader.createEl("div", {
      cls: "devhelper-project-header",
    });
    if (presentation.selectedProject !== null) {
      projectHeader.createEl("h3", {
        text: presentation.selectedProject.title,
      });
      projectHeader.createEl("span", {
        cls: "devhelper-project-path",
        text: presentation.selectedProject.path,
      });
    } else {
      projectHeader.createEl("h3", { text: "Todas las tareas" });
    }

    const fabs = panelHeader.createEl("div", {
      cls: "devhelper-panel-fabs",
    });

    // Placeholder filter: no click listener on purpose (spec rule).
    const filterButton = fabs.createEl("button", {
      cls: "devhelper-icon-button",
      attr: { "aria-label": "Filtrar", type: "button" },
    });
    setIcon(filterButton, "funnel");

    const createTaskButton = fabs.createEl("button", {
      cls: "devhelper-fab",
      attr: { "aria-label": "Nueva tarea", type: "button" },
    });
    setIcon(createTaskButton, "plus");
    createTaskButton.addEventListener("click", () =>
      void this.openCreateTask(),
    );

    const list = main.createEl("ul", { cls: "devhelper-task-list" });
    if (tasks.length === 0) {
      const emptyText =
        presentation.showAll || presentation.selectedProject === null
          ? "Aún no hay tareas en ningún proyecto."
          : "Este proyecto aún no tiene tareas.";
      list.createEl("li", {
        cls: "devhelper-task-empty",
        text: emptyText,
      });
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
  }

  private renderTaskCard(
    task: TaskRecord,
    projectTitle?: string,
  ): HTMLElement {
    const card = createEl("li", { cls: "devhelper-task-card" });
    if (task.status === "done") card.addClass("is-done");

    // The title is the primary affordance: clicking it opens the note.
    const titleEl = card.createEl("h4", {
      cls: "devhelper-task-title",
      text: task.title,
    });
    titleEl.addEventListener("click", () => this.openNote(task.path));

    // In `showAll` mode the parent project is not obvious from the
    // panel header, so each card gets a small pill next to its title.
    if (projectTitle !== undefined) {
      card.createEl("span", {
        cls: "devhelper-task-project-badge",
        text: projectTitle,
      });
    }

    // Placeholder subtitle until the `description` property lands (spec
    // roadmap); always rendered so the card height is stable.
    card.createEl("p", {
      cls: "devhelper-task-subtitle",
      text: "Sin descripción",
    });

    const actions = card.createEl("div", { cls: "devhelper-task-actions" });

    // Delete is not part of v1: the button is rendered but inert.
    const deleteBtn = actions.createEl("button", {
      cls: "devhelper-icon-button devhelper-task-icon",
      attr: {
        "aria-label": "Eliminar tarea",
        type: "button",
        title: "Disponible en una versión futura",
      },
    });
    setIcon(deleteBtn, "trash-2");
    deleteBtn.disabled = true;

    const editBtn = actions.createEl("button", {
      cls: "devhelper-icon-button devhelper-task-icon",
      attr: { "aria-label": "Editar tarea", type: "button" },
    });
    setIcon(editBtn, "pencil");
    editBtn.addEventListener("click", () => void this.openEditTask(task));

    // The status circle carries no text/icon: its appearance is pure
    // CSS (`--open` hollow, `--done` filled green).
    const statusCircle = actions.createEl("button", {
      cls: `devhelper-status-circle devhelper-status-circle--${task.status}`,
      attr: { "aria-label": "Cambiar estado", type: "button" },
    });
    statusCircle.addEventListener("click", () =>
      void this.toggleTaskStatus(task),
    );

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
   * Right-hand column of the layout: the icon rail stacked above the
   * weekly calendar card.
   *
   * Everything here is a visual placeholder — the controls are rendered
   * for the silhouette only and carry no listeners, so they cannot
   * mutate the repository or the vault.
   */
  private renderSideColumn(): void {
    const column = this.contentEl.createEl("div", {
      cls: "devhelper-side-column",
    });

    // 1. Icon rail: four inert round buttons.
    const rail = column.createEl("div", { cls: "devhelper-icon-rail" });
    const railIcons: Array<{ icon: string; label: string }> = [
      { icon: "funnel", label: "Filtrar" },
      { icon: "code", label: "Código" },
      { icon: "settings", label: "Ajustes" },
      { icon: "log-out", label: "Salir" },
    ];
    for (const entry of railIcons) {
      const button = rail.createEl("button", {
        cls: "devhelper-icon-button",
        attr: {
          "aria-label": entry.label,
          title: entry.label,
          type: "button",
        },
      });
      setIcon(button, entry.icon);
    }

    // 2. Calendar card: month label, inert controls, weekday header,
    //    the seven days of the current ISO week and an empty state.
    const strip = getWeekStrip(new Date());
    const calendar = column.createEl("section", {
      cls: "devhelper-calendar",
    });

    const header = calendar.createEl("div", {
      cls: "devhelper-calendar-header",
    });
    header.createEl("strong", { text: strip.monthLabel });

    const calendarControls: Array<{ icon: string; label: string }> = [
      { icon: "chevron-left", label: "Mes anterior" },
      { icon: "plus", label: "Hoy" },
      { icon: "chevron-right", label: "Mes siguiente" },
      { icon: "plus", label: "Añadir evento" },
    ];
    for (const entry of calendarControls) {
      const button = header.createEl("button", {
        cls: "devhelper-icon-button",
        attr: {
          "aria-label": entry.label,
          title: entry.label,
          type: "button",
        },
      });
      setIcon(button, entry.icon);
    }

    const weekdays = calendar.createEl("div", {
      cls: "devhelper-calendar-weekdays",
    });
    for (const letter of ["L", "M", "X", "J", "V", "S", "D"]) {
      weekdays.createEl("span", { text: letter });
    }

    const days = calendar.createEl("div", { cls: "devhelper-calendar-days" });
    for (const day of strip.days) {
      const cell = days.createEl("span", {
        cls: "devhelper-calendar-day",
        text: String(day.day),
      });
      if (day.isToday) cell.addClass("is-today");
    }

    calendar.createEl("p", {
      cls: "devhelper-placeholder-empty",
      text: "No hay eventos este día",
    });
  }

  /**
   * Bottom row of the layout: two side-by-side placeholder panels. Both
   * are empty silhouettes — the FABs carry no listeners (the `+` is
   * additionally disabled) and the bodies only show an empty state.
   */
  private renderBottomSections(): void {
    const row = this.contentEl.createEl("div", {
      cls: "devhelper-bottom-sections",
    });

    const renderSection = (
      title: string,
      emptyText: string,
      addLabel: string,
    ): void => {
      const section = row.createEl("section", { cls: "devhelper-section" });
      section.createEl("h3", { text: title });
      section.createEl("p", {
        cls: "devhelper-placeholder-empty",
        text: emptyText,
      });

      const fabs = section.createEl("div", { cls: "devhelper-panel-fabs" });

      // Placeholder filter: no click listener on purpose (spec rule).
      const filterButton = fabs.createEl("button", {
        cls: "devhelper-icon-button",
        attr: { "aria-label": "Filtrar", title: "Filtrar", type: "button" },
      });
      setIcon(filterButton, "funnel");

      // Decorative `+`: disabled, same signalling as the task trash.
      const addButton = fabs.createEl("button", {
        cls: "devhelper-fab",
        attr: { "aria-label": addLabel, title: addLabel, type: "button" },
      });
      setIcon(addButton, "plus");
      addButton.disabled = true;
    };

    renderSection("Archivos", "No hay archivos", "Añadir archivo");
    renderSection("Contraseña", "Sin contraseñas", "Añadir contraseña");
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
    const abstract = this.app.vault.getAbstractFileByPath(folderPath);
    const leaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
    const view = leaf?.view as unknown as {
      revealInFolder?: (f: unknown) => void;
    };
    if (abstract && view && typeof view.revealInFolder === "function") {
      view.revealInFolder(abstract);
    } else {
      new Notice("No se pudo abrir la carpeta en el explorador de archivos.");
    }
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
      .filter((p) => !p.favorite)
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

  private async openEditTask(task: TaskRecord): Promise<void> {
    // Pull the project list from the live vault so the dropdown
    // matches what the repository would actually accept.
    const projects = (await this.repository.load()).projects;
    const modal = new TaskFormModal(this.app, {
      mode: "edit",
      initial: {
        title: task.title,
        projectPath: task.projectPath,
        path: task.path,
      },
      projects,
      defaultProjectPath: task.projectPath,
      onSubmit: async (payload) => {
        try {
          if (payload.title !== task.title) {
            await this.repository.renameTask(task.path, payload.title);
          }
          if (payload.projectPath !== task.projectPath) {
            await this.repository.reassignTask(task.path, payload.projectPath);
          }
          await this.refresh();
        } catch (err) {
          console.error("DevHelper: failed to edit task", err);
        }
      },
    });
    modal.open();
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