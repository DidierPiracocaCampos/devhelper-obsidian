import { describe, it, expect } from "vitest";
import type { VaultNoteRef, VaultAdapter } from "../src/data/VaultAdapter";
import { ProjectTaskRepository } from "../src/data/ProjectTaskRepository";
import { DEFAULT_SETTINGS, type PluginSettings } from "../src/settings";

// ---------------------------------------------------------------------------
// In-memory fake VaultAdapter used by every test below.
//
// The fake is stateful: it keeps a map of file path -> content and a set of
// known folders. Methods that would otherwise throw if the file does not
// exist use the captured state to behave like the Obsidian vault. The
// `listMarkdownFiles` method returns refs sorted by path for deterministic
// test assertions.
// ---------------------------------------------------------------------------

interface FakeVaultState {
  files: Map<string, string>;
  folders: Set<string>;
}

function createFakeVault(): FakeVaultState & VaultAdapter {
  const files = new Map<string, string>();
  const folders = new Set<string>();

  const adapter: VaultAdapter = {
    listMarkdownFiles(folderPath: string): VaultNoteRef[] {
      const prefix = `${folderPath}/`;
      const refs: VaultNoteRef[] = [];
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue;
        if (path.slice(prefix.length).includes("/")) continue;
        const basename = path.slice(path.lastIndexOf("/") + 1);
        refs.push({ path, basename });
      }
      return refs.sort((a, b) => a.path.localeCompare(b.path));
    },

    async read(note: VaultNoteRef): Promise<string> {
      const content = files.get(note.path);
      if (content === undefined) {
        throw new Error(`Fake vault: file not found: ${note.path}`);
      }
      return content;
    },

    async createFolder(path: string): Promise<void> {
      const segments = path.split("/");
      let current = "";
      for (const seg of segments) {
        current = current.length === 0 ? seg : `${current}/${seg}`;
        folders.add(current);
      }
    },

    async createMarkdown(path: string, content: string): Promise<VaultNoteRef> {
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (dir.length > 0) folders.add(dir);
      files.set(path, content);
      const basename = path.slice(path.lastIndexOf("/") + 1);
      return { path, basename };
    },

    async rename(note: VaultNoteRef, newPath: string): Promise<VaultNoteRef> {
      const content = files.get(note.path);
      if (content === undefined) {
        throw new Error(`Fake vault: cannot rename missing file: ${note.path}`);
      }
      files.delete(note.path);
      files.set(newPath, content);
      const dir = newPath.includes("/")
        ? newPath.slice(0, newPath.lastIndexOf("/"))
        : "";
      if (dir.length > 0) folders.add(dir);
      const basename = newPath.slice(newPath.lastIndexOf("/") + 1);
      return { path: newPath, basename };
    },

    async processFrontMatter(
      note: VaultNoteRef,
      update: (frontmatter: Record<string, unknown>) => void,
    ): Promise<void> {
      const content = files.get(note.path);
      if (content === undefined) {
        throw new Error(
          `Fake vault: cannot processFrontMatter on missing file: ${note.path}`,
        );
      }
      // Mimic Obsidian: parse the YAML block, hand it to the callback,
      // and write it back. The body and other parts of the file are not
      // touched by this fake.
      const normalized = content.replace(/\r\n/g, "\n");
      const parsed = parseFrontmatter(normalized);
      const obj = parsed.frontmatter ?? {};
      update(obj);
      const rebuilt = rebuildFrontmatter(normalized, obj, parsed.body);
      files.set(note.path, rebuilt);
    },

    resolveLink(linkPath: string, sourcePath: string): VaultNoteRef | null {
      // Resolve against known files. Mimic Obsidian's behaviour for bare
      // basenames: scan top-level candidates, prefer exact matches.
      const candidates: string[] = [];
      const tryAdd = (candidate: string): void => {
        if (files.has(candidate) && !candidates.includes(candidate)) {
          candidates.push(candidate);
        }
      };
      const normalized = stripLinkAlias(linkPath);
      if (normalized.endsWith(".md")) {
        tryAdd(normalized);
      } else {
        tryAdd(`${normalized}.md`);
      }
      if (!normalized.includes("/")) {
        // Scan every folder we know for a matching basename.
        for (const path of files.keys()) {
          if (path.endsWith(`/${normalized}.md`)) tryAdd(path);
        }
      }
      if (candidates.length === 0) return null;
      const exact = candidates.find(
        (path) =>
          path === `${DEFAULT_SETTINGS.projectsFolder}/${normalized}.md` ||
          path === normalized,
      );
      const chosen = exact ?? candidates[0];
      const basename = chosen.slice(chosen.lastIndexOf("/") + 1);
      return { path: chosen, basename };
    },
  };

  return { files, folders, ...adapter };
}

