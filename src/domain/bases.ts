/**
 * Bases de Obsidian (`.base`) que el plugin siembra en la raíz de
 * `projectsFolder`. Sin imports de Obsidian: son YAML estático.
 *
 *  - `Proyectos.base`   — todos los proyectos (cards + tabla).
 *  - `Tareas.base`      — tareas del proyecto que la incrusta; cada hub
 *                         de proyecto lleva `![[Tareas.base]]`, donde
 *                         `this` es el propio hub.
 *  - `Credenciales.base` — una fila por proyecto con credenciales y su
 *                         número de entradas. Nunca muestra secretos.
 *  - `Calendario.base`  — todos los eventos `type: calendar-event`
 *                         ordenados por fecha.
 *
 * Viven juntas en `BASES_FOLDER` (carpeta propia en la raíz del vault)
 * para no ensuciar `projectsFolder`, donde cada subcarpeta es un proyecto.
 */

export const BASES_FOLDER = "Bases";

export const BASE_FILES: Record<string, string> = {
  "Proyectos.base": [
    "filters:",
    "  and:",
    "    - 'type == \"project\"'",
    "properties:",
    "  status:",
    "    displayName: Estado",
    "  favorite:",
    "    displayName: Favorito",
    "  created:",
    "    displayName: Creado",
    "views:",
    "  - type: cards",
    "    name: Proyectos",
    "    order:",
    "      - file.name",
    "      - status",
    "      - favorite",
    "      - description",
    "  - type: table",
    "    name: Tabla",
    "    order:",
    "      - file.name",
    "      - status",
    "      - favorite",
    "      - client",
    "      - created",
    "",
  ].join("\n"),

  "Tareas.base": [
    "filters:",
    "  and:",
    "    - 'type == \"task\"'",
    "    - 'file.hasLink(this.file)'",
    "properties:",
    "  status:",
    "    displayName: Estado",
    "  due:",
    "    displayName: Vence",
    "  priority:",
    "    displayName: Prioridad",
    "views:",
    "  - type: table",
    "    name: Tareas",
    "    groupBy:",
    "      property: status",
    "      direction: ASC",
    "    order:",
    "      - file.name",
    "      - status",
    "      - priority",
    "      - due",
    "",
  ].join("\n"),

  "Credenciales.base": [
    "filters:",
    "  and:",
    "    - 'type == \"credentials\"'",
    "formulas:",
    "  entradas: 'if(credentials, credentials.length, 0)'",
    "properties:",
    "  project:",
    "    displayName: Proyecto",
    "  formula.entradas:",
    "    displayName: Entradas",
    "views:",
    "  - type: table",
    "    name: Credenciales",
    "    order:",
    "      - project",
    "      - formula.entradas",
    "      - file.mtime",
    "",
  ].join("\n"),

  "Calendario.base": [
    "filters:",
    "  and:",
    "    - 'type == \"calendar-event\"'",
    "properties:",
    "  kind:",
    "    displayName: Tipo",
    "  date:",
    "    displayName: Fecha",
    "  endDate:",
    "    displayName: Hasta",
    "  time:",
    "    displayName: Hora",
    "  recurrence:",
    "    displayName: Repite",
    "  project:",
    "    displayName: Proyecto",
    "  status:",
    "    displayName: Estado",
    "views:",
    "  - type: table",
    "    name: Eventos",
    "    sort:",
    "      - property: date",
    "        direction: ASC",
    "    order:",
    "      - file.name",
    "      - kind",
    "      - date",
    "      - endDate",
    "      - time",
    "      - recurrence",
    "      - project",
    "      - status",
    "  - type: cards",
    "    name: Tarjetas",
    "    sort:",
    "      - property: date",
    "        direction: ASC",
    "    order:",
    "      - file.name",
    "      - kind",
    "      - date",
    "      - project",
    "",
  ].join("\n"),
};


/**
 * `Plantillas.base`: lista las plantillas de ambas carpetas configuradas
 * (proyecto/tarea/nota/credenciales y eventos). A diferencia de las demás
 * depende de los ajustes, así que se genera en vez de ser un literal.
 */
export function buildTemplatesBase(
  templatesFolder: string,
  calendarTemplatesFolder: string,
): string {
  const quote = (path: string): string => JSON.stringify(path);
  return [
    "filters:",
    "  or:",
    `    - 'file.inFolder(${quote(templatesFolder)})'`,
    `    - 'file.inFolder(${quote(calendarTemplatesFolder)})'`,
    "properties:",
    "  type:",
    "    displayName: Tipo",
    "  file.folder:",
    "    displayName: Carpeta",
    "views:",
    "  - type: table",
    "    name: Plantillas",
    "    order:",
    "      - file.name",
    "      - type",
    "      - file.folder",
    "      - file.mtime",
    "",
  ].join("\n");
}

export const TEMPLATES_BASE_FILE = "Plantillas.base";

/**
 * Bases listas para sembrar: los literales de `BASE_FILES` más
 * `Plantillas.base`, todas con las carpetas de plantillas excluidas del
 * filtro (una plantilla `type: credentials` o `type: project` no es una
 * credencial ni un proyecto real y duplicaría filas).
 */
export function buildBases(
  templatesFolder: string,
  calendarTemplatesFolder: string,
): Record<string, string> {
  const exclusions = [templatesFolder, calendarTemplatesFolder]
    .map((folder) => `    - '!file.inFolder(${JSON.stringify(folder)})'\n`)
    .join("");
  const bases: Record<string, string> = {};
  for (const [name, content] of Object.entries(BASE_FILES)) {
    bases[name] = content.replace("  and:\n", () => `  and:\n${exclusions}`);
  }
  bases[TEMPLATES_BASE_FILE] = buildTemplatesBase(
    templatesFolder,
    calendarTemplatesFolder,
  );
  return bases;
}
