/**
 * Pure templates module for the DevHelper Dashboard.
 *
 * Five note kinds are recognised:
 *  - `project`        — managed via `Projects/.../<proyecto>.md`
 *  - `task`           — managed via `Projects/.../<tarea>.md`
 *  - `note`           — managed via `Projects/.../<nota>.md`
 *  - `credentials`    — managed via `Projects/.../<credenciales>.md`
 *  - `calendar-event` — managed via `Calendario/<evento>.md`
 *
 * For each kind the module exposes:
 *  - the canonical file name,
 *  - the list of properties the template MUST declare,
 *  - a default seed template,
 *  - a `validateTemplate` helper that returns a Spanish error message
 *    when the seed is malformed,
 *  - an `applyTemplate` helper that produces a final note by stamping
 *    `created` (and `project` for tasks) without disturbing the body
 *    or any extra user-defined properties.
 *
 * The module is intentionally framework-free: no `obsidian` imports.
 * `js-yaml` is used to parse and re-emit the YAML between frontmatter
 * markers; everything else is string handling.
 */

import yaml from "js-yaml";
import { sliceFrontmatter } from "./frontmatter";

// ---------------------------------------------------------------------------
// Public type and constants
// ---------------------------------------------------------------------------

export type TemplateKind =
  | "project"
  | "task"
  | "note"
  | "credentials"
  | "calendar-event";

export const TEMPLATE_FILE_NAMES: Record<TemplateKind, string> = {
  project: "proyecto.md",
  task: "tarea.md",
  note: "nota.md",
  credentials: "credenciales.md",
  "calendar-event": "evento.md",
};

/**
 * Properties that a template MUST declare for its kind. The list is
 * used both for validation and for the issue messages that surface
 * missing keys.
 */
export const FIXED_TEMPLATE_PROPERTIES: Record<TemplateKind, string[]> = {
  project: ["type", "status", "created", "tags", "description", "client"],
  task: ["type", "project", "status", "created", "due", "priority"],
  note: ["type", "project", "created"],
  credentials: ["type", "credentials"],
  "calendar-event": [
    "type",
    "kind",
    "date",
    "allDay",
    "recurrence",
    "created",
    "status",
  ],
};

/**
 * Default seed templates shipped with the plugin. Each template is a
 * valid Markdown file whose frontmatter ends with `---\n` followed by
 * an empty body. Users can fork them; the validator will reject any
 * fork that drops a fixed property or breaks the YAML.
 */
export const DEFAULT_TEMPLATE_CONTENT: Record<TemplateKind, string> = {
  project: [
    "---",
    "type: project",
    "status: active",
    "created: 1970-01-01",
    "tags: []",
    "description:",
    "client:",
    "---",
    "",
    "## Tareas",
    "",
    "![[Tareas.base]]",
    "",
  ].join("\n"),
  task: [
    "---",
    "type: task",
    'project: "[[Proyecto]]"',
    "status: open",
    "created: 1970-01-01",
    "due:",
    "priority: medium",
    "---",
    "",
  ].join("\n"),
  note: [
    "---",
    "type: note",
    'project: "[[Proyecto]]"',
    "created: 1970-01-01",
    "---",
    "",
  ].join("\n"),
  credentials: [
    "---",
    "type: credentials",
    "credentials: []",
    "---",
    "",
  ].join("\n"),
  "calendar-event": [
    "---",
    "type: calendar-event",
    "kind: evento",
    "date:",
    "allDay: true",
    "recurrence: none",
    "created: 1970-01-01",
    "status: open",
    "---",
    "",
  ].join("\n"),
};

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export interface TemplateValues {
  title: string;
  today: string;
  projectLink?: string;
}

/**
 * Validate a Markdown file as a template for the given kind.
 *
 * Returns `null` when the content is a well-formed template; otherwise
 * a Spanish error message describing the first failure encountered.
 *
 * Failure modes, in order:
 *  1. Missing frontmatter (no leading `---`).
 *  2. Unclosed frontmatter (leading `---` without a closing one).
 *  3. Broken YAML (js-yaml throws).
 *  4. Wrong `type` literal for the kind.
 *  5. A fixed property missing from the frontmatter.
 */
export function validateTemplate(
  content: string,
  kind: TemplateKind,
): string | null {
  const sliced = sliceFrontmatter(content);
  if (sliced.kind === "missing") {
    return "Falta bloque de frontmatter (--- … ---).";
  }
  if (sliced.kind === "unclosed") {
    return "Frontmatter malformado: falta el delimitador de cierre ---.";
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(sliced.yaml);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return `Frontmatter con YAML inválido: ${detail}.`.trim();
  }

  if (parsed === null || parsed === undefined) {
    return "Frontmatter vacío: no se puede validar la plantilla.";
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return "Frontmatter no es un mapeo YAML de propiedades.";
  }

  const properties = parsed as Record<string, unknown>;
  const typeValue = properties.type;
  if (typeof typeValue !== "string" || typeValue !== kind) {
    return `La propiedad 'type' debe ser '${kind}'.`;
  }

  for (const key of FIXED_TEMPLATE_PROPERTIES[kind]) {
    if (!(key in properties)) {
      return `La plantilla '${TEMPLATE_FILE_NAMES[kind]}' no tiene la propiedad fija '${key}'.`;
    }
  }

  return null;
}

/**
 * Apply a template for the given kind, stamping `values.today` into
 * `created` (and `values.projectLink` into `project` for tasks when
 * provided). The body and any extra user-defined properties are
 * preserved untouched.
 *
 * Credentials templates are returned verbatim — there is no per-note
 * stamp to apply.
 */
export function applyTemplate(
  content: string,
  kind: TemplateKind,
  values: TemplateValues,
): string {
  // Las credenciales sólo se tocan para enlazarlas a su proyecto (así
  // aparecen conectadas en el grafo); sin enlace se devuelven intactas.
  if (kind === "credentials" && values.projectLink === undefined) {
    return content;
  }

  const sliced = sliceFrontmatter(content);
  if (sliced.kind !== "ok") {
    // Validation should have caught it first; degrade gracefully by
    // returning the content unchanged so callers never see a thrown
    // exception from a templating path.
    return content;
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(sliced.yaml);
  } catch {
    return content;
  }

  if (parsed === null || parsed === undefined || typeof parsed !== "object" || Array.isArray(parsed)) {
    return content;
  }

  const properties = parsed as Record<string, unknown>;
  properties.created = values.today;
  if (
    (kind === "task" || kind === "note" || kind === "credentials") &&
    values.projectLink !== undefined
  ) {
    properties.project = values.projectLink;
  }

  const dumped = yaml.dump(properties, { lineWidth: -1 });
  return `---\n${dumped}---\n${sliced.body}`;
}

/**
 * Return today's date as `YYYY-MM-DD` in the local timezone. The
 * optional `now` parameter exists for deterministic tests; when it is
 * omitted the function uses `new Date()`.
 */
export function todayStamp(now?: Date): string {
  const d = now ?? new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}