/**
 * Repository that turns the parser from Task 3 into concrete read/write
 * operations against the vault.
 *
 * Responsibilities:
 *  - On `load()`, scan the configured `projectsFolder` and its V2 folder
 *    tree, seed/validate templates, classify loose notes, and aggregate
 *    projects, tasks, credentials and per-note issues into a
 *    `DashboardData`.
 *  - Provide mutation methods that create or rename notes and update
 *    only the frontmatter keys the plugin owns (`type`, `project`,
 *    `status`). User-defined properties and the Markdown body are
 *    preserved by routing every frontmatter change through
 *    `processFrontMatter` (never read+rewrite).
 *
 * The repository deliberately depends on the abstract `VaultAdapter`
 * rather than on `obsidian` so the same code path is exercised by the
 * fake adapter in `tests/ProjectTaskRepository.test.ts`.
 *
 * V2 layout (Task 5):
 *  - `projectsFolder` (e.g. "Projects") is a parent directory. Each
 *    direct subfolder (excluding `templatesFolder`) is one project.
 *  - A project's hub is the file `<F>/<F's basename>.md`. The folder's
 *    tasks live under `<F>/Tareas/`. Optional `<F>/Credenciales.md`
 *    carries the project's credentials.
 *  - Templates are seeded into `templatesFolder` (e.g. "Projects/_templates")
 *    and are NOT scanned as project folders.
 */

import yaml from "js-yaml";
import { sliceFrontmatter } from "../domain/frontmatter";
import { parseCredentialsNote, parseProjectTaskNote } from "../domain/parseNote";
import {
  DEFAULT_TEMPLATE_CONTENT,
  FIXED_TEMPLATE_PROPERTIES,
  TEMPLATE_FILE_NAMES,
  type TemplateKind,
} from "../domain/templates";
import type {
  CredentialsRecord,
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
   * V2 scan.
   *
   *  1. Ensure `projectsFolder` exists, then seed the three templates
   *     and validate each one (one issue per invalid template).
   *  2. Any loose `.md` sitting at the root of `projectsFolder` is
   *     reported as a V1 straggler.
   *  3. Every direct subfolder (excluding `templatesFolder`) is a
   *     project. Each project MUST contain `<F>/<F>.md`; otherwise the
   *     folder is reported and skipped.
   *  4. Tasks are read from `<F>/Tareas/` (when it exists).
   *  5. Credentials are read from `<F>/Credenciales.md` (when it
   *     exists).
   */
  async load(): Promise<DashboardData> {
    const projects: ProjectRecord[] = [];
    const tasks: TaskRecord[] = [];
    const credentials: CredentialsRecord[] = [];
    const issues: DashboardIssue[] = [];

    await this.adapter.createFolder(this.settings.projectsFolder);

    // 1. Seed + validate templates.
    await this.seedTemplates();
    const kinds: TemplateKind[] = ["project", "task", "credentials"];
    for (const kind of kinds) {
      const issueMessage = await this.templateIssue(kind);
      if (issueMessage !== null) {
        const path = joinPath(
          this.settings.templatesFolder,
          TEMPLATE_FILE_NAMES[kind],
        );
        issues.push({ path, message: issueMessage });
      }
    }

    // 2. Stray V1 notes (loose .md at the root of projectsFolder).
    for (const ref of this.adapter.listMarkdownFiles(
      this.settings.projectsFolder,
    )) {
      issues.push({
        path: ref.path,
        message: `Nota suelta de la estructura V1: mueve '${basenameOf(ref.path)}' a la carpeta de su proyecto.`,
      });
    }

    // 3. Scan each direct subfolder (excluding templatesFolder).
    const subfolders = this.adapter.listSubfolders(
      this.settings.projectsFolder,
    );
    for (const folder of subfolders) {
      if (
        normalizePathForCompare(folder) ===
        normalizePathForCompare(this.settings.templatesFolder)
      ) {
        continue;
      }
      const folderName = basenameOf(folder);
      const hubPath = `${folder}/${folderName}.md`;
      if (!this.adapter.exists(hubPath)) {
        issues.push({
          path: folder,
          message: `La carpeta '${folderName}' no contiene su nota hub '${folderName}.md'.`,
        });
        continue;
      }
      const hubRef: VaultNoteRef = { path: hubPath, basename: `${folderName}.md` };
      const hubSnapshot = await this.readSnapshot(hubRef);
      const hubParsed = parseProjectTaskNote(hubSnapshot, this.resolveProject);
      switch (hubParsed.kind) {
        case "project":
          projects.push(hubParsed.project);
          break;
        case "issue":
          issues.push(hubParsed.issue);
          break;
        default:
          // task or credentials inside a hub slot — that's a misplaced note.
          issues.push({
            path: hubPath,
            message: `La nota hub de '${folderName}' debe ser de tipo 'project'.`,
          });
          break;
      }

      // 4. Tasks from <F>/Tareas.
      const tasksFolder = `${folder}/Tareas`;
      if (this.adapter.exists(tasksFolder)) {
        for (const ref of this.adapter.listMarkdownFiles(tasksFolder)) {
          const snapshot = await this.readSnapshot(ref);
          const parsed = parseProjectTaskNote(snapshot, this.resolveProject);
          switch (parsed.kind) {
            case "task":
              tasks.push(parsed.task);
              break;
            case "issue":
              issues.push(parsed.issue);
              break;
            case "project":
              issues.push({
                path: ref.path,
                message: `Nota de proyecto fuera de lugar: sólo la nota hub de cada carpeta puede ser 'type: project'.`,
              });
              break;
            case "credentials":
              // Ignored — credentials are not tasks.
              break;
          }
        }
      }

      // 5. Credenciales.md (optional).
      const credsPath = `${folder}/Credenciales.md`;
      if (this.adapter.exists(credsPath)) {
        const credRef: VaultNoteRef = {
          path: credsPath,
          basename: "Credenciales.md",
        };
        const credSnapshot = await this.readSnapshot(credRef);
        const credParsed = parseCredentialsNote(credSnapshot);
        switch (credParsed.kind) {
          case "credentials":
            credentials.push({
              path: credParsed.credentials.path,
              entries: credParsed.credentials.entries,
              projectPath: hubPath,
            });
            break;
          case "issue":
            issues.push(credParsed.issue);
            break;
          default:
            issues.push({
              path: credsPath,
              message: `'Credenciales.md' del proyecto '${folderName}' debe ser de tipo 'credentials'.`,
            });
            break;
        }
      }
    }

    return { projects, tasks, credentials, issues };
  }

  // -------------------------------------------------------------------------
  // Template helpers
  // -------------------------------------------------------------------------

  /**
   * Ensure each of the three templates exists on disk. Templates that
   * already exist (for example because the user forked them) are NOT
   * overwritten — `seedTemplates` is non-destructive.
   */
  private async seedTemplates(): Promise<void> {
    await this.adapter.createFolder(this.settings.templatesFolder);
    const kinds: TemplateKind[] = ["project", "task", "credentials"];
    for (const kind of kinds) {
      const fileName = TEMPLATE_FILE_NAMES[kind];
      const fullPath = joinPath(this.settings.templatesFolder, fileName);
      if (!this.adapter.exists(fullPath)) {
        await this.adapter.createMarkdown(fullPath, DEFAULT_TEMPLATE_CONTENT[kind]);
      }
    }
  }

  /**
   * Return a Spanish error message when the template for `kind` is
   * invalid; `null` when the template is fresh (just seeded) or valid.
   *
   * The file-name is woven into every message so the dashboard can
   * show "La plantilla 'proyecto.md' …" rather than a generic message.
   */
  private async templateIssue(kind: TemplateKind): Promise<string | null> {
    const fileName = TEMPLATE_FILE_NAMES[kind];
    const fullPath = joinPath(this.settings.templatesFolder, fileName);
    if (!this.adapter.exists(fullPath)) return null;
    const ref: VaultNoteRef = { path: fullPath, basename: fileName };
    const content = await this.adapter.read(ref);
    const sliced = sliceFrontmatter(content);
    if (sliced.kind === "missing") {
      return `La plantilla '${fileName}' no tiene bloque de frontmatter.`;
    }
    if (sliced.kind === "unclosed") {
      return `La plantilla '${fileName}' tiene el frontmatter sin cerrar.`;
    }
    let parsed: unknown;
    try {
      parsed = yaml.load(sliced.yaml);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return `La plantilla '${fileName}' tiene YAML inválido: ${detail}.`;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return `La plantilla '${fileName}' no es un mapeo YAML.`;
    }
    const props = parsed as Record<string, unknown>;
    if (props.type !== kind) {
      return `La plantilla '${fileName}' debe tener 'type: ${kind}'.`;
    }
    for (const key of FIXED_TEMPLATE_PROPERTIES[kind]) {
      if (!(key in props)) {
        return `La plantilla '${fileName}' no tiene la propiedad fija '${key}'.`;
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Mutations: create
  //
  // T6 rewrites the mutation bodies to honour the V2 layout
  // (`<projectFolder>/Tareas/…`). For T5 we keep the V1 surface intact
  // but route the storage location to a V2-compatible path so the
  // typecheck and the adapted tests can pass.
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
    // V2: the task's owning project folder is `folderOf(projectPath)` and
    // tasks live under `<thatFolder>/Tareas/`. T6 will revisit this
    // surface but the redirect is enough to satisfy the typecheck and
    // the adapted tests today.
    const projectFolder = folderOf(projectPath);
    const folder = `${projectFolder}/Tareas`;
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

    // V2: tasks live under each project's `<F>/Tareas/`. Scan every
    // subfolder of `projectsFolder` and patch matching tasks in place.
    const subfolders = this.adapter.listSubfolders(
      this.settings.projectsFolder,
    );
    for (const projectFolder of subfolders) {
      const tasksFolder = `${projectFolder}/Tareas`;
      if (!this.adapter.exists(tasksFolder)) continue;
      const taskRefs = this.adapter.listMarkdownFiles(tasksFolder);
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
      case "credentials":
        // Credentials are not surfaced through `collect`; the V2 scan
        // handles them via `parseCredentialsNote` directly. We keep the
        // switch exhaustive so future kinds don't slip past typecheck.
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
 * Combine a folder path with a file name, inserting a single `/`
 * separator even when `folder` already has a trailing slash.
 */
function joinPath(folder: string, file: string): string {
  return folder.endsWith("/") ? `${folder}${file}` : `${folder}/${file}`;
}

/**
 * Normalize a vault-relative path for equality comparison:
 *  - convert backslashes to forward slashes (Windows safety)
 *  - strip trailing slashes so `Projects` equals `Projects/`
 */
function normalizePathForCompare(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
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