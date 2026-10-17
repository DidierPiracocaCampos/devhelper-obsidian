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
 */
export interface ParsedCredentialsNote {
  path: string;
  entries: CredentialEntry[];
}

/**
 * A credentials note bound to a specific project folder. `projectPath`
 * is the vault-relative path of the owning project note (always ending
 * in `.md`).
 */
export interface CredentialsRecord extends ParsedCredentialsNote {
  projectPath: string;
}

/**
 * The aggregate payload produced by the repository on every `load()`.
 */
export interface DashboardData {
  projects: ProjectRecord[];
  tasks: TaskRecord[];
  credentials: CredentialsRecord[];
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
 *  - `"credentials"` => the note is a valid credentials file.
 *  - `"issue"`       => the note is malformed or fails validation;
 *    exactly one issue is returned so the folder scan can continue.
 */
export type ParsedNote =
  | { kind: "project"; project: ProjectRecord }
  | { kind: "task"; task: TaskRecord }
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
