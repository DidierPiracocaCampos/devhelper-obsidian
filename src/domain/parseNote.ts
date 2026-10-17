/**
 * Pure Markdown frontmatter parser for project and task notes.
 *
 * Responsibilities:
 *  1. Slice a leading `---\n...\n---\n` frontmatter block out of the
 *     note content (without modifying the body).
 *  2. Hand the YAML between the markers to `js-yaml.load` (single
 *     document; throws on parse errors are caught and converted to
 *     issues).
 *  3. Validate the resulting object against the project/task schema and
 *     return a discriminated `ParsedNote`:
 *      - `{ kind: "project" }` for valid project notes.
 *      - `{ kind: "task" }`    for valid task notes (after resolving the
 *        `project` wikilink through the injected callback).
 *      - `{ kind: "issue" }`   for any failure, including malformed
 *        frontmatter, missing required properties, invalid status, or
 *        an unresolvable project link.
 *
 * The module is intentionally framework-free. No `obsidian` imports.
 * The vault adapter (Task 4) is the only thing that knows how to turn
 * a `[[link]]` into a real vault path, and it does that through the
 * `resolveProject` callback.
 */

import yaml from "js-yaml";
import { sliceFrontmatter } from "./frontmatter";
import type {
  DashboardIssue,
  NoteSnapshot,
  ParsedNote,
  ProjectRecord,
  ResolveProjectFn,
  TaskRecord,
} from "./types";

const ALLOWED_TASK_STATUSES = new Set(["open", "done"]);

/**
 * Parse a single Markdown note and return one of the three
 * `ParsedNote` variants. Never throws - every failure mode is
 * reported as a `kind: "issue"` with the note `path` and a
 * descriptive message.
 */
export function parseProjectTaskNote(
  note: NoteSnapshot,
  resolveProject: ResolveProjectFn,
): ParsedNote {
  const title = basenameToTitle(note.basename);

  const sliced = sliceFrontmatter(note.content);
  if (sliced.kind === "missing") {
    return issue(note.path, "Falta bloque de frontmatter (--- … ---).");
  }
  if (sliced.kind === "unclosed") {
    return issue(
      note.path,
      "Frontmatter malformado: falta el delimitador de cierre ---.",
    );
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(sliced.yaml);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return issue(
      note.path,
      `Frontmatter con YAML inválido: ${detail}`.trim(),
    );
  }

  if (parsed === null || parsed === undefined) {
    return issue(
      note.path,
      "Frontmatter vacío o ausente: falta la propiedad requerida 'type'.",
    );
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return issue(
      note.path,
      "Frontmatter no es un mapeo YAML de propiedades.",
    );
  }

  const properties = parsed as Record<string, unknown>;
  const type = properties.type;

  if (type === undefined || type === null) {
    return issue(
      note.path,
      "Falta la propiedad requerida 'type' (esperado 'project' o 'task').",
    );
  }
  if (typeof type !== "string") {
    return issue(
      note.path,
      "La propiedad 'type' debe ser una cadena de texto.",
    );
  }

  if (type === "project") {
    return buildProject(note, title, properties);
  }
  if (type === "task") {
    return buildTask(note, title, properties, resolveProject);
  }

  return issue(
    note.path,
    `Tipo desconocido '${type}' (esperado 'project' o 'task').`,
  );
}

// ---------------------------------------------------------------------------
// Project / task record construction
// ---------------------------------------------------------------------------

function buildProject(
  note: NoteSnapshot,
  title: string,
  properties: Record<string, unknown>,
): ParsedNote {
  const project: ProjectRecord = {
    path: note.path,
    title,
    properties,
  };
  return { kind: "project", project };
}

function buildTask(
  note: NoteSnapshot,
  title: string,
  properties: Record<string, unknown>,
  resolveProject: ResolveProjectFn,
): ParsedNote {
  const projectLink = properties.project;
  if (typeof projectLink !== "string" || projectLink.length === 0) {
    return issue(
      note.path,
      "Falta la propiedad requerida 'project' (espera un wikilink '[[…]]').",
    );
  }
  if (!projectLink.startsWith("[[") || !projectLink.endsWith("]]")) {
    return issue(
      note.path,
      `La propiedad 'project' debe ser un wikilink '[[…]]', se recibió: ${projectLink}.`,
    );
  }

  const stripped = projectLink.slice(2, -2).trim();
  if (stripped.length === 0) {
    return issue(
      note.path,
      "La propiedad 'project' está vacía dentro del wikilink.",
    );
  }

  const resolved = resolveProject(stripped, note.path);
  if (resolved === null) {
    return issue(
      note.path,
      `No se pudo resolver el enlace de proyecto '[[${stripped}]]'.`,
    );
  }

  const projectPath = resolved.toLowerCase().endsWith(".md")
    ? resolved
    : `${resolved}.md`;

  const statusRaw = properties.status;
  if (statusRaw === undefined || statusRaw === null) {
    return issue(
      note.path,
      "Falta la propiedad requerida 'status' (esperado 'open' o 'done').",
    );
  }
  if (typeof statusRaw !== "string" || !ALLOWED_TASK_STATUSES.has(statusRaw)) {
    return issue(
      note.path,
      `La propiedad 'status' debe ser 'open' o 'done', se recibió: ${String(
        statusRaw,
      )}.`,
    );
  }

  const task: TaskRecord = {
    path: note.path,
    title,
    projectPath,
    status: statusRaw as "open" | "done",
    properties,
  };
  return { kind: "task", task };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function basenameToTitle(basename: string): string {
  return basename.replace(/\.md$/i, "");
}

function issue(path: string, message: string): ParsedNote {
  const entry: DashboardIssue = { path, message };
  return { kind: "issue", issue: entry };
}
