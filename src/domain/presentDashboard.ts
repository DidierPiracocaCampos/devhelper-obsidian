/**
 * Deterministic presentation layer for the dashboard.
 *
 * The view (Task 5) consumes a `DashboardPresentation` so all ordering
 * and selection logic is concentrated here. Keeping the layer pure and
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
 * Selection contract:
 *
 *  - If `selectedProjectPath` matches a project (case-sensitive on the
 *    path), that project wins.
 *  - Otherwise the first project in the sorted list is chosen.
 *  - When there are no projects the selected project is `null` and the
 *    task list is empty regardless of the input.
 *
 * Issues are returned verbatim. The view is responsible for surfacing
 * them with an "open note" affordance.
 */

import type {
  DashboardData,
  DashboardIssue,
  ProjectRecord,
  TaskRecord,
} from "./types";

export interface DashboardPresentation {
  selectedProject: ProjectRecord | null;
  tasks: TaskRecord[];
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

/**
 * Compute the dashboard's current view from the latest repository data
 * and the view's previously selected project path.
 *
 * The function is pure: it does not mutate `data` and never throws.
 */
export function presentDashboard(
  data: DashboardData,
  selectedProjectPath: string | null,
): DashboardPresentation {
  const sortedProjects = [...data.projects].sort(compareProjects);

  let selectedProject: ProjectRecord | null = null;
  if (sortedProjects.length > 0) {
    if (selectedProjectPath !== null) {
      const match = sortedProjects.find(
        (p) => p.path === selectedProjectPath,
      );
      selectedProject = match ?? sortedProjects[0]!;
    } else {
      selectedProject = sortedProjects[0]!;
    }
  }

  const tasks = selectedProject
    ? data.tasks
        .filter((t) => t.projectPath === selectedProject!.path)
        .sort(compareTasks)
    : [];

  return {
    selectedProject,
    tasks,
    issues: data.issues,
  };
}