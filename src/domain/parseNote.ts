/**
 * Pure Markdown frontmatter parser for project, task, credentials and
 * calendar-event notes.
 *
 * Responsibilities:
 *  1. Slice a leading `---\n...\n---\n` frontmatter block out of the
 *     note content (without modifying the body).
 *  2. Hand the YAML between the markers to `js-yaml.load` (single
 *     document; throws on parse errors are caught and converted to
 *     issues).
 *  3. Validate the resulting object against the V2 schema and return
 *     a discriminated `ParsedNote`:
 *      - `{ kind: "project" }`     for valid project notes.
 *      - `{ kind: "task" }`        for valid task notes (after resolving
 *        the `project` wikilink through the injected callback).
 *      - `{ kind: "credentials" }` for valid credentials notes.
 *      - `{ kind: "calendar-event" }` for valid calendar event notes
 *        (`type: calendar-event`, proyecto opcional).
 *      - `{ kind: "issue" }`       for any failure, including malformed
 *        frontmatter, missing required properties, invalid enum values,
 *        bad dates, or an unresolvable project link.
 *
 * The module is intentionally framework-free. No `obsidian` imports.
 * The vault adapter (Task 4) is the only thing that knows how to turn
 * a `[[link]]` into a real vault path, and it does that through the
 * `resolveProject` callback.
 */

import yaml from "js-yaml";
import { sliceFrontmatter } from "./frontmatter";
import { ENCRYPTED_PREFIX, isEncryptedValue } from "./credentialsCrypto";
import type {
  CalendarEventRecord,
  CalendarKind,
  CalendarRecurrence,
  CredentialEntry,
  DashboardIssue,
  NoteSnapshot,
  ParsedCredentialsNote,
  ParsedNote,
  ProjectRecord,
  ResolveProjectFn,
  TaskRecord,
  NoteRecord,
} from "./types";

const ALLOWED_PROJECT_STATUSES = new Set(["active", "on-hold", "done"]);
const ALLOWED_TASK_STATUSES = new Set(["open", "done"]);
const ALLOWED_TASK_PRIORITIES = new Set(["low", "medium", "high"]);
const ALLOWED_CALENDAR_KINDS = new Set([
  "evento",
  "reunion",
  "fecha_limite",
  "aviso",
]);
const ALLOWED_CALENDAR_RECURRENCES = new Set([
  "none",
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Parse a single Markdown note and return one of the five
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
      "Falta la propiedad requerida 'type' (esperado 'project', 'task', 'note', 'credentials' o 'calendar-event').",
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
  if (type === "note") {
    return buildNote(note, title, properties, resolveProject);
  }
  if (type === "calendar-event") {
    return buildCalendarEvent(note, title, properties, resolveProject);
  }

  return issue(
    note.path,
    `Tipo desconocido '${type}' (esperado 'project', 'task', 'note', 'credentials' o 'calendar-event').`,
  );
}

// ---------------------------------------------------------------------------
// Credentials parser
// ---------------------------------------------------------------------------

/**
 * Parse a `type: credentials` note into a `ParsedNote`. The note must
 * expose a `credentials` list whose entries are objects with the
 * required keys (`service`, `user`, `password`). Extra keys on each
 * entry are preserved.
 *
 * Never throws. Every failure mode is reported as a `kind: "issue"`
 * with the note `path` and a descriptive message.
 */
export function parseCredentialsNote(note: NoteSnapshot): ParsedNote {
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
      "Frontmatter vacío o ausente: falta la propiedad requerida 'credentials'.",
    );
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return issue(
      note.path,
      "Frontmatter no es un mapeo YAML de propiedades.",
    );
  }

  const properties = parsed as Record<string, unknown>;
  const raw = properties.credentials;
  if (!Array.isArray(raw)) {
    return issue(
      note.path,
      "La propiedad 'credentials' debe ser una lista.",
    );
  }

  const entries: CredentialEntry[] = [];
  const entryIssues: DashboardIssue[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    const validation = validateCredentialEntry(entry, i);
    if (validation !== null) {
      entryIssues.push({ path: note.path, message: validation });
      continue;
    }
    entries.push(entry as CredentialEntry);
  }

  const credentials: ParsedCredentialsNote = {
    path: note.path,
    entries,
    entryIssues,
  };
  return { kind: "credentials", credentials };
}

// ---------------------------------------------------------------------------
// Project / task record construction
// ---------------------------------------------------------------------------

function buildProject(
  note: NoteSnapshot,
  title: string,
  properties: Record<string, unknown>,
): ParsedNote {
  const error = validateProjectFixedProperties(properties);
  if (error !== null) {
    return issue(note.path, error);
  }

  const project: ProjectRecord = {
    path: note.path,
    title,
    folderPath: folderOf(note.path),
    favorite: properties.favorite === true,
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

  const error = validateTaskFixedProperties(properties);
  if (error !== null) {
    return issue(note.path, error);
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

function buildNote(
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

  if (properties.created === undefined || properties.created === null) {
    return issue(
      note.path,
      "Falta la propiedad requerida 'created' (esperado 'YYYY-MM-DD').",
    );
  }
  const normalizedCreated = normalizeDateProp(properties.created);
  if (normalizedCreated === null) {
    return issue(
      note.path,
      `La propiedad 'created' debe ser una cadena de texto no vacía, se recibió: ${String(
        properties.created,
      )}.`,
    );
  }
  properties.created = normalizedCreated;

  const noteRecord: NoteRecord = {
    path: note.path,
    title,
    projectPath,
    properties,
  };
  return { kind: "note", note: noteRecord };
}

// ---------------------------------------------------------------------------
// Calendar event record construction
// ---------------------------------------------------------------------------

/**
 * Parse a `type: calendar-event` note into a `CalendarEventRecord`.
 *
 * Reglas (spec calendario mensual):
 *  - `kind` obligatorio; 4 valores fijos (`evento`, `reunion`,
 *    `fecha_limite`, `aviso`).
 *  - `date` obligatorio 'YYYY-MM-DD' y día real del calendario (el
 *    round-trip por `new Date` descarta valores como '2026-13-40' que
 *    JavaScript rueda). Acepta también el objeto `Date` que js-yaml
 *    produce en las fechas sin comillas (patrón Obsidian Properties).
 *  - `endDate` opcional, misma validación que `date`, nunca anterior a
 *    `date` (rango inclusivo `[date..endDate]`).
 *  - `allDay` default `true`; un valor no booleano es un issue.
 *  - `time` opcional 'HH:mm' 24h; se valida siempre pero solo llega al
 *    record cuando `allDay` es `false` (con `allDay: true` se ignora,
 *    la UI no lo envía).
 *  - `recurrence` default `none`; `recurrenceEnd` opcional 'YYYY-MM-DD'
 *    (solo tope de expansión: el dominio lo ignora si es anterior a
 *    `date`, no es issue).
 *  - `status` default `open` (misma semántica que tareas: `done` tacha).
 *  - `project` opcional: ausente = evento global (`projectPath`
 *    undefined); presente debe ser un wikilink `[[…]]` resoluble.
 *
 * Never throws: every failure mode is a `kind: "issue"` in Spanish.
 */
function buildCalendarEvent(
  note: NoteSnapshot,
  title: string,
  properties: Record<string, unknown>,
  resolveProject: ResolveProjectFn,
): ParsedNote {
  const kindRaw = properties.kind;
  if (kindRaw === undefined || kindRaw === null) {
    return issue(
      note.path,
      "Falta la propiedad requerida 'kind' (esperado 'evento', 'reunion', 'fecha_limite' o 'aviso').",
    );
  }
  if (typeof kindRaw !== "string" || !ALLOWED_CALENDAR_KINDS.has(kindRaw)) {
    return issue(
      note.path,
      `La propiedad 'kind' debe ser 'evento', 'reunion', 'fecha_limite' o 'aviso', se recibió: ${String(kindRaw)}.`,
    );
  }

  if (properties.date === undefined || properties.date === null) {
    return issue(
      note.path,
      "Falta la propiedad requerida 'date' (esperado 'YYYY-MM-DD').",
    );
  }
  const normalizedDate = normalizeCalendarDateProp(properties.date);
  if (normalizedDate === null) {
    return issue(
      note.path,
      `La propiedad 'date' debe ser una fecha 'YYYY-MM-DD' válida, se recibió: ${String(properties.date)}.`,
    );
  }
  properties.date = normalizedDate;

  let endDate: string | undefined;
  if (properties.endDate !== undefined && properties.endDate !== null) {
    const normalizedEnd = normalizeCalendarDateProp(properties.endDate);
    if (normalizedEnd === null) {
      return issue(
        note.path,
        `La propiedad 'endDate' debe ser una fecha 'YYYY-MM-DD' válida, se recibió: ${String(properties.endDate)}.`,
      );
    }
    // Fechas ISO en 'YYYY-MM-DD': el orden lexicográfico es el orden
    // cronológico.
    if (normalizedEnd < normalizedDate) {
      return issue(
        note.path,
        `La propiedad 'endDate' (${normalizedEnd}) no puede ser anterior a 'date' (${normalizedDate}).`,
      );
    }
    properties.endDate = normalizedEnd;
    endDate = normalizedEnd;
  }

  let allDay = true;
  const allDayRaw = properties.allDay;
  if (allDayRaw !== undefined && allDayRaw !== null) {
    if (typeof allDayRaw !== "boolean") {
      return issue(
        note.path,
        `La propiedad 'allDay' debe ser true o false, se recibió: ${String(allDayRaw)}.`,
      );
    }
    allDay = allDayRaw;
  }

  let time: string | undefined;
  const timeRaw = properties.time;
  if (timeRaw !== undefined && timeRaw !== null) {
    if (typeof timeRaw !== "string" || !TIME_REGEX.test(timeRaw)) {
      return issue(
        note.path,
        `La propiedad 'time' debe ser una hora 'HH:mm' en formato 24h, se recibió: ${String(timeRaw)}.`,
      );
    }
    if (!allDay) {
      time = timeRaw;
    }
  }

  let recurrence: CalendarRecurrence = "none";
  const recurrenceRaw = properties.recurrence;
  if (recurrenceRaw !== undefined && recurrenceRaw !== null) {
    if (
      typeof recurrenceRaw !== "string" ||
      !ALLOWED_CALENDAR_RECURRENCES.has(recurrenceRaw)
    ) {
      return issue(
        note.path,
        `La propiedad 'recurrence' debe ser 'none', 'daily', 'weekly', 'monthly' o 'yearly', se recibió: ${String(recurrenceRaw)}.`,
      );
    }
    recurrence = recurrenceRaw as CalendarRecurrence;
  }

  let recurrenceEnd: string | undefined;
  if (
    properties.recurrenceEnd !== undefined &&
    properties.recurrenceEnd !== null
  ) {
    const normalizedRecEnd = normalizeCalendarDateProp(
      properties.recurrenceEnd,
    );
    if (normalizedRecEnd === null) {
      return issue(
        note.path,
        `La propiedad 'recurrenceEnd' debe ser una fecha 'YYYY-MM-DD' válida, se recibió: ${String(properties.recurrenceEnd)}.`,
      );
    }
    properties.recurrenceEnd = normalizedRecEnd;
    recurrenceEnd = normalizedRecEnd;
  }

  let status: "open" | "done" = "open";
  const statusRaw = properties.status;
  if (statusRaw !== undefined && statusRaw !== null) {
    if (
      typeof statusRaw !== "string" ||
      !ALLOWED_TASK_STATUSES.has(statusRaw)
    ) {
      return issue(
        note.path,
        `La propiedad 'status' debe ser 'open' o 'done', se recibió: ${String(statusRaw)}.`,
      );
    }
    status = statusRaw as "open" | "done";
  }

  // project opcional: ausente = evento global; presente = wikilink
  // resoluble (mismos mensajes que tareas y notas).
  let projectPath: string | undefined;
  const projectLink = properties.project;
  if (projectLink !== undefined && projectLink !== null) {
    if (typeof projectLink !== "string") {
      return issue(
        note.path,
        `La propiedad 'project' debe ser un wikilink '[[…]]', se recibió: ${String(projectLink)}.`,
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
    projectPath = resolved.toLowerCase().endsWith(".md")
      ? resolved
      : `${resolved}.md`;
  }

  const event: CalendarEventRecord = {
    path: note.path,
    title,
    kind: kindRaw as CalendarKind,
    date: normalizedDate,
    allDay,
    recurrence,
    status,
    properties,
  };
  if (endDate !== undefined) event.endDate = endDate;
  if (time !== undefined) event.time = time;
  if (recurrenceEnd !== undefined) event.recurrenceEnd = recurrenceEnd;
  if (projectPath !== undefined) event.projectPath = projectPath;
  return { kind: "calendar-event", event };
}

// ---------------------------------------------------------------------------
// Fixed-property validators
// ---------------------------------------------------------------------------

/**
 * Return `null` when the project fixed-property bag is valid; otherwise
 * a Spanish error message describing the first violation encountered.
 */
function validateProjectFixedProperties(
  properties: Record<string, unknown>,
): string | null {
  const statusRaw = properties.status;
  if (statusRaw === undefined || statusRaw === null) {
    return "Falta la propiedad requerida 'status' (esperado 'active', 'on-hold' o 'done').";
  }
  if (
    typeof statusRaw !== "string" ||
    !ALLOWED_PROJECT_STATUSES.has(statusRaw)
  ) {
    return `La propiedad 'status' debe ser 'active', 'on-hold' o 'done', se recibió: ${String(
      statusRaw,
    )}.`;
  }

  if (properties.created === undefined || properties.created === null) {
    return "Falta la propiedad requerida 'created' (esperado 'YYYY-MM-DD').";
  }
  // 'created' acepta cadena no vacía o Date (js-yaml convierte
  // `created: 2026-01-15` sin comillas en un objeto Date; Obsidian
  // Properties escribe las fechas así). Normalizamos Date → 'YYYY-MM-DD'
  // para que el resto del dashboard siempre vea una cadena.
  const normalizedCreated = normalizeDateProp(properties.created);
  if (normalizedCreated === null) {
    return `La propiedad 'created' debe ser una cadena de texto no vacía, se recibió: ${String(
      properties.created,
    )}.`;
  }
  properties.created = normalizedCreated;

  if (!("tags" in properties)) {
    return "Falta la propiedad requerida 'tags'.";
  }
  if (!("description" in properties)) {
    return "Falta la propiedad requerida 'description'.";
  }
  if (!("client" in properties)) {
    return "Falta la propiedad requerida 'client'.";
  }

  return null;
}

/**
 * Return `null` when the task fixed-property bag is valid; otherwise a
 * Spanish error message describing the first violation encountered.
 * Assumes the wikilink and the status enum have already been validated
 * by `buildTask`; it focuses on `created`, `priority` and `due`.
 */
function validateTaskFixedProperties(
  properties: Record<string, unknown>,
): string | null {
  if (properties.created === undefined || properties.created === null) {
    return "Falta la propiedad requerida 'created' (esperado 'YYYY-MM-DD').";
  }
  const normalizedCreated = normalizeDateProp(properties.created);
  if (normalizedCreated === null) {
    return `La propiedad 'created' debe ser una cadena de texto no vacía, se recibió: ${String(
      properties.created,
    )}.`;
  }
  properties.created = normalizedCreated;

  const priorityRaw = properties.priority;
  if (priorityRaw === undefined || priorityRaw === null) {
    return "Falta la propiedad requerida 'priority' (esperado 'low', 'medium' o 'high').";
  }
  if (
    typeof priorityRaw !== "string" ||
    !ALLOWED_TASK_PRIORITIES.has(priorityRaw)
  ) {
    return `La propiedad 'priority' debe ser 'low', 'medium' o 'high', se recibió: ${String(
      priorityRaw,
    )}.`;
  }

  if ("due" in properties && properties.due !== undefined && properties.due !== null) {
    const due = properties.due;
    if (due instanceof Date) {
      const normalizedDue = normalizeDateProp(due);
      if (normalizedDue === null) {
        return `La propiedad 'due' debe ser una fecha 'YYYY-MM-DD' válida o estar vacía, se recibió: ${String(due)}.`;
      }
      properties.due = normalizedDue;
    } else if (typeof due !== "string") {
      return `La propiedad 'due' debe ser una fecha 'YYYY-MM-DD' válida o estar vacía, se recibió: ${String(due)}.`;
    } else if (due.length > 0 && !DATE_REGEX.test(due)) {
      return `La propiedad 'due' debe ser una fecha 'YYYY-MM-DD' válida o estar vacía, se recibió: ${due}.`;
    }
  }

  return null;
}

/**
 * Normaliza un valor de fecha del frontmatter a 'YYYY-MM-DD'.
 *
 * Acepta cadenas no vacías tal cual y objetos `Date` válidos (js-yaml
 * convierte `created: 2026-01-15` sin comillas en `Date`; Obsidian
 * Properties escribe las fechas así). Devuelve `null` cuando el valor
 * no es una fecha utilizable (cadena vacía, `Date` inválido u otro tipo).
 */
function normalizeDateProp(value: unknown): string | null {
  if (typeof value === "string") {
    return value.length === 0 ? null : value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    return formatDateUTC(value);
  }
  return null;
}

/**
 * Normaliza un valor de fecha del frontmatter de calendario a
 * 'YYYY-MM-DD' EXACTO: acepta cadenas y objetos `Date` (vía
 * `normalizeDateProp`) pero además exige que la cadena marque un día
 * real del calendario. Devuelve `null` para todo lo demás, incluidos
 * los valores que `new Date` rueda en silencio ('2026-13-40' →
 * 2027-02-09) o malformados ('2026/11/04', 'not-a-date').
 */
function normalizeCalendarDateProp(value: unknown): string | null {
  const normalized = normalizeDateProp(value);
  if (normalized === null || !isValidIsoDateString(normalized)) {
    return null;
  }
  return normalized;
}

/**
 * True cuando `value` es 'YYYY-MM-DD' (DATE_REGEX) y el round-trip por
 * `new Date` local reproduce exactamente año, mes y día.
 */
function isValidIsoDateString(value: string): boolean {
  if (!DATE_REGEX.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

/**
 * Formatea un `Date` como 'YYYY-MM-DD' en UTC. Se usa UTC (y no la zona
 * local) porque js-yaml parsea `2026-01-15` como medianoche UTC; usar
 * getters locales desplazaría el día en zonas al oeste de Greenwich.
 */
function formatDateUTC(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * True when `v` is an `enc:v1:` blob with two non-empty segments after the
 * prefix. Full base64 validity is checked at decrypt time; the parser only
 * rejects the structurally broken values (truncated paste, wrong version).
 */
function isWellFormedBlob(v: string): boolean {
  const rest = v.slice(ENCRYPTED_PREFIX.length).split(":");
  return rest.length === 2 && rest[0].length > 0 && rest[1].length > 0;
}

/**
 * Validate a single credentials entry. Returns `null` when the entry
 * is well-formed; otherwise a Spanish error message mentioning the
 * entry index and the offending key.
 */
function validateCredentialEntry(
  entry: unknown,
  index: number,
): string | null {
  if (entry === null || entry === undefined || typeof entry !== "object" || Array.isArray(entry)) {
    return `Entrada ${index} de 'credentials': debe ser un objeto con 'service', 'user' y 'password'.`;
  }
  const record = entry as Record<string, unknown>;
  const service = record.service;
  if (typeof service !== "string" || service.length === 0) {
    return `Entrada ${index} de 'credentials': la propiedad 'service' debe ser una cadena de texto no vacía, se recibió: ${String(
      service,
    )}.`;
  }
  if (isEncryptedValue(service)) {
    return `Entrada ${index} de 'credentials': la propiedad 'service' debe estar en claro, sin cifrar (los nombres de servicio no se cifran).`;
  }
  for (const key of ["user", "password"] as const) {
    if (!(key in record) || record[key] === undefined || record[key] === null) {
      return `Entrada ${index} de 'credentials': falta la propiedad requerida '${key}'.`;
    }
    const value = record[key];
    if (typeof value !== "string" || value.length === 0) {
      return `Entrada ${index} de 'credentials': la propiedad '${key}' debe ser una cadena de texto no vacía, se recibió: ${String(
        value,
      )}.`;
    }
    // Encrypted values are opaque to the parser (decryption happens in the
    // view), but the shape must be well-formed or the entry is rejected.
    if (isEncryptedValue(value) && !isWellFormedBlob(value)) {
      return `Entrada ${index} de 'credentials': la propiedad '${key}' tiene un valor cifrado con formato inválido (esperado 'enc:v1:<iv>:<cipher>').`;
    }
  }
  if ("url" in record && record.url !== undefined && record.url !== null) {
    if (typeof record.url !== "string") {
      return `Entrada ${index} de 'credentials': la propiedad 'url' debe ser una cadena de texto, se recibió: ${String(
        record.url,
      )}.`;
    }
  }
  if ("notes" in record && record.notes !== undefined && record.notes !== null) {
    if (typeof record.notes !== "string") {
      return `Entrada ${index} de 'credentials': la propiedad 'notes' debe ser una cadena de texto, se recibió: ${String(
        record.notes,
      )}.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function basenameToTitle(basename: string): string {
  return basename.replace(/\.md$/i, "");
}

/**
 * Return the parent folder of a vault-relative path. The root folder
 * (no `/` in the path) is reported as an empty string. Copied locally
 * from `ProjectTaskRepository` because the parser module must remain
 * free of cross-module imports.
 */
function folderOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx < 0 ? "" : path.slice(0, idx);
}

function issue(path: string, message: string): ParsedNote {
  const entry: DashboardIssue = { path, message };
  return { kind: "issue", issue: entry };
}
