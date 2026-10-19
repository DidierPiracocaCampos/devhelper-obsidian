import { describe, it, expect } from "vitest";
import {
  parseCredentialsNote,
  parseProjectTaskNote,
} from "../src/domain/parseNote";
import type { NoteSnapshot, ParsedNote } from "../src/domain/types";

/**
 * Tests for the pure Markdown frontmatter parser used by the dashboard.
 *
 * The parser is the seam between the vault adapter (Task 4) and the
 * presentation layer (Task 5). It must:
 *  - Return a `{ kind: "project" }`, `{ kind: "task" }` or
 *    `{ kind: "credentials" }` record for valid notes, preserving the
 *    user-defined properties bag untouched.
 *  - Return a single `{ kind: "issue" }` per invalid note (never throw) so
 *    a single malformed file does not abort the whole folder scan.
 */

const noopResolve = (_link: string, _source: string) => null;

function snapshot(
  path: string,
  basename: string,
  content: string,
): NoteSnapshot {
  return { path, basename, content };
}

/**
 * Helper for calendar-event notes: wraps the given frontmatter lines in
 * a `type: calendar-event` block so each test only spells out the
 * properties under test.
 */
function calendarEventNote(lines: string[]): NoteSnapshot {
  return snapshot(
    "Calendario/Evento.md",
    "Evento.md",
    ["---", "type: calendar-event", ...lines, "---"].join("\n"),
  );
}

function expectCalendarIssue(result: ParsedNote, ...contains: string[]): void {
  expect(result.kind).toBe("issue");
  if (result.kind !== "issue") return;
  for (const fragment of contains) {
    expect(result.issue.message).toContain(fragment);
  }
}

