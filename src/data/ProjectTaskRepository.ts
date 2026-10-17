/**
 * Repository that turns the parser from Task 3 into concrete read/write
 * operations against the vault.
 *
 * Responsibilities:
 *  - On `load()`, scan the configured `projectsFolder` and `tasksFolder`,
 *    read each note through the adapter, run the parser, and aggregate
 *    projects, tasks and per-note issues into a `DashboardData`.
 *  - Provide mutation methods that create or rename notes and update
 *    only the frontmatter keys the plugin owns (`type`, `project`,
 *    `status`). User-defined properties and the Markdown body are
 *    preserved by routing every frontmatter change through
 *    `processFrontMatter` (never read+rewrite).
 *
 * The repository deliberately depends on the abstract `VaultAdapter`
 * rather than on `obsidian` so the same code path is exercised by the
 * fake adapter in `tests/ProjectTaskRepository.test.ts`.
 */

import yaml from "js-yaml";
import { parseProjectTaskNote } from "../domain/parseNote";
import type {
  DashboardData,
  DashboardIssue,
  NoteSnapshot,
  ParsedNote,
  ProjectRecord,
  ResolveProjectFn,
  TaskRecord,
} from "../domain/types";
import type { PluginSettings } from "../settings";
import type { VaultAdapter, VaultNoteRef } from "./VaultAdapter";

export class ProjectTaskRepository {
  private readonly adapter: VaultAdapter;
  private readonly settings: PluginSettings;
  private readonly resolveProject: ResolveProjectFn;

  constructor(
    adapter: VaultAdapter,
    settings: PluginSettings,
    // Optional override for tests; defaults to the adapter's link
    // resolver. Both signatures return the path string the parser
    // expects to compare against the workspace-relative path of the
    // owning project note.
    resolveProject?: ResolveProjectFn,
  ) {
    this.adapter = adapter;
    this.settings = settings;
    if (resolveProject) {
      this.resolveProject = resolveProject;
    } else {
      this.resolveProject = (link: string, source: string) => {
        const resolved = adapter.resolveLink(link, source);
        return resolved ? resolved.path : null;
      };
    }
  }

  // -------------------------------------------------------------------------
  // Read path
  // -------------------------------------------------------------------------

  /**
   * Scan both configured folders and return the aggregate dashboard
   * data. Validation issues are surfaced per-note; the dashboard
   * renders them as actionable items with an "open note" affordance.
   */
  async load(): Promise<DashboardData> {
    const projects: ProjectRecord[] = [];
    const tasks: TaskRecord[] = [];
    const issues: DashboardIssue[] = [];

    const projectRefs = this.adapter.listMarkdownFiles(
      this.settings.projectsFolder,
    );
    for (const ref of projectRefs) {
      const snapshot = await this.readSnapshot(ref);
      const parsed = parseProjectTaskNote(snapshot, this.resolveProject);
      this.collect(parsed, projects, tasks, issues);
    }

    const taskRefs = this.adapter.listMarkdownFiles(this.settings.tasksFolder);
    for (const ref of taskRefs) {
      const snapshot = await this.readSnapshot(ref);
      const parsed = parseProjectTaskNote(snapshot, this.resolveProject);
      this.collect(parsed, projects, tasks, issues);
    }

    return { projects, tasks, credentials: [], issues };
  }

  // -------------------------------------------------------------------------
  // Mutations: create
  // -------------------------------------------------------------------------

  async createProject(title: string): Promise<void> {
    const sanitized = sanitizeFilename(title);
    const folder = this.settings.projectsFolder;
    await this.adapter.createFolder(folder);
    const path = await this.uniqueMarkdownPath(folder, sanitized);
    const content = renderProjectFrontmatter(title);
    await this.adapter.createMarkdown(path, content);
  }

  async createTask(
    title: string,
    projectPath: string,
  ): Promise<void> {
    const sanitized = sanitizeFilename(title);
    const folder = this.settings.tasksFolder;
    await this.adapter.createFolder(folder);
    const path = await this.uniqueMarkdownPath(folder, sanitized);

    const inner = projectPathToWikilinkInner(projectPath);
    const content = renderTaskFrontmatter(title, inner);
    await this.adapter.createMarkdown(path, content);
  }

  // -------------------------------------------------------------------------
  // Mutations: rename
  // -------------------------------------------------------------------------

