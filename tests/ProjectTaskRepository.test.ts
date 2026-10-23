import { describe, it, expect } from "vitest";
import type { VaultNoteRef, VaultAdapter } from "../src/data/VaultAdapter";
import { ProjectTaskRepository } from "../src/data/ProjectTaskRepository";
import { DEFAULT_SETTINGS, type PluginSettings } from "../src/settings";
import {
  createSaltB64,
  decryptField,
  deriveKey,
  encryptField,
  isEncryptedValue,
} from "../src/domain/credentialsCrypto";
import {
  DEFAULT_TEMPLATE_CONTENT,
  TEMPLATE_FILE_NAMES,
} from "../src/domain/templates";

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
  binaries: Map<string, ArrayBuffer>;
}

function createFakeVault(): FakeVaultState & VaultAdapter {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const binaries = new Map<string, ArrayBuffer>();

  const adapter: VaultAdapter = {
    listMarkdownFiles(folderPath: string): VaultNoteRef[] {
      const prefix = `${folderPath}/`;
      const refs: VaultNoteRef[] = [];
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue;
        if (path.slice(prefix.length).includes("/")) continue;
        // Como `vault.getMarkdownFiles()`: sólo `.md` (las `.base` no cuentan).
        if (!path.endsWith(".md")) continue;
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

    listFiles(folderPath: string): VaultNoteRef[] {
      const prefix = `${folderPath}/`;
      const seen = new Set<string>();
      const refs: VaultNoteRef[] = [];
      const tryAdd = (path: string): void => {
        if (!path.startsWith(prefix)) return;
        const rest = path.slice(prefix.length);
        if (rest.includes("/")) return;
        if (rest.startsWith(".")) return;
        if (seen.has(path)) return;
        seen.add(path);
        const basename = path.slice(path.lastIndexOf("/") + 1);
        refs.push({ path, basename });
      };
      for (const path of files.keys()) tryAdd(path);
      for (const path of binaries.keys()) tryAdd(path);
      return refs.sort((a, b) => a.path.localeCompare(b.path));
    },

    async createBinary(path: string, data: ArrayBuffer): Promise<VaultNoteRef> {
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (dir.length > 0) {
        const segments = dir.split("/");
        let current = "";
        for (const seg of segments) {
          current = current.length === 0 ? seg : `${current}/${seg}`;
          folders.add(current);
        }
      }
      binaries.set(path, data);
      const basename = path.slice(path.lastIndexOf("/") + 1);
      return { path, basename };
    },

    async rename(note: VaultNoteRef, newPath: string): Promise<VaultNoteRef> {
      const content = files.get(note.path);
      if (content !== undefined) {
        files.delete(note.path);
        files.set(newPath, content);
        const dir = newPath.includes("/")
          ? newPath.slice(0, newPath.lastIndexOf("/"))
          : "";
        if (dir.length > 0) folders.add(dir);
        const basename = newPath.slice(newPath.lastIndexOf("/") + 1);
        return { path: newPath, basename };
      }
      // Los binarios de Archivos/ también pueden renombrarse (misma
      // semántica opaca que las notas: mover bytes sin tocar contenido).
      const data = binaries.get(note.path);
      if (data !== undefined) {
        binaries.delete(note.path);
        binaries.set(newPath, data);
        const dir = newPath.includes("/")
          ? newPath.slice(0, newPath.lastIndexOf("/"))
          : "";
        if (dir.length > 0) folders.add(dir);
        const basename = newPath.slice(newPath.lastIndexOf("/") + 1);
        return { path: newPath, basename };
      }
      throw new Error(`Fake vault: cannot rename missing file: ${note.path}`);
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

    listSubfolders(folderPath: string): string[] {
      // The fake's `folders` set holds every path that has ever been
      // created or implied. Direct children are those entries whose
      // parent is exactly `folderPath`, i.e. the entry equals
      // `${folderPath}/${name}` with no further `/` in `name`.
      const out: string[] = [];
      for (const path of folders) {
        const lastSlash = path.lastIndexOf("/");
        const parent = lastSlash >= 0 ? path.slice(0, lastSlash) : "";
        if (parent !== folderPath) continue;
        if (path.slice(lastSlash + 1).startsWith(".")) continue;
        out.push(path);
      }
      return out.sort();
    },

    exists(path: string): boolean {
      return files.has(path) || binaries.has(path) || folders.has(path);
    },

    async renameFolder(folderPath: string, newPath: string): Promise<void> {
      if (!folders.has(folderPath)) {
        throw new Error(
          `Fake vault: cannot rename missing folder: ${folderPath}`,
        );
      }
      const oldPrefix = `${folderPath}/`;
      const newPrefix = `${newPath}/`;

      // Rewrite every file whose path lives inside the renamed folder.
      for (const path of Array.from(files.keys())) {
        if (!path.startsWith(oldPrefix)) continue;
        const suffix = path.slice(oldPrefix.length);
        const next = `${newPrefix}${suffix}`;
        const content = files.get(path)!;
        files.delete(path);
        files.set(next, content);
      }

      // Rewrite every binary whose path lives inside the renamed folder.
      for (const path of Array.from(binaries.keys())) {
        if (!path.startsWith(oldPrefix)) continue;
        const suffix = path.slice(oldPrefix.length);
        const next = `${newPrefix}${suffix}`;
        const data = binaries.get(path)!;
        binaries.delete(path);
        binaries.set(next, data);
      }

      // Rewrite every descendant folder entry.
      for (const path of Array.from(folders)) {
        if (!path.startsWith(oldPrefix)) continue;
        const suffix = path.slice(oldPrefix.length);
        const next = `${newPrefix}${suffix}`;
        folders.delete(path);
        folders.add(next);
      }

      // Move the folder itself last so descendants resolve before the
      // parent's own key is rewritten.
      folders.delete(folderPath);
      folders.add(newPath);

      // Materialise every ancestor of `newPath` so the new subtree
      // lives inside a fully-connected tree, mirroring what
      // `createFolder` does when called on a fresh path.
      const segments = newPath.split("/");
      let current = "";
      for (const segment of segments) {
        current = current.length === 0 ? segment : `${current}/${segment}`;
        folders.add(current);
      }
    },

    async trash(note: VaultNoteRef): Promise<void> {
      if (files.has(note.path)) {
        files.delete(note.path);
        return;
      }
      if (binaries.has(note.path)) {
        binaries.delete(note.path);
        return;
      }
      throw new Error(`Fake vault: cannot trash missing file: ${note.path}`);
    },
  };

  return { files, folders, binaries, ...adapter };
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

function seedFolder(
  fake: FakeVaultState & VaultAdapter,
  path: string,
): void {
  fake.folders.add(path);
}

/**
 * Seed the three V2 templates so the mutation tests that bypass
 * `load()` (and therefore the seeding it does) still see a healthy
 * template file on disk. Pass `templatesFolder` to override the
 * default; defaults to `DEFAULT_SETTINGS.templatesFolder`.
 */
function seedTemplates(
  fake: FakeVaultState & VaultAdapter,
  templatesFolder: string = DEFAULT_SETTINGS.templatesFolder,
): void {
  for (const [kind, content] of Object.entries(DEFAULT_TEMPLATE_CONTENT) as [
    keyof typeof DEFAULT_TEMPLATE_CONTENT,
    string,
  ][]) {
    const fileName = TEMPLATE_FILE_NAMES[kind];
    seedFile(fake, `${templatesFolder}/${fileName}`, content);
  }
}

function projectNote(props: Record<string, unknown> = {}): string {
  // V2 fixed-property bag. The parser requires these specific keys for
  // a `type: project` note to validate cleanly.
  const merged: Record<string, unknown> = {
    status: "active",
    created: "2026-01-15",
    tags: [],
    description: "",
    client: "",
    ...props,
  };
  const lines = ["---", "type: project"];
  for (const [key, value] of Object.entries(merged)) {
    lines.push(`${key}: ${formatValue(value)}`);
  }
  lines.push("---", "# Project", "", "Body.");
  return lines.join("\n");
}

function taskNote(
  projectLink: string,
  props: Record<string, unknown> = {},
): string {
  const merged: Record<string, unknown> = {
    status: "open",
    created: "2026-01-15",
    priority: "medium",
    due: "",
    ...props,
  };
  const lines = [
    "---",
    "type: task",
    `project: "[[${projectLink}]]"`,
  ];
  for (const [key, value] of Object.entries(merged)) {
    lines.push(`${key}: ${formatValue(value)}`);
  }
  lines.push("---", "# Task", "", "Body.");
  return lines.join("\n");
}

function noteContent(projectLink: string, props: Record<string, unknown> = {}): string {
  const merged: Record<string, unknown> = {
    created: "2026-01-15",
    ...props,
  };
  const lines = [
    "---",
    "type: note",
    `project: "[[${projectLink}]]"`,
  ];
  for (const [key, value] of Object.entries(merged)) {
    lines.push(`${key}: ${formatValue(value)}`);
  }
  lines.push("---", "# Nota", "", "Cuerpo.");
  return lines.join("\n");
}

function credentialsNote(
  entries: Array<Record<string, unknown>> = [],
): string {
  return [
    "---",
    "type: credentials",
    `credentials: ${JSON.stringify(entries)}`,
    "---",
    "",
  ].join("\n");
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return `"${value.replace(/"/g, '\\"')}"`;
  if (Array.isArray(value)) return JSON.stringify(value);
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Folder scan + validation tests
// ---------------------------------------------------------------------------

describe("ProjectTaskRepository", () => {
  describe("load", () => {
    describe("scansProjectTree", () => {
      it("seeds the three templates, parses hubs and tasks from each project folder", async () => {
        const fake = createFakeVault();
        seedFile(
          fake,
          "Projects/Website/Website.md",
          projectNote({ description: "Marketing site" }),
        );
        seedFile(
          fake,
          "Projects/Website/Tareas/Write copy.md",
          taskNote("Projects/Website/Website"),
        );
        seedFile(
          fake,
          "Projects/Internal/Internal.md",
          projectNote(),
        );
        seedFile(
          fake,
          "Projects/Internal/Tareas/Quarterly review.md",
          taskNote("Projects/Internal/Internal", { priority: "high" }),
        );

        const repo = makeRepo(fake);
        const data = await repo.load();

        expect(data.projects.filter((p) => !p.isGeneral)).toHaveLength(2);
        // General se siembra junto a los proyectos del usuario.
        expect(data.projects.find((p) => p.isGeneral === true)?.path).toBe(
          "Projects/General/General.md",
        );
        const website = data.projects.find((p) => p.title === "Website")!;
        expect(website).toBeDefined();
        expect(website.path).toBe("Projects/Website/Website.md");
        expect(website.folderPath).toBe("Projects/Website");
        expect(website.properties.description).toBe("Marketing site");

        const internal = data.projects.find((p) => p.title === "Internal")!;
        expect(internal.folderPath).toBe("Projects/Internal");

        expect(data.tasks).toHaveLength(2);
        const copy = data.tasks.find((t) => t.title === "Write copy")!;
        expect(copy).toBeDefined();
        expect(copy.path).toBe("Projects/Website/Tareas/Write copy.md");
        expect(copy.projectPath).toBe("Projects/Website/Website.md");
        expect(copy.status).toBe("open");
        expect(copy.properties.priority).toBe("medium");

        const review = data.tasks.find((t) => t.title === "Quarterly review")!;
        expect(review.projectPath).toBe("Projects/Internal/Internal.md");
        expect(review.properties.priority).toBe("high");

        expect(data.issues).toHaveLength(0);
      });
    });

    describe("isolatesInvalidNotes", () => {
      it("surfaces invalid notes as issues without dropping valid ones", async () => {
        const fake = createFakeVault();
        // Valid project.
        seedFile(
          fake,
          "Projects/Good/Good.md",
          projectNote(),
        );
        // Folder whose hub has broken frontmatter (no closing `---`).
        seedFile(
          fake,
          "Projects/Broken/Broken.md",
          ["---", "type: project", "owner: alice", "Body"].join("\n"),
        );
        // Folder missing its hub — surfaces its own dedicated issue.
        // The brief skips the rest of the scan for hubless folders, so
        // we don't seed any tasks inside.
        seedFolder(fake, "Projects/Missing");

        const repo = makeRepo(fake);
        const data = await repo.load();

        expect(data.projects.map((p) => p.title)).toEqual(["General", "Good"]);
        // The broken hub note must produce an issue pointing at it.
        expect(
          data.issues.some(
            (i) => i.path === "Projects/Broken/Broken.md",
          ),
        ).toBe(true);
        // The missing hub must surface its own dedicated issue.
        expect(data.issues.some((i) => i.path === "Projects/Missing")).toBe(true);
        expect(data.tasks).toHaveLength(0);
      });
    });

    describe("unresolvedTaskLink", () => {
      it("reports a task whose project link does not resolve", async () => {
        const fake = createFakeVault();
        seedFile(
          fake,
          "Projects/Website/Website.md",
          projectNote(),
        );
        seedFile(
          fake,
          "Projects/Website/Tareas/Orphan.md",
          taskNote("Projects/Nonexistent/Nonexistent"),
        );

        const repo = makeRepo(fake);
        const data = await repo.load();

        expect(data.tasks).toHaveLength(0);
        expect(data.issues).toHaveLength(1);
        expect(data.issues[0].path).toBe(
          "Projects/Website/Tareas/Orphan.md",
        );
        expect(data.issues[0].message).toMatch(/No se pudo resolver/i);
      });
    });

    describe("ignoresForeignFolders", () => {
      it("does not pick up notes outside the configured folders", async () => {
        const fake = createFakeVault();
        seedFile(
          fake,
          "Projects/A/A.md",
          projectNote(),
        );
        // A foreign folder that LOOKS like a project folder: has a hub
        // and a Tareas/ subfolder with a task. The scan must ignore it.
        seedFile(
          fake,
          "Daily Notes/2026-01-01/Daily Notes.md",
          projectNote(),
        );
        seedFile(
          fake,
          "Daily Notes/2026-01-01/Tareas/Review.md",
          taskNote("Daily Notes/2026-01-01/Daily Notes"),
        );

        const repo = makeRepo(fake);
        const data = await repo.load();

        expect(data.projects.filter((p) => !p.isGeneral)).toHaveLength(1);
        expect(
          data.projects.find((p) => !p.isGeneral)?.path,
        ).toBe("Projects/A/A.md");
        expect(data.tasks).toHaveLength(0);
        expect(data.issues).toHaveLength(0);
      });
    });

    describe("reloadReadsManualMarkdownChanges", () => {
      it("picks up status and project-link edits made directly on the file", async () => {
        const fake = createFakeVault();
        seedFile(
          fake,
          "Projects/Alpha/Alpha.md",
          projectNote(),
        );
        seedFile(
          fake,
          "Projects/Beta/Beta.md",
          projectNote(),
        );
        const taskPath = "Projects/Alpha/Tareas/Write copy.md";
        const initial = [
          "---",
          "type: task",
          'project: "[[Projects/Alpha/Alpha]]"',
          "status: open",
          "priority: high",
          'created: "2026-01-15"',
          "---",
          "# Write copy",
          "",
          "Custom body content stays here.",
        ].join("\n");
        seedFile(fake, taskPath, initial);

        const repo = makeRepo(fake);

        const first = await repo.load();
        const firstTask = first.tasks.find((t) => t.path === taskPath)!;
        expect(firstTask).toBeDefined();
        expect(firstTask.status).toBe("open");
        expect(firstTask.projectPath).toBe("Projects/Alpha/Alpha.md");
        expect(firstTask.properties.priority).toBe("high");

        const manuallyEdited = [
          "---",
          "type: task",
          'project: "[[Projects/Beta/Beta]]"',
          "status: done",
          "priority: high",
          'created: "2026-01-15"',
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
        expect(secondTask.projectPath).toBe("Projects/Beta/Beta.md");
        expect(secondTask.properties.priority).toBe("high");
      });
    });

    // -------------------------------------------------------------------------
    // V2 seed / template tests (brief new tests 1-3)
    // -------------------------------------------------------------------------

    describe("seedsOnlyMissingTemplates", () => {
      it("seeds all three templates on first load and does not overwrite them on the next", async () => {
        const fake = createFakeVault();
        const repo = makeRepo(fake);

        // First load: every template is created from the default seed.
        await repo.load();
        const tplProject = fake.files.get(
          `${DEFAULT_SETTINGS.templatesFolder}/${TEMPLATE_FILE_NAMES.project}`,
        );
        const tplTask = fake.files.get(
          `${DEFAULT_SETTINGS.templatesFolder}/${TEMPLATE_FILE_NAMES.task}`,
        );
        const tplCreds = fake.files.get(
          `${DEFAULT_SETTINGS.templatesFolder}/${TEMPLATE_FILE_NAMES.credentials}`,
        );
        expect(tplProject).toBe(DEFAULT_TEMPLATE_CONTENT.project);
        expect(tplTask).toBe(DEFAULT_TEMPLATE_CONTENT.task);
        expect(tplCreds).toBe(DEFAULT_TEMPLATE_CONTENT.credentials);

        // User customises the project template: add a `client_logo`
        // property to mark their fork.
        const customised = tplProject!.replace(
          "client:",
          "client:\nclient_logo: \"\"",
        );
        fake.files.set(
          `${DEFAULT_SETTINGS.templatesFolder}/${TEMPLATE_FILE_NAMES.project}`,
          customised,
        );

        // Re-running load() must NOT overwrite the customised content.
        await repo.load();
        const afterReload = fake.files.get(
          `${DEFAULT_SETTINGS.templatesFolder}/${TEMPLATE_FILE_NAMES.project}`,
        );
        expect(afterReload).toBe(customised);
        expect(afterReload).toContain("client_logo");
      });
    });

    describe("reportsInvalidTemplate", () => {
      it("returns an issue pointing at the broken template path with a Spanish message", async () => {
        const fake = createFakeVault();
        // Pre-seed a broken template: missing 'status' fixed property.
        const broken = DEFAULT_TEMPLATE_CONTENT.project
          .split("\n")
          .filter((line) => !line.startsWith("status:"))
          .join("\n");
        seedFile(
          fake,
          `${DEFAULT_SETTINGS.templatesFolder}/${TEMPLATE_FILE_NAMES.project}`,
          broken,
        );

        const repo = makeRepo(fake);
        const data = await repo.load();

        const tplIssue = data.issues.find((i) =>
          i.path.endsWith(TEMPLATE_FILE_NAMES.project),
        );
        expect(tplIssue).toBeDefined();
        expect(tplIssue!.message).toMatch(/plantilla/i);
        expect(tplIssue!.message).toMatch(/status/);
      });
    });

    describe("excludesTemplatesFolderFromScan", () => {
      it("does not treat templates as project folders even if they live inside projectsFolder", async () => {
        const fake = createFakeVault();
        // A `_templates` subfolder under Projects with a note that
        // would otherwise be misread as a project.
        seedFolder(fake, DEFAULT_SETTINGS.templatesFolder);
        const tplProject = DEFAULT_SETTINGS.templatesFolder;
        seedFile(
          fake,
          `${tplProject}/proyecto.md`,
          DEFAULT_TEMPLATE_CONTENT.project,
        );
        // A real project, to make sure the scan still works.
        seedFile(
          fake,
          "Projects/Website/Website.md",
          projectNote(),
        );

        const repo = makeRepo(fake);
        const data = await repo.load();

        expect(data.projects.filter((p) => !p.isGeneral)).toHaveLength(1);
        expect(data.projects.find((p) => !p.isGeneral)?.title).toBe("Website");
      });
    });

    // -------------------------------------------------------------------------
    // V2 stray / hub / subfolder tests (brief new tests 4-6, 8, 9)
    // -------------------------------------------------------------------------

    describe("reportsStrayV1Note", () => {
      it("produces an issue for a loose .md sitting at the root of projectsFolder", async () => {
        const fake = createFakeVault();
        seedFile(
          fake,
          "Projects/Loose note.md",
          ["---", "type: project", "status: active", "created: 2026-01-15", "---"].join("\n"),
        );
        // Also one well-formed project so the scan is not empty.
        seedFile(
          fake,
          "Projects/Website/Website.md",
          projectNote(),
        );

        const repo = makeRepo(fake);
        const data = await repo.load();

        expect(data.projects.filter((p) => !p.isGeneral)).toHaveLength(1);
        const strayIssue = data.issues.find((i) => i.path === "Projects/Loose note.md");
        expect(strayIssue).toBeDefined();
        expect(strayIssue!.message).toMatch(/suelta/i);
        expect(strayIssue!.message).toMatch(/Loose note\.md/);
      });
    });

    describe("reportsFolderWithoutMatchingHub", () => {
      it("surfaces a dedicated issue naming the folder and the missing hub file", async () => {
        const fake = createFakeVault();
        // Folder present, but no <folder>/<folder>.md inside it.
        seedFolder(fake, "Projects/Emptyish");
        // Add a task inside Tareas/ to prove the folder is being scanned.
        seedFile(
          fake,
          "Projects/Emptyish/Tareas/Hello.md",
          taskNote("Projects/Website/Website"),
        );
        // And a sibling project with a valid hub, to confirm the scan
        // does not abort on the first failure.
        seedFile(
          fake,
          "Projects/Website/Website.md",
          projectNote(),
        );

        const repo = makeRepo(fake);
        const data = await repo.load();

        const folderIssue = data.issues.find(
          (i) => i.path === "Projects/Emptyish",
        );
        expect(folderIssue).toBeDefined();
        expect(folderIssue!.message).toMatch(/Emptyish/);
        expect(folderIssue!.message).toMatch(/Emptyish\.md/);
        // The valid project still came back.
        expect(data.projects.some((p) => p.title === "Website")).toBe(true);
      });
    });

    describe("loadsProjectTreeWithTasksAndCredentials", () => {
      it("returns project, tasks and credentials together with folderPath populated", async () => {
        const fake = createFakeVault();
        seedFile(
          fake,
          "Projects/Website/Website.md",
          projectNote({ description: "Marketing site", client: "Acme" }),
        );
        seedFile(
          fake,
          "Projects/Website/Tareas/Write copy.md",
          taskNote("Projects/Website/Website"),
        );
        seedFile(
          fake,
          "Projects/Website/Tareas/Buy domain.md",
          taskNote("Projects/Website/Website", { status: "done" }),
        );
        seedFile(
          fake,
          "Projects/Website/Credenciales.md",
          credentialsNote([
            { service: "Hosting", user: "ops", password: "secret1" },
          ]),
        );

        const repo = makeRepo(fake);
        const data = await repo.load();

        expect(data.projects.filter((p) => !p.isGeneral)).toHaveLength(1);
        const websiteProject = data.projects.find(
          (p) => p.path === "Projects/Website/Website.md",
        )!;
        expect(websiteProject).toBeDefined();
        expect(websiteProject.folderPath).toBe("Projects/Website");
        expect(websiteProject.properties.client).toBe("Acme");

        expect(data.tasks).toHaveLength(2);
        const copy = data.tasks.find((t) => t.title === "Write copy")!;
        expect(copy.projectPath).toBe("Projects/Website/Website.md");
        const domain = data.tasks.find((t) => t.title === "Buy domain")!;
        expect(domain.status).toBe("done");

        const websiteCreds = data.credentials.find(
          (c) => c.projectPath === "Projects/Website/Website.md",
        )!;
        expect(websiteCreds).toBeDefined();
        expect(websiteCreds.entries).toHaveLength(1);
        expect(websiteCreds.entries[0].service).toBe("Hosting");

        expect(data.issues).toHaveLength(0);
      });
    });

    describe("missingCredentialsNoteIsNotAnIssue", () => {
      it("does not surface an issue when a project folder has no Credenciales.md", async () => {
        const fake = createFakeVault();
        seedFile(
          fake,
          "Projects/Website/Website.md",
          projectNote(),
        );
        seedFile(
          fake,
          "Projects/Website/Tareas/Write copy.md",
          taskNote("Projects/Website/Website"),
        );

        const repo = makeRepo(fake);
        const data = await repo.load();

        // Website no aporta credenciales; General sí (vacías, sembradas).
        expect(
          data.credentials.find(
            (c) => c.projectPath === "Projects/Website/Website.md",
          ),
        ).toBeUndefined();
        const generalCreds = data.credentials.find(
          (c) => c.projectPath === "Projects/General/General.md",
        )!;
        expect(generalCreds).toBeDefined();
        expect(generalCreds.entries).toHaveLength(0);
        // No issues about a missing credentials note.
        expect(
          data.issues.some((i) => /Credenciales/i.test(i.message)),
        ).toBe(false);
      });
    });

    describe("missingSubfoldersAreTolerated", () => {
      it("still loads a project when both Tareas/ and Credenciales.md are absent", async () => {
        const fake = createFakeVault();
        seedFolder(fake, "Projects/Minimal");
        seedFile(
          fake,
          "Projects/Minimal/Minimal.md",
          projectNote(),
        );

        const repo = makeRepo(fake);
        const data = await repo.load();

        expect(data.projects.filter((p) => !p.isGeneral)).toHaveLength(1);
        expect(
          data.projects.find((p) => p.path === "Projects/Minimal/Minimal.md")
            ?.title,
        ).toBe("Minimal");
        expect(data.tasks).toHaveLength(0);
        // Solo General aporta su Credenciales.md sembrado (vacío).
        expect(data.credentials.map((c) => c.projectPath).sort()).toEqual([
          "Projects/General/General.md",
        ]);
        expect(data.issues).toHaveLength(0);
      });
    });

    describe("taskLocationDoesNotOverrideWikilink", () => {
      it("follows the project's [[wikilink]] even when the task physically lives in another project's Tareas/", async () => {
        const fake = createFakeVault();
        seedFile(
          fake,
          "Projects/A/A.md",
          projectNote(),
        );
        seedFile(
          fake,
          "Projects/B/B.md",
          projectNote(),
        );
        // The file is in B/Tareas, yet the frontmatter points at A.
        seedFile(
          fake,
          "Projects/B/Tareas/Misplaced.md",
          taskNote("Projects/A/A"),
        );

        const repo = makeRepo(fake);
        const data = await repo.load();

        const task = data.tasks.find(
          (t) => t.path === "Projects/B/Tareas/Misplaced.md",
        );
        expect(task).toBeDefined();
        // The task belongs to A, not B.
        expect(task!.projectPath).toBe("Projects/A/A.md");
      });
    });

    // -------------------------------------------------------------------------
    // V2 hub-type / credentials validation tests (brief new tests 10, 11)
    // -------------------------------------------------------------------------

    describe("hubWithWrongTypeIsAnIssue", () => {
      it("surfaces an issue when a folder's hub note has a non-project type", async () => {
        const fake = createFakeVault();
        seedFile(
          fake,
          "Projects/Confused/Confused.md",
          taskNote("Projects/Website/Website"),
        );
        seedFile(
          fake,
          "Projects/Website/Website.md",
          projectNote(),
        );

        const repo = makeRepo(fake);
        const data = await repo.load();

        const confusedIssue = data.issues.find(
          (i) => i.path === "Projects/Confused/Confused.md",
        );
        expect(confusedIssue).toBeDefined();
        expect(confusedIssue!.message).toMatch(/hub/i);
        expect(confusedIssue!.message).toMatch(/project/);
      });
    });

    describe("preservesValidCredentialEntriesAlongsideInvalidOne", () => {
      it("keeps the valid entry in data.credentials while surfacing the invalid one as an issue", async () => {
        const fake = createFakeVault();
        seedFile(
          fake,
          "Projects/Website/Website.md",
          projectNote(),
        );
        seedFile(
          fake,
          "Projects/Website/Credenciales.md",
          credentialsNote([
            // Missing `password` on the first entry.
            { service: "Hosting", user: "ops" },
            // Valid second entry.
            { service: "GitHub", user: "alice", password: "hunter2" },
          ]),
        );

        const repo = makeRepo(fake);
        const data = await repo.load();

        // The credentials record still appears with the valid row intact.
        const websiteCreds = data.credentials.find(
          (c) => c.projectPath === "Projects/Website/Website.md",
        )!;
        expect(websiteCreds).toBeDefined();
        expect(websiteCreds.entries).toHaveLength(1);
        expect(websiteCreds.entries[0].service).toBe("GitHub");
        expect(websiteCreds.entries[0].user).toBe("alice");
        expect(websiteCreds.entries[0].password).toBe("hunter2");

        // The broken row surfaces as a per-entry issue indexed at 0.
        const credsIssue = data.issues.find(
          (i) => i.path === "Projects/Website/Credenciales.md",
        );
        expect(credsIssue).toBeDefined();
        expect(credsIssue!.message).toMatch(/0/);
        expect(credsIssue!.message).toMatch(/password/i);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Creation tests — V2 mutation surface (brief tests 1, 2, 3, 4, 8)
  // -------------------------------------------------------------------------

  describe("createProject", () => {
    it("createsFullStructure", async () => {
      const fake = createFakeVault();
      // Seed a healthy project template so `createProject` does not
      // throw the "invalid template" branch. The default seed lives
      // on disk only after `load()`, so we mimic it here for an
      // isolated mutation test.
      seedTemplates(fake);
      const repo = makeRepo(fake);

      await repo.createProject("Foo");

      // The folder, both subfolders, the hub and Credenciales.md must
      // all materialise.
      expect(fake.folders.has(`${DEFAULT_SETTINGS.projectsFolder}/Foo`)).toBe(true);
      expect(fake.folders.has(`${DEFAULT_SETTINGS.projectsFolder}/Foo/Tareas`)).toBe(true);
      expect(fake.folders.has(`${DEFAULT_SETTINGS.projectsFolder}/Foo/Archivos`)).toBe(true);

      const hubPath = `${DEFAULT_SETTINGS.projectsFolder}/Foo/Foo.md`;
      expect(fake.files.has(hubPath)).toBe(true);
      const hubContent = fake.files.get(hubPath)!;
      // The hub carries the six fixed properties. js-yaml dumps
      // string values with single quotes; the assertions accept either
      // form so the test stays robust across dump styles.
      expect(hubContent).toMatch(/type: project/);
      expect(hubContent).toMatch(/status: active/);
      expect(hubContent).toMatch(/created: ['"]?(\d{4}-\d{2}-\d{2})['"]?/);
      expect(hubContent).toMatch(/tags: \[\]/);
      expect(hubContent).toMatch(/description:/);
      expect(hubContent).toMatch(/client:/);

      const credPath = `${DEFAULT_SETTINGS.projectsFolder}/Foo/Credenciales.md`;
      expect(fake.files.has(credPath)).toBe(true);
      const credContent = fake.files.get(credPath)!;
      expect(credContent).toMatch(/type: credentials/);
      expect(credContent).toMatch(/credentials: \[\]/);
    });

    it("appliesCustomTemplateProperties", async () => {
      const fake = createFakeVault();
      // Pre-seed a project template that carries an extra `color`
      // property. The hub should round-trip that property through
      // `applyTemplate`. Seed the credentials template too because
      // `createProject` reads it as well.
      const customTemplate = [
        "---",
        "type: project",
        "status: active",
        "created: 1970-01-01",
        "tags: []",
        "description:",
        "client:",
        "color: blue",
        "---",
        "",
      ].join("\n");
      seedFile(
        fake,
        `${DEFAULT_SETTINGS.templatesFolder}/${TEMPLATE_FILE_NAMES.project}`,
        customTemplate,
      );
      seedFile(
        fake,
        `${DEFAULT_SETTINGS.templatesFolder}/${TEMPLATE_FILE_NAMES.credentials}`,
        DEFAULT_TEMPLATE_CONTENT.credentials,
      );
      const repo = makeRepo(fake);

      await repo.createProject("Foo");

      const hubContent = fake.files.get(
        `${DEFAULT_SETTINGS.projectsFolder}/Foo/Foo.md`,
      )!;
      expect(hubContent).toMatch(/color: blue/);
    });

    it("blockedByInvalidTemplate", async () => {
      const fake = createFakeVault();
      // Pre-seed a broken project template (missing `status`).
      const broken = DEFAULT_TEMPLATE_CONTENT.project
        .split("\n")
        .filter((line) => !line.startsWith("status:"))
        .join("\n");
      seedFile(
        fake,
        `${DEFAULT_SETTINGS.templatesFolder}/${TEMPLATE_FILE_NAMES.project}`,
        broken,
      );
      const repo = makeRepo(fake);

      // createProject must throw with a Spanish message.
      await expect(repo.createProject("Foo")).rejects.toThrowError(
        /La plantilla/,
      );
      // No folder, no file should have been created.
      expect(fake.folders.has(`${DEFAULT_SETTINGS.projectsFolder}/Foo`)).toBe(false);
      expect(
        fake.files.has(`${DEFAULT_SETTINGS.projectsFolder}/Foo/Foo.md`),
      ).toBe(false);
    });

    it("createsTheProjectsFolderWhenMissing", async () => {
      const fake = createFakeVault();
      const repo = makeRepo(fake, {
        ...DEFAULT_SETTINGS,
        projectsFolder: "Areas/Web",
        templatesFolder: "Areas/Web/_templates",
      });
      // Seed the project + credentials templates under the customised
      // templates folder so `createProject` can read them.
      seedTemplates(fake, "Areas/Web/_templates");

      await repo.createProject("Website");

      // The configured projects folder (and every level below it) is
      // materialised by the mutation, even when it never existed.
      expect(fake.folders.has("Areas/Web")).toBe(true);
      expect(fake.folders.has("Areas/Web/Website")).toBe(true);
      expect(fake.folders.has("Areas/Web/Website/Tareas")).toBe(true);
      expect(fake.folders.has("Areas/Web/Website/Archivos")).toBe(true);
    });
  });

  describe("createTask", () => {
    it("writesIntoProjectTasksFolder", async () => {
      const fake = createFakeVault();
      seedFile(
        fake,
        "Projects/Website/Website.md",
        projectNote(),
      );
      // `createTask` reads the task template — seed it.
      seedTemplates(fake);
      const repo = makeRepo(fake);

      await repo.createTask("Write copy", "Projects/Website/Website.md");

      const taskPath = "Projects/Website/Tareas/Write copy.md";
      expect(fake.files.has(taskPath)).toBe(true);
      const content = fake.files.get(taskPath)!;
      expect(content).toMatch(/type: task/);
      // js-yaml may quote the wikilink with single or double quotes.
      expect(content).toMatch(/project: ['"]\[\[Projects\/Website\/Website\]\]['"]?/);
      expect(content).toMatch(/status: open/);
      // The task template's fixed properties survive the apply step.
      expect(content).toMatch(/priority: medium/);
      expect(content).toMatch(/created: ['"]?(\d{4}-\d{2}-\d{2})['"]?/);
    });

    it("blockedByInvalidTemplate", async () => {
      const fake = createFakeVault();
      seedFile(
        fake,
        "Projects/Website/Website.md",
        projectNote(),
      );
      // Pre-seed a broken task template (missing `priority`).
      const broken = DEFAULT_TEMPLATE_CONTENT.task
        .split("\n")
        .filter((line) => !line.startsWith("priority:"))
        .join("\n");
      seedFile(
        fake,
        `${DEFAULT_SETTINGS.templatesFolder}/${TEMPLATE_FILE_NAMES.task}`,
        broken,
      );
      const repo = makeRepo(fake);

      await expect(
        repo.createTask("Write copy", "Projects/Website/Website.md"),
      ).rejects.toThrowError(/La plantilla/);
      // No file landed inside Tareas/.
      expect(
        fake.files.has("Projects/Website/Tareas/Write copy.md"),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Rename tests
  // -------------------------------------------------------------------------

  describe("renameTask", () => {
    it("renames the note file to the sanitized title", async () => {
      const fake = createFakeVault();
      seedFile(
        fake,
        "Projects/A/A.md",
        projectNote(),
      );
      seedFile(
        fake,
        "Projects/A/Tareas/Old name.md",
        taskNote("Projects/A/A"),
      );
      const repo = makeRepo(fake);

      await repo.renameTask("Projects/A/Tareas/Old name.md", "Fresh name");

      expect(fake.files.has("Projects/A/Tareas/Old name.md")).toBe(false);
      expect(fake.files.has("Projects/A/Tareas/Fresh name.md")).toBe(true);
    });
  });

  describe("renamingProjectUpdatesLinkedTasksAtNewPaths", () => {
    it("moves the folder, the hub, and patches the project link on every task that linked the old path", async () => {
      const fake = createFakeVault();
      seedFile(
        fake,
        "Projects/Old/Old.md",
        projectNote(),
      );
      seedFile(
        fake,
        "Projects/Other/Other.md",
        projectNote(),
      );
      seedFile(
        fake,
        "Projects/Old/Tareas/Alpha.md",
        taskNote("Projects/Old/Old"),
      );
      seedFile(
        fake,
        "Projects/Old/Tareas/Beta.md",
        taskNote("Projects/Old/Old"),
      );
      seedFile(
        fake,
        "Projects/Other/Tareas/Other.md",
        taskNote("Projects/Other/Other"),
      );

      const repo = makeRepo(fake);

      await repo.renameProject("Projects/Old/Old.md", "New");

      // The folder itself moved (Obsidian auto-link-update is OFF in
      // this scenario; the plugin is the only thing rewriting the
      // frontmatter).
      expect(fake.folders.has("Projects/New")).toBe(true);
      expect(fake.folders.has("Projects/Old")).toBe(false);
      // The hub landed inside the new folder with the new name.
      expect(fake.files.has("Projects/New/New.md")).toBe(true);
      expect(fake.files.has("Projects/Old/Old.md")).toBe(false);

      // Tasks physically moved with the folder, and their project
      // link was rewritten to the new path.
      expect(fake.files.has("Projects/New/Tareas/Alpha.md")).toBe(true);
      expect(fake.files.has("Projects/New/Tareas/Beta.md")).toBe(true);
      expect(fake.files.has("Projects/Old/Tareas/Alpha.md")).toBe(false);
      expect(fake.files.has("Projects/Old/Tareas/Beta.md")).toBe(false);

      const alphaContent = fake.files.get("Projects/New/Tareas/Alpha.md")!;
      const betaContent = fake.files.get("Projects/New/Tareas/Beta.md")!;
      expect(alphaContent).toMatch(/project: "\[\[Projects\/New\/New\]\]"/);
      expect(betaContent).toMatch(/project: "\[\[Projects\/New\/New\]\]"/);

      // The 'Other' task belongs to a different project and must be
      // untouched.
      const otherContent = fake.files.get(
        "Projects/Other/Tareas/Other.md",
      )!;
      expect(otherContent).toMatch(/project: "\[\[Projects\/Other\/Other\]\]"/);

      // Bodies and other frontmatter properties are preserved on
      // the moved tasks.
      expect(alphaContent).toMatch(/# Task/);
      expect(alphaContent).toMatch(/status: open/);
    });
  });

  describe("renameProjectDisambiguatesExistingFolder", () => {
    it("appends ' 2' when the requested folder name collides with an existing project", async () => {
      const fake = createFakeVault();
      // Two project folders with hubs. Rename `Original` to `Foo`,
      // which is already taken by the sibling.
      seedFile(
        fake,
        "Projects/Foo/Foo.md",
        projectNote(),
      );
      seedFile(
        fake,
        "Projects/Original/Original.md",
        projectNote(),
      );

      const repo = makeRepo(fake);

      await repo.renameProject("Projects/Original/Original.md", "Foo");

      // The renamed project lives in the disambiguated folder.
      expect(fake.folders.has("Projects/Foo 2")).toBe(true);
      expect(fake.files.has("Projects/Foo 2/Foo.md")).toBe(true);
      // The original folder is gone.
      expect(fake.folders.has("Projects/Original")).toBe(false);
      // The pre-existing Foo project is untouched.
      expect(fake.files.has("Projects/Foo/Foo.md")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Reassignment + status change tests
  // -------------------------------------------------------------------------

  describe("reassignTask", () => {
    it("moves the file to the new project's Tareas/ and rewrites the project wikilink", async () => {
      const fake = createFakeVault();
      seedFile(
        fake,
        "Projects/A/A.md",
        projectNote(),
      );
      seedFile(
        fake,
        "Projects/B/B.md",
        projectNote(),
      );
      const originalBody = [
        "---",
        "type: task",
        'project: "[[Projects/A/A]]"',
        "status: open",
        "created: 2026-01-15",
        "priority: medium",
        "owner: alice",
        "estimate: 3",
        "---",
        "# Alpha",
        "",
        "Original body stays here.",
      ].join("\n");
      seedFile(fake, "Projects/A/Tareas/Alpha.md", originalBody);

      const repo = makeRepo(fake);
      await repo.reassignTask(
        "Projects/A/Tareas/Alpha.md",
        "Projects/B/B.md",
      );

      // The file physically moved to the new project's Tareas/ folder.
      expect(fake.files.has("Projects/B/Tareas/Alpha.md")).toBe(true);
      expect(fake.files.has("Projects/A/Tareas/Alpha.md")).toBe(false);

      const updated = fake.files.get("Projects/B/Tareas/Alpha.md")!;
      expect(updated).toMatch(/project: "\[\[Projects\/B\/B\]\]"/);
      expect(updated).toMatch(/owner: alice/);
      expect(updated).toMatch(/estimate: 3/);
      expect(updated).toMatch(/status: open/);
      expect(updated).toMatch(/Original body stays here\./);
    });
  });

  describe("setTaskStatus", () => {
    it("flips open to done and updates only the status property", async () => {
      const fake = createFakeVault();
      seedFile(
        fake,
        "Projects/A/A.md",
        projectNote(),
      );
      const original = [
        "---",
        "type: task",
        'project: "[[Projects/A/A]]"',
        "status: open",
        "created: 2026-01-15",
        "priority: medium",
        "owner: alice",
        "---",
        "# Alpha",
        "",
        "Body here.",
      ].join("\n");
      seedFile(fake, "Projects/A/Tareas/Alpha.md", original);

      const repo = makeRepo(fake);
      await repo.setTaskStatus("Projects/A/Tareas/Alpha.md", "done");

      const updated = fake.files.get("Projects/A/Tareas/Alpha.md")!;
      expect(updated).toMatch(/status: done/);
      expect(updated).toMatch(/owner: alice/);
      expect(updated).toMatch(/project: "\[\[Projects\/A\/A\]\]"/);
      expect(updated).toMatch(/Body here\./);
    });
  });

  describe("deleteTask", () => {
    it("trashes the note so it disappears from the next load", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/A/A.md", projectNote());
      seedFile(
        fake,
        "Projects/A/Tareas/Alpha.md",
        taskNote("Projects/A/A"),
      );
      seedFile(fake, "Projects/A/Tareas/Beta.md", taskNote("Projects/A/A"));

      const repo = makeRepo(fake);
      await repo.deleteTask("Projects/A/Tareas/Alpha.md");

      expect(fake.files.has("Projects/A/Tareas/Alpha.md")).toBe(false);
      const data = await repo.load();
      expect(data.tasks.map((t) => t.path)).toEqual([
        "Projects/A/Tareas/Beta.md",
      ]);
    });

    it("throws when the note does not exist", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/A/A.md", projectNote());

      const repo = makeRepo(fake);
      await expect(repo.deleteTask("Projects/A/Tareas/Ghost.md")).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Favorite flag mutation tests (Task 2: setProjectFavorite + createProject
  // returns the hub path)
  // -------------------------------------------------------------------------

  describe("setProjectFavorite", () => {
    it("addsMissingPropPreservingRest", async () => {
      const fake = createFakeVault();
      const hubPath = "Projects/Website/Website.md";
      // The fake's hand-rolled `processFrontMatter` strips quotes from
      // bare-safe scalars (e.g. `created: "2026-01-15"` → `created:
      //2026-01-15`), which `js-yaml.load` then parses as a Date
      // object — failing the project's `created`-must-be-string check.
      // Use a `/` date so the round-trip emits a quoted string that
      // survives the subsequent `js-yaml.load`.
      const initial = [
        "---",
        "type: project",
        "status: active",
        'created: "2026/01/15"',
        "tags: []",
        "description:",
        "client:",
        "owner: alice",
        "---",
        "# Website",
        "",
        "Original body of the project stays here.",
      ].join("\n");
      seedFile(fake, hubPath, initial);

      const repo = makeRepo(fake);
      await repo.setProjectFavorite(hubPath, true);

      const data = await repo.load();
      const project = data.projects.find((p) => p.path === hubPath);
      expect(project).toBeDefined();
      expect(project!.favorite).toBe(true);

      // The user's custom property and the body must be intact.
      const updated = fake.files.get(hubPath)!;
      expect(updated).toMatch(/owner: alice/);
      expect(updated).toMatch(/Original body of the project stays here\./);
    });

    it("turnsOffExistingProp", async () => {
      const fake = createFakeVault();
      const hubPath = "Projects/Website/Website.md";
      const initial = [
        "---",
        "type: project",
        "status: active",
        'created: "2026/01/15"',
        "tags: []",
        "description:",
        "client:",
        "favorite: true",
        "---",
        "# Website",
        "",
        "Body.",
      ].join("\n");
      seedFile(fake, hubPath, initial);

      const repo = makeRepo(fake);
      await repo.setProjectFavorite(hubPath, false);

      const data = await repo.load();
      const project = data.projects.find((p) => p.path === hubPath);
      expect(project).toBeDefined();
      expect(project!.favorite).toBe(false);
    });
  });

  describe("createProject returns the hub path", () => {
    it("createProjectReturnsHubPath", async () => {
      const fake = createFakeVault();
      seedTemplates(fake);
      const repo = makeRepo(fake);

      const hubPath = await repo.createProject("Web Rediseño");

      expect(hubPath).toBe("Projects/Web Rediseño/Web Rediseño.md");
    });
  });

  // -------------------------------------------------------------------------
  // Sanitization + disambiguation tests
  // -------------------------------------------------------------------------

  describe("sanitizesUnsafeCharacters", () => {
    it("strips characters forbidden by Windows and Obsidian", async () => {
      const fake = createFakeVault();
      seedFile(
        fake,
        "Projects/A/A.md",
        projectNote(),
      );
      seedTemplates(fake);
      const repo = makeRepo(fake);

      await repo.createTask(
        'Risky / title: "x" * ? < > | #bad',
        "Projects/A/A.md",
      );

      // After sanitisation the title becomes "Risky - title- -x- -bad"
      // (forbidden chars collapse into single dashes, which are kept
      // verbatim). The file lives at Projects/A/Tareas/<basename>.md.
      const keys = Array.from(fake.files.keys()).filter((k) =>
        k.startsWith("Projects/A/Tareas/"),
      );
      expect(keys.length).toBeGreaterThan(0);
      const file = keys[0]!;
      const basename = file.slice(file.lastIndexOf("/") + 1);
      expect(basename).not.toMatch(/[\\/:*?"<>|#]/);
      expect(basename.endsWith(".md")).toBe(true);
      // The sanitised stem must begin with the original first word so
      // we know it came from the user's input rather than "Untitled".
      expect(basename.startsWith("Risky")).toBe(true);
    });

    it("returns 'Untitled' when the sanitized title is empty", async () => {
      const fake = createFakeVault();
      seedFile(
        fake,
        "Projects/A/A.md",
        projectNote(),
      );
      seedTemplates(fake);
      const repo = makeRepo(fake);

      await repo.createTask("////", "Projects/A/A.md");

      const keys = Array.from(fake.files.keys()).filter((k) =>
        k.includes("/Untitled.md"),
      );
      expect(keys.length).toBeGreaterThan(0);
    });
  });

  describe("renamingToExistingTitleDisambiguates", () => {
    it("appends ' 2', ' 3', ... to avoid overwriting an existing note", async () => {
      const fake = createFakeVault();
      seedFile(
        fake,
        "Projects/A/A.md",
        projectNote(),
      );
      seedFile(
        fake,
        "Projects/A/Tareas/Shared.md",
        taskNote("Projects/A/A"),
      );
      seedTemplates(fake);
      const repo = makeRepo(fake);

      await repo.createTask("Shared", "Projects/A/A.md");

      const allKeys = Array.from(fake.files.keys()).filter(
        (k) => k.startsWith("Projects/A/Tareas/") && k.endsWith(".md"),
      );
      // The original note must still be there with its content intact.
      expect(fake.files.get("Projects/A/Tareas/Shared.md")).toMatch(
        /project: "\[\[Projects\/A\/A\]\]"/,
      );
      expect(allKeys).toContain("Projects/A/Tareas/Shared.md");
      // The new note is disambiguated.
      expect(allKeys).toContain("Projects/A/Tareas/Shared 2.md");
    });
  });

  // -------------------------------------------------------------------------
  // Custom property + body preservation tests
  // -------------------------------------------------------------------------

  describe("preservesCustomPropertiesAndBody", () => {
    it("createTask does not strip unknown properties when reloading the note", async () => {
      const fake = createFakeVault();
      seedFile(
        fake,
        "Projects/A/A.md",
        projectNote(),
      );
      seedTemplates(fake);
      const repo = makeRepo(fake);

      await repo.createTask("Has props", "Projects/A/A.md");

      const createdKey = Array.from(fake.files.keys()).find(
        (k) => k.endsWith("/Has props.md"),
      );
      expect(createdKey).toBeDefined();
      // The freshly created file uses the V1 frontmatter shape (no
      // `created` / `priority` / `due`). Replace it with a V2-valid
      // body that also carries a custom `color` property to assert
      // the round-trip preservation in `load()`.
      const withCustom = [
        "---",
        "type: task",
        'project: "[[Projects/A/A]]"',
        "status: open",
        'created: "2026-01-15"',
        "due:",
        "priority: medium",
        "color: blue",
        "---",
        "# Has props",
        "",
        "My notes.",
        "",
      ].join("\n");
      fake.files.set(createdKey!, withCustom);

      const data = await repo.load();
      const task = data.tasks.find((t) => t.path === createdKey!)!;
      expect(task).toBeDefined();
      expect(task.properties.color).toBe("blue");
    });
  });

  describe("notes", () => {
    it("loadsNotesFromNotasFolder", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/Website/Website.md", projectNote());
      seedFile(
        fake,
        "Projects/Website/Notas/Idea.md",
        noteContent("Projects/Website/Website"),
      );
      seedFile(
        fake,
        "Projects/Website/Tareas/Write copy.md",
        taskNote("Projects/Website/Website"),
      );

      const repo = makeRepo(fake);
      const data = await repo.load();

      expect(data.notes).toHaveLength(1);
      expect(data.notes[0]!.path).toBe("Projects/Website/Notas/Idea.md");
      expect(data.notes[0]!.projectPath).toBe("Projects/Website/Website.md");
      expect(data.tasks).toHaveLength(1);
    });

    it("createNoteWritesIntoNotasFolder", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/Website/Website.md", projectNote());
      seedTemplates(fake);
      const repo = makeRepo(fake);

      await repo.createNote("Idea suelta", "Projects/Website/Website.md");

      const notePath = "Projects/Website/Notas/Idea suelta.md";
      expect(fake.files.has(notePath)).toBe(true);
      const content = fake.files.get(notePath)!;
      expect(content).toMatch(/type: note/);
      expect(content).toMatch(/project: ['"]\[\[Projects\/Website\/Website\]\]['"]?/);
    });

    it("deleteNoteTrashesTheNote", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/A/A.md", projectNote());
      seedFile(fake, "Projects/A/Notas/Idea.md", noteContent("Projects/A/A"));
      const repo = makeRepo(fake);

      await repo.deleteNote("Projects/A/Notas/Idea.md");

      expect(fake.files.has("Projects/A/Notas/Idea.md")).toBe(false);
      const data = await repo.load();
      expect(data.notes).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Contrato binario del falso (listFiles + createBinary conviven con .md)
  // -------------------------------------------------------------------------

  describe("vaultBinaryContract", () => {
    it("listsNonMarkdownFilesSortedNonRecursive", async () => {
      const fake = createFakeVault();
      // Creación desordenada a propósito para afirmar el orden por path.
      await fake.createBinary(
        "Projects/A/Archivos/foto.png",
        new ArrayBuffer(2),
      );
      await fake.createBinary(
        "Projects/A/Archivos/doc.pdf",
        new ArrayBuffer(3),
      );
      await fake.createBinary(
        "Projects/A/Archivos/sub/nested.png",
        new ArrayBuffer(1),
      );

      const refs = fake.listFiles("Projects/A/Archivos");

      expect(refs.map((r) => r.path)).toEqual([
        "Projects/A/Archivos/doc.pdf",
        "Projects/A/Archivos/foto.png",
      ]);
    });

    it("createBinaryEnsuresParentFolder", async () => {
      const fake = createFakeVault();

      await fake.createBinary(
        "Projects/Nuevo/Archivos/scan.pdf",
        new ArrayBuffer(4),
      );

      expect(fake.folders.has("Projects/Nuevo/Archivos")).toBe(true);
      expect(fake.binaries.has("Projects/Nuevo/Archivos/scan.pdf")).toBe(true);
      expect(fake.exists("Projects/Nuevo/Archivos/scan.pdf")).toBe(true);
    });

    it("createBinaryCoexistsWithMarkdown", async () => {
      const fake = createFakeVault();
      await fake.createMarkdown(
        "Projects/A/Archivos/nota.md",
        "# Nota\n",
      );
      await fake.createBinary(
        "Projects/A/Archivos/foto.png",
        new ArrayBuffer(2),
      );

      // Ambas semánticas conviven: el .md sigue en el store de notas…
      expect(fake.files.has("Projects/A/Archivos/nota.md")).toBe(true);
      // …y el binario en su propio store sin pisarlo.
      expect(fake.binaries.has("Projects/A/Archivos/foto.png")).toBe(true);
      // listMarkdownFiles no devuelve binarios…
      expect(
        fake.listMarkdownFiles("Projects/A/Archivos").map((r) => r.path),
      ).toEqual(["Projects/A/Archivos/nota.md"]);
      // …pero listFiles devuelve ambos, ordenados por path.
      expect(fake.listFiles("Projects/A/Archivos").map((r) => r.path)).toEqual([
        "Projects/A/Archivos/foto.png",
        "Projects/A/Archivos/nota.md",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Proyecto sombra General + Archivos (siembra, escaneo, addFile)
  // -------------------------------------------------------------------------

  describe("seedsGeneralShadowProject", () => {
    it("siembra General en el primer load y lo marca isGeneral", async () => {
      const fake = createFakeVault();
      const repo = makeRepo(fake);

      const first = await repo.load();

      const general = first.projects.find((p) => p.isGeneral === true);
      expect(general).toBeDefined();
      expect(general!.path).toBe("Projects/General/General.md");
      expect(general!.folderPath).toBe("Projects/General");
      // Estructura completa del proyecto sombra.
      expect(fake.folders.has("Projects/General/Tareas")).toBe(true);
      expect(fake.folders.has("Projects/General/Archivos")).toBe(true);
      expect(fake.files.has("Projects/General/General.md")).toBe(true);
      expect(fake.files.has("Projects/General/Credenciales.md")).toBe(true);
      // Ningún otro proyecto se marca como General.
      expect(first.projects.filter((p) => p.isGeneral === true)).toHaveLength(
        1,
      );

      // Segunda carga: no duplica ni sobrescribe el hub existente.
      const hubBefore = fake.files.get("Projects/General/General.md")!;
      const second = await repo.load();
      expect(fake.files.get("Projects/General/General.md")).toBe(hubBefore);
      expect(
        second.projects
          .filter((p) => p.isGeneral === true)
          .map((p) => p.path),
      ).toEqual(["Projects/General/General.md"]);
    });

    it("respeta una General ya sembrada a mano con sus credenciales", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/General/General.md", projectNote());
      seedFile(
        fake,
        "Projects/General/Credenciales.md",
        credentialsNote([
          { service: "S", user: "u", password: "p" },
        ]),
      );
      const repo = makeRepo(fake);

      const data = await repo.load();

      const general = data.projects.find((p) => p.isGeneral === true);
      expect(general).toBeDefined();
      expect(general!.path).toBe("Projects/General/General.md");
      const creds = data.credentials.find(
        (c) => c.projectPath === "Projects/General/General.md",
      );
      expect(creds).toBeDefined();
      expect(creds!.entries).toHaveLength(1);
    });

    it("un General.md roto sale como issue sin tumbar el dashboard", async () => {
      const fake = createFakeVault();
      seedFile(
        fake,
        "Projects/General/General.md",
        ["---", "type: project", "owner: alice", "Body"].join("\n"),
      );
      seedFile(fake, "Projects/A/A.md", projectNote());
      const repo = makeRepo(fake);

      const data = await repo.load();

      expect(
        data.projects.some((p) => p.path === "Projects/A/A.md"),
      ).toBe(true);
      const generalIssue = data.issues.find(
        (i) => i.path === "Projects/General/General.md",
      );
      expect(generalIssue).toBeDefined();
    });
  });

  describe("listsFilesPerProject", () => {
    it("load lista Archivos/ por proyecto con projectPath del hub", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/A/A.md", projectNote());
      seedFile(fake, "Projects/B/B.md", projectNote());
      await fake.createBinary("Projects/A/Archivos/foto.png", new ArrayBuffer(2));
      await fake.createBinary("Projects/A/Archivos/doc.pdf", new ArrayBuffer(3));
      await fake.createBinary(
        "Projects/A/Archivos/sub/nested.png",
        new ArrayBuffer(1),
      );
      await fake.createBinary("Projects/A/Archivos/SINEXT", new ArrayBuffer(1));
      await fake.createBinary("Projects/A/Archivos/FOTO.PNG", new ArrayBuffer(1));
      await fake.createBinary("Projects/B/Archivos/otro.pdf", new ArrayBuffer(1));
      const repo = makeRepo(fake);

      const data = await repo.load();

      const filesA = data.files.filter(
        (f) => f.projectPath === "Projects/A/A.md",
      );
      expect(filesA.map((f) => f.path).sort()).toEqual([
        "Projects/A/Archivos/FOTO.PNG",
        "Projects/A/Archivos/SINEXT",
        "Projects/A/Archivos/doc.pdf",
        "Projects/A/Archivos/foto.png",
      ]);
      const foto = filesA.find((f) => f.name === "foto.png")!;
      expect(foto.extension).toBe("png");
      // La extensión se normaliza a minúsculas…
      const mayus = filesA.find((f) => f.name === "FOTO.PNG")!;
      expect(mayus.extension).toBe("png");
      // …y el fichero sin extensión informa "".
      const sinExt = filesA.find((f) => f.name === "SINEXT")!;
      expect(sinExt.extension).toBe("");
      // El subnivel no se lista (igual que listMarkdownFiles).
      expect(data.files.some((f) => f.path.includes("/sub/"))).toBe(false);
      // Cada proyecto ata sus ficheros a su propio hub.
      const filesB = data.files.filter(
        (f) => f.projectPath === "Projects/B/B.md",
      );
      expect(filesB.map((f) => f.path)).toEqual([
        "Projects/B/Archivos/otro.pdf",
      ]);
      // General recién sembrado no aporta ficheros.
      expect(
        data.files.filter(
          (f) => f.projectPath === "Projects/General/General.md",
        ),
      ).toEqual([]);
    });
  });

  describe("addFile", () => {
    it("preserva la extension y desambigua con ' 2'", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/A/A.md", projectNote());
      seedTemplates(fake);
      const repo = makeRepo(fake);

      const first = await repo.addFile(
        "Projects/A/A.md",
        "foto.png",
        new ArrayBuffer(1),
      );
      expect(first).toBe("Projects/A/Archivos/foto.png");
      const second = await repo.addFile(
        "Projects/A/A.md",
        "foto.png",
        new ArrayBuffer(1),
      );
      expect(second).toBe("Projects/A/Archivos/foto 2.png");
      // El original sigue intacto en el store binario.
      expect(fake.binaries.has("Projects/A/Archivos/foto.png")).toBe(true);
      expect(fake.binaries.has("Projects/A/Archivos/foto 2.png")).toBe(true);

      const data = await repo.load();
      expect(
        data.files
          .filter((f) => f.projectPath === "Projects/A/A.md")
          .map((f) => f.path)
          .sort(),
      ).toEqual([
        "Projects/A/Archivos/foto 2.png",
        "Projects/A/Archivos/foto.png",
      ]);
    });

    it("sanitiza traversal sin escapar de Archivos/", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/A/A.md", projectNote());
      seedTemplates(fake);
      const repo = makeRepo(fake);

      const created = await repo.addFile(
        "Projects/A/A.md",
        "../evil.png",
        new ArrayBuffer(1),
      );

      expect(created).toBe("Projects/A/Archivos/evil.png");
      expect(created.includes("..")).toBe(false);
    });

    it("conserva la extension con mayusculas tal cual en disco", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/A/A.md", projectNote());
      seedTemplates(fake);
      const repo = makeRepo(fake);

      const created = await repo.addFile(
        "Projects/A/A.md",
        "FOTO.PNG",
        new ArrayBuffer(1),
      );

      expect(created).toBe("Projects/A/Archivos/FOTO.PNG");
      const data = await repo.load();
      const rec = data.files.find((f) => f.path === created)!;
      expect(rec).toBeDefined();
      expect(rec.extension).toBe("png");
    });
  });

  describe("deleteFile", () => {
    it("manda a papelera y desaparece del siguiente load", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/A/A.md", projectNote());
      seedTemplates(fake);
      const repo = makeRepo(fake);
      const created = await repo.addFile(
        "Projects/A/A.md",
        "foto.png",
        new ArrayBuffer(2),
      );
      await repo.addFile("Projects/A/A.md", "doc.pdf", new ArrayBuffer(3));

      await repo.deleteFile(created);

      expect(fake.binaries.has(created)).toBe(false);
      const data = await repo.load();
      expect(
        data.files
          .filter((f) => f.projectPath === "Projects/A/A.md")
          .map((f) => f.path),
      ).toEqual(["Projects/A/Archivos/doc.pdf"]);
    });

    it("lanza cuando el fichero no existe", async () => {
      const fake = createFakeVault();
      seedFile(fake, "Projects/A/A.md", projectNote());
      const repo = makeRepo(fake);

      await expect(
        repo.deleteFile("Projects/A/Archivos/fantasma.png"),
      ).rejects.toThrow();
    });
  });

  describe("splitFileName", () => {
    it("separa stem y extension por el ultimo punto", async () => {
      const mod = await import("../src/data/ProjectTaskRepository");

      expect(mod.splitFileName("foto.png")).toEqual({
        stem: "foto",
        ext: "png",
      });
      expect(mod.splitFileName("archive.tar.gz")).toEqual({
        stem: "archive.tar",
        ext: "gz",
      });
      expect(mod.splitFileName("SINEXT")).toEqual({
        stem: "SINEXT",
        ext: "",
      });
    });
  });

  describe("credentialsMutations", () => {
    const hubPath = "Projects/Website/Website.md";
    const credPath = "Projects/Website/Credenciales.md";

    async function unlockedKey(): Promise<CryptoKey> {
      return deriveKey("maestra-correcta-123", await createSaltB64());
    }

    function seedProjectWithCredentials(
      fake: FakeVaultState & VaultAdapter,
      entries: Array<Record<string, unknown>> = [],
    ): void {
      seedFile(fake, hubPath, projectNote());
      seedFile(fake, credPath, credentialsNote(entries));
    }

    it("createCredentialStoresEncryptedFields", async () => {
      const fake = createFakeVault();
      seedProjectWithCredentials(fake);
      const repo = makeRepo(fake);
      const key = await unlockedKey();

      await repo.createCredential(
        hubPath,
        { service: "Hosting", user: "ops", password: "s3cret" },
        key,
      );

      const content = fake.files.get(credPath)!;
      // The fake serialises arrays as JSON while real Obsidian writes YAML;
      // pin the adapter-agnostic guarantees: the service is readable, no
      // secret leaks, and the blobs carry the enc:v1: tag.
      expect(content).toContain("Hosting");
      expect(content).not.toContain("s3cret");
      expect(content).toContain("enc:v1:");

      const data = await repo.load();
      // General también siembra su Credenciales.md vacío: buscar por proyecto.
      const website = data.credentials.find(
        (c) => c.projectPath === hubPath,
      )!;
      expect(website.entries).toHaveLength(1);
      const entry = website.entries[0];
      expect(entry.service).toBe("Hosting");
      expect(isEncryptedValue(entry.password)).toBe(true);
      await expect(decryptField(key, entry.password as string)).resolves.toBe(
        "s3cret",
      );
    });

    it("createCredentialRequiresUnlockedKey", async () => {
      const fake = createFakeVault();
      seedProjectWithCredentials(fake);
      const repo = makeRepo(fake);

      await expect(
        repo.createCredential(
          hubPath,
          { service: "Hosting", user: "ops", password: "s3cret" },
          null,
        ),
      ).rejects.toThrow("Desbloquea las credenciales primero.");
    });

    it("updateCredentialReplacesEntry", async () => {
      const fake = createFakeVault();
      seedProjectWithCredentials(fake, [
        { service: "Hosting", user: "ops", password: "old" },
      ]);
      const repo = makeRepo(fake);
      const key = await unlockedKey();

      await repo.updateCredential(
        hubPath,
        0,
        "Hosting",
        { service: "Hosting", user: "root", password: "new" },
        key,
      );

      const data = await repo.load();
      const website = data.credentials.find(
        (c) => c.projectPath === hubPath,
      )!;
      expect(website.entries).toHaveLength(1);
      const entry = website.entries[0];
      expect(entry.service).toBe("Hosting");
      await expect(decryptField(key, entry.password as string)).resolves.toBe(
        "new",
      );
      await expect(decryptField(key, entry.user as string)).resolves.toBe(
        "root",
      );
    });

    it("updateCredentialPreservesExtraFields", async () => {
      const fake = createFakeVault();
      const key = await unlockedKey();
      seedProjectWithCredentials(fake, [
        {
          service: "Hosting",
          user: await encryptField(key, "ops"),
          password: await encryptField(key, "old"),
          rotation: "90d",
        },
      ]);
      const repo = makeRepo(fake);

      await repo.updateCredential(
        hubPath,
        0,
        "Hosting",
        { service: "Hosting", user: "root", password: "new" },
        key,
      );

      const data = await repo.load();
      const website = data.credentials.find(
        (c) => c.projectPath === hubPath,
      )!;
      const entry = website.entries[0] as Record<string, unknown>;
      expect(entry.rotation).toBe("90d");
      expect(entry.url).toBeUndefined();
      await expect(
        decryptField(key, entry.password as string),
      ).resolves.toBe("new");
    });

    it("updateCredentialDetectsServiceMismatch", async () => {
      const fake = createFakeVault();
      seedProjectWithCredentials(fake, [
        { service: "Hosting", user: "ops", password: "old" },
      ]);
      const repo = makeRepo(fake);
      const key = await unlockedKey();

      await expect(
        repo.updateCredential(
          hubPath,
          0,
          "Stale name",
          { service: "Hosting", user: "root", password: "new" },
          key,
        ),
      ).rejects.toThrow("La credencial cambió mientras la editabas.");
    });

    it("deleteCredentialRemovesEntry", async () => {
      const fake = createFakeVault();
      seedProjectWithCredentials(fake, [
        { service: "Hosting", user: "ops", password: "a" },
        { service: "DNS", user: "ops", password: "b" },
      ]);
      const repo = makeRepo(fake);
      const key = await unlockedKey();

      await expect(repo.deleteCredential(hubPath, 0, null)).rejects.toThrow(
        "Desbloquea las credenciales primero.",
      );
      await repo.deleteCredential(hubPath, 0, key);

      const data = await repo.load();
      const website = data.credentials.find(
        (c) => c.projectPath === hubPath,
      )!;
      expect(website.entries).toHaveLength(1);
      expect(website.entries[0].service).toBe("DNS");
    });

    it("migratePlaintextCredentialsEncryptsLegacy", async () => {
      const fake = createFakeVault();
      seedProjectWithCredentials(fake, [
        {
          service: "Hosting",
          user: "ops",
          password: "plano",
          rotation: "90d",
        },
      ]);
      const repo = makeRepo(fake);
      const key = await unlockedKey();

      const migrated = await repo.migratePlaintextCredentials(hubPath, key);

      expect(migrated).toBe(1);
      const data = await repo.load();
      const website = data.credentials.find(
        (c) => c.projectPath === hubPath,
      )!;
      const entry = website.entries[0] as Record<string, unknown>;
      expect(isEncryptedValue(entry.password)).toBe(true);
      expect(isEncryptedValue(entry.user)).toBe(true);
      await expect(
        decryptField(key, entry.password as string),
      ).resolves.toBe("plano");
      // Extra user fields survive the migration untouched.
      expect(entry.rotation).toBe("90d");
      expect(website.needsMigration).toBe(false);
    });

    it("loadFlagsNeedsMigrationForPlaintext", async () => {
      const fake = createFakeVault();
      seedProjectWithCredentials(fake, [
        { service: "Hosting", user: "ops", password: "plano" },
      ]);
      const repo = makeRepo(fake);

      const data = await repo.load();

      const website = data.credentials.find(
        (c) => c.projectPath === hubPath,
      )!;
      expect(website.needsMigration).toBe(true);
    });
  });

  describe("bases y grafo", () => {
    it("seedsTheThreeBasesWithoutOverwriting", async () => {
      const fake = createFakeVault();
      fake.files.set("Bases/Tareas.base", "personalizada");
      const repo = makeRepo(fake);

      const data = await repo.load();

      expect(fake.files.has("Bases/Proyectos.base")).toBe(true);
      expect(fake.files.has("Bases/Credenciales.base")).toBe(true);
      expect(fake.files.has("Bases/Calendario.base")).toBe(true);
      // Las plantillas no cuentan como credenciales/proyectos/eventos reales.
      expect(fake.files.get("Bases/Credenciales.base")).toContain(
        '!file.inFolder("Plantillas")',
      );
      const templatesBase = fake.files.get("Bases/Plantillas.base")!;
      expect(templatesBase).toContain('file.inFolder("Plantillas")');
      expect(templatesBase).toContain('file.inFolder("Plantillas/Calendario")');
      expect(fake.files.get("Bases/Tareas.base")).toBe("personalizada");
      expect([...fake.files.keys()].filter((p) => p.endsWith(".base")).every((p) => p.startsWith("Bases/"))).toBe(true);
      expect(data.issues).toEqual([]);
    });

    it("movesLegacyLooseBasesIntoBasesFolder", async () => {
      const fake = createFakeVault();
      fake.files.set("Projects/Proyectos.base", "editada");
      const repo = makeRepo(fake);

      await repo.load();

      expect(fake.files.has("Projects/Proyectos.base")).toBe(false);
      expect(fake.files.get("Bases/Proyectos.base")).toBe("editada");
    });

    it("linksNewCredentialsNoteToItsProject", async () => {
      const fake = createFakeVault();
      const repo = makeRepo(fake);

      await repo.load();
      const hub = await repo.createProject("Alfa");

      const creds = fake.files.get("Projects/Alfa/Credenciales.md")!;
      expect(hub).toBe("Projects/Alfa/Alfa.md");
      expect(creds).toContain("[[Projects/Alfa/Alfa]]");
      expect(fake.files.get(hub)).toContain("![[Tareas.base]]");
    });

    it("backfillsProjectLinkOnLegacyCredentials", async () => {
      const fake = createFakeVault();
      const repo = makeRepo(fake);
      await repo.load();
      await repo.createProject("Beta");
      fake.files.set(
        "Projects/Beta/Credenciales.md",
        "---\ntype: credentials\ncredentials: []\n---\n",
      );

      await repo.load();

      expect(fake.files.get("Projects/Beta/Credenciales.md")).toContain(
        "[[Projects/Beta/Beta]]",
      );
    });
  });
});