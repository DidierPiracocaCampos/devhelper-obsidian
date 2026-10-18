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
  applyTemplate,
  todayStamp,
  type TemplateKind,
} from "../domain/templates";
import type {
  CredentialsRecord,
  DashboardData,
  DashboardIssue,
  NoteRecord,
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
    const notes: NoteRecord[] = [];
    const credentials: CredentialsRecord[] = [];
    const issues: DashboardIssue[] = [];

    await this.adapter.createFolder(this.settings.projectsFolder);

    // 1. Seed + validate templates.
    await this.seedTemplates();
    const kinds: TemplateKind[] = ["project", "task", "note", "credentials"];
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
            case "note":
              notes.push(parsed.note);
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

      // 4b. Notes from <F>/Notas.
      const notasFolder = `${folder}/Notas`;
      if (this.adapter.exists(notasFolder)) {
        for (const ref of this.adapter.listMarkdownFiles(notasFolder)) {
          const snapshot = await this.readSnapshot(ref);
          const parsed = parseProjectTaskNote(snapshot, this.resolveProject);
          switch (parsed.kind) {
            case "note":
              notes.push(parsed.note);
              break;
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
              // Ignored — credentials are not notes.
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
          case "credentials": {
            const { path, entries, entryIssues } = credParsed.credentials;
            credentials.push({ path, entries, projectPath: hubPath });
            // `entryIssues` is parser-internal: lift each one into the
            // global issues list so the dashboard surfaces them. The
            // `CredentialsRecord` does not carry the field.
            for (const ei of entryIssues ?? []) {
              issues.push(ei);
            }
            break;
          }
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

    return { projects, tasks, notes, credentials, issues };
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
    const kinds: TemplateKind[] = ["project", "task", "note", "credentials"];
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
  // T6 rewrites the mutation bodies to honour the V2 layout:
  //  - `createProject` materialises the full project subtree
  //    (`<F>/`, `<F>/Tareas/`, `<F>/Archivos/`, `<F>/<F>.md`,
  //    `<F>/Credenciales.md`) seeded from the user's project and
  //    credentials templates.
  //  - `createTask` writes the new note inside `<F>/Tareas/`,
  //    stamped from the user's task template.
  //  - Mutations that target a single property only edit that
  //    property — frontmatter rewrites always route through
  //    `processFrontMatter` so the user's other keys and the body
  //    survive untouched.
  // -------------------------------------------------------------------------

  async createProject(title: string): Promise<string> {
    const sanitized = sanitizeFilename(title);

    // Validate the templates BEFORE we touch the filesystem so a
    // broken template never leaves a half-built folder behind.
    const projectIssue = await this.templateIssue("project");
    if (projectIssue !== null) {
      throw new Error(projectIssue);
    }
    const credentialsIssue = await this.templateIssue("credentials");
    if (credentialsIssue !== null) {
      throw new Error(credentialsIssue);
    }
    const noteIssue = await this.templateIssue("note");
    if (noteIssue !== null) {
      throw new Error(noteIssue);
    }

    await this.adapter.createFolder(this.settings.projectsFolder);
    const folder = await this.uniqueFolderPath(
      this.settings.projectsFolder,
      sanitized,
    );
    await this.adapter.createFolder(`${folder}/Tareas`);
    await this.adapter.createFolder(`${folder}/Notas`);
    await this.adapter.createFolder(`${folder}/Archivos`);

    const folderName = basenameOf(folder);
    const hubPath = `${folder}/${folderName}.md`;
    const hubTemplateRef: VaultNoteRef = {
      path: this.templatePath("project"),
      basename: TEMPLATE_FILE_NAMES.project,
    };
    const hubTemplateContent = await this.adapter.read(hubTemplateRef);
    const hubContent = applyTemplate(hubTemplateContent, "project", {
      title,
      today: todayStamp(),
    });
    await this.adapter.createMarkdown(hubPath, hubContent);

    const credPath = `${folder}/Credenciales.md`;
    const credTemplateRef: VaultNoteRef = {
      path: this.templatePath("credentials"),
      basename: TEMPLATE_FILE_NAMES.credentials,
    };
    const credTemplateContent = await this.adapter.read(credTemplateRef);
    const credContent = applyTemplate(credTemplateContent, "credentials", {
      title,
      today: todayStamp(),
    });
    await this.adapter.createMarkdown(credPath, credContent);

    return hubPath;
  }

  async createTask(
    title: string,
    projectPath: string,
  ): Promise<void> {
    // Validate the task template before touching the filesystem.
    const taskIssue = await this.templateIssue("task");
    if (taskIssue !== null) {
      throw new Error(taskIssue);
    }

    const sanitized = sanitizeFilename(title);
    const projectFolder = folderOf(projectPath);
    const tasksFolder = `${projectFolder}/Tareas`;
    await this.adapter.createFolder(tasksFolder);
    const path = await this.uniqueMarkdownPath(tasksFolder, sanitized);

    const templateRef: VaultNoteRef = {
      path: this.templatePath("task"),
      basename: TEMPLATE_FILE_NAMES.task,
    };
    const templateContent = await this.adapter.read(templateRef);
    const inner = projectPathToWikilinkInner(projectPath);
    const content = applyTemplate(templateContent, "task", {
      title,
      today: todayStamp(),
      projectLink: wrapWikilink(inner),
    });
    await this.adapter.createMarkdown(path, content);
  }

  async createNote(
    title: string,
    projectPath: string,
  ): Promise<void> {
    const noteIssue = await this.templateIssue("note");
    if (noteIssue !== null) {
      throw new Error(noteIssue);
    }

    const sanitized = sanitizeFilename(title);
    const projectFolder = folderOf(projectPath);
    const notasFolder = `${projectFolder}/Notas`;
    await this.adapter.createFolder(notasFolder);
    const path = await this.uniqueMarkdownPath(notasFolder, sanitized);

    const templateRef: VaultNoteRef = {
      path: this.templatePath("note"),
      basename: TEMPLATE_FILE_NAMES.note,
    };
    const templateContent = await this.adapter.read(templateRef);
    const inner = projectPathToWikilinkInner(projectPath);
    const content = applyTemplate(templateContent, "note", {
      title,
      today: todayStamp(),
      projectLink: wrapWikilink(inner),
    });
    await this.adapter.createMarkdown(path, content);
  }

  async renameNote(path: string, title: string): Promise<void> {
    const sanitized = sanitizeFilename(title);
    const folder = folderOf(path);
    const targetPath = await this.uniqueMarkdownPath(folder, sanitized, path);
    const ref = { path, basename: basenameOf(path) };
    await this.adapter.rename(ref, targetPath);
  }

  async reassignNote(
    path: string,
    projectPath: string,
  ): Promise<void> {
    const inner = projectPathToWikilinkInner(projectPath);
    const ref = { path, basename: basenameOf(path) };
    await this.adapter.processFrontMatter(ref, (frontmatter) => {
      frontmatter["project"] = wrapWikilink(inner);
    });

    const projectFolder = folderOf(projectPath);
    const newNotasFolder = `${projectFolder}/Notas`;
    await this.adapter.createFolder(newNotasFolder);
    const newPath = await this.uniqueMarkdownPath(
      newNotasFolder,
      basenameOf(path).replace(/\.md$/, ""),
      path,
    );
    await this.adapter.rename(ref, newPath);
  }

  /**
   * Move a simple note to the trash (recoverable).
   */
  async deleteNote(path: string): Promise<void> {
    const ref = { path, basename: basenameOf(path) };
    await this.adapter.trash(ref);
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
    const currentBasename = basenameOf(path);

    // No-op when the sanitised title already matches the current hub
    // basename (case-sensitive). This keeps a click that does not
    // change anything from churning the vault.
    if (sanitized === currentBasename.replace(/\.md$/, "")) {
      return;
    }

    // Step A: rename the hub file inside its current folder. Use the
    // existing file-uniqueness helper so we never overwrite a sibling
    // task by accident.
    const targetHubPath = await this.uniqueMarkdownPath(
      folder,
      sanitized,
      path,
    );
    const hubRef: VaultNoteRef = { path, basename: currentBasename };
    await this.adapter.rename(hubRef, targetHubPath);

    // Step B: rename the folder itself, disambiguating against every
    // existing project folder under `projectsFolder`.
    const newFolder = await this.uniqueFolderPath(
      this.settings.projectsFolder,
      sanitized,
      folder,
    );
    await this.adapter.renameFolder(folder, newFolder);

    // The hub now lives at `${newFolder}/${sanitized}.md`. Compute
    // both the old and new wikilink inner so we can rewrite the
    // `project` property on tasks that linked this project.
    const oldWikilinkInner = projectPathToWikilinkInner(path);
    const newHubPath = `${newFolder}/${sanitized}.md`;
    const newWikilinkInner = projectPathToWikilinkInner(newHubPath);

    // Accept both the bare and the `.md`-suffixed form so the rename
    // applies even when the user wrote the link with the extension.
    const oldLinkNoExt = wrapWikilink(oldWikilinkInner);
    const oldLinkWithExt = `${wrapWikilink(oldWikilinkInner)}.md`;

    // Walk every project's `<F>/Tareas/` and `<F>/Notas/`. After the folder rename,
    // any task/note that lived in the renamed folder is now at
    // `${newFolder}/Tareas/...` o `${newFolder}/Notas/...`. We patch only those whose
    // frontmatter `project` still points at the old path.
    const subfolders = this.adapter.listSubfolders(
      this.settings.projectsFolder,
    );
    for (const projectFolder of subfolders) {
      if (
        normalizePathForCompare(projectFolder) ===
        normalizePathForCompare(this.settings.templatesFolder)
      ) {
        continue;
      }
      for (const child of ["Tareas", "Notas"]) {
        const childFolder = `${projectFolder}/${child}`;
        if (!this.adapter.exists(childFolder)) continue;
        const childRefs = this.adapter.listMarkdownFiles(childFolder);
        for (const childRef of childRefs) {
          const current = await this.adapter.read(childRef);
          const projectValue = extractProjectWikilink(current);
          if (projectValue === null) continue;
          if (projectValue !== oldLinkNoExt && projectValue !== oldLinkWithExt) {
            continue;
          }
          await this.adapter.processFrontMatter(childRef, (frontmatter) => {
            frontmatter["project"] = wrapWikilink(newWikilinkInner);
          });
        }
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
    // Update the frontmatter at the OLD path first so the file is
    // never observed with a wikilink that does not match its
    // physical location.
    await this.adapter.processFrontMatter(ref, (frontmatter) => {
      frontmatter["project"] = wrapWikilink(inner);
    });

    // Then physically move the note to the new project's `Tareas/`,
    // disambiguating against any existing sibling.
    const projectFolder = folderOf(projectPath);
    const newTasksFolder = `${projectFolder}/Tareas`;
    await this.adapter.createFolder(newTasksFolder);
    const newPath = await this.uniqueMarkdownPath(
      newTasksFolder,
      basenameOf(path).replace(/\.md$/, ""),
      path,
    );
    await this.adapter.rename(ref, newPath);
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

  /**
   * Move a task note to the trash. There is deliberately no project
   * equivalent: removing a project folder is out of scope.
   */
  async deleteTask(path: string): Promise<void> {
    const ref = { path, basename: basenameOf(path) };
    await this.adapter.trash(ref);
  }

  async setProjectFavorite(path: string, favorite: boolean): Promise<void> {
    const ref = { path, basename: basenameOf(path) };
    await this.adapter.processFrontMatter(ref, (frontmatter) => {
      frontmatter["favorite"] = favorite;
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
    notes: NoteRecord[],
    issues: DashboardIssue[],
  ): void {
    switch (parsed.kind) {
      case "project":
        projects.push(parsed.project);
        return;
      case "task":
        tasks.push(parsed.task);
        return;
      case "note":
        notes.push(parsed.note);
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

  /**
   * Return a unique folder path inside `parent` derived from
   * `sanitized`. If a folder already exists at the candidate location
   * (other than `ignorePath` itself, used by `renameProject`), append
   * a trailing space + number (`" 2"`, `" 3"`, ...).
   *
   * Mirrors `uniqueMarkdownPath` but operates on the folder name space
   * — used by `createProject` and `renameProject` to pick the new
   * project's parent folder.
   */
  private async uniqueFolderPath(
    parent: string,
    sanitized: string,
    ignorePath?: string,
  ): Promise<string> {
    if (sanitized.includes("/") || sanitized.includes("..")) {
      throw new Error(
        `ProjectTaskRepository: unsafe folder name after sanitization: ${sanitized}`,
      );
    }
    const basePath = `${parent}/${sanitized}`;
    if (
      !this.adapter.exists(basePath) ||
      (ignorePath !== undefined && basePath === ignorePath)
    ) {
      return basePath;
    }

    for (let counter = 2; counter < 10_000; counter++) {
      const candidate = `${parent}/${sanitized} ${counter}`;
      if (
        !this.adapter.exists(candidate) ||
        (ignorePath !== undefined && candidate === ignorePath)
      ) {
        return candidate;
      }
    }
    throw new Error(
      `ProjectTaskRepository: could not disambiguate folder ${sanitized} inside ${parent}`,
    );
  }

  /**
   * Resolve the absolute vault-relative path of the template file for
   * `kind`. The repository owns the canonical naming
   * (`TEMPLATE_FILE_NAMES`) so the call sites stay short.
   */
  private templatePath(kind: TemplateKind): string {
    return joinPath(this.settings.templatesFolder, TEMPLATE_FILE_NAMES[kind]);
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
  const sliced = sliceFrontmatter(content);
  if (sliced.kind !== "ok") return null;
  let parsed: unknown;
  try {
    parsed = yaml.load(sliced.yaml);
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