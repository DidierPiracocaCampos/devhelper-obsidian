/**
 * Deterministic presentation layer for the dashboard.
 *
 * The view consumes a `DashboardPresentation` so all ordering and
 * selection logic is concentrated here. Keeping the layer pure and
 * framework-free means the sort/filter rules can be unit-tested in
 * isolation, and the view can stay focused on DOM rendering.
 *
 * Sort contract (kept in sync with the global plan rules):
 *
 *  - Projects: `title` ascending, case-insensitive; ties broken by `path`.
 *  - Tasks:    `status` (`open` before `done`); within each status,
 *               `title` ascending case-insensitive; ties broken by
 *               `path`.
 *
 * Selection contract (discriminated `DashboardSelection`):
 *
 *  - `{ kind: "all" }` is the default mode: `selectedProject` is `null`,
 *    `showAll` is `true` and `tasks` contains every task in the vault
 *    sorted with `compareTasks`.
 *  - `{ kind: "project", path }` is honoured verbatim when `path`
 *    matches an existing project; `showAll` is `false`, `selectedProject`
 *    is that project and `tasks` is filtered to it.
 *  - When the requested project is missing OR the vault has no projects
 *    at all, the presenter falls back to `{ kind: "all" }`: `selection`
 *    becomes `all`, `selectedProject` becomes `null` and `tasks` is the
 *    full list (or empty if there are no projects).
 *
 * `ProjectRecord.favorite` is intentionally ignored here — the view
 * uses it to render the favorites row in Task 4.
 *
 * Issues are returned verbatim. The view is responsible for surfacing
 * them with an "open note" affordance.
 */

import type {
  DashboardData,
  DashboardIssue,
  NoteRecord,
  ProjectRecord,
  TaskRecord,
} from "./types";

/**
 * The view's effective selection. This is a discriminated union so the
 * view can branch on `kind` without carrying a `null` sentinel:
 *
 *  - `{ kind: "all" }`        — no project is selected; every task is
 *                                in scope.
 *  - `{ kind: "project"; path }` — a specific project is selected; only
 *                                its tasks are shown.
 */
export type DashboardSelection =
  | { kind: "all" }
  | { kind: "project"; path: string };

export interface DashboardPresentation {
  /** The effective selection after fallback (always populated). */
  selection: DashboardSelection;
  /** The project picked for the view, or `null` in `kind: "all"` mode. */
  selectedProject: ProjectRecord | null;
  /** `true` when no project is in scope (every task is shown). */
  showAll: boolean;
  tasks: TaskRecord[];
  notes: NoteRecord[];
  issues: DashboardIssue[];
}

/**
 * Project comparator. Case-insensitive on `title`, then `path` as the
 * deterministic tiebreaker so two projects with the same display title
 * still render in a stable order.
 */
function compareProjects(a: ProjectRecord, b: ProjectRecord): number {
  const titleCmp = compareIgnoreCase(a.title, b.title);
  if (titleCmp !== 0) return titleCmp;
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

/**
 * Task comparator. `open` is ranked strictly above `done` so a finished
 * task with a title that would otherwise sort first does not steal the
 * spotlight. Within each status we sort by title (case-insensitive) with
 * a `path` tiebreaker.
 */
function compareTasks(a: TaskRecord, b: TaskRecord): number {
  // `open` must come before `done`. We do not use string ordering
  // because lexically `"done" < "open"` is false; an explicit rank is
  // clearer and won't drift if a new status is added later.
  const statusOrder: Record<TaskRecord["status"], number> = {
    open: 0,
    done: 1,
  };
  const statusCmp = statusOrder[a.status] - statusOrder[b.status];
  if (statusCmp !== 0) return statusCmp;
  const titleCmp = compareIgnoreCase(a.title, b.title);
  if (titleCmp !== 0) return titleCmp;
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

function compareIgnoreCase(a: string, b: string): number {
  const lowerA = a.toLocaleLowerCase();
  const lowerB = b.toLocaleLowerCase();
  if (lowerA < lowerB) return -1;
  if (lowerA > lowerB) return 1;
  return 0;
}

function compareNotes(a: NoteRecord, b: NoteRecord): number {
  const titleCmp = compareIgnoreCase(a.title, b.title);
  if (titleCmp !== 0) return titleCmp;
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

/**
 * Compute the dashboard's current view from the latest repository data
 * and the view's previously selected scope.
 *
 * The function is pure: it does not mutate `data` and never throws.
 *
 * See the file header for the selection contract. The short version:
 * `kind: "all"` shows everything (and is also the fallback when the
 * requested project disappears); `kind: "project"` filters down to a
 * single project and only succeeds when the path actually exists.
 */
export function presentDashboard(
  data: DashboardData,
  selection: DashboardSelection,
): DashboardPresentation {
  const sortedProjects = [...data.projects].sort(compareProjects);

  const allModeSelection: DashboardSelection = { kind: "all" };
  const allTasks = [...data.tasks].sort(compareTasks);
  const allNotes = [...(data.notes ?? [])].sort(compareNotes);

  // No projects at all: nothing for any project to match. We honour the
  // requested mode for the document shape but `selectedProject` is null
  // and there are no project-scoped tasks to render.
  if (sortedProjects.length === 0) {
    return {
      selection: allModeSelection,
      selectedProject: null,
      showAll: true,
      tasks: allTasks,
      notes: allNotes,
      issues: data.issues,
    };
  }

  if (selection.kind === "all") {
    return {
      selection: allModeSelection,
      selectedProject: null,
      showAll: true,
      tasks: allTasks,
      notes: allNotes,
      issues: data.issues,
    };
  }

  // selection.kind === "project"
  const match = sortedProjects.find((p) => p.path === selection.path);
  if (match === undefined) {
    // The requested project disappeared (was renamed/deleted, or the
    // path was a phantom). Fall back to "all" so the user always sees
    // something rather than an empty panel.
    return {
      selection: allModeSelection,
      selectedProject: null,
      showAll: true,
      tasks: allTasks,
      notes: allNotes,
      issues: data.issues,
    };
  }

  return {
    selection,
    selectedProject: match,
    showAll: false,
    tasks: data.tasks
      .filter((t) => t.projectPath === match.path)
      .sort(compareTasks),
    notes: (data.notes ?? [])
      .filter((n) => n.projectPath === match.path)
      .sort(compareNotes),
    issues: data.issues,
  };
}
