import { describe, it, expect } from "vitest";
import { presentDashboard } from "../src/domain/presentDashboard";
import type {
  DashboardData,
  DashboardIssue,
  NoteRecord,
  ProjectRecord,
  TaskRecord,
} from "../src/domain/types";

/**
 * Tests for the deterministic dashboard presentation layer.
 *
 * `presentDashboard` is the seam between the repository and the view.
 * The layer must:
 *
 *  - Treat `{ kind: "all" }` as the default: every project is in scope,
 *    and every task is returned sorted by the global contract.
 *  - Honour `{ kind: "project", path }` exactly when the path matches an
 *    existing project; filter tasks down to that project only.
 *  - Fall back to `{ kind: "all" }` when the requested project is gone
 *    (or there are no projects at all).
 *  - Keep `open` tasks above `done` ones, even when titles would sort the
 *    other way around.
 *  - Surface validation issues verbatim so the view can offer an "open
 *    note" action on each one.
 */

function project(path: string, title: string): ProjectRecord {
  return { path, title, folderPath: folderOf(path), favorite: false, properties: {} };
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

function note(
  path: string,
  title: string,
  projectPath: string,
): NoteRecord {
  return { path, title, projectPath, properties: {} };
}

function issue(path: string, message: string): DashboardIssue {
  return { path, message };
}

describe("presentDashboard", () => {
  it("returnsEmptyPresentationForEmptyData", () => {
    const data: DashboardData = { projects: [], tasks: [], notes: [], credentials: [], issues: [] };
    const result = presentDashboard(data, { kind: "all" });

    expect(result.selection).toEqual({ kind: "all" });
    expect(result.showAll).toBe(true);
    expect(result.selectedProject).toBeNull();
    expect(result.tasks).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it("selectsAllTasksWhenSelectionIsAll", () => {
    const alfa = project("Projects/Alfa.md", "Alfa");
    const beta = project("Projects/Beta.md", "Beta");
    const data: DashboardData = {
      projects: [alfa, beta],
      tasks: [
        task("Tasks/Alfa-1.md", "Alfa task 1", alfa.path, "open"),
        task("Tasks/Beta-1.md", "Beta task 1", beta.path, "open"),
        task("Tasks/Alfa-2.md", "Alfa task 2", alfa.path, "done"),
      ],
      notes: [],
      credentials: [],
      issues: [],
    };

    const result = presentDashboard(data, { kind: "all" });

    expect(result.selection).toEqual({ kind: "all" });
    expect(result.showAll).toBe(true);
    expect(result.selectedProject).toBeNull();
    // Todos los proyectos son "in-scope"; el panel devuelve TODAS las tareas.
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks.map((t) => t.path).sort()).toEqual([
      "Tasks/Alfa-1.md",
      "Tasks/Alfa-2.md",
      "Tasks/Beta-1.md",
    ]);
  });

  it("sortsAllTasksOpenFirstAcrossProjects", () => {
    // Con `kind: "all"` el presentador ordena por status primero; las
    // tareas `open` de cualquier proyecto deben aparecer antes que las
    // `done`, aunque por título la de Beta vaya antes. Dentro de cada
    // status el orden secundario es por título.
    const alfa = project("Projects/Alfa.md", "Alfa");
    const beta = project("Projects/Beta.md", "Beta");
    const data: DashboardData = {
      projects: [alfa, beta],
      tasks: [
        // "Done task" tiene título que lexicográficamente iría primero,
        // pero el status manda.
        task("Tasks/beta-done.md", "Done task", beta.path, "done"),
        task("Tasks/alfa-open.md", "Zeta", alfa.path, "open"),
        task("Tasks/alfa-done.md", "Middle", alfa.path, "done"),
      ],
      notes: [],
      credentials: [],
      issues: [],
    };

    const result = presentDashboard(data, { kind: "all" });

    expect(result.tasks.map((t) => t.path)).toEqual([
      "Tasks/alfa-open.md",
      // Dentro de `done`: "Done task" (Beta) < "Middle" (Alfa).
      "Tasks/beta-done.md",
      "Tasks/alfa-done.md",
    ]);
  });

  it("selectsRequestedProject", () => {
    const alfa = project("Projects/Alfa.md", "Alfa");
    const beta = project("Projects/Beta.md", "Beta");
    const data: DashboardData = {
      projects: [alfa, beta],
      tasks: [
        task("Tasks/Alfa-1.md", "Alfa task 1", alfa.path, "open"),
        task("Tasks/Beta-1.md", "Beta task 1", beta.path, "open"),
        task("Tasks/Alfa-2.md", "Alfa task 2", alfa.path, "done"),
      ],
      notes: [],
      credentials: [],
      issues: [],
    };

    const result = presentDashboard(data, {
      kind: "project",
      path: alfa.path,
    });

    expect(result.selection).toEqual({ kind: "project", path: alfa.path });
    expect(result.showAll).toBe(false);
    expect(result.selectedProject?.path).toBe(alfa.path);
    expect(result.tasks).toHaveLength(2);
    for (const t of result.tasks) {
      expect(t.projectPath).toBe(alfa.path);
    }
  });

  it("sortsProjectTasksOpenBeforeDone", () => {
    const p = project("Projects/Alfa.md", "Alfa");
    const data: DashboardData = {
      projects: [p],
      tasks: [
        // "Done task" sorts BEFORE "Open task" by title; status must win.
        task("Tasks/done.md", "Done task", p.path, "done"),
        task("Tasks/open.md", "Open task", p.path, "open"),
      ],
      notes: [],
      credentials: [],
      issues: [],
    };

    const result = presentDashboard(data, {
      kind: "project",
      path: p.path,
    });

    expect(result.tasks.map((t) => t.path)).toEqual([
      "Tasks/open.md",
      "Tasks/done.md",
    ]);
  });

  it("fallsBackToAllWhenSelectedProjectIsMissing", () => {
    const alfa = project("Projects/Alfa.md", "Alfa");
    const beta = project("Projects/Beta.md", "Beta");
    const data: DashboardData = {
      projects: [beta, alfa],
      tasks: [
        task("Tasks/Alfa-1.md", "Alfa task 1", alfa.path, "open"),
        task("Tasks/Beta-1.md", "Beta task 1", beta.path, "open"),
      ],
      notes: [],
      credentials: [],
      issues: [],
    };

    const result = presentDashboard(data, {
      kind: "project",
      path: "Projects/Ghost.md",
    });

    // El proyecto fantasma no existe; el presentador cae a `kind: "all"`.
    expect(result.selection).toEqual({ kind: "all" });
    expect(result.showAll).toBe(true);
    expect(result.selectedProject).toBeNull();
    // Y `tasks` ahora contiene todas las tareas (no filtradas por proyecto).
    expect(result.tasks).toHaveLength(2);
  });

  it("returnsIssuesVerbatim", () => {
    const p = project("Projects/Alfa.md", "Alfa");
    const issues = [
      issue("Tasks/broken.md", "Falta la propiedad 'project'."),
      issue("Tasks/another.md", "Estado no admitido: 'closed'."),
    ];
    const data: DashboardData = {
      projects: [p],
      tasks: [],
      notes: [],
      credentials: [],
      issues,
    };

    const result = presentDashboard(data, {
      kind: "project",
      path: p.path,
    });

    expect(result.issues).toEqual(issues);
  });

  it("filtersNotesBySelectedProject", () => {
    const alfa = project("Projects/Alfa.md", "Alfa");
    const beta = project("Projects/Beta.md", "Beta");
    const data: DashboardData = {
      projects: [alfa, beta],
      tasks: [task("Tasks/Alfa-1.md", "Alfa task 1", alfa.path, "open")],
      notes: [
        note("Projects/Alfa/Notas/Idea.md", "Idea alfa", alfa.path),
        note("Projects/Beta/Notas/Idea.md", "Idea beta", beta.path),
      ],
      credentials: [],
      issues: [],
    };

    const result = presentDashboard(data, {
      kind: "project",
      path: alfa.path,
    });

    expect(result.notes.map((n) => n.path)).toEqual([
      "Projects/Alfa/Notas/Idea.md",
    ]);
  });

  it("returnsAllNotesWhenSelectionIsAll", () => {
    const alfa = project("Projects/Alfa.md", "Alfa");
    const beta = project("Projects/Beta.md", "Beta");
    const data: DashboardData = {
      projects: [alfa, beta],
      tasks: [],
      notes: [
        note("Projects/Beta/Notas/B.md", "B", beta.path),
        note("Projects/Alfa/Notas/A.md", "A", alfa.path),
      ],
      credentials: [],
      issues: [],
    };

    const result = presentDashboard(data, { kind: "all" });

    expect(result.notes.map((n) => n.title)).toEqual(["A", "B"]);
  });
});
