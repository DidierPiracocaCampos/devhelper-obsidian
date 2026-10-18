import { describe, it, expect } from "vitest";
import {
  presentDashboard,
  resolveVisibleCredentialsRecord,
} from "../src/domain/presentDashboard";
import type {
  CredentialsRecord,
  DashboardData,
  DashboardIssue,
  FileRecord,
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

function file(
  path: string,
  name: string,
  extension: string,
  projectPath: string,
): FileRecord {
  return { path, name, extension, projectPath };
}

function credentialsRecord(
  projectPath: string,
  services: string[] = [],
): CredentialsRecord {
  return {
    path: `${projectPath.replace(/\.md$/, "")}/Credenciales.md`,
    projectPath,
    needsMigration: false,
    entries: services.map((service) => ({
      service,
      user: "u",
      password: "p",
    })),
  };
}

const GENERAL_HUB = "Projects/General/General.md";
const PROJ_A = "Projects/Alfa/Alfa.md";

function generalProject(): ProjectRecord {
  return {
    path: GENERAL_HUB,
    title: "General",
    folderPath: "Projects/General",
    favorite: false,
    properties: {},
    isGeneral: true,
  };
}

function projectA(): ProjectRecord {
  return {
    path: PROJ_A,
    title: "Alfa",
    folderPath: "Projects/Alfa",
    favorite: false,
    properties: {},
  };
}

describe("presentDashboard", () => {
  it("returnsEmptyPresentationForEmptyData", () => {
    const data: DashboardData = { projects: [], tasks: [], notes: [], credentials: [], files: [], issues: [] };
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
      files: [],
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
      files: [],
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
      files: [],
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
      files: [],
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
      files: [],
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
      files: [],
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
      files: [],
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
      files: [],
      issues: [],
    };

    const result = presentDashboard(data, { kind: "all" });

    expect(result.notes.map((n) => n.title)).toEqual(["A", "B"]);
  });

  it("acota files de General en modo all", () => {
    const general = generalProject();
    const alfa = project("Projects/Alfa.md", "Alfa");
    const dataConGeneralYFiles: DashboardData = {
      projects: [general, alfa],
      tasks: [],
      notes: [],
      credentials: [],
      files: [
        file(
          "Projects/General/Archivos/nota.pdf",
          "nota.pdf",
          "pdf",
          GENERAL_HUB,
        ),
        file(
          "Projects/Alfa/Archivos/diseño.png",
          "diseño.png",
          "png",
          alfa.path,
        ),
      ],
      issues: [],
    };

    const pres = presentDashboard(dataConGeneralYFiles, { kind: "all" });

    expect(pres.files).toHaveLength(1);
    expect(pres.files.every((f) => f.projectPath === GENERAL_HUB)).toBe(true);
    expect(pres.files.some((f) => f.projectPath === alfa.path)).toBe(false);
  });

  it("en proyecto solo devuelve sus tasks, notes y files", () => {
    const general = generalProject();
    const alfa = projectA();
    const fullData: DashboardData = {
      projects: [general, alfa],
      tasks: [
        task("Projects/Alfa/Tareas/a1.md", "A1", PROJ_A, "open"),
        task("Projects/General/Tareas/g1.md", "G1", GENERAL_HUB, "open"),
      ],
      notes: [
        note("Projects/Alfa/Notas/a.md", "A", PROJ_A),
        note("Projects/General/Notas/g.md", "G", GENERAL_HUB),
      ],
      credentials: [],
      files: [
        file("Projects/Alfa/Archivos/a.png", "a.png", "png", PROJ_A),
        file("Projects/General/Archivos/g.pdf", "g.pdf", "pdf", GENERAL_HUB),
      ],
      issues: [],
    };

    const pres = presentDashboard(fullData, { kind: "project", path: PROJ_A });

    expect(pres.showAll).toBe(false);
    expect(pres.tasks.every((t) => t.projectPath === PROJ_A)).toBe(true);
    expect(pres.notes.every((n) => n.projectPath === PROJ_A)).toBe(true);
    expect(pres.files.every((f) => f.projectPath === PROJ_A)).toBe(true);
    expect(pres.tasks).toHaveLength(1);
    expect(pres.notes).toHaveLength(1);
    expect(pres.files).toHaveLength(1);
  });

  it("Todos muestra files de General y credentials de General", () => {
    const general = generalProject();
    const alfa = projectA();
    const fullData: DashboardData = {
      projects: [general, alfa],
      tasks: [],
      notes: [],
      credentials: [
        credentialsRecord(alfa.path, ["Hosting"]),
        credentialsRecord(general.path, ["VPN"]),
      ],
      files: [
        file("Projects/General/Archivos/g.pdf", "g.pdf", "pdf", GENERAL_HUB),
        file("Projects/Alfa/Archivos/a.png", "a.png", "png", PROJ_A),
      ],
      issues: [],
    };

    const pres = presentDashboard(fullData, { kind: "all" });

    expect(pres.files.every((f) => f.projectPath === GENERAL_HUB)).toBe(true);
    expect(pres.files).toHaveLength(1);
    expect(resolveVisibleCredentialsRecord(fullData, { kind: "all" })?.projectPath).toBe(
      GENERAL_HUB,
    );
  });

  it("showsOnlyGeneralFilesWhenSelectionIsAll", () => {
    const general = generalProject();
    const alfa = projectA();
    const data: DashboardData = {
      projects: [general, alfa],
      tasks: [],
      notes: [],
      credentials: [],
      issues: [],
      files: [
        file("Projects/General/Archivos/nota.pdf", "nota.pdf", "pdf", GENERAL_HUB),
        file("Projects/Alfa/Archivos/diseño.png", "diseño.png", "png", PROJ_A),
      ],
    };

    const result = presentDashboard(data, { kind: "all" });

    expect(result.showAll).toBe(true);
    expect(result.files.map((f) => f.path)).toEqual([
      "Projects/General/Archivos/nota.pdf",
    ]);
  });

  it("showsOnlyProjectFilesWhenSelectionIsProject", () => {
    const general = generalProject();
    const alfa = projectA();
    const data: DashboardData = {
      projects: [general, alfa],
      tasks: [],
      notes: [],
      credentials: [],
      issues: [],
      files: [
        file("Projects/General/Archivos/nota.pdf", "nota.pdf", "pdf", GENERAL_HUB),
        file("Projects/Alfa/Archivos/diseño.png", "diseño.png", "png", PROJ_A),
        file("Projects/Alfa/Archivos/spec.md", "spec.md", "md", PROJ_A),
      ],
    };

    const result = presentDashboard(data, { kind: "project", path: PROJ_A });

    expect(result.showAll).toBe(false);
    expect(result.files.map((f) => f.path).sort()).toEqual(
      ["Projects/Alfa/Archivos/diseño.png", "Projects/Alfa/Archivos/spec.md"].sort(),
    );
    for (const f of result.files) {
      expect(f.projectPath).toBe(PROJ_A);
    }
  });

  it("fallsBackToAllWhenGeneralIsRequestedDirectly", () => {
    const general = generalProject();
    const alfa = projectA();
    const data: DashboardData = {
      projects: [general, alfa],
      tasks: [],
      notes: [],
      credentials: [],
      issues: [],
      files: [
        file("Projects/General/Archivos/nota.pdf", "nota.pdf", "pdf", GENERAL_HUB),
        file("Projects/Alfa/Archivos/diseño.png", "diseño.png", "png", PROJ_A),
      ],
    };

    const result = presentDashboard(data, { kind: "project", path: GENERAL_HUB });

    expect(result.selection).toEqual({ kind: "all" });
    expect(result.showAll).toBe(true);
    expect(result.selectedProject).toBeNull();
    expect(result.files.map((f) => f.path)).toEqual([
      "Projects/General/Archivos/nota.pdf",
    ]);
  });

  it("sortsFilesByNameCaseInsensitiveWithPathTiebreaker", () => {
    const general = generalProject();
    const alfa = projectA();
    const data: DashboardData = {
      projects: [general, alfa],
      tasks: [],
      notes: [],
      credentials: [],
      issues: [],
      files: [
        file("Projects/General/Archivos/beta.pdf", "Beta.pdf", "pdf", GENERAL_HUB),
        file("Projects/General/Archivos/ALFA.pdf", "ALFA.pdf", "pdf", GENERAL_HUB),
        file("Projects/General/Archivos/alfa2.pdf", "alfa.pdf", "pdf", GENERAL_HUB),
        file("Projects/General/Archivos/alfa1.pdf", "alfa.pdf", "pdf", GENERAL_HUB),
      ],
    };

    const result = presentDashboard(data, { kind: "all" });

    expect(result.files.map((f) => f.path)).toEqual([
      // "alfa.pdf" x3 (case-insensitive iguales) → desempate por `path`
      // con comparación directa (mayúsculas antes que minúsculas).
      "Projects/General/Archivos/ALFA.pdf",
      "Projects/General/Archivos/alfa1.pdf",
      "Projects/General/Archivos/alfa2.pdf",
      "Projects/General/Archivos/beta.pdf",
    ]);
  });
});

describe("resolveVisibleCredentialsRecord", () => {
  it("returnsTheSelectedProjectRecord", () => {
    const general = project("Projects/General/General.md", "General");
    const web = project("Projects/Web/Web.md", "Web");
    const data: DashboardData = {
      projects: [general, web],
      tasks: [],
      notes: [],
      credentials: [credentialsRecord(web.path, ["Hosting"])],
      files: [],
      issues: [],
    };

    const visible = resolveVisibleCredentialsRecord(data, {
      kind: "project",
      path: web.path,
    });

    expect(visible?.projectPath).toBe(web.path);
    expect(visible?.record?.entries).toHaveLength(1);
  });

  it("returnsNullRecordWhenTheProjectHasNoCredentialsNote", () => {
    const web = project("Projects/Web/Web.md", "Web");
    const data: DashboardData = {
      projects: [web],
      tasks: [],
      notes: [],
      credentials: [],
      files: [],
      issues: [],
    };

    const visible = resolveVisibleCredentialsRecord(data, {
      kind: "project",
      path: web.path,
    });

    expect(visible?.projectPath).toBe(web.path);
    expect(visible?.record).toBeNull();
  });

  it("returnsGeneralRecordWhenSelectionIsAll", () => {
    const general = project("Projects/General/General.md", "General");
    const web = project("Projects/Web/Web.md", "Web");
    const data: DashboardData = {
      projects: [web, general],
      tasks: [],
      notes: [],
      credentials: [
        credentialsRecord(web.path, ["Hosting"]),
        credentialsRecord(general.path, ["VPN"]),
      ],
      files: [],
      issues: [],
    };

    const visible = resolveVisibleCredentialsRecord(data, { kind: "all" });

    expect(visible?.projectPath).toBe(general.path);
    expect(visible?.record?.entries.map((e) => e.service)).toEqual(["VPN"]);
  });

  it("returnsNullWhenSelectionIsAllAndThereIsNoGeneralProject", () => {
    const web = project("Projects/Web/Web.md", "Web");
    const data: DashboardData = {
      projects: [web],
      tasks: [],
      notes: [],
      credentials: [credentialsRecord(web.path, ["Hosting"])],
      files: [],
      issues: [],
    };

    expect(resolveVisibleCredentialsRecord(data, { kind: "all" })).toBeNull();
  });
});
