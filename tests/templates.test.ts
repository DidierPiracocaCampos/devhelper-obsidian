import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import {
  DEFAULT_TEMPLATE_CONTENT,
  TEMPLATE_FILE_NAMES,
  applyTemplate,
  todayStamp,
  validateTemplate,
  type TemplateKind,
} from "../src/domain/templates";
import { sliceFrontmatter } from "../src/domain/frontmatter";

/**
 * Tests for the pure templates module.
 *
 * - validateTemplate must report each failure mode with a Spanish
 *   message that mentions the offending key/file.
 * - applyTemplate must mutate only `created` (and `project` for tasks
 *   when supplied) while preserving the body and any user-added
 *   properties the template happens to carry.
 * - todayStamp must produce a `YYYY-MM-DD` string in local time.
 */

const ALL_KINDS: TemplateKind[] = ["project", "task", "note", "credentials"];

describe("DEFAULT_TEMPLATE_CONTENT", () => {
  it("seededTemplatesAreValid", () => {
    for (const kind of ALL_KINDS) {
      const content = DEFAULT_TEMPLATE_CONTENT[kind];
      const result = validateTemplate(content, kind);
      expect(result, `seeded ${kind} template must be valid`).toBeNull();
    }
  });
});

describe("validateTemplate", () => {
  it("validateTemplateDetectsMissingFixedProperty", () => {
    // Remove `status` from the seeded project template.
    const stripped = DEFAULT_TEMPLATE_CONTENT.project
      .split("\n")
      .filter((line) => !line.startsWith("status:"))
      .join("\n");

    const result = validateTemplate(stripped, "project");

    expect(result).not.toBeNull();
    expect(result).toContain("status");
    expect(result).toContain(TEMPLATE_FILE_NAMES.project);
  });

  it("validateTemplateDetectsBrokenYaml", () => {
    const broken = [
      "---",
      "type: project",
      "key: [unterminated",
      "---",
      "",
    ].join("\n");

    const result = validateTemplate(broken, "project");

    expect(result).not.toBeNull();
    // The message must be non-empty so the UI can show it.
    expect(result!.length).toBeGreaterThan(0);
  });

  it("validateTemplateDetectsWrongType", () => {
    // Feed a project-typed template into validate for "task".
    const result = validateTemplate(
      DEFAULT_TEMPLATE_CONTENT.project,
      "task",
    );

    expect(result).not.toBeNull();
    // The message must mention `type` and the expected literal so the
    // user can fix the template.
    expect(result).toContain("type");
    expect(result).toContain("task");
  });
});

describe("applyTemplate", () => {
  it("applyTemplateSetsCreatedAndPreservesBody", () => {
    const result = applyTemplate(DEFAULT_TEMPLATE_CONTENT.project, "project", {
      title: "Foo",
      today: "2026-01-15",
    });

    const sliced = sliceFrontmatter(result);
    expect(sliced.kind).toBe("ok");
    if (sliced.kind !== "ok") return;

    const parsed = yaml.load(sliced.yaml) as Record<string, unknown>;
    expect(parsed.created).toBe("2026-01-15");
    // type stays intact
    expect(parsed.type).toBe("project");
    // The body is the empty body from the template.
    expect(sliced.body).toBe("");
  });

  it("applyTemplateSetsProjectLink", () => {
    const result = applyTemplate(DEFAULT_TEMPLATE_CONTENT.task, "task", {
      title: "Write copy",
      today: "2026-02-20",
      projectLink: "[[Projects/Web]]",
    });

    const sliced = sliceFrontmatter(result);
    expect(sliced.kind).toBe("ok");
    if (sliced.kind !== "ok") return;

    const parsed = yaml.load(sliced.yaml) as Record<string, unknown>;
    expect(parsed.project).toBe("[[Projects/Web]]");
    expect(parsed.type).toBe("task");
    expect(parsed.created).toBe("2026-02-20");
  });

  it("applyTemplatePreservesCustomProperties", () => {
    const template = [
      "---",
      "type: project",
      "status: active",
      "created: 1970-01-01",
      "tags: []",
      "description:",
      "client:",
      "extra: hello",
      "---",
      "",
    ].join("\n");

    const result = applyTemplate(template, "project", {
      title: "Bar",
      today: "2026-03-01",
    });

    const sliced = sliceFrontmatter(result);
    expect(sliced.kind).toBe("ok");
    if (sliced.kind !== "ok") return;

    const parsed = yaml.load(sliced.yaml) as Record<string, unknown>;
    expect(parsed.extra).toBe("hello");
    expect(parsed.created).toBe("2026-03-01");
  });
});

describe("noteTemplate", () => {
  it("seededNoteTemplateIsValid", () => {
    const content = DEFAULT_TEMPLATE_CONTENT.note;
    const result = validateTemplate(content, "note");
    expect(result).toBeNull();
  });

  it("applyNoteTemplateSetsProjectLink", () => {
    const result = applyTemplate(DEFAULT_TEMPLATE_CONTENT.note, "note", {
      title: "Idea",
      today: "2026-02-20",
      projectLink: "[[Projects/Web]]",
    });

    const sliced = sliceFrontmatter(result);
    expect(sliced.kind).toBe("ok");
    if (sliced.kind !== "ok") return;

    const parsed = yaml.load(sliced.yaml) as Record<string, unknown>;
    expect(parsed.project).toBe("[[Projects/Web]]");
    expect(parsed.type).toBe("note");
    expect(parsed.created).toBe("2026-02-20");
  });
});

describe("todayStamp", () => {
  it("todayStampFormat", () => {
    // Pin a fixed instant so the assertion is deterministic.
    const fixed = new Date(2026, 0, 15, 10, 30, 0); // 2026-01-15 local
    const stamp = todayStamp(fixed);

    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Local-date formatted via the same primitive the implementation
    // must use. The exact expected value depends on the local
    // timezone, so we recompute it for the fixed instant.
    const expected = `${fixed.getFullYear()}-${String(
      fixed.getMonth() + 1,
    ).padStart(2, "0")}-${String(fixed.getDate()).padStart(2, "0")}`;
    expect(stamp).toBe(expected);
  });
});