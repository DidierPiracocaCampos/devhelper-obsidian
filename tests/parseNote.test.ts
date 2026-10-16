import { describe, it, expect } from "vitest";
import { parseProjectTaskNote } from "../src/domain/parseNote";
import type { NoteSnapshot } from "../src/domain/types";

/**
 * Tests for the pure Markdown frontmatter parser used by the dashboard.
 *
 * The parser is the seam between the vault adapter (Task 4) and the
 * presentation layer (Task 5). It must:
 *  - Return a `{ kind: "project" }` or `{ kind: "task" }` record for valid
 *    notes, preserving the user-defined properties bag untouched.
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

describe("parseProjectTaskNote", () => {
  describe("parsesValidProject", () => {
    it("parses a project note and preserves custom properties", () => {
      const note = snapshot(
        "Projects/Website.md",
        "Website.md",
        [
          "---",
          "type: project",
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
      // Custom property bag is preserved untouched.
      expect(result.project.properties).toEqual({
        type: "project",
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
          'type: task',
          'project: "[[Projects/Foo]]"',
          "status: open",
          "priority: high",
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
        ["priority", "project", "status", "type"].sort(),
      );
      expect(result.task.properties.type).toBe("task");
      expect(result.task.properties.status).toBe("open");
      expect(result.task.properties.priority).toBe("high");
      expect(result.task.properties.project).toBe("[[Projects/Foo]]");
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
});