  async renameProject(
    path: string,
    title: string,
  ): Promise<void> {
    const sanitized = sanitizeFilename(title);
    const folder = folderOf(path);
    const targetPath = await this.uniqueMarkdownPath(folder, sanitized, path);
    const ref = { path, basename: basenameOf(path) };
    await this.adapter.rename(ref, targetPath);

    // Update tasks whose `project` property still pointed at the old
    // path. We do this manually because Obsidian's auto-update of links
    // may be disabled by the user, and we want the frontmatter to be
    // authoritative regardless of that setting.
    const oldWikilinkInner = projectPathToWikilinkInner(path);
    const newWikilinkInner = projectPathToWikilinkInner(targetPath);
    // The user may have hand-written the project link with the `.md`
    // extension included; accept both forms so the rename still applies
    // when the frontmatter deviates from what `createTask` writes.
    const oldLinkNoExt = wrapWikilink(oldWikilinkInner);
    const oldLinkWithExt = `${wrapWikilink(oldWikilinkInner)}.md`;

    const taskRefs = this.adapter.listMarkdownFiles(this.settings.tasksFolder);
    for (const taskRef of taskRefs) {
      const current = await this.adapter.read(taskRef);
      const projectValue = extractProjectWikilink(current);
      if (projectValue === null) continue;
      if (projectValue !== oldLinkNoExt && projectValue !== oldLinkWithExt) {
        continue;
      }
      await this.adapter.processFrontMatter(taskRef, (frontmatter) => {
        frontmatter["project"] = wrapWikilink(newWikilinkInner);
      });
    }
  }

  async renameTask(path: string, title: string): Promise<void> {
    const sanitized = sanitizeFilename(title);
    const folder = folderOf(path);
    const targetPath = await this.uniqueMarkdownPath(folder, sanitized, path);
    const ref = { path, basename: basenameOf(path) };
    await this.adapter.rename(ref, targetPath);
    // Wikilinks pointing TO this task from other notes are not
    // maintained in V1 (delete is out of scope; backlink rewrites
    // belong to the delete-flow that will land in a later version).
  }

  // -------------------------------------------------------------------------
  // Mutations: frontmatter patches
  // -------------------------------------------------------------------------

  async reassignTask(
    path: string,
    projectPath: string,
  ): Promise<void> {
    const inner = projectPathToWikilinkInner(projectPath);
    const ref = { path, basename: basenameOf(path) };
    await this.adapter.processFrontMatter(ref, (frontmatter) => {
      frontmatter["project"] = wrapWikilink(inner);
    });
  }

  async setTaskStatus(
    path: string,
    status: "open" | "done",
  ): Promise<void> {
    const ref = { path, basename: basenameOf(path) };
    await this.adapter.processFrontMatter(ref, (frontmatter) => {
      frontmatter["status"] = status;
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async readSnapshot(ref: VaultNoteRef): Promise<NoteSnapshot> {
    const content = await this.adapter.read(ref);
    return { path: ref.path, basename: ref.basename, content };
  }

  private collect(
    parsed: ParsedNote,
    projects: ProjectRecord[],
    tasks: TaskRecord[],
    issues: DashboardIssue[],
  ): void {
    switch (parsed.kind) {
      case "project":
        projects.push(parsed.project);
        return;
      case "task":
        tasks.push(parsed.task);
        return;
      case "issue":
        issues.push(parsed.issue);
        return;
    }
  }

  /**
   * Return a unique `.md` path inside `folderPath` derived from
   * `sanitized`. If `sanitized` already resolves to an existing file
   * (other than `ignorePath` itself, used by rename), disambiguate
   * with a trailing space + number (`" 2"`, `" 3"`, ...).
   *
   * The returned path is guaranteed to be vault-relative, contain no
   * `..` segments and end in `.md`.
   */
  private async uniqueMarkdownPath(
    folderPath: string,
    sanitized: string,
    ignorePath?: string,
  ): Promise<string> {
    if (sanitized.includes("/") || sanitized.includes("..")) {
      throw new Error(
        `ProjectTaskRepository: unsafe filename after sanitization: ${sanitized}`,
      );
    }
    const existing = new Set(
      this.adapter.listMarkdownFiles(folderPath).map((ref) => ref.path),
    );

    const baseName = `${sanitized}.md`;
    const basePath = `${folderPath}/${baseName}`;
    if (
      !existing.has(basePath) ||
      (ignorePath !== undefined && basePath === ignorePath)
    ) {
      return basePath;
    }

    for (let counter = 2; counter < 10_000; counter++) {
      const candidatePath = `${folderPath}/${sanitized} ${counter}.md`;
      if (
        !existing.has(candidatePath) ||
        (ignorePath !== undefined && candidatePath === ignorePath)
      ) {
        return candidatePath;
      }
    }
    throw new Error(
      `ProjectTaskRepository: could not disambiguate ${sanitized} inside ${folderPath}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Sanitization helpers (exported for unit tests in later tasks if needed).
// ---------------------------------------------------------------------------

/**
 * Sanitize a free-form title into a safe Markdown filename stem.
 *
 * Rules (kept in sync with the brief):
 *  - Replace Windows/Obsidian forbidden characters (`\ / : * ? " < > |`)
 *    and `#` with a single dash.
 *  - Collapse runs of dashes to a single dash.
 *  - Trim leading and trailing dashes, dots and whitespace.
 *  - If the result is empty (or a single dash), return `"Untitled"`.
 */
export function sanitizeFilename(title: string): string {
  if (typeof title !== "string") return "Untitled";
  const replaced = title
    .replace(/[\\/:*?"<>|#]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[\s.\-]+|[\s.\-]+$/g, "");
  if (replaced.length === 0) return "Untitled";
  return replaced;
}

/**
 * Return the parent folder of a vault-relative path. The root folder
 * (no `/` in the path) is reported as an empty string.
 */
function folderOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx < 0 ? "" : path.slice(0, idx);
}

/**
 * Return the basename of a vault-relative path (the trailing segment
 * including the extension).
 */
function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Convert a vault-relative project path (always ending in `.md`) into
 * the inner text of a `[[wikilink]]` (the vault path with the
 * extension stripped). Pair with `wrapWikilink` to produce the value
 * the parser expects on a task's `project` property.
 */
function projectPathToWikilinkInner(projectPath: string): string {
  if (!projectPath.endsWith(".md")) {
    throw new Error(
      `ProjectTaskRepository: project path must end in .md: ${projectPath}`,
    );
  }
  return projectPath.slice(0, -".md".length);
}

/**
 * Wrap a wikilink inner text into the `[[…]]` form. Used by the
 * mutation methods that write the task's `project` frontmatter key.
 */
function wrapWikilink(inner: string): string {
  return `[[${inner}]]`;
}

/**
 * Render the frontmatter + minimal body for a new project note. The
 * body is intentionally short so the user owns the Markdown content;
 * the frontmatter is the only thing the plugin requires.
 */
function renderProjectFrontmatter(title: string): string {
  return ["---", "type: project", "---", "", `# ${title}`, "", ""].join("\n");
}

/**
 * Render the frontmatter + minimal body for a new task note. The
 * `project` value is the full wikilink form (`[[…]]`) the parser
 * expects.
 */
function renderTaskFrontmatter(title: string, projectWikilink: string): string {
  return [
    "---",
    "type: task",
    `project: "[[${projectWikilink}]]"`,
    "status: open",
    "---",
    "",
    `# ${title}`,
    "",
    "",
  ].join("\n");
}

/**
 * Extract the raw string value of the `project` frontmatter key from a
 * Markdown note. Returns the value unchanged (including any
 * surrounding `[[…]]` wikilink brackets if present) or `null` when the
 * note has no frontmatter, no `project` key, or an unparseable block.
 *
 * Uses the same `js-yaml` parser that `parseProjectTaskNote` uses so
 * the rename flow accepts hand-written values the regex probe would
 * have missed (multi-line folded scalars, unquoted flow forms, etc.).
 */
function extractProjectWikilink(content: string): string | null {
  const sliced = sliceFrontmatterBlock(content);
  if (sliced === null) return null;
  let parsed: unknown;
  try {
    parsed = yaml.load(sliced);
  } catch {
    return null;
  }
  if (parsed === null || parsed === undefined) return null;
  if (typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const properties = parsed as Record<string, unknown>;
  const value = properties["project"];
  if (typeof value !== "string") return null;
  return value.trim();
}

/**
 * Slice a `---\n…\n---` frontmatter block from raw note content and
 * return the YAML between the markers, or `null` if the block is
 * missing or unclosed. Mirrors `sliceFrontmatter` in
 * `src/domain/parseNote.ts` but returns a flat string so callers that
 * only need the YAML text (not the body) can stay allocation-light.
 */
function sliceFrontmatterBlock(content: string): string | null {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return null;
  const lines = normalized.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      return lines.slice(1, i).join("\n");
    }
  }
  return null;
}