interface Sliced {
  frontmatter: Record<string, unknown> | null;
  body: string;
}

function parseFrontmatter(content: string): Sliced {
  if (!content.startsWith("---\n")) return { frontmatter: null, body: content };
  const lines = content.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      const yaml = lines.slice(1, i).join("\n");
      const body = lines.slice(i + 1).join("\n");
      // Tiny hand-rolled YAML reader so the fake stays dependency-free.
      const obj: Record<string, unknown> = {};
      for (const line of yaml.split("\n")) {
        const idx = line.indexOf(":");
        if (idx < 0) continue;
        const key = line.slice(0, idx).trim();
        const raw = line.slice(idx + 1).trim();
        if (raw.length === 0) {
          obj[key] = null;
        } else if (raw === "true") {
          obj[key] = true;
        } else if (raw === "false") {
          obj[key] = false;
        } else if (/^-?\d+$/.test(raw)) {
          obj[key] = Number(raw);
        } else if (
          (raw.startsWith('"') && raw.endsWith('"')) ||
          (raw.startsWith("'") && raw.endsWith("'"))
        ) {
          obj[key] = raw.slice(1, -1);
        } else {
          obj[key] = raw;
        }
      }
      return { frontmatter: obj, body };
    }
  }
  return { frontmatter: null, body: content };
}

function rebuildFrontmatter(
  original: string,
  obj: Record<string, unknown>,
  body: string,
): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      lines.push(`${key}:`);
      continue;
    }
    if (typeof value === "string") {
      lines.push(`${key}: ${formatYamlString(value)}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      lines.push(`${key}: ${String(value)}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push("---");
  // Preserve the original trailing whitespace on the body.
  const bodyWithBreak = body.startsWith("\n") ? body : `\n${body}`;
  return `${lines.join("\n")}${bodyWithBreak}`;
}

/**
 * Mirror the round-trip behaviour of Obsidian's `processFrontMatter`:
 * plain scalar strings (no special characters) are emitted bare; any
 * value that would confuse YAML (contains `:`, `#`, quotes, brackets,
 * etc.) is quoted. `[[…]]` wikilinks always need quoting because the
 * flow mapping syntax would otherwise interpret `[[` as a sequence.
 */
function formatYamlString(value: string): string {
  if (/^[A-Za-z0-9 _.-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function stripLinkAlias(link: string): string {
  const pipe = link.indexOf("|");
  const head = pipe >= 0 ? link.slice(0, pipe) : link;
  const hash = head.indexOf("#");
  return hash >= 0 ? head.slice(0, hash) : head;
}

// ---------------------------------------------------------------------------
// Helpers shared by tests
// ---------------------------------------------------------------------------

function makeRepo(
  fake: FakeVaultState & VaultAdapter,
  settings: PluginSettings = { ...DEFAULT_SETTINGS },
): ProjectTaskRepository {
  return new ProjectTaskRepository(fake, settings);
}

function seedFile(
  fake: FakeVaultState & VaultAdapter,
  path: string,
  content: string,
): void {
  fake.files.set(path, content);
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (dir.length > 0) fake.folders.add(dir);
}

function projectNote(props: Record<string, unknown> = {}): string {
  const lines = ["---", "type: project"];
  for (const [key, value] of Object.entries(props)) {
    lines.push(`${key}: ${formatValue(value)}`);
  }
  lines.push("---", "# Project", "", "Body.");
  return lines.join("\n");
}

function taskNote(
  projectLink: string,
  props: Record<string, unknown> = {},
): string {
  const lines = ["---", "type: task", `project: "[[${projectLink}]]"`];
  for (const [key, value] of Object.entries(props)) {
    lines.push(`${key}: ${formatValue(value)}`);
  }
  if (!("status" in props)) lines.push("status: open");
  lines.push("---", "# Task", "", "Body.");
  return lines.join("\n");
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return `"${value.replace(/"/g, '\\"')}"`;
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Folder scan + validation tests
// ---------------------------------------------------------------------------

describe("ProjectTaskRepository", () => {
  describe("load", () => {
    describe("scansBothFolders", () => {
      it("parses projects and tasks from their configured folders", async () => {
        const fake = createFakeVault();
        seedFile(
          fake,
          "Projects/Website.md",
          projectNote({ color: "blue" }),
        );
        seedFile(
          fake,
          "Tasks/Write copy.md",
          taskNote("Projects/Website"),
        );

        const repo = makeRepo(fake);
        const data = await repo.load();

        expect(data.projects).toHaveLength(1);
        expect(data.projects[0].path).toBe("Projects/Website.md");
        expect(data.projects[0].title).toBe("Website");

        expect(data.tasks).toHaveLength(1);
        expect(data.tasks[0].path).toBe("Tasks/Write copy.md");
        expect(data.tasks[0].projectPath).toBe("Projects/Website.md");
        expect(data.tasks[0].status).toBe("open");

        expect(data.issues).toHaveLength(0);
      });
    });

    describe("isolatesInvalidNotes", () => {
      it("surfaces invalid notes as issues without dropping valid ones", async () => {
        const fake = createFakeVault();
        seedFile(fake, "Projects/Good.md", projectNote());
        seedFile(
          fake,
          "Projects/Broken.md",
          ["---", "type: project", "owner: alice", "Body"].join("\n"),
        );
        seedFile(fake, "Projects/Random.md", "Just a regular note.");

        const repo = makeRepo(fake);
        const data = await repo.load();

        expect(data.projects.map((p) => p.title)).toEqual(["Good"]);
        expect(data.issues).toHaveLength(2);
        const issuePaths = data.issues.map((i) => i.path).sort();
        expect(issuePaths).toEqual([
          "Projects/Broken.md",
          "Projects/Random.md",
        ]);
      });
    });

    describe("unresolvedTaskLink", () => {
      it("reports a task whose project link does not resolve", async () => {
        const fake = createFakeVault();
        seedFile(
          fake,
          "Tasks/Orphan.md",
          taskNote("Projects/Nonexistent"),
        );

        const repo = makeRepo(fake);
        const data = await repo.load();

        expect(data.tasks).toHaveLength(0);
        expect(data.issues).toHaveLength(1);
        expect(data.issues[0].path).toBe("Tasks/Orphan.md");
        expect(data.issues[0].message).toMatch(/No se pudo resolver/i);
      });
    });

    describe("ignoresForeignFolders", () => {
      it("does not pick up notes outside the configured folders", async () => {
        const fake = createFakeVault();
        seedFile(fake, "Projects/A.md", projectNote());
        seedFile(
          fake,
          "Daily Notes/2026-01-01.md",
          projectNote(),
        );

        const repo = makeRepo(fake);
        const data = await repo.load();

        expect(data.projects).toHaveLength(1);
        expect(data.projects[0].path).toBe("Projects/A.md");
        expect(data.issues).toHaveLength(0);
      });
    });

    describe("reloadReadsManualMarkdownChanges", () => {
      it("picks up status and project-link edits made directly on the file", async () => {
        const fake = createFakeVault();
        seedFile(fake, "Projects/Alpha.md", projectNote());
        seedFile(fake, "Projects/Beta.md", projectNote());
        // Task starts as open + linked to Alpha; carries a custom
        // `priority` frontmatter key and a body line the test will
        // later assert is preserved untouched.
        const taskPath = "Tasks/Write copy.md";
        const initial = [
          "---",
          "type: task",
          'project: "[[Projects/Alpha]]"',
          "status: open",
          "priority: high",
          "---",
          "# Write copy",
          "",
          "Custom body content stays here.",
        ].join("\n");
        seedFile(fake, taskPath, initial);

        const repo = makeRepo(fake);

        // Sanity check: the first load reflects the seeded values.
        const first = await repo.load();
        const firstTask = first.tasks.find((t) => t.path === taskPath)!;
        expect(firstTask).toBeDefined();
        expect(firstTask.status).toBe("open");
        expect(firstTask.projectPath).toBe("Projects/Alpha.md");
        expect(firstTask.properties.priority).toBe("high");

        // Simulate an external Markdown edit (the user opening the
        // note in the editor and toggling status + reassigning the
        // project link). We rewrite the stored bytes directly so the
        // repository's next `load()` has to re-read from scratch.
        const manuallyEdited = [
          "---",
          "type: task",
          'project: "[[Projects/Beta]]"',
          "status: done",
          "priority: high",
          "---",
          "# Write copy",
          "",
          "Custom body content stays here.",
        ].join("\n");
        fake.files.set(taskPath, manuallyEdited);

        const second = await repo.load();
        const secondTask = second.tasks.find((t) => t.path === taskPath)!;
        expect(secondTask).toBeDefined();
        expect(secondTask.status).toBe("done");
        expect(secondTask.projectPath).toBe("Projects/Beta.md");
        // The custom `priority` key survives the second load because
        // `load()` parses the file as it sits on disk and keeps every
        // unknown frontmatter entry in `properties`.
        expect(secondTask.properties.priority).toBe("high");
      });
    });
  });

  // -------------------------------------------------------------------------
  // Creation tests
  // -------------------------------------------------------------------------

  describe("createProject", () => {
    it("creates a project note in the configured folder", async () => {
      const fake = createFakeVault();
      const repo = makeRepo(fake);

      await repo.createProject("Website");

      expect(fake.files.has("Projects/Website.md")).toBe(true);
      const content = fake.files.get("Projects/Website.md")!;
      expect(content).toMatch(/type: project/);
      expect(content).toMatch(/^---/);
    });
  });

  describe("createTask", () => {
    it("creates a task note linked to the given project", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/Website.md", projectNote());
      const repo = makeRepo(fake);

      await repo.createTask("Write copy", "Projects/Website.md");

      expect(fake.files.has("Tasks/Write copy.md")).toBe(true);
      const content = fake.files.get("Tasks/Write copy.md")!;
      expect(content).toMatch(/type: task/);
      expect(content).toMatch(/project: "\[\[Projects\/Website\]\]"/);
      expect(content).toMatch(/status: open/);
    });

    it("creates the projects and tasks folders when missing", async () => {
      const fake = createFakeVault();
      const repo = makeRepo(fake, {
        projectsFolder: "Areas/Web",
        tasksFolder: "Inbox/Todo",
      });

      await repo.createProject("Website");
      await repo.createTask("First task", "Areas/Web/Website.md");

      expect(fake.folders.has("Areas/Web")).toBe(true);
      expect(fake.folders.has("Inbox/Todo")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Rename tests
  // -------------------------------------------------------------------------

  describe("renameTask", () => {
    it("renames the note file to the sanitized title", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/A.md", projectNote());
      seedFile(fake, "Tasks/Old name.md", taskNote("Projects/A"));
      const repo = makeRepo(fake);

      await repo.renameTask("Tasks/Old name.md", "Fresh name");

      expect(fake.files.has("Tasks/Old name.md")).toBe(false);
      expect(fake.files.has("Tasks/Fresh name.md")).toBe(true);
    });
  });

  describe("renamingProjectUpdatesLinkedTasks", () => {
    it("updates the project property of every task that linked the old path", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/Old.md", projectNote());
      seedFile(fake, "Tasks/Alpha.md", taskNote("Projects/Old"));
      seedFile(fake, "Tasks/Beta.md", taskNote("Projects/Old"));
      seedFile(
        fake,
        "Tasks/Other.md",
        taskNote("Projects/Other"),
      );

      // Add a third project so Other can resolve.
      seedFile(fake, "Projects/Other.md", projectNote());
      const repo = makeRepo(fake);

      await repo.renameProject("Projects/Old.md", "New");

      // The project file itself was renamed.
      expect(fake.files.has("Projects/New.md")).toBe(true);
      expect(fake.files.has("Projects/Old.md")).toBe(false);

      // Alpha + Beta have their project link rewritten to the new wikilink.
      const alphaContent = fake.files.get("Tasks/Alpha.md")!;
      const betaContent = fake.files.get("Tasks/Beta.md")!;
      expect(alphaContent).toMatch(/project: "\[\[Projects\/New\]\]"/);
      expect(betaContent).toMatch(/project: "\[\[Projects\/New\]\]"/);

      // Other task's project link is untouched.
      const otherContent = fake.files.get("Tasks/Other.md")!;
      expect(otherContent).toMatch(/project: "\[\[Projects\/Other\]\]"/);

      // Bodies and other frontmatter properties are preserved.
      expect(alphaContent).toMatch(/# Task/);
      expect(alphaContent).toMatch(/status: open/);
    });

    it("picks up multi-line folded-scalar project values written by hand", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/Old.md", projectNote());
      // A hand-written frontmatter where `project` spans two physical
      // lines via YAML's `|` (literal) block-scalar indicator. The
      // previous regex probe could not match this form because it
      // only looked at single lines; the new `js-yaml`-backed
      // `extractProjectWikilink` helper must surface it.
      const foldedTask = [
        "---",
        "type: task",
        "project: |",
        "  [[Projects/Old]]",
        "status: open",
        "---",
        "# Folded",
        "",
        "Body.",
      ].join("\n");
      seedFile(fake, "Tasks/Folded.md", foldedTask);

      const repo = makeRepo(fake);
      await repo.renameProject("Projects/Old.md", "New");

      // The task was rewritten; the exact bytes depend on the fake's
      // own line-based YAML reader, but it must end up with the new
      // wikilink and must not be left with the folded scalar literal.
      const updated = fake.files.get("Tasks/Folded.md")!;
      expect(updated).toMatch(/project: "\[\[Projects\/New\]\]"/);
      expect(updated).not.toMatch(/^project: \|/m);
      // Body and unrelated keys are preserved.
      expect(updated).toMatch(/# Folded/);
      expect(updated).toMatch(/status: open/);
    });
  });

  // -------------------------------------------------------------------------
  // Reassignment + status change tests
  // -------------------------------------------------------------------------

  describe("reassignTask", () => {
    it("updates only the project property and preserves the body and other keys", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/A.md", projectNote());
      seedFile(fake, "Projects/B.md", projectNote());
      const originalBody = [
        "---",
        "type: task",
        'project: "[[Projects/A]]"',
        "status: open",
        "owner: alice",
        "estimate: 3",
        "---",
        "# Alpha",
        "",
        "Original body stays here.",
      ].join("\n");
      seedFile(fake, "Tasks/Alpha.md", originalBody);

      const repo = makeRepo(fake);
      await repo.reassignTask("Tasks/Alpha.md", "Projects/B.md");

      const updated = fake.files.get("Tasks/Alpha.md")!;
      expect(updated).toMatch(/project: "\[\[Projects\/B\]\]"/);
      expect(updated).toMatch(/owner: alice/);
      expect(updated).toMatch(/estimate: 3/);
      expect(updated).toMatch(/status: open/);
      expect(updated).toMatch(/Original body stays here\./);
    });
  });

  describe("setTaskStatus", () => {
    it("flips open to done and updates only the status property", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/A.md", projectNote());
      const original = [
        "---",
        "type: task",
        'project: "[[Projects/A]]"',
        "status: open",
        "owner: alice",
        "---",
        "# Alpha",
        "",
        "Body here.",
      ].join("\n");
      seedFile(fake, "Tasks/Alpha.md", original);

      const repo = makeRepo(fake);
      await repo.setTaskStatus("Tasks/Alpha.md", "done");

      const updated = fake.files.get("Tasks/Alpha.md")!;
      expect(updated).toMatch(/status: done/);
      expect(updated).toMatch(/owner: alice/);
      expect(updated).toMatch(/project: "\[\[Projects\/A\]\]"/);
      expect(updated).toMatch(/Body here\./);
    });
  });

  // -------------------------------------------------------------------------
  // Sanitization + disambiguation tests
  // -------------------------------------------------------------------------

  describe("sanitizesUnsafeCharacters", () => {
    it("strips characters forbidden by Windows and Obsidian", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/A.md", projectNote());
      const repo = makeRepo(fake);

      await repo.createTask('Risky / title: "x" * ? < > | #bad', "Projects/A.md");

      const keys = Array.from(fake.files.keys()).filter((k) =>
        k.startsWith("Tasks/"),
      );
      expect(keys).toHaveLength(1);
      const name = keys[0];
      // Every forbidden char must be gone from the basename portion.
      const basename = name!.slice("Tasks/".length);
      expect(basename).not.toMatch(/[\\/:*?"<>|#]/);
      expect(basename.endsWith(".md")).toBe(true);
    });

    it("returns 'Untitled' when the sanitized title is empty", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/A.md", projectNote());
      const repo = makeRepo(fake);

      await repo.createTask("////", "Projects/A.md");

      const keys = Array.from(fake.files.keys()).filter((k) =>
        k.startsWith("Tasks/"),
      );
      expect(keys).toHaveLength(1);
      expect(keys[0]).toBe("Tasks/Untitled.md");
    });
  });

  describe("renamingToExistingTitleDisambiguates", () => {
    it("appends ' 2', ' 3', ... to avoid overwriting an existing note", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/A.md", projectNote());
      seedFile(fake, "Tasks/Shared.md", taskNote("Projects/A"));
      const repo = makeRepo(fake);

      await repo.createTask("Shared", "Projects/A.md");

      const keys = Array.from(fake.files.keys())
        .filter((k) => k.startsWith("Tasks/"))
        .sort();
      // The original note must still be there with its content intact.
      expect(fake.files.get("Tasks/Shared.md")).toMatch(
        /project: "\[\[Projects\/A\]\]"/,
      );
      expect(keys).toContain("Tasks/Shared.md");
      // The new note is disambiguated.
      expect(keys).toContain("Tasks/Shared 2.md");
    });
  });

  // -------------------------------------------------------------------------
  // Custom property + body preservation tests
  // -------------------------------------------------------------------------

  describe("preservesCustomPropertiesAndBody", () => {
    it("createTask does not strip unknown properties when reloading the note", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/A.md", projectNote());
      const repo = makeRepo(fake);

      await repo.createTask("Has props", "Projects/A.md");

      // Inject a custom property directly into the stored content (simulating
      // the user editing the file in Obsidian) and confirm load() returns it.
      const before = fake.files.get("Tasks/Has props.md")!;
      const withCustom = before
        .replace(/^---\n/, "---\ncolor: blue\n")
        .replace(/# Has props/, "# Has props\n\nMy notes.");
      fake.files.set("Tasks/Has props.md", withCustom);

      const data = await repo.load();
      const task = data.tasks.find((t) => t.path === "Tasks/Has props.md")!;
      expect(task).toBeDefined();
      expect(task.properties.color).toBe("blue");
    });
  });
});