describe("parseProjectTaskNote", () => {
  describe("parsesValidProject", () => {
    it("parses a project note and preserves custom properties", () => {
      const note = snapshot(
        "Projects/Website.md",
        "Website.md",
        [
          "---",
          "type: project",
          "status: active",
          "created: \"2026-01-15\"",
          "tags:",
          "  - web",
          "  - blog",
          "description: Web presence",
          "client: ACME",
          "key: value",
          "color: blue",
          "---",
          "# Website",
          "",
          "Body of the project.",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, noopResolve);

      expect(result.kind).toBe("project");
      if (result.kind !== "project") return;

      expect(result.project.path).toBe("Projects/Website.md");
      expect(result.project.title).toBe("Website");
      expect(result.project.folderPath).toBe("Projects");
      // Custom property bag is preserved untouched.
      expect(result.project.properties).toEqual({
        type: "project",
        status: "active",
        created: "2026-01-15",
        tags: ["web", "blog"],
        description: "Web presence",
        client: "ACME",
        key: "value",
        color: "blue",
      });
      // The custom key is reachable in the bag.
      expect(result.project.properties.key).toBe("value");
    });
  });

  describe("parsesValidTask", () => {
    it("parses a task note and resolves the project link to a vault path", () => {
      const note = snapshot(
        "Tasks/Write copy.md",
        "Write copy.md",
        [
          "---",
          "type: task",
          'project: "[[Projects/Foo]]"',
          "status: open",
          "created: \"2026-01-15\"",
          "priority: medium",
          "---",
          "Body of the task.",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, (_link, source) => {
        // Simulate a vault adapter that maps "[[Projects/Foo]]" to
        // "Projects/Foo.md" (the .md suffix may or may not be present
        // in the link, the parser appends it defensively).
        expect(source).toBe("Tasks/Write copy.md");
        return "Projects/Foo.md";
      });

      expect(result.kind).toBe("task");
      if (result.kind !== "task") return;

      expect(result.task.path).toBe("Tasks/Write copy.md");
      expect(result.task.title).toBe("Write copy");
      expect(result.task.status).toBe("open");
      expect(result.task.projectPath).toBe("Projects/Foo.md");
      // The original keys survive in the property bag. The wikilink is
      // written between double quotes in the note's frontmatter so
      // js-yaml parses it as a literal string; the `[[...]]` brackets
      // are not interpreted as YAML flow-sequence syntax in the
      // quoted form.
      expect(Object.keys(result.task.properties).sort()).toEqual(
        ["created", "priority", "project", "status", "type"].sort(),
      );
      expect(result.task.properties.type).toBe("task");
      expect(result.task.properties.status).toBe("open");
      expect(result.task.properties.priority).toBe("medium");
      expect(result.task.properties.project).toBe("[[Projects/Foo]]");
      expect(result.task.properties.created).toBe("2026-01-15");
    });

    it("appends .md to a resolved project path that lacks the extension", () => {
      const note = snapshot(
        "Tasks/Bar.md",
        "Bar.md",
        [
          "---",
          "type: task",
          'project: "[[Projects/Bar]]"',
          "status: done",
          "created: \"2026-01-15\"",
          "priority: low",
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, () => "Projects/Bar");

      expect(result.kind).toBe("task");
      if (result.kind !== "task") return;
      expect(result.task.projectPath).toBe("Projects/Bar.md");
      expect(result.task.status).toBe("done");
    });
  });

  describe("reportsMalformedFrontmatter", () => {
    it("returns a single issue for an unclosed frontmatter block", () => {
      const note = snapshot(
        "Projects/Broken.md",
        "Broken.md",
        ["---", "type: project", "key: value"].join("\n"),
      );

      const result = parseProjectTaskNote(note, noopResolve);

      expect(result.kind).toBe("issue");
      if (result.kind !== "issue") return;
      expect(result.issue.path).toBe("Projects/Broken.md");
      expect(result.issue.message.length).toBeGreaterThan(0);
    });

    it("returns a single issue for invalid YAML inside the frontmatter", () => {
      const note = snapshot(
        "Projects/YamlBad.md",
        "YamlBad.md",
        ["---", "type: project", "key: [unterminated", "---"].join("\n"),
      );

      const result = parseProjectTaskNote(note, noopResolve);

      expect(result.kind).toBe("issue");
      if (result.kind !== "issue") return;
      expect(result.issue.path).toBe("Projects/YamlBad.md");
      expect(result.issue.message.length).toBeGreaterThan(0);
    });
  });

  describe("reportsMissingOrWrongType", () => {
    it("returns a single issue for a note without a type property", () => {
      const note = snapshot(
        "Projects/NoType.md",
        "NoType.md",
        ["---", "key: value", "---", "body"].join("\n"),
      );

      const result = parseProjectTaskNote(note, noopResolve);

      expect(result.kind).toBe("issue");
      if (result.kind !== "issue") return;
      expect(result.issue.path).toBe("Projects/NoType.md");
    });

    it("returns a single issue for a note with an unknown type", () => {
      const note = snapshot(
        "Projects/Wrong.md",
        "Wrong.md",
        ["---", "type: not-a-project", "---", "body"].join("\n"),
      );

      const result = parseProjectTaskNote(note, noopResolve);

      expect(result.kind).toBe("issue");
      if (result.kind !== "issue") return;
      expect(result.issue.path).toBe("Projects/Wrong.md");
    });

    it("returns a single issue for a note with no frontmatter at all", () => {
      const note = snapshot("Plain.md", "Plain.md", "# Just a heading\n\nbody");

      const result = parseProjectTaskNote(note, noopResolve);

      expect(result.kind).toBe("issue");
      if (result.kind !== "issue") return;
      expect(result.issue.path).toBe("Plain.md");
    });
  });

  describe("reportsMissingTaskProject", () => {
    it("returns a single issue for a task missing the project property", () => {
      const note = snapshot(
        "Tasks/NoProject.md",
        "NoProject.md",
        ["---", "type: task", "status: open", "---"].join("\n"),
      );

      const result = parseProjectTaskNote(note, noopResolve);

      expect(result.kind).toBe("issue");
      if (result.kind !== "issue") return;
      expect(result.issue.path).toBe("Tasks/NoProject.md");
    });
  });

  describe("reportsMissingOrInvalidTaskStatus", () => {
    it("returns a single issue for a task whose status is not open or done", () => {
      const note = snapshot(
        "Tasks/BadStatus.md",
        "BadStatus.md",
        [
          "---",
          "type: task",
          'project: "[[Projects/Foo]]"',
          "status: nope",
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, () => "Projects/Foo.md");

      expect(result.kind).toBe("issue");
      if (result.kind !== "issue") return;
      expect(result.issue.path).toBe("Tasks/BadStatus.md");
    });

    it("returns a single issue for a task missing the status property", () => {
      const note = snapshot(
        "Tasks/NoStatus.md",
        "NoStatus.md",
        [
          "---",
          "type: task",
          'project: "[[Projects/Foo]]"',
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, () => "Projects/Foo.md");

      expect(result.kind).toBe("issue");
      if (result.kind !== "issue") return;
      expect(result.issue.path).toBe("Tasks/NoStatus.md");
    });
  });

  describe("reportsUnresolvedTaskProject", () => {
    it("returns a single issue when the resolver cannot find the linked project", () => {
      const note = snapshot(
        "Tasks/Ghost.md",
        "Ghost.md",
        [
          "---",
          "type: task",
          'project: "[[Projects/Ghost]]"',
          "status: open",
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, () => null);

      expect(result.kind).toBe("issue");
      if (result.kind !== "issue") return;
      expect(result.issue.path).toBe("Tasks/Ghost.md");
      // The unresolved link should be quoted in the message so the user
      // can find the broken reference.
      expect(result.issue.message).toContain("Projects/Ghost");
    });
  });

  describe("parsesFavoriteTrue", () => {
    it("parsesFavoriteTrue()", () => {
      const note = snapshot(
        "Projects/Website.md",
        "Website.md",
        [
          "---",
          "type: project",
          "status: active",
          "created: \"2026-01-15\"",
          "tags:",
          "  - web",
          "description: Web presence",
          "client: ACME",
          "favorite: true",
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, noopResolve);

      expect(result.kind).toBe("project");
      if (result.kind !== "project") return;
      expect(result.project.favorite).toBe(true);
    });
  });

  describe("parsesFavoriteFalse", () => {
    it("parsesFavoriteFalse()", () => {
      const note = snapshot(
        "Projects/Website.md",
        "Website.md",
        [
          "---",
          "type: project",
          "status: active",
          "created: \"2026-01-15\"",
          "tags: []",
          "description: x",
          "client: y",
          "favorite: false",
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, noopResolve);

      expect(result.kind).toBe("project");
      if (result.kind !== "project") return;
      expect(result.project.favorite).toBe(false);
    });
  });

  describe("parsesMissingFavoriteAsFalse", () => {
    it("parsesMissingFavoriteAsFalse()", () => {
      const note = snapshot(
        "Projects/Website.md",
        "Website.md",
        [
          "---",
          "type: project",
          "status: active",
          "created: \"2026-01-15\"",
          "tags: []",
          "description: x",
          "client: y",
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, noopResolve);

      expect(result.kind).toBe("project");
      if (result.kind !== "project") return;
      expect(result.project.favorite).toBe(false);
    });
  });

  describe("parsesInvalidFavoriteAsFalse", () => {
    it("parsesInvalidFavoriteAsFalse()", () => {
      const note = snapshot(
        "Projects/Website.md",
        "Website.md",
        [
          "---",
          "type: project",
          "status: active",
          "created: \"2026-01-15\"",
          "tags: []",
          "description: x",
          "client: y",
          'favorite: "yes"',
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, noopResolve);

      // An invalid favorite value is silently coerced to false; it must
      // NOT produce an issue.
      expect(result.kind).toBe("project");
      if (result.kind !== "project") return;
      expect(result.project.favorite).toBe(false);
    });
  });

  describe("parsesValidProjectV2", () => {
    it("parses a project with all six fixed properties and exposes folderPath", () => {
      const note = snapshot(
        "Projects/Website.md",
        "Website.md",
        [
          "---",
          "type: project",
          "status: active",
          "created: \"2026-01-15\"",
          "tags:",
          "  - web",
          "description: Web presence",
          "client: ACME",
          "---",
          "# Website",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, noopResolve);

      expect(result.kind).toBe("project");
      if (result.kind !== "project") return;
      expect(result.project.path).toBe("Projects/Website.md");
      expect(result.project.title).toBe("Website");
      expect(result.project.folderPath).toBe("Projects");
      expect(result.project.properties.type).toBe("project");
      expect(result.project.properties.status).toBe("active");
      expect(result.project.properties.created).toBe("2026-01-15");
      expect(result.project.properties.tags).toEqual(["web"]);
      expect(result.project.properties.description).toBe("Web presence");
      expect(result.project.properties.client).toBe("ACME");
    });

    it("parses a project note at the vault root with an empty folderPath", () => {
      const note = snapshot(
        "Root.md",
        "Root.md",
        [
          "---",
          "type: project",
          "status: active",
          "created: \"2026-01-15\"",
          "tags: []",
          "description: x",
          "client: y",
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, noopResolve);

      expect(result.kind).toBe("project");
      if (result.kind !== "project") return;
      expect(result.project.folderPath).toBe("");
    });
  });

  describe("reportsInvalidProjectStatus", () => {
    it("returns a single issue when project status is not in the allowed set", () => {
      const note = snapshot(
        "Projects/BadStatus.md",
        "BadStatus.md",
        [
          "---",
          "type: project",
          "status: weird",
          "created: \"2026-01-15\"",
          "tags: []",
          "description: x",
          "client: y",
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, noopResolve);

      expect(result.kind).toBe("issue");
      if (result.kind !== "issue") return;
      expect(result.issue.path).toBe("Projects/BadStatus.md");
      expect(result.issue.message).toContain("status");
      expect(result.issue.message).toContain("weird");
    });
  });

  describe("reportsMissingProjectFixedProperty", () => {
    it("returns a single issue when a required project property is missing", () => {
      const note = snapshot(
        "Projects/NoClient.md",
        "NoClient.md",
        [
          "---",
          "type: project",
          "status: active",
          "created: \"2026-01-15\"",
          "tags: []",
          "description: x",
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, noopResolve);

      expect(result.kind).toBe("issue");
      if (result.kind !== "issue") return;
      expect(result.issue.path).toBe("Projects/NoClient.md");
      expect(result.issue.message).toContain("client");
    });
  });

  describe("reportsInvalidTaskPriority", () => {
    it("returns a single issue when task priority is not in the allowed set", () => {
      const note = snapshot(
        "Tasks/BadPriority.md",
        "BadPriority.md",
        [
          "---",
          "type: task",
          'project: "[[Projects/Foo]]"',
          "status: open",
          "created: \"2026-01-15\"",
          "priority: urgent",
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, () => "Projects/Foo.md");

      expect(result.kind).toBe("issue");
      if (result.kind !== "issue") return;
      expect(result.issue.path).toBe("Tasks/BadPriority.md");
      expect(result.issue.message).toContain("priority");
      expect(result.issue.message).toContain("urgent");
    });
  });

  describe("reportsInvalidTaskDue", () => {
    it("returns a single issue when task due is not a YYYY-MM-DD date", () => {
      const note = snapshot(
        "Tasks/BadDue.md",
        "BadDue.md",
        [
          "---",
          "type: task",
          'project: "[[Projects/Foo]]"',
          "status: open",
          "created: \"2026-01-15\"",
          "priority: high",
          "due: 2026/01/15",
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, () => "Projects/Foo.md");

      expect(result.kind).toBe("issue");
      if (result.kind !== "issue") return;
      expect(result.issue.path).toBe("Tasks/BadDue.md");
      expect(result.issue.message).toContain("due");
    });

    it("accepts a task with no due property", () => {
      const note = snapshot(
        "Tasks/NoDue.md",
        "NoDue.md",
        [
          "---",
          "type: task",
          'project: "[[Projects/Foo]]"',
          "status: open",
          "created: \"2026-01-15\"",
          "priority: high",
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, () => "Projects/Foo.md");

      expect(result.kind).toBe("task");
    });
  });

  describe("acceptsEmptyDueProperty", () => {
    it("parses a task with due set to an empty quoted string as open", () => {
      const note = snapshot(
        "Tasks/EmptyDue.md",
        "EmptyDue.md",
        [
          "---",
          "type: task",
          'project: "[[Projects/Foo]]"',
          "status: open",
          "created: \"2026-01-15\"",
          "priority: high",
          'due: ""',
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, () => "Projects/Foo.md");

      expect(result.kind).toBe("task");
      if (result.kind !== "task") return;
      expect(result.task.status).toBe("open");
      expect(result.task.projectPath).toBe("Projects/Foo.md");
      expect(result.task.path).toBe("Tasks/EmptyDue.md");
      expect(result.task.properties.due).toBe("");
    });
  });

  describe("acceptsYamlDateObjects", () => {
    it("parses a project with bare created date (js-yaml Date) and normalizes to YYYY-MM-DD", () => {
      const note = snapshot(
        "Projects/spot.md",
        "spot.md",
        [
          "---",
          "type: project",
          "status: active",
          "created: 2026-01-15",
          "tags: []",
          "description: x",
          "client: y",
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, noopResolve);

      expect(result.kind).toBe("project");
      if (result.kind !== "project") return;
      expect(result.project.properties.created).toBe("2026-01-15");
    });

    it("parses a task with bare created date and normalizes to YYYY-MM-DD", () => {
      const note = snapshot(
        "Tasks/BareCreated.md",
        "BareCreated.md",
        [
          "---",
          "type: task",
          'project: "[[Projects/Foo]]"',
          "status: open",
          "created: 2026-01-15",
          "priority: high",
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, () => "Projects/Foo.md");

      expect(result.kind).toBe("task");
      if (result.kind !== "task") return;
      expect(result.task.properties.created).toBe("2026-01-15");
    });

    it("parses a task with bare due date and normalizes to YYYY-MM-DD", () => {
      const note = snapshot(
        "Tasks/BareDue.md",
        "BareDue.md",
        [
          "---",
          "type: task",
          'project: "[[Projects/Foo]]"',
          "status: open",
          'created: "2026-01-15"',
          "priority: high",
          "due: 2026-02-20",
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, () => "Projects/Foo.md");

      expect(result.kind).toBe("task");
      if (result.kind !== "task") return;
      expect(result.task.properties.due).toBe("2026-02-20");
    });
  });
  describe("parsesValidNote", () => {
    it("parses a note with only project and created", () => {
      const note = snapshot(
        "Projects/Website/Notas/Idea.md",
        "Idea.md",
        [
          "---",
          "type: note",
          'project: "[[Projects/Website/Website]]"',
          'created: "2026-01-15"',
          "---",
          "Cuerpo libre.",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, () => "Projects/Website/Website.md");

      expect(result.kind).toBe("note");
      if (result.kind !== "note") return;
      expect(result.note.path).toBe("Projects/Website/Notas/Idea.md");
      expect(result.note.title).toBe("Idea");
      expect(result.note.projectPath).toBe("Projects/Website/Website.md");
      expect(result.note.properties.type).toBe("note");
    });

    it("returns an issue for a note missing project", () => {
      const note = snapshot(
        "Projects/Website/Notas/SinProyecto.md",
        "SinProyecto.md",
        ["---", "type: note", 'created: "2026-01-15"', "---"].join("\n"),
      );

      const result = parseProjectTaskNote(note, () => "Projects/Website/Website.md");

      expect(result.kind).toBe("issue");
    });

    it("returns an issue for a note missing created", () => {
      const note = snapshot(
        "Projects/Website/Notas/SinFecha.md",
        "SinFecha.md",
        [
          "---",
          "type: note",
          'project: "[[Projects/Website/Website]]"',
          "---",
        ].join("\n"),
      );

      const result = parseProjectTaskNote(note, () => "Projects/Website/Website.md");

      expect(result.kind).toBe("issue");
    });
  });

  describe("parsesCalendarEvent", () => {
    it("parses a minimal calendar-event note as a global all-day event", () => {
      const minimal = [
        "---",
        "type: calendar-event",
        "kind: evento",
        'date: "2026-11-04"',
        'created: "2026-10-19"',
        "---",
        "Detalles del evento.",
      ].join("\n");

      // Caso verbatim del brief: el tipo discriminado deja de caer a issue.
      expect(
        parseProjectTaskNote(
          { path: "Calendario/X.md", basename: "X.md", content: minimal },
          () => null,
        ).kind,
      ).toBe("calendar-event");

      const result = parseProjectTaskNote(
        snapshot("Calendario/X.md", "X.md", minimal),
        () => null,
      );

      expect(result.kind).toBe("calendar-event");
      if (result.kind !== "calendar-event") return;
      expect(result.event.path).toBe("Calendario/X.md");
      expect(result.event.title).toBe("X");
      expect(result.event.kind).toBe("evento");
      expect(result.event.date).toBe("2026-11-04");
      // Defaults: sin endDate, sin time (allDay true lo ignora), todo el
      // día, sin recurrencia, estado abierto y sin proyecto = global.
      expect(result.event.endDate).toBeUndefined();
      expect(result.event.time).toBeUndefined();
      expect(result.event.allDay).toBe(true);
      expect(result.event.recurrence).toBe("none");
      expect(result.event.status).toBe("open");
      expect(result.event.projectPath).toBeUndefined();
    });

    it("normalizes a bare YAML date into a YYYY-MM-DD string", () => {
      // Sin comillas js-yaml parsea la fecha como objeto Date (patrón
      // Obsidian Properties); el parser debe devolver siempre cadena.
      const result = parseProjectTaskNote(
        calendarEventNote([
          "kind: evento",
          "date: 2026-11-04",
          'created: "2026-10-19"',
        ]),
        noopResolve,
      );

      expect(result.kind).toBe("calendar-event");
      if (result.kind !== "calendar-event") return;
      expect(result.event.date).toBe("2026-11-04");
      expect(result.event.properties.date).toBe("2026-11-04");
    });

    it("keeps a valid time when allDay is false", () => {
      const result = parseProjectTaskNote(
        calendarEventNote([
          "kind: reunion",
          'date: "2026-11-04"',
          "allDay: false",
          'time: "10:30"',
          'created: "2026-10-19"',
        ]),
        noopResolve,
      );

      expect(result.kind).toBe("calendar-event");
      if (result.kind !== "calendar-event") return;
      expect(result.event.allDay).toBe(false);
      expect(result.event.time).toBe("10:30");
    });

    it("ignores a time when allDay is true", () => {
      // Regla del spec: con allDay true el time se ignora (la UI no lo
      // envía), nunca llega al record.
      const result = parseProjectTaskNote(
        calendarEventNote([
          "kind: evento",
          'date: "2026-11-04"',
          "allDay: true",
          'time: "10:30"',
          'created: "2026-10-19"',
        ]),
        noopResolve,
      );

      expect(result.kind).toBe("calendar-event");
      if (result.kind !== "calendar-event") return;
      expect(result.event.allDay).toBe(true);
      expect(result.event.time).toBeUndefined();
    });

    it("does not even validate a time when allDay is true", () => {
      // Con allDay true el time se ignora POR COMPLETO: un valor
      // corrupto ("25:00") no es issue, se descarta y ya.
      const result = parseProjectTaskNote(
        calendarEventNote([
          "kind: evento",
          'date: "2026-11-04"',
          "allDay: true",
          'time: "25:00"',
          'created: "2026-10-19"',
        ]),
        noopResolve,
      );

      expect(result.kind).toBe("calendar-event");
      if (result.kind !== "calendar-event") return;
      expect(result.event.allDay).toBe(true);
      expect(result.event.time).toBeUndefined();
    });

    it("parses an inclusive multi-day range via endDate", () => {
      const result = parseProjectTaskNote(
        calendarEventNote([
          "kind: evento",
          'date: "2026-11-04"',
          'endDate: "2026-11-08"',
          'created: "2026-10-19"',
        ]),
        noopResolve,
      );

      expect(result.kind).toBe("calendar-event");
      if (result.kind !== "calendar-event") return;
      expect(result.event.date).toBe("2026-11-04");
      expect(result.event.endDate).toBe("2026-11-08");
    });

    it("parses weekly recurrence with a recurrenceEnd cap", () => {
      const result = parseProjectTaskNote(
        calendarEventNote([
          "kind: aviso",
          'date: "2026-11-04"',
          "recurrence: weekly",
          'recurrenceEnd: "2027-02-01"',
          'created: "2026-10-19"',
          "status: done",
        ]),
        noopResolve,
      );

      expect(result.kind).toBe("calendar-event");
      if (result.kind !== "calendar-event") return;
      expect(result.event.recurrence).toBe("weekly");
      expect(result.event.recurrenceEnd).toBe("2027-02-01");
      expect(result.event.status).toBe("done");
    });

    it("resolves the optional project link to a vault path", () => {
      const result = parseProjectTaskNote(
        calendarEventNote([
          "kind: fecha_limite",
          'date: "2026-11-04"',
          'project: "[[Projects/Web]]"',
          'created: "2026-10-19"',
        ]),
        (_link, source) => {
          expect(source).toBe("Calendario/Evento.md");
          return "Projects/Web";
        },
      );

      expect(result.kind).toBe("calendar-event");
      if (result.kind !== "calendar-event") return;
      expect(result.event.projectPath).toBe("Projects/Web.md");
    });

    it("treats a missing project as a global event without calling resolveProject", () => {
      const result = parseProjectTaskNote(
        calendarEventNote([
          "kind: evento",
          'date: "2026-11-04"',
          'created: "2026-10-19"',
        ]),
        () => {
          throw new Error("resolveProject no debe llamarse sin project");
        },
      );

      expect(result.kind).toBe("calendar-event");
      if (result.kind !== "calendar-event") return;
      expect(result.event.projectPath).toBeUndefined();
    });

    it("returns an issue when kind is missing", () => {
      const result = parseProjectTaskNote(
        calendarEventNote(['date: "2026-11-04"']),
        noopResolve,
      );

      expectCalendarIssue(result, "kind");
    });

    it("returns an issue for an unknown kind value", () => {
      const result = parseProjectTaskNote(
        calendarEventNote(['kind: "fiesta"', 'date: "2026-11-04"']),
        noopResolve,
      );

      expectCalendarIssue(result, "kind", "fiesta");
    });

    it("returns an issue when date is missing", () => {
      const result = parseProjectTaskNote(
        calendarEventNote(["kind: evento"]),
        noopResolve,
      );

      expectCalendarIssue(result, "date");
    });

    it("returns an issue for a date that rolls over in the Date constructor", () => {
      const result = parseProjectTaskNote(
        calendarEventNote(['kind: evento', 'date: "2026-13-40"']),
        noopResolve,
      );

      expectCalendarIssue(result, "date", "2026-13-40");
    });

    it("returns an issue when endDate is earlier than date", () => {
      const result = parseProjectTaskNote(
        calendarEventNote([
          "kind: evento",
          'date: "2026-11-08"',
          'endDate: "2026-11-04"',
        ]),
        noopResolve,
      );

      expectCalendarIssue(result, "endDate", "date");
    });

    it("returns an issue for a time that is not HH:mm", () => {
      const result = parseProjectTaskNote(
        calendarEventNote([
          "kind: reunion",
          'date: "2026-11-04"',
          "allDay: false",
          'time: "25:00"',
        ]),
        noopResolve,
      );

      expectCalendarIssue(result, "time", "25:00");
    });

    it("returns an issue for a non-boolean allDay", () => {
      const result = parseProjectTaskNote(
        calendarEventNote([
          "kind: evento",
          'date: "2026-11-04"',
          'allDay: "yes"',
        ]),
        noopResolve,
      );

      expectCalendarIssue(result, "allDay");
    });

    it("returns an issue for a recurrence outside the allowed set", () => {
      const result = parseProjectTaskNote(
        calendarEventNote([
          "kind: evento",
          'date: "2026-11-04"',
          "recurrence: fortnightly",
        ]),
        noopResolve,
      );

      expectCalendarIssue(result, "recurrence", "fortnightly");
    });

    it("returns an issue for a corrupt recurrenceEnd", () => {
      const result = parseProjectTaskNote(
        calendarEventNote([
          "kind: evento",
          'date: "2026-11-04"',
          "recurrence: daily",
          'recurrenceEnd: "not-a-date"',
        ]),
        noopResolve,
      );

      expectCalendarIssue(result, "recurrenceEnd", "not-a-date");
    });

    it("returns an issue for a status outside open|done", () => {
      const result = parseProjectTaskNote(
        calendarEventNote([
          "kind: evento",
          'date: "2026-11-04"',
          "status: paused",
        ]),
        noopResolve,
      );

      expectCalendarIssue(result, "status", "paused");
    });

    it("returns an issue for a project that is not a wikilink", () => {
      const result = parseProjectTaskNote(
        calendarEventNote([
          "kind: evento",
          'date: "2026-11-04"',
          'project: "Projects/Web"',
        ]),
        noopResolve,
      );

      expectCalendarIssue(result, "project", "wikilink");
    });

    it("returns an issue for an unresolvable project link", () => {
      const result = parseProjectTaskNote(
        calendarEventNote([
          "kind: evento",
          'date: "2026-11-04"',
          'project: "[[Desaparecido]]"',
        ]),
        noopResolve,
      );

      expectCalendarIssue(result, "Desaparecido");
    });
  });
});

describe("parseCredentialsNote", () => {
  describe("parsesValidCredentials", () => {
    it("returns a credentials record with both entries", () => {
      const note = snapshot(
        "Projects/Website/Credentials.md",
        "Credentials.md",
        [
          "---",
          "type: credentials",
          "credentials:",
          "  - service: GitHub",
          "    user: alice",
          "    password: hunter2",
          "  - service: AWS",
          "    user: bob",
          "    password: secret",
          "    url: https://aws.example.com",
          "    notes: production account",
          "---",
          "# Credentials",
        ].join("\n"),
      );

      const result = parseCredentialsNote(note);

      expect(result.kind).toBe("credentials");
      if (result.kind !== "credentials") return;
      expect(result.credentials.path).toBe(
        "Projects/Website/Credentials.md",
      );
      expect(result.credentials.entries).toHaveLength(2);
      expect(result.credentials.entries[0]).toMatchObject({
        service: "GitHub",
        user: "alice",
        password: "hunter2",
      });
      expect(result.credentials.entries[1]).toMatchObject({
        service: "AWS",
        user: "bob",
        password: "secret",
        url: "https://aws.example.com",
        notes: "production account",
      });
    });
  });

  describe("parsesEncryptedCredentials", () => {
    it("accepts well-formed enc:v1 blobs without decrypting", () => {
      const note = snapshot(
        "Projects/Website/Credentials.md",
        "Credentials.md",
        [
          "---",
          "type: credentials",
          "credentials:",
          "  - service: Hosting",
          '    user: "enc:v1:aGk:amts"',
          '    password: "enc:v1:aGk:amts"',
          '    url: "enc:v1:aGk:amts"',
          "---",
          "# Credentials",
        ].join("\n"),
      );

      const result = parseCredentialsNote(note);

      expect(result.kind).toBe("credentials");
      if (result.kind !== "credentials") return;
      expect(result.credentials.entries).toHaveLength(1);
      expect(result.credentials.entries[0]).toMatchObject({
        service: "Hosting",
        user: "enc:v1:aGk:amts",
        password: "enc:v1:aGk:amts",
      });
      expect(result.credentials.entryIssues ?? []).toHaveLength(0);
    });
  });

  describe("reportsMalformedEncryptedBlob", () => {
    it("flags a truncated enc: value as a per-entry issue", () => {
      const note = snapshot(
        "Projects/Website/Credentials.md",
        "Credentials.md",
        [
          "---",
          "type: credentials",
          "credentials:",
          "  - service: Hosting",
          "    user: admin",
          '    password: "enc:v1:truncado"',
          "---",
        ].join("\n"),
      );

      const result = parseCredentialsNote(note);

      expect(result.kind).toBe("credentials");
      if (result.kind !== "credentials") return;
      expect(result.credentials.entries).toHaveLength(0);
      expect(result.credentials.entryIssues).toHaveLength(1);
      expect(result.credentials.entryIssues![0].message).toContain("password");
    });
  });

  describe("reportsEncryptedServiceAsIssue", () => {
    it("rejects an encrypted service name", () => {
      const note = snapshot(
        "Projects/Website/Credentials.md",
        "Credentials.md",
        [
          "---",
          "type: credentials",
          "credentials:",
          '  - service: "enc:v1:aGk:amts"',
          "    user: admin",
          "    password: s3cret",
          "---",
        ].join("\n"),
      );

      const result = parseCredentialsNote(note);

      expect(result.kind).toBe("credentials");
      if (result.kind !== "credentials") return;
      expect(result.credentials.entries).toHaveLength(0);
      expect(result.credentials.entryIssues).toHaveLength(1);
      expect(result.credentials.entryIssues![0].message).toContain("service");
    });
  });

  describe("legacyPlaintextStillParses", () => {
    it("keeps a fully plaintext entry valid for migration", () => {
      const note = snapshot(
        "Projects/Website/Credentials.md",
        "Credentials.md",
        [
          "---",
          "type: credentials",
          "credentials:",
          "  - service: GitHub",
          "    user: alice",
          "    password: hunter2",
          "---",
        ].join("\n"),
      );

      const result = parseCredentialsNote(note);

      expect(result.kind).toBe("credentials");
      if (result.kind !== "credentials") return;
      expect(result.credentials.entries).toHaveLength(1);
      expect(result.credentials.entries[0]).toMatchObject({
        service: "GitHub",
        user: "alice",
        password: "hunter2",
      });
      expect(result.credentials.entryIssues ?? []).toHaveLength(0);
    });
  });

  describe("preservesValidCredentialEntriesAlongsideInvalidOne", () => {
    it("keeps the valid entry and surfaces the invalid one as a per-entry issue", () => {
      const note = snapshot(
        "Projects/Website/Credentials.md",
        "Credentials.md",
        [
          "---",
          "type: credentials",
          "credentials:",
          "  - service: GitHub",
          "    user: alice",
          "    password: hunter2",
          "  - service: AWS",
          "    user: bob",
          "---",
        ].join("\n"),
      );

      const result = parseCredentialsNote(note);

      // The parser no longer bails on the first broken entry: it returns
      // a credentials record so the valid row survives.
      expect(result.kind).toBe("credentials");
      if (result.kind !== "credentials") return;

      expect(result.credentials.path).toBe(
        "Projects/Website/Credentials.md",
      );
      expect(result.credentials.entries).toHaveLength(1);
      expect(result.credentials.entries[0]).toMatchObject({
        service: "GitHub",
        user: "alice",
        password: "hunter2",
      });

      // The invalid row surfaces as a per-entry issue indexed at 1.
      expect(result.credentials.entryIssues).toHaveLength(1);
      expect(result.credentials.entryIssues![0].path).toBe(
        "Projects/Website/Credentials.md",
      );
      expect(result.credentials.entryIssues![0].message).toContain("1");
      expect(result.credentials.entryIssues![0].message).toContain("password");
    });

    it("drops the entry but still produces a credentials record when only the invalid entry is present", () => {
      const note = snapshot(
        "Projects/Website/Credentials.md",
        "Credentials.md",
        [
          "---",
          "type: credentials",
          "credentials:",
          "  - service: AWS",
          "    user: bob",
          "---",
        ].join("\n"),
      );

      const result = parseCredentialsNote(note);

      expect(result.kind).toBe("credentials");
      if (result.kind !== "credentials") return;
      expect(result.credentials.entries).toHaveLength(0);
      expect(result.credentials.entryIssues).toHaveLength(1);
      expect(result.credentials.entryIssues![0].message).toContain("password");
    });
  });

  describe("preservesExtraCredentialFields", () => {
    it("keeps unknown keys on the parsed entry", () => {
      const note = snapshot(
        "Projects/Website/Credentials.md",
        "Credentials.md",
        [
          "---",
          "type: credentials",
          "credentials:",
          "  - service: GitHub",
          "    user: alice",
          "    password: hunter2",
          "    rotation: 30",
          "---",
        ].join("\n"),
      );

      const result = parseCredentialsNote(note);

      expect(result.kind).toBe("credentials");
      if (result.kind !== "credentials") return;
      expect(result.credentials.entries[0].rotation).toBe(30);
    });
  });

  describe("reportsCredentialsNotAList", () => {
    it("returns a single issue when credentials is not an array", () => {
      const note = snapshot(
        "Projects/Website/Credentials.md",
        "Credentials.md",
        [
          "---",
          "type: credentials",
          'credentials: "not-a-list"',
          "---",
        ].join("\n"),
      );

      const result = parseCredentialsNote(note);

      expect(result.kind).toBe("issue");
      if (result.kind !== "issue") return;
      expect(result.issue.path).toBe(
        "Projects/Website/Credentials.md",
      );
      expect(result.issue.message).toContain("credentials");
      expect(result.issue.message).toContain("lista");
    });
  });
});
