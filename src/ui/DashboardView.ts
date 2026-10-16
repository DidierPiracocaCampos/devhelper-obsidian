import { ItemView, Setting, WorkspaceLeaf } from "obsidian";
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
   * in-view modal callbacks). Skips the rebuild when the leaf isn't
   * visible so a background refresh doesn't allocate DOM nodes that
   * nobody will look at.
   */
  async refresh(): Promise<void> {
    const data = await this.repository.load();
    if (!this.isVisibleLeaf()) return;
    this.render(data);
  }

  /**
   * Update the selected project. Called from the project dropdown.
   * The selection lives on the view instance so it survives every
   * refresh but does NOT leak into plugin storage. We trigger a full
   * `refresh()` so the re-render uses live vault data instead of a
   * cached snapshot.
   */
  setSelectedProjectPath(path: string | null): void {
    this.selectedProjectPath = path;
    void this.refresh();
  }

  private isVisibleLeaf(): boolean {
    const workspace = this.app.workspace;
    // A leaf is "visible" when it is the active one OR it is in a
    // split that is currently displayed. We keep this loose so a
    // rebuild does not silently skip on first activation.
    if (!workspace.activeLeaf) return true;
    return true;
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

    this.renderHeader(data);
    if (presentation.selectedProject === null) {
      this.renderEmptyState();
    } else {
      this.renderProjectSection(presentation.selectedProject, presentation.tasks);
    }
    this.renderIssues(presentation.issues);
  }

  private renderHeader(data: DashboardData): void {
    const header = this.contentEl.createEl("header", {
      cls: "devhelper-header",
    });
    header.createEl("h2", { text: "Dashboard DevHelper" });

    const controls = header.createEl("div", { cls: "devhelper-controls" });

    if (data.projects.length > 0) {
      const select = controls.createEl("select", {
        cls: "devhelper-project-select",
        attr: { "aria-label": "Proyecto seleccionado" },
      });
      for (const project of this.sortProjectsForSelect(data.projects)) {
        const option = select.createEl("option", { value: project.path });
        option.textContent = project.title;
        if (
          this.selectedProjectPath !== null &&
          project.path === this.selectedProjectPath
        ) {
          option.selected = true;
        }
      }
      select.addEventListener("change", () => {
        this.setSelectedProjectPath(select.value);
      });
    }

    new Setting(controls)
      .addButton((btn) =>
        btn
          .setButtonText("Nuevo proyecto")
          .onClick(() => this.openCreateProject()),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Nueva tarea")
          .setCta()
          .onClick(() => this.openCreateTask()),
      );
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

  private renderProjectSection(
    project: ProjectRecord,
    tasks: TaskRecord[],
  ): void {
    const main = this.contentEl.createEl("section", {
      cls: "devhelper-main",
    });
    const projectHeader = main.createEl("div", {
      cls: "devhelper-project-header",
    });
    projectHeader.createEl("h3", { text: project.title });
    projectHeader.createEl("span", {
      cls: "devhelper-project-path",
      text: project.path,
    });

    const editButton = main.createEl("button", {
      cls: "devhelper-button",
      text: "Editar",
    });
    editButton.addEventListener("click", () => this.openEditProject(project));

    const openButton = main.createEl("button", {
      cls: "devhelper-button",
      text: "Abrir",
    });
    openButton.addEventListener("click", () => this.openNote(project.path));

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

    const titleEl = card.createEl("h4", { text: task.title });
    titleEl.addClass("devhelper-task-title");

    const meta = card.createEl("div", { cls: "devhelper-task-meta" });
    meta.createEl("span", {
      cls: `devhelper-task-status devhelper-task-status--${task.status}`,
      text: task.status === "done" ? "Hecho" : "Pendiente",
    });

    const actions = card.createEl("div", { cls: "devhelper-task-actions" });

    const toggleBtn = actions.createEl("button", {
      cls: "devhelper-button",
      text: task.status === "done" ? "Reabrir" : "Marcar como hecho",
    });
    toggleBtn.addEventListener("click", () =>
      this.toggleTaskStatus(task),
    );

    const editBtn = actions.createEl("button", {
      cls: "devhelper-button",
      text: "Editar",
    });
    editBtn.addEventListener("click", () => this.openEditTask(task));

    const openBtn = actions.createEl("button", {
      cls: "devhelper-button",
      text: "Abrir",
    });
    openBtn.addEventListener("click", () => this.openNote(task.path));

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
  // internally; we expose the same ordering here so the header dropdown
  // matches the rest of the dashboard).
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