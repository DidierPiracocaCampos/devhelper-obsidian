import { ItemView, Menu, setIcon, Setting, WorkspaceLeaf } from "obsidian";
import type { PluginSettings } from "../settings";
import type {
  DashboardData,
  DashboardIssue,
  ProjectRecord,
  TaskRecord,
} from "../domain/types";
import { presentDashboard } from "../domain/presentDashboard";
import type { ProjectTaskRepository } from "../data/ProjectTaskRepository";
import { ProjectFormModal } from "./ProjectFormModal";
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

  private selectedProjectPath: string | null = null;

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
   * Update the selected project. Called from the project chips in the
   * top bar.
   * The selection lives on the view instance so it survives every
   * refresh but does NOT leak into plugin storage. We trigger a full
   * `refresh()` so the re-render uses live vault data instead of a
   * cached snapshot.
   */
  setSelectedProjectPath(path: string | null): void {
    this.selectedProjectPath = path;
    void this.refresh();
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  private renderEmpty(): void {
    this.contentEl.empty();
    this.contentEl.addClass("devhelper-dashboard-root");
    this.contentEl.createEl("h2", { text: "Dashboard DevHelper" });
    this.contentEl.createEl("p", {
      cls: "devhelper-empty",
      text: "Cargando proyectos y tareas…",
    });
  }

  private render(data: DashboardData): void {
    const presentation = presentDashboard(data, this.selectedProjectPath);
    // Keep selection in sync with what the presenter chose. This is
    // how the "project disappeared" fall-back (plan rule) is wired
    // into the view's state.
    this.selectedProjectPath = presentation.selectedProject
      ? presentation.selectedProject.path
      : null;

    this.contentEl.removeClass("devhelper-dashboard-root");
    this.contentEl.empty();
    this.contentEl.addClass("devhelper-dashboard-root");

    this.renderTopBar(data);
    if (presentation.selectedProject === null) {
      this.renderEmptyState();
    } else {
      this.renderTasksPanel(presentation.selectedProject, presentation.tasks);
    }
    this.renderIssues(presentation.issues);
  }

  /**
   * Top bar of the new layout: title at the left, project chips next
   * to it, and (pushed to the right edge by `margin-left: auto` on
   * `.devhelper-topbar-controls`) the filter / + / search controls.
   *
   * The filter button is intentionally inert and the search input is
   * disabled — per the spec both are decorative placeholders.
   */
  private renderTopBar(data: DashboardData): void {
    const topbar = this.contentEl.createEl("div", {
      cls: "devhelper-topbar",
    });
    topbar.createEl("h2", { text: "Proyectos" });

    this.renderProjectChips(data);

    const controls = topbar.createEl("div", {
      cls: "devhelper-topbar-controls",
    });

    // Placeholder filter: no click listener on purpose (spec rule).
    const filterButton = controls.createEl("button", {
      cls: "devhelper-icon-button",
      attr: { "aria-label": "Filtrar", type: "button" },
    });
    setIcon(filterButton, "funnel");

    const createProjectButton = controls.createEl("button", {
      cls: "devhelper-fab",
      attr: { "aria-label": "Nuevo proyecto", type: "button" },
    });
    setIcon(createProjectButton, "plus");
    createProjectButton.addEventListener("click", () =>
      this.openCreateProject(),
    );

    const search = controls.createEl("input", {
      cls: "devhelper-search",
      type: "search",
      placeholder: "Pregunta sobre tu workspace…",
      attr: { "aria-label": "Búsqueda del workspace" },
    });
    search.disabled = true;
    controls.createEl("span", {
      cls: "devhelper-search-hint",
      text: "Ctrl+K",
    });
  }

  /**
   * Chip row that replaces the old project `<select>`. Each chip
   * selects its project; the trailing "···" button opens the Obsidian
   * context menu for that project (Editar / Abrir nota).
   *
   * When there are no projects at all we still render a placeholder
   * chip so the always-visible top bar is never blank.
   */
  private renderProjectChips(data: DashboardData): void {
    const topbar = this.contentEl.querySelector<HTMLElement>(
      ".devhelper-topbar",
    );
    if (topbar === null) return;
    const chipList = topbar.createEl("div", { cls: "devhelper-chip-list" });

    const projects = this.sortProjectsForSelect(data.projects);
    if (projects.length === 0) {
      chipList.createEl("span", {
        cls: "devhelper-chip is-placeholder",
        text: "Sin proyectos",
      });
      return;
    }

    for (const project of projects) {
      const chip = chipList.createEl("button", {
        cls: "devhelper-chip",
        text: project.title,
        attr: { "aria-label": project.title, type: "button" },
      });
      if (project.path === this.selectedProjectPath) {
        chip.addClass("is-selected");
      }
      chip.addEventListener("click", () =>
        this.setSelectedProjectPath(project.path),
      );

      const menuButton = chip.createEl("button", {
        cls: "devhelper-chip-menu",
        attr: { "aria-label": "Opciones de proyecto", type: "button" },
      });
      setIcon(menuButton, "more-horizontal");
      menuButton.addEventListener("click", (evt) => {
        // The menu button lives inside the chip: without stopping
        // propagation the click would also select the project.
        evt.stopPropagation();
        const menu = new Menu();
        menu.addItem((item) =>
          item
            .setTitle("Editar")
            .onClick(() => this.openEditProject(project)),
        );
        menu.addItem((item) =>
          item
            .setTitle("Abrir nota")
            .onClick(() => this.openNote(project.path)),
        );
        menu.showAtMouseEvent(evt);
      });
    }
  }

  private renderEmptyState(): void {
    const main = this.contentEl.createEl("section", {
      cls: "devhelper-main",
    });
    main.createEl("p", {
      cls: "devhelper-empty",
      text: "No hay proyectos todavía. Crea el primero con «Nuevo proyecto».",
    });
  }

  private renderTasksPanel(
    project: ProjectRecord,
    tasks: TaskRecord[],
  ): void {
    const main = this.contentEl.createEl("section", {
      cls: "devhelper-tasks-panel",
    });

    // Header row: the project title/path on the left and the panel FABs
    // stacked on the right edge. The task list below wraps onto its
    // own row (`.devhelper-task-list` gets `flex-basis: 100%`).
    const panelHeader = main.createEl("div", {
      cls: "devhelper-tasks-panel-header",
    });
    const projectHeader = panelHeader.createEl("div", {
      cls: "devhelper-project-header",
    });
    projectHeader.createEl("h3", { text: project.title });
    projectHeader.createEl("span", {
      cls: "devhelper-project-path",
      text: project.path,
    });

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
      list.createEl("li", {
        cls: "devhelper-task-empty",
        text: "Este proyecto aún no tiene tareas.",
      });
      return;
    }

    for (const task of tasks) {
      list.appendChild(this.renderTaskCard(task));
    }
  }

  private renderTaskCard(task: TaskRecord): HTMLElement {
    const card = createEl("li", { cls: "devhelper-task-card" });
    if (task.status === "done") card.addClass("is-done");

    // The title is the primary affordance: clicking it opens the note.
    const titleEl = card.createEl("h4", {
      cls: "devhelper-task-title",
      text: task.title,
    });
    titleEl.addEventListener("click", () => this.openNote(task.path));

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
          await this.repository.createProject(payload.title);
          await this.refresh();
        } catch (err) {
          // We surface the failure through the console for v1. A
          // dedicated error toast lands in a later iteration.
          console.error("DevHelper: failed to create project", err);
        }
      },
    });
    modal.open();
  }

  private openEditProject(project: ProjectRecord): void {
    const modal = new ProjectFormModal(this.app, {
      mode: "edit",
      initial: { title: project.title, path: project.path },
      onSubmit: async (payload) => {
        try {
          await this.repository.renameProject(project.path, payload.title);
          await this.refresh();
        } catch (err) {
          console.error("DevHelper: failed to rename project", err);
        }
      },
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
      defaultProjectPath: this.selectedProjectPath,
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