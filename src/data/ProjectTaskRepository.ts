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
 *  - Templates are seeded into `templatesFolder` (e.g. "Plantillas")
 *    and are NOT scanned as project folders.
 */

import yaml from "js-yaml";
import { BASES_FOLDER, buildBases } from "../domain/bases";
import { sliceFrontmatter } from "../domain/frontmatter";
import {
  encryptField,
  isEncryptedValue,
} from "../domain/credentialsCrypto";
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
  CalendarEventRecord,
  CalendarKind,
  CalendarRecurrence,
  CredentialsRecord,
  DashboardData,
  DashboardIssue,
  FileRecord,
  NoteRecord,
  NoteSnapshot,
  ParsedNote,
  ProjectRecord,
  ResolveProjectFn,
  TaskRecord,
} from "../domain/types";
import type { PluginSettings } from "../settings";
import type { VaultAdapter, VaultNoteRef } from "./VaultAdapter";

/**
 * Nombre de la carpeta del proyecto sombra bajo `settings.projectsFolder`.
 * Su hub es `<projectsFolder>/General/General.md` y solo es visible en
 * modo «Todos» (el presenter lo oculta de la selección directa).
 */
export const GENERAL_FOLDER = "General";

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
   *  1. Ensure `projectsFolder` exists, then seed the four templates
   *     and validate each one (one issue per invalid template).
   *  1b. Seed the `General` shadow project (hub, `Tareas/`, `Notas/`,
   *     `Archivos/`, `Credenciales.md`) when missing — never
   *     overwritten. Its hub is flagged `isGeneral` when parsed.
   *  2. Any loose `.md` sitting at the root of `projectsFolder` is
   *     reported as a V1 straggler.
   *  3. Every direct subfolder (excluding `templatesFolder`) is a
   *     project. Each project MUST contain `<F>/<F>.md`; otherwise the
   *     folder is reported and skipped.
   *  4. Tasks and notes are read from `<F>/Tareas/` (when it exists).
   *  4b. Notes and tasks are read from `<F>/Notas/` (when it exists).
   *  5. Credentials are read from `<F>/Credenciales.md` (when it
   *     exists).
   *  6. Files are listed from `<F>/Archivos/` (when it exists, any
   *     extension, non-recursive) into `files`, each bound to its
   *     project hub via `projectPath`.
   */
  async load(): Promise<DashboardData> {
    const projects: ProjectRecord[] = [];
    const tasks: TaskRecord[] = [];
    const notes: NoteRecord[] = [];
    const credentials: CredentialsRecord[] = [];
    const files: FileRecord[] = [];
    const calendarEvents: CalendarEventRecord[] = [];
    const issues: DashboardIssue[] = [];

    await this.adapter.createFolder(this.settings.projectsFolder);

    // 1. Seed + validate templates.
    await this.seedTemplates();
    await this.seedCalendarTemplates();
    await this.seedBases();
    // 1b. Proyecto sombra General: se siembra si falta (nunca se
    // sobrescribe) para que el modo «Todos» siempre tenga ámbito.
    await this.ensureGeneralProject();
    const generalHubPath =
      `${this.settings.projectsFolder}/${GENERAL_FOLDER}/${GENERAL_FOLDER}.md`;
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
    const calendarTemplateIssueMessage = await this.templateIssue(
      "calendar-event",
      this.settings.calendarTemplatesFolder,
    );
    if (calendarTemplateIssueMessage !== null) {
      issues.push({
        path: this.calendarTemplatePath(),
        message: calendarTemplateIssueMessage,
      });
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
        case "project": {
          // El hub del proyecto sombra se marca para que el presenter lo
          // oculte de la selección directa y lo use en modo «Todos».
          if (
            normalizePathForCompare(hubParsed.project.path) ===
            normalizePathForCompare(generalHubPath)
          ) {
            hubParsed.project.isGeneral = true;
          }
          projects.push(hubParsed.project);
          break;
        }
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
        await this.linkCredentialsToProject(credRef, credSnapshot, hubPath);
        const credParsed = parseCredentialsNote(credSnapshot);
        switch (credParsed.kind) {
          case "credentials": {
            const { path, entries, entryIssues } = credParsed.credentials;
            credentials.push({
              path,
              entries,
              projectPath: hubPath,
              needsMigration: entries.some(
                (e) =>
                  typeof e.password === "string" &&
                  !isEncryptedValue(e.password),
              ),
            });
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

      // 6. Archivos from <F>/Archivos (optional). Every top-level file
      // counts — any extension, including `.md` — except dotfiles
      // (already excluded by `listFiles`) and nested subfolders (the
      // listing is non-recursive, like `listMarkdownFiles`).
      const archivosFolder = `${folder}/Archivos`;
      if (this.adapter.exists(archivosFolder)) {
        for (const ref of this.adapter.listFiles(archivosFolder)) {
          files.push({
            path: ref.path,
            name: ref.basename,
            extension: extensionOf(ref.basename),
            projectPath: hubPath,
          });
        }
      }
    }

    // 7. Scan the flat calendar folder (non-recursive). Files inside
    // `calendarTemplatesFolder` are never listed because
    // `listMarkdownFiles` is non-recursive, but we guard explicitly.
    await this.adapter.createFolder(this.settings.calendarFolder);
    for (const ref of this.adapter.listMarkdownFiles(
      this.settings.calendarFolder,
    )) {
      if (
        normalizePathForCompare(folderOf(ref.path)) ===
        normalizePathForCompare(this.settings.calendarTemplatesFolder)
      ) {
        continue;
      }
      const snapshot = await this.readSnapshot(ref);
      const parsed = parseProjectTaskNote(snapshot, this.resolveProject);
      switch (parsed.kind) {
        case "calendar-event":
          calendarEvents.push(parsed.event);
          break;
        case "issue":
          issues.push(parsed.issue);
          break;
        default:
          issues.push({
            path: ref.path,
            message: `La nota '${basenameOf(ref.path)}' de la carpeta de calendario debe ser de tipo 'calendar-event'.`,
          });
          break;
      }
    }

    return { projects, tasks, notes, credentials, files, calendarEvents, issues };
  }

  // -------------------------------------------------------------------------
  // Template helpers
  // -------------------------------------------------------------------------

  /**
   * Ensure each template exists on disk. Templates that
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
   * Siembra las bases de Obsidian (`Proyectos`, `Tareas`,
   * `Credenciales` y `Calendario`) en `BASES_FOLDER`, fuera de
   * `projectsFolder` para que el escaneo no las tome por un proyecto.
   * Nunca sobrescribe una base que el usuario haya editado.
   */
  private async seedBases(): Promise<void> {
    await this.adapter.createFolder(BASES_FOLDER);
    const bases = buildBases(
      this.settings.templatesFolder,
      this.settings.calendarTemplatesFolder,
    );
    for (const [fileName, content] of Object.entries(bases)) {
      const fullPath = joinPath(BASES_FOLDER, fileName);
      if (this.adapter.exists(fullPath)) {
        continue;
      }
      // Versiones anteriores las dejaban sueltas en `projectsFolder`:
      // se mueven (conservando ediciones del usuario) en vez de duplicarlas.
      const legacyPath = joinPath(this.settings.projectsFolder, fileName);
      if (this.adapter.exists(legacyPath)) {
        await this.adapter.rename(
          { path: legacyPath, basename: fileName },
          fullPath,
        );
        continue;
      }
      await this.adapter.createMarkdown(fullPath, content);
    }
  }

  /**
   * Las notas `Credenciales.md` heredadas no tienen `project`, así que
   * quedan huérfanas en el grafo. Si falta, se escribe sólo esa prop
   * (nunca se tocan las entradas cifradas).
   */
  private async linkCredentialsToProject(
    ref: VaultNoteRef,
    snapshot: NoteSnapshot,
    hubPath: string,
  ): Promise<void> {
    const sliced = sliceFrontmatter(snapshot.content);
    if (sliced.kind !== "ok" || /^project\s*:/m.test(sliced.yaml)) {
      return;
    }
    const link = wrapWikilink(projectPathToWikilinkInner(hubPath));
    await this.adapter.processFrontMatter(ref, (frontmatter) => {
      frontmatter["project"] = link;
    });
  }

  /**
   * Ensure the calendar-event template exists under
   * `calendarTemplatesFolder`. Like `seedTemplates`, it never overwrites
   * a user-forked template.
   */
  private async seedCalendarTemplates(): Promise<void> {
    await this.adapter.createFolder(this.settings.calendarTemplatesFolder);
    const fileName = TEMPLATE_FILE_NAMES["calendar-event"];
    const fullPath = joinPath(this.settings.calendarTemplatesFolder, fileName);
    if (!this.adapter.exists(fullPath)) {
      await this.adapter.createMarkdown(
        fullPath,
        DEFAULT_TEMPLATE_CONTENT["calendar-event"],
      );
    }
  }

  /**
   * Siembra el proyecto sombra `General` (`<projectsFolder>/General/`
   * con `General.md`, `Tareas/`, `Notas/`, `Archivos/` y
   * `Credenciales.md`) cuando falta. Corre en cada `load()`, tras
   * `seedTemplates()`, pero nunca sobrescribe: lo que ya existe se
   * deja intacto (incluido un `General.md` roto, que el escaneo normal
   * reporta como issue).
   *
   * El hub se genera desde la plantilla `project` del usuario y las
   * credenciales desde la plantilla `credentials`, igual que
   * `createProject`. Si una plantilla está rota, el hub resultante será
   * inválido y saldrá como issue — `load()` nunca lanza.
   */
  private async ensureGeneralProject(): Promise<void> {
    const folder = `${this.settings.projectsFolder}/${GENERAL_FOLDER}`;
    const hubPath = `${folder}/${GENERAL_FOLDER}.md`;
    const credsPath = `${folder}/Credenciales.md`;
    await this.adapter.createFolder(folder);
    await this.adapter.createFolder(`${folder}/Tareas`);
    await this.adapter.createFolder(`${folder}/Notas`);
    await this.adapter.createFolder(`${folder}/Archivos`);

    if (!this.adapter.exists(hubPath)) {
      const templateRef: VaultNoteRef = {
        path: this.templatePath("project"),
        basename: TEMPLATE_FILE_NAMES.project,
      };
      const templateContent = await this.adapter.read(templateRef);
      const hubContent = applyTemplate(templateContent, "project", {
        title: GENERAL_FOLDER,
        today: todayStamp(),
      });
      await this.adapter.createMarkdown(hubPath, hubContent);
    }

    if (!this.adapter.exists(credsPath)) {
      const templateRef: VaultNoteRef = {
        path: this.templatePath("credentials"),
        basename: TEMPLATE_FILE_NAMES.credentials,
      };
      const templateContent = await this.adapter.read(templateRef);
      const credsContent = applyTemplate(templateContent, "credentials", {
        title: GENERAL_FOLDER,
        today: todayStamp(),
        projectLink: wrapWikilink(projectPathToWikilinkInner(hubPath)),
      });
      await this.adapter.createMarkdown(credsPath, credsContent);
    }
  }

  /**
   * Return a Spanish error message when the template for `kind` is
   * invalid; `null` when the template is fresh (just seeded) or valid.
   *
   * The file-name is woven into every message so the dashboard can
   * show "La plantilla 'proyecto.md' …" rather than a generic message.
   */
  private async templateIssue(
    kind: TemplateKind,
    folder: string = this.settings.templatesFolder,
  ): Promise<string | null> {
    const fileName = TEMPLATE_FILE_NAMES[kind];
    const fullPath = joinPath(folder, fileName);
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
      projectLink: wrapWikilink(projectPathToWikilinkInner(hubPath)),
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
  // Mutations: encrypted credentials
  //
  // Every mutation requires the unlocked vault key (the view only calls
  // these while `CredentialSession.isUnlocked()`). `service` stays in
  // plaintext; every sensitive field is encrypted before it reaches
  // `processFrontMatter`, so the YAML on disk never sees a secret.
  // -------------------------------------------------------------------------

  async createCredential(
    projectPath: string,
    input: CredentialInput,
    key: CryptoKey | null,
  ): Promise<void> {
    const unlocked = requireCredentialKey(key);
    const service = validateCredentialService(input.service);
    const credPath = credentialsPathFor(projectPath);
    await this.ensureCredentialsNote(credPath);
    const entry = await buildEncryptedEntry(unlocked, {
      ...input,
      service,
    });
    // The new list is computed from a real YAML read first: the value is
    // then swapped wholesale inside `processFrontMatter`, so only the
    // `credentials` prop is ever written.
    const next = [...(await this.readCredentialEntries(credPath)), entry];
    const ref = { path: credPath, basename: "Credenciales.md" };
    await this.adapter.processFrontMatter(ref, (frontmatter) => {
      frontmatter["credentials"] = next;
    });
  }

  async updateCredential(
    projectPath: string,
    index: number,
    expectedService: string,
    input: CredentialInput,
    key: CryptoKey | null,
  ): Promise<void> {
    const unlocked = requireCredentialKey(key);
    const service = validateCredentialService(input.service);
    const credPath = credentialsPathFor(projectPath);
    const current = await this.readCredentialEntries(credPath);
    if (current[index]?.service !== expectedService) {
      throw new Error("La credencial cambió mientras la editabas.");
    }
    const entry = await buildEncryptedEntry(unlocked, {
      ...input,
      service,
    });
    // Preserve user-defined extra fields (rotation cadences, tags, …)
    // that the form does not manage: they survive untouched, encrypted
    // blobs included (same vault key still decrypts them).
    const preserved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(current[index]!)) {
      if (!["service", "user", "password", "url", "notes"].includes(k)) {
        preserved[k] = v;
      }
    }
    const next = current.map((row, i) =>
      i === index ? { ...preserved, ...entry } : row,
    );
    const ref = { path: credPath, basename: "Credenciales.md" };
    await this.adapter.processFrontMatter(ref, (frontmatter) => {
      frontmatter["credentials"] = next;
    });
  }

  async deleteCredential(
    projectPath: string,
    index: number,
    key: CryptoKey | null,
  ): Promise<void> {
    requireCredentialKey(key);
    const credPath = credentialsPathFor(projectPath);
    const next = (await this.readCredentialEntries(credPath)).filter(
      (_, i) => i !== index,
    );
    const ref = { path: credPath, basename: "Credenciales.md" };
    await this.adapter.processFrontMatter(ref, (frontmatter) => {
      frontmatter["credentials"] = next;
    });
  }

  /**
   * Encrypt every plaintext sensitive field in the project's
   * `Credenciales.md`. Returns the number of migrated entries. Extra
   * user-defined fields are preserved untouched.
   */
  async migratePlaintextCredentials(
    projectPath: string,
    key: CryptoKey | null,
  ): Promise<number> {
    const unlocked = requireCredentialKey(key);
    const credPath = credentialsPathFor(projectPath);
    // Encrypt everything BEFORE touching the file: `processFrontMatter`
    // writes synchronously when its callback returns, so no async work
    // may be staged inside the callback.
    const current = await this.readCredentialEntries(credPath);
    let migrated = 0;
    const next: Array<Record<string, unknown>> = [];
    for (const raw of current) {
      const copy: Record<string, unknown> = { ...raw };
      if (
        typeof copy.password === "string" &&
        !isEncryptedValue(copy.password)
      ) {
        migrated++;
      }
      for (const field of ["user", "password", "url", "notes"] as const) {
        const value = copy[field];
        if (
          typeof value === "string" &&
          value.length > 0 &&
          !isEncryptedValue(value)
        ) {
          copy[field] = await encryptField(unlocked, value);
        }
      }
      next.push(copy);
    }
    const ref = { path: credPath, basename: "Credenciales.md" };
    await this.adapter.processFrontMatter(ref, (frontmatter) => {
      frontmatter["credentials"] = next;
    });
    return migrated;
  }

  // -------------------------------------------------------------------------
  // Mutations: files (Archivos/)
  //
  // Los ficheros de `<Proyecto>/Archivos/` son opacos para el plugin:
  // se copian tal cual vía `createBinary` y nunca pasan por
  // `processFrontMatter`. La confirmación previa al borrado vive en la
  // vista; aquí el borrado va directo a la papelera de Obsidian.
  // -------------------------------------------------------------------------

  /**
   * Copia un fichero externo (bytes ya leídos por la vista) al
   * `Archivos/` del proyecto dueño de `projectPath`. Devuelve la ruta
   * creada en el vault.
   *
   * Solo el stem se sanitiza con `sanitizeFilename` (la extensión va
   * intacta, con sus mayúsculas); `../` y `/` quedan plegados al stem,
   * así el fichero nunca escapa de `Archivos/`. Si el nombre ya
   * existe, se desambigua con ` 2`, ` 3`, … antes de la extensión
   * (`foto.png` → `foto 2.png`).
   */
  async addFile(
    projectPath: string,
    fileName: string,
    data: ArrayBuffer,
  ): Promise<string> {
    const { stem, ext } = splitFileName(fileName);
    const sanitizedStem = sanitizeFilename(stem);
    const safeName = ext.length > 0 ? `${sanitizedStem}.${ext}` : sanitizedStem;
    const projectFolder = folderOf(projectPath);
    const archivosFolder = `${projectFolder}/Archivos`;
    await this.adapter.createFolder(archivosFolder);
    const targetPath = await this.uniqueFilePath(archivosFolder, safeName);
    await this.adapter.createBinary(targetPath, data);
    return targetPath;
  }

  /**
   * Manda un fichero de `Archivos/` a la papelera (recuperable — nunca
   * borrado permanente). Lanza cuando la ruta no existe, igual que
   * `deleteTask`. No hay borrado de carpetas.
   */
  async deleteFile(path: string): Promise<void> {
    const ref = { path, basename: basenameOf(path) };
    await this.adapter.trash(ref);
  }

  // -------------------------------------------------------------------------
  // Mutations: calendar events
  //
  // Cada evento vive como una nota `type: calendar-event` en la carpeta
  // plana `calendarFolder`. Las operaciones de escritura validan la
  // plantilla `evento.md`, crean desde la plantilla del usuario y
  // actualizan sólo las propiedades que tocan, siempre por
  // `processFrontMatter` (salvo `create`, que materializa la nota de una
  // vez con el contenido final para evitar escrituras parciales).
  // -------------------------------------------------------------------------

  async createCalendarEvent(
    input: CalendarEventInput,
  ): Promise<string> {
    const issue = await this.templateIssue(
      "calendar-event",
      this.settings.calendarTemplatesFolder,
    );
    if (issue !== null) {
      throw new Error(issue);
    }

    await this.adapter.createFolder(this.settings.calendarFolder);
    const sanitized = sanitizeFilename(input.title);
    const path = await this.uniqueMarkdownPath(
      this.settings.calendarFolder,
      sanitized,
    );
    const content = await this.buildCalendarEventContent(input);
    await this.adapter.createMarkdown(path, content);
    return path;
  }

  /**
   * Actualiza sólo las propiedades de frontmatter de un evento de
   * calendario. El título y el cuerpo no son mutables por este método:
   * renombrar un evento requiere recrearlo (cambio de filename), y el
   * cuerpo se edita directamente en la nota de Obsidian, igual que para
   * tareas y notas simples.
   */
  async updateCalendarEvent(
    path: string,
    patch: Partial<CalendarEventPatch>,
  ): Promise<void> {
    const ref = { path, basename: basenameOf(path) };
    await this.adapter.processFrontMatter(ref, (frontmatter) => {
      if (patch.kind !== undefined) frontmatter["kind"] = patch.kind;
      if (patch.date !== undefined) frontmatter["date"] = patch.date;
      if (patch.endDate !== undefined) {
        if (patch.endDate === null) {
          delete frontmatter["endDate"];
        } else {
          frontmatter["endDate"] = patch.endDate;
        }
      }
      if (patch.allDay !== undefined) {
        frontmatter["allDay"] = patch.allDay;
        if (patch.allDay) {
          delete frontmatter["time"];
        }
      }
      if (patch.time !== undefined) {
        if (patch.time === null) {
          delete frontmatter["time"];
        } else {
          frontmatter["time"] = patch.time;
        }
      }
      if (patch.recurrence !== undefined) {
        frontmatter["recurrence"] = patch.recurrence;
      }
      if (patch.recurrenceEnd !== undefined) {
        if (patch.recurrenceEnd === null) {
          delete frontmatter["recurrenceEnd"];
        } else {
          frontmatter["recurrenceEnd"] = patch.recurrenceEnd;
        }
      }
      if (patch.projectLink !== undefined) {
        if (patch.projectLink === null) {
          delete frontmatter["project"];
        } else {
          const inner = projectPathToWikilinkInner(patch.projectLink);
          frontmatter["project"] = wrapWikilink(inner);
        }
      }
      if (patch.status !== undefined) frontmatter["status"] = patch.status;
    });
  }

  async setCalendarEventStatus(
    path: string,
    status: "open" | "done",
  ): Promise<void> {
    const ref = { path, basename: basenameOf(path) };
    await this.adapter.processFrontMatter(ref, (frontmatter) => {
      frontmatter["status"] = status;
    });
  }

  /**
   * Manda una nota de calendario a la papelera (recuperable).
   */
  async deleteCalendarEvent(path: string): Promise<void> {
    const ref = { path, basename: basenameOf(path) };
    await this.adapter.trash(ref);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async readSnapshot(ref: VaultNoteRef): Promise<NoteSnapshot> {
    const content = await this.adapter.read(ref);
    return { path: ref.path, basename: ref.basename, content };
  }

  /**
   * Read the raw `credentials` list of a `Credenciales.md` without
   * validating: mutations need the current rows (to check the service
   * guard or migrate) even when some row would not parse cleanly.
   * Returns `[]` when the note is missing or its frontmatter is broken.
   */
  private async readCredentialEntries(
    credPath: string,
  ): Promise<Array<Record<string, unknown>>> {
    const ref = { path: credPath, basename: "Credenciales.md" };
    let content: string;
    try {
      content = await this.adapter.read(ref);
    } catch {
      return [];
    }
    const sliced = sliceFrontmatter(content);
    if (sliced.kind !== "ok") {
      return [];
    }
    let parsed: unknown;
    try {
      parsed = yaml.load(sliced.yaml);
    } catch {
      return [];
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    const list = (parsed as Record<string, unknown>)["credentials"];
    if (!Array.isArray(list)) {
      return [];
    }
    return list.filter(
      (row): row is Record<string, unknown> =>
        row !== null && typeof row === "object" && !Array.isArray(row),
    );
  }

  /**
   * Create an empty `Credenciales.md` when the project has none yet, so
   * the first `createCredential` never fails on a missing note.
   */
  private async ensureCredentialsNote(credPath: string): Promise<void> {
    if (this.adapter.exists(credPath)) {
      return;
    }
    const folder = folderOf(credPath);
    await this.adapter.createFolder(folder);
    const link = wrapWikilink(
      projectPathToWikilinkInner(`${folder}/${basenameOf(folder)}.md`),
    );
    await this.adapter.createMarkdown(
      credPath,
      `---\ntype: credentials\nproject: "${link}"\ncredentials: []\n---\n`,
    );
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
   * Devuelve una ruta única dentro de `folderPath` para `fileName`
   * (nombre con extensión, ya sanitizado por `addFile`). Si la ruta
   * existe (fichero o carpeta), desambigua con ` 2`, ` 3`, … antes de
   * la extensión (`foto.png` → `foto 2.png`); sin extensión, el sufijo
   * va al final (`SINEXT` → `SINEXT 2`).
   *
   * Usa `adapter.exists` (cubre `.md` y binarios) en vez de
   * `listMarkdownFiles`, porque `Archivos/` guarda toda extensión.
   */
  private async uniqueFilePath(
    folderPath: string,
    fileName: string,
    ignorePath?: string,
  ): Promise<string> {
    if (fileName.includes("/") || fileName.includes("\\")) {
      throw new Error(
        `ProjectTaskRepository: unsafe filename: ${fileName}`,
      );
    }
    const basePath = `${folderPath}/${fileName}`;
    if (
      !this.adapter.exists(basePath) ||
      (ignorePath !== undefined && basePath === ignorePath)
    ) {
      return basePath;
    }

    const { stem, ext } = splitFileName(fileName);
    for (let counter = 2; counter < 10_000; counter++) {
      const candidateName =
        ext.length > 0 ? `${stem} ${counter}.${ext}` : `${stem} ${counter}`;
      const candidatePath = `${folderPath}/${candidateName}`;
      if (
        !this.adapter.exists(candidatePath) ||
        (ignorePath !== undefined && candidatePath === ignorePath)
      ) {
        return candidatePath;
      }
    }
    throw new Error(
      `ProjectTaskRepository: could not disambiguate ${fileName} inside ${folderPath}`,
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

  /**
   * Resolve the vault-relative path of the calendar-event template.
   */
  private calendarTemplatePath(): string {
    return joinPath(
      this.settings.calendarTemplatesFolder,
      TEMPLATE_FILE_NAMES["calendar-event"],
    );
  }

  /**
   * Build the final Markdown content for a new calendar event from the
   * user's `calendar-event` template, stamping the values supplied by the
   * caller and preserving any extra properties or body the template
   * carries.
   */
  private async buildCalendarEventContent(
    input: CalendarEventInput,
  ): Promise<string> {
    const templateRef: VaultNoteRef = {
      path: this.calendarTemplatePath(),
      basename: TEMPLATE_FILE_NAMES["calendar-event"],
    };
    const templateContent = await this.adapter.read(templateRef);

    // Reutilizamos `applyTemplate` para estampar `created` y preservar el
    // cuerpo / props extra; este paso ya hace el parseo/serializado base.
    const stamped = applyTemplate(templateContent, "calendar-event", {
      title: input.title,
      today: todayStamp(),
    });

    const sliced = sliceFrontmatter(stamped);
    if (sliced.kind !== "ok") {
      // Validation should have caught this first; degrade gracefully.
      return stamped;
    }

    let parsed: unknown;
    try {
      parsed = yaml.load(sliced.yaml);
    } catch {
      return stamped;
    }
    if (
      parsed === null ||
      parsed === undefined ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return stamped;
    }

    const props = parsed as Record<string, unknown>;
    // Campos específicos de calendar-event que `applyTemplate` no toca.
    props.kind = input.kind;
    props.date = input.date;
    props.allDay = input.allDay ?? true;
    props.recurrence = input.recurrence ?? "none";
    props.status = input.status ?? "open";

    if (input.endDate !== undefined) {
      props.endDate = input.endDate;
    }

    if (input.allDay === false && input.time !== undefined) {
      props.time = input.time;
    } else if (input.allDay !== false && input.time === undefined) {
      delete props.time;
    }

    if (input.recurrenceEnd !== undefined) {
      props.recurrenceEnd = input.recurrenceEnd;
    }

    if (input.projectLink !== undefined) {
      const inner = projectPathToWikilinkInner(input.projectLink);
      props.project = wrapWikilink(inner);
    }

    const dumped = yaml.dump(props, { lineWidth: -1 });
    const body = input.body ?? sliced.body;
    return `---\n${dumped}---\n${body}`;
  }
}

// ---------------------------------------------------------------------------
// Encrypted-credential helpers (exported input type + module privates).
// ---------------------------------------------------------------------------

/**
 * User-supplied values for one calendar event. The repository stamps
 * these into the frontmatter of a new `type: calendar-event` note,
 * preserving the template's body and any extra user-defined properties.
 */
export interface CalendarEventInput {
  title: string;
  kind: CalendarKind;
  date: string;
  endDate?: string;
  time?: string;
  allDay?: boolean;
  recurrence?: CalendarRecurrence;
  recurrenceEnd?: string;
  projectLink?: string;
  body?: string;
  status?: "open" | "done";
}

/**
 * Keys mutables vía `updateCalendarEvent`. El título no es editable por
 * este método (cambiarlo implica renombrar el archivo); el cuerpo tampoco
 * (se edita directamente en Obsidian, igual que tareas y notas simples).
 *
 * `endDate`, `time`, `recurrenceEnd` y `projectLink` aceptan `null` para
 * borrar explícitamente la propiedad del frontmatter. `undefined` sigue
 * sin tocar la propiedad.
 */
export interface CalendarEventPatch {
  kind?: CalendarKind;
  date?: string;
  /** `null` borra `endDate` del frontmatter; `undefined` no lo toca. */
  endDate?: string | null;
  /** `null` borra `time` del frontmatter; `undefined` no lo toca. */
  time?: string | null;
  allDay?: boolean;
  recurrence?: CalendarRecurrence;
  /** `null` borra `recurrenceEnd` del frontmatter; `undefined` no lo toca. */
  recurrenceEnd?: string | null;
  /**
   * `null` borra `project` del frontmatter (evento global);
   * `undefined` no lo toca.
   */
  projectLink?: string | null;
  status?: "open" | "done";
}

/**
 * User-supplied values for one credential. `service` is stored in
 * plaintext; every other non-empty field is encrypted before it is
 * written to `Credenciales.md`.
 */
export interface CredentialInput {
  service: string;
  user: string;
  password: string;
  url?: string;
  notes?: string;
}

/**
 * Guard shared by every credential mutation: without the unlocked vault
 * key there is nothing to encrypt with (and nothing destructive may run).
 */
function requireCredentialKey(key: CryptoKey | null): CryptoKey {
  if (key === null) {
    throw new Error("Desbloquea las credenciales primero.");
  }
  return key;
}

function validateCredentialService(service: string): string {
  const trimmed = typeof service === "string" ? service.trim() : "";
  if (trimmed.length === 0) {
    throw new Error("El servicio no puede estar vacío.");
  }
  return trimmed;
}

/**
 * Vault-relative path of a project's `Credenciales.md`, derived from its
 * hub note path (`<F>/<F>.md` → `<F>/Credenciales.md`).
 */
function credentialsPathFor(projectPath: string): string {
  return `${folderOf(projectPath)}/Credenciales.md`;
}

/**
 * Build the stored row for one credential: `service` in plaintext, every
 * other non-empty sensitive field encrypted. Empty `url`/`notes` are
 * omitted rather than stored as empty blobs.
 */
async function buildEncryptedEntry(
  key: CryptoKey,
  input: CredentialInput,
): Promise<Record<string, unknown>> {
  const entry: Record<string, unknown> = {
    service: input.service,
    user: await encryptField(key, input.user),
    password: await encryptField(key, input.password),
  };
  if (typeof input.url === "string" && input.url.length > 0) {
    entry.url = await encryptField(key, input.url);
  }
  if (typeof input.notes === "string" && input.notes.length > 0) {
    entry.notes = await encryptField(key, input.notes);
  }
  return entry;
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
 * Separa un nombre de fichero en stem y extensión por el ÚLTIMO punto.
 * La extensión va sin punto y tal cual (con mayúsculas si las trae);
 * quien la necesite normalizada usa `extensionOf`.
 *
 *  - `"foto.png"` → `{ stem: "foto", ext: "png" }`
 *  - `"archive.tar.gz"` → `{ stem: "archive.tar", ext: "gz" }`
 *  - `"SINEXT"` / `".oculto"` / `"foto."` → `{ stem: <nombre>, ext: "" }`
 */
export function splitFileName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return { stem: name, ext: "" };
  }
  return { stem: name.slice(0, dot), ext: name.slice(dot + 1) };
}

/**
 * Extensión de un nombre de fichero en minúsculas y sin punto
 * (`"FOTO.PNG"` → `"png"`; `""` cuando no hay extensión). Los
 * dotfiles devuelven `""` (el punto inicial no cuenta como separador).
 */
function extensionOf(fileName: string): string {
  return splitFileName(fileName).ext.toLowerCase();
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