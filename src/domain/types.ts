/**
 * Pure domain types for the dashboard.
 *
 * This module deliberately has NO Obsidian imports so the parser, the
 * presentation layer and the repository can be unit-tested without the
 * Obsidian runtime. The vault adapter (Task 4) is the only place that
 * talks to the Obsidian `app` and converts raw `TFile`s into the
 * `NoteSnapshot` shape below.
 */

/**
 * A validated project record derived from a single Markdown note.
 * `properties` is the full frontmatter bag parsed from the note so the
 * user's custom properties survive a round-trip through the dashboard.
 * `folderPath` is the parent directory of `path` inside the vault
 * (empty string for notes saved at the vault root); V2 surfaces this
 * so the UI can group projects by folder.
 */
export interface ProjectRecord {
  path: string;
  title: string;
  folderPath: string;
  // prop opcional en frontmatter; `true` = chip visible en la fila de favoritos
  favorite: boolean;
  // `true` solo en el hub `Projects/General/General.md` (proyecto sombra:
  // nunca aparece en chips/favoritos/picker ni como selección directa).
  isGeneral?: boolean;
  properties: Record<string, unknown>;
}

/**
 * A validated task record. `projectPath` is the vault-relative path of
 * the project this task belongs to (always ending in `.md`).
 */
export interface TaskRecord {
  path: string;
  title: string;
  projectPath: string;
  status: "open" | "done";
  properties: Record<string, unknown>;
}

/**
 * A validated simple note record. Lighter than a task: only `project`
 * + `created` are required, no `status`/`priority`/`due`.
 */
export interface NoteRecord {
  path: string;
  title: string;
  projectPath: string;
  properties: Record<string, unknown>;
}

/**
 * A validation problem scoped to a single note. The dashboard surfaces
 * these as actionable issues with an "open note" affordance.
 */
export interface DashboardIssue {
  path: string;
  message: string;
}

/**
 * A single credential entry inside a `type: credentials` note. The
 * three required keys (`service`, `user`, `password`) are exposed as
 * named strings so the UI can render them without knowing the rest of
 * the bag; the index signature lets callers preserve arbitrary
 * user-defined keys (rotation cadence, tags, etc.).
 */
export interface CredentialEntry {
  service: string;
  user: string;
  password: string;
  url?: string;
  notes?: string;
  [extra: string]: unknown;
}

/**
 * Parsed credentials note (without a project binding). The repository
 * (Task 4) upgrades this to a `CredentialsRecord` once it knows which
 * project folder the note lives in.
 *
 * `entryIssues` collects per-entry validation failures so a single
 * malformed entry never drops the rest of the credentials list: the
 * repository splits the two arrays back out at the boundary, surfacing
 * the issues via `DashboardData.issues` while keeping the valid entries
 * in `DashboardData.credentials`. The field is optional because it is
 * parser-internal — `CredentialsRecord` does not carry it.
 */
export interface ParsedCredentialsNote {
  path: string;
  entries: CredentialEntry[];
  entryIssues?: DashboardIssue[];
}

/**
 * A credentials note bound to a specific project folder. `projectPath`
 * is the vault-relative path of the owning project note (always ending
 * in `.md`). `needsMigration` is true when any entry still stores its
 * password in plaintext (the repository flags it so the view can offer
 * one-click encryption).
 */
export interface CredentialsRecord extends ParsedCredentialsNote {
  projectPath: string;
  needsMigration: boolean;
}

/**
 * Un fichero binario o de texto dentro de `<Proyecto>/Archivos/`.
 * `projectPath` es la ruta del hub del proyecto propietario (siempre `.md`).
 * `name` incluye la extensión; `extension` va sin punto y en minúsculas
 * ("" cuando el fichero no tiene extensión).
 */
export interface FileRecord {
  path: string;
  name: string;
  extension: string;
  projectPath: string;
}

/**
 * The aggregate payload produced by the repository on every `load()`.
 *
 * `files` lista los ficheros de `<Proyecto>/Archivos/` de cada proyecto
 * (el presenter los acota por selección; en «Todos» solo los de General).
 */
export interface DashboardData {
  projects: ProjectRecord[];
  tasks: TaskRecord[];
  notes: NoteRecord[];
  credentials: CredentialsRecord[];
  files: FileRecord[];
  issues: DashboardIssue[];
}

/**
 * A read-only snapshot of a Markdown note supplied by the vault
 * adapter. The parser never touches the Obsidian `TFile` directly.
 */
export interface NoteSnapshot {
  path: string;
  basename: string;
  content: string;
}

/**
 * The result of parsing a single note. Discriminated by `kind`:
 *
 *  - `"project"`     => the note is a valid project.
 *  - `"task"`        => the note is a valid task.
 *  - `"note"`        => the note is a valid simple note.
 *  - `"credentials"` => the note is a valid credentials file.
 *  - `"issue"`       => the note is malformed or fails validation;
 *    exactly one issue is returned so the folder scan can continue.
 */
export type ParsedNote =
  | { kind: "project"; project: ProjectRecord }
  | { kind: "task"; task: TaskRecord }
  | { kind: "note"; note: NoteRecord }
  | { kind: "credentials"; credentials: ParsedCredentialsNote }
  | { kind: "issue"; issue: DashboardIssue };

/**
 * Callback used by the parser to resolve a task's `[[...]]` project
 * wikilink into a vault-relative path. The vault adapter (Task 4) wires
 * this to Obsidian's `metadataCache.getFirstLinkpathDest` so the domain
 * layer stays pure.
 *
 * Returning `null` means the link could not be resolved (broken wikilink
 * or a link to a non-project note). The parser will turn that into a
 * `kind: "issue"`.
 */
export type ResolveProjectFn = (
  link: string,
  sourcePath: string,
) => string | null;
