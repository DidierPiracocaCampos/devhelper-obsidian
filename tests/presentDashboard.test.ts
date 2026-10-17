import { describe, it, expect } from "vitest";
import { presentDashboard } from "../src/domain/presentDashboard";
import type {
  DashboardData,
  DashboardIssue,
  ProjectRecord,
  TaskRecord,
} from "../src/domain/types";

/**
 * Tests for the deterministic dashboard presentation layer.
 *
 * `presentDashboard` is the seam between the repository (Task 4) and the
 * `DashboardView` (Task 5). The layer must:
 *
 *  - Pick a sensible default project when the caller hasn't chosen one.
 *  - Filter tasks down to the selected project only.
 *  - Sort projects and tasks deterministically so the rendered order is
 *    stable across refreshes.
 *  - Keep `open` tasks above `done` ones, even when titles would sort the
 *    other way around.
 *  - Fall back to the first project if the requested selection is gone.
 *  - Surface validation issues verbatim so the view can offer an "open
 *    note" action on each one.
 */

function project(path: string, title: string): ProjectRecord {
  return { path, title, folderPath: folderOf(path), properties: {} };
}

function folderOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx < 0 ? "" : path.slice(0, idx);
}

function task(
  path: string,
  title: string,
  projectPath: string,
  status: "open" | "done",
): TaskRecord {
  return { path, title, projectPath, status, properties: {} };
}

function issue(path: string, message: string): DashboardIssue {
  return { path, message };
}

describe("presentDashboard", () => {
  describe("showsEmptyDashboard", () => {
    it("returns null selected project and empty arrays for empty data", () => {
      const data: DashboardData = { projects: [], tasks: [], credentials: [], issues: [] };
      const result = presentDashboard(data, null);

      expect(result.selectedProject).toBeNull();
      expect(result.tasks).toEqual([]);
      expect(result.issues).toEqual([]);
    });
  });

  describe("selectsFirstProjectByDefault", () => {
    it("selects the first sorted project when selectedProjectPath is null", () => {
      // The projects arrive at the presenter in an arbitrary order; the
      // presenter must reorder them deterministically and then take the
      // first one as the default selection.
      const a = project("Projects/Beta.md", "Beta");
      const c = project("Projects/Charlie.md", "Charlie");
      const b = project("Projects/Alfa.md", "Alfa");
      const data: DashboardData = {
        projects: [a, c, b],
        tasks: [],
        credentials: [],
        issues: [],
      };

      const result = presentDashboard(data, null);

      expect(result.selectedProject).not.toBeNull();
      expect(result.selectedProject!.title).toBe("Alfa");
      expect(result.selectedProject!.path).toBe("Projects/Alfa.md");
    });
  });

  describe("filtersTasksToSelectedProject", () => {
    it("returns only tasks for the selected project", () => {
      const alfa = project("Projects/Alfa.md", "Alfa");
      const beta = project("Projects/Beta.md", "Beta");
      const data: DashboardData = {
        projects: [alfa, beta],
        tasks: [
          task("Tasks/Alfa-1.md", "Alfa task 1", alfa.path, "open"),
          task("Tasks/Beta-1.md", "Beta task 1", beta.path, "open"),
          task("Tasks/Alfa-2.md", "Alfa task 2", alfa.path, "done"),
        ],
        credentials: [],
        issues: [],
      };

      const result = presentDashboard(data, alfa.path);

      expect(result.selectedProject?.path).toBe(alfa.path);
      expect(result.tasks).toHaveLength(2);
      for (const t of result.tasks) {
        expect(t.projectPath).toBe(alfa.path);
      }
    });
  });

  describe("ordersOpenTasksBeforeDone", () => {
    it("places open tasks before done tasks even when title sort would disagree", () => {
      const p = project("Projects/Alfa.md", "Alfa");
      const data: DashboardData = {
        projects: [p],
        tasks: [
          // "Done task" sorts BEFORE "Open task" by title; status must win.
          task("Tasks/done.md", "Done task", p.path, "done"),
          task("Tasks/open.md", "Open task", p.path, "open"),
        ],
        credentials: [],
        issues: [],
      };

      const result = presentDashboard(data, p.path);

      expect(result.tasks.map((t) => t.path)).toEqual([
        "Tasks/open.md",
        "Tasks/done.md",
      ]);
    });
  });

  describe("showsValidationIssues", () => {
    it("returns issues from data without filtering them", () => {
      const p = project("Projects/Alfa.md", "Alfa");
      const issues = [
        issue("Tasks/broken.md", "Falta la propiedad 'project'."),
        issue("Tasks/another.md", "Estado no admitido: 'closed'."),
      ];
      const data: DashboardData = {
        projects: [p],
        tasks: [],
        credentials: [],
        issues,
      };

      const result = presentDashboard(data, p.path);

      expect(result.issues).toEqual(issues);
    });
  });

  describe("ordersProjectsByTitle", () => {
    it("sorts projects by title ascending, case-insensitive, with path tiebreaker", () => {
      const zeta = project("Projects/Zeta.md", "zeta");
      const ALFA = project("Projects/ALFA.md", "ALFA");
      const middle = project("Projects/Middle.md", "Middle");
      const data: DashboardData = {
        projects: [zeta, ALFA, middle],
        tasks: [],
        credentials: [],
        issues: [],
      };

      const result = presentDashboard(data, null);

      // Order: "ALFA", "Middle", "zeta" (case-insensitive asc).
      expect(result.selectedProject?.path).toBe("Projects/ALFA.md");
    });
  });

  describe("ordersTasksByTitleWithinStatus", () => {
    it("sorts tasks of the same status by title, case-insensitive, with path tiebreaker", () => {
      const p = project("Projects/Alfa.md", "Alfa");
      const data: DashboardData = {
        projects: [p],
        tasks: [
          task("Tasks/z.md", "zeta", p.path, "open"),
          task("Tasks/a.md", "ALFA", p.path, "open"),
          task("Tasks/m.md", "Middle", p.path, "open"),
        ],
        credentials: [],
        issues: [],
      };

      const result = presentDashboard(data, p.path);

      expect(result.tasks.map((t) => t.path)).toEqual([
        "Tasks/a.md",
        "Tasks/m.md",
        "Tasks/z.md",
      ]);
    });
  });

  describe("fallsBackWhenSelectedProjectMissing", () => {
    it("selects the first sorted project when the requested path does not exist", () => {
      const alfa = project("Projects/Alfa.md", "Alfa");
      const beta = project("Projects/Beta.md", "Beta");
      const data: DashboardData = {
        projects: [beta, alfa],
        tasks: [],
        credentials: [],
        issues: [],
      };

      const result = presentDashboard(data, "Projects/Ghost.md");

      // Alfa < Beta case-insensitive, so Alfa wins.
      expect(result.selectedProject?.path).toBe("Projects/Alfa.md");
    });
  });
});