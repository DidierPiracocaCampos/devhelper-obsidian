# Plan de implementación: Estructura de carpetas por proyecto, plantillas y credenciales (V2)

> **Para trabajadores agénticos:** SUB-SKILL OBLIGATORIO: Usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan sintaxis de casilla (`- [ ]`) para el seguimiento.

**Objetivo:** Pasar de la estructura plana de la V1 a una carpeta autocontenida por proyecto (nota hub + `Credenciales.md` + `Tareas/` + `Archivos/`) con plantillas editables sembradas en el vault y validación estricta de properties fijas.

**Arquitectura:** El dominio gana un módulo puro de plantillas (`templates.ts`) y validaciones nuevas en `parseNote.ts`. El `VaultAdapter` gana tres operaciones de carpeta. El repositorio rehace su escaneo (subcarpetas = proyectos) y sus mutaciones (estructura completa al crear, renombrado nota→carpeta→props, reasignación con movimiento de archivo). La UI sólo se adapta: ajustes con `templatesFolder` e indicador de `status` en los chips.

**Stack tecnológico:** TypeScript, Obsidian Plugin API, esbuild, Vitest, `js-yaml`; DOM nativo y variables de tema de Obsidian, sin framework de UI.

**Spec:** `docs/superpowers/specs/2026-10-17-projects-structure-design.md`

## Restricciones globales

- Las notas Markdown son la única fuente de verdad; `data.json` sólo guarda `projectsFolder` y `templatesFolder`.
- Properties fijas — proyecto: `type`, `status` (`active|on-hold|done`), `created`, `tags`, `description`, `client`. Tarea: `type`, `project` (wikilink), `status` (`open|done`), `created`, `due`, `priority` (`low|medium|high`). Credenciales: `type`, `credentials` (lista; cada entrada exige `service`+`user`+`password`; `url` y `notes` opcionales; campos extra preservados).
- La property `project` de la tarea es la fuente de verdad de la relación (es lo que enlaza en el grafo); la carpeta `Tareas/` es sólo la ubicación física y no se valida contra el wikilink.
- Nombres fijos en español: `Tareas/`, `Archivos/`, `Credenciales.md`; la nota hub se llama exactamente como su carpeta. `templatesFolder` (por defecto `Projects/_templates`) queda excluida del escaneo.
- Las plantillas se siembran en cada arranque sólo si faltan; nunca se sobrescriben. Una plantilla sin property fija genera issue y bloquea la creación de ese tipo.
- Toda mutación es atómica por property vía `processFrontMatter`; prohibido leer y reescribir archivos completos; se preservan el cuerpo y las properties del usuario.
- Sanitización heredada de la V1 (también para carpetas): `\ / : * ? " < > |` y `#` → `-`, colapso de `-` repetidos, trim de `.`/espacios, vacío → `Untitled`, sufijos ` 2`, ` 3`, … ante colisión.
- Ruptura limpia con la V1: sin migración; las notas planas antiguas generan un issue explicativo.
- Sin borrado: no se crean métodos `delete*`; la papelera sigue decorativa y deshabilitada.
- Todo el texto nuevo de UI, issues y mensajes de error en español.
- Tras cada tarea: `npm run typecheck` y `npm test` en verde antes del commit.

## Foco de revisión

- Plantilla borrada o rota a mano por el usuario: `load()` debe sembrar sólo las ausentes y reportar las inválidas como issue sin tumbar el dashboard → tests `seedsOnlyMissingTemplates()` y `reportsInvalidTemplate()` (Tarea 5).
- `renameProject` con auto-link-update de Obsidian desactivado: las props `project` de las tareas deben actualizarse usando las rutas NUEVAS tras el renombrado de carpeta (los paths viejos quedan obsoletos) → test `renamingProjectUpdatesLinkedTasksAtNewPaths()` (Tarea 6).
- Carpeta renombrada a mano en Obsidian (la nota hub ya no coincide con el nombre de la carpeta): debe aparecer el issue de «carpeta sin nota hub», no un fallo → test `reportsFolderWithoutMatchingHub()` (Tarea 5).
- Entrada de credenciales con campos extra desconocidos: se preservan en el registro parseado → test `preservesExtraCredentialFields()` (Tarea 3).
- Tarea físicamente en `Tareas/` de B pero con wikilink al proyecto A: pertenece a A y no genera issue → test `taskLocationDoesNotOverrideWikilink()` (Tarea 5).
- `templatesFolder` dentro de `projectsFolder` no debe aparecer jamás como proyecto (sus plantillas llevan `type:` de andamiaje) → test `excludesTemplatesFolderFromScan()` (Tarea 5).

---

## Mapa de archivos

- `src/settings.ts`, `src/ui/SettingsTab.ts`: ajustes `projectsFolder` + `templatesFolder` y su UI.
- `src/domain/frontmatter.ts` *(nuevo)*: slicing de frontmatter compartido por `parseNote.ts` y `templates.ts`.
- `src/domain/templates.ts` *(nuevo)*: plantillas por defecto, properties fijas, validación y aplicación de plantillas; sin imports de Obsidian.
- `src/domain/types.ts`: `ProjectRecord.folderPath`, `CredentialEntry`, `ParsedCredentialsNote`, `CredentialsRecord`, `DashboardData.credentials`, variante `ParsedNote` de credenciales.
- `src/domain/parseNote.ts`: validación de properties fijas y valores (`status`/`priority`/`due`) y parseo de `type: credentials`.
- `src/data/VaultAdapter.ts`, `src/data/ObsidianVaultAdapter.ts`: operaciones de carpeta nuevas.
- `src/data/ProjectTaskRepository.ts`: escaneo V2, semilla de plantillas, mutaciones V2.
- `src/main.ts`: wiring de ajustes (merge con defaults; la clave vieja `tasksFolder` queda ignorada).
- `src/ui/DashboardView.ts`: indicador de `status` en chips; placeholders intactos.
- `styles.css`: clases del indicador de estado del proyecto.
- `tests/templates.test.ts` *(nuevo)*, `tests/settings.test.ts`, `tests/parseNote.test.ts`, `tests/ProjectTaskRepository.test.ts`: suites actualizadas; el `VaultAdapter` falso gana árbol de carpetas en memoria.

## Tarea 1: Ajustes `projectsFolder` + `templatesFolder`

**Archivos:** Modificar `src/settings.ts`, `src/ui/SettingsTab.ts` y `tests/settings.test.ts`.

**Interfaces:** `PluginSettings` pasa a `{ projectsFolder: string; templatesFolder: string }`. `DEFAULT_SETTINGS` es `{ projectsFolder: "Projects", templatesFolder: "Projects/_templates" }`. `normalizeVaultFolderPath(path: string, fallback: string): string` se reutiliza sin cambios para ambas rutas. La clave antigua `tasksFolder` en un `data.json` viejo se ignora (merge con defaults; nadie la lee).

- [ ] Actualizar `tests/settings.test.ts`: los defaults esperados son `Projects` y `Projects/_templates`; renombrar los tests que mencionen `tasksFolder`.
- [ ] Ejecutar `npm test -- tests/settings.test.ts` y verificar que falla.
- [ ] Cambiar `PluginSettings` y `DEFAULT_SETTINGS` en `src/settings.ts`.
- [ ] En `src/ui/SettingsTab.ts`, sustituir el campo `tasksFolder` por `templatesFolder` (etiqueta «Carpeta de plantillas», descripción que mencione el default `Projects/_templates`).
- [ ] Ejecutar `npm test -- tests/settings.test.ts` y `npm run typecheck`.

Esperado: tests de ajustes en verde; ninguna referencia a `tasksFolder` fuera de notas históricas en `docs/`.

- [ ] Commit como `feat: sustituir tasksFolder por templatesFolder en ajustes`.

## Tarea 2: Módulo puro de plantillas (`templates.ts` + `frontmatter.ts`)

**Archivos:** Crear `src/domain/frontmatter.ts`, `src/domain/templates.ts` y `tests/templates.test.ts`; modificar `src/domain/parseNote.ts` sólo para importar el slicer extraído (sus 12 tests actuales deben seguir en verde sin tocarlos).

**Interfaces:**

```ts
// frontmatter.ts
export type SlicedFrontmatter =
  | { kind: "ok"; yaml: string; body: string }
  | { kind: "missing" }
  | { kind: "unclosed" };
export function sliceFrontmatter(content: string): SlicedFrontmatter;
```

```ts
// templates.ts
export type TemplateKind = "project" | "task" | "credentials";
export const TEMPLATE_FILE_NAMES: Record<TemplateKind, string>;
//   project → "proyecto.md", task → "tarea.md", credentials → "credenciales.md"
export const FIXED_TEMPLATE_PROPERTIES: Record<TemplateKind, string[]>;
//   project → ["type","status","created","tags","description","client"]
//   task → ["type","project","status","created","due","priority"]
//   credentials → ["type","credentials"]
export const DEFAULT_TEMPLATE_CONTENT: Record<TemplateKind, string>;
export function validateTemplate(content: string, kind: TemplateKind): string | null;
export interface TemplateValues { title: string; today: string; projectLink?: string }
export function applyTemplate(content: string, kind: TemplateKind, values: TemplateValues): string;
export function todayStamp(now?: Date): string; // "YYYY-MM-DD" en hora local
```

Contenido sembrado exacto (termina en `---\n`, cuerpo vacío):

- `proyecto.md`: `---\ntype: project\nstatus: active\ncreated: 1970-01-01\ntags: []\ndescription:\nclient:\n---\n`
- `tarea.md`: `---\ntype: task\nproject: "[[Proyecto]]"\nstatus: open\ncreated: 1970-01-01\ndue:\npriority: medium\n---\n`
- `credenciales.md`: `---\ntype: credentials\ncredentials: []\n---\n`

`validateTemplate` devuelve `null` si es válida; si no, un mensaje en español: frontmatter ausente/roto/YAML inválido, `type` distinto del del kind, o `La plantilla '<archivo>' no tiene la propiedad fija '<key>'.` `applyTemplate` parsea el frontmatter con `js-yaml`, pisa `created` con `values.today` (project y task), pisa `project` con `values.projectLink` (task, cuando se pasa), y reensambla `---\n` + `yaml.dump` + `---\n` + cuerpo original tal cual; para `credentials` devuelve el contenido sin cambios. Las properties extra del usuario en la plantilla sobreviven porque se muta el objeto parseado.

- [ ] Escribir `tests/templates.test.ts`: `seededTemplatesAreValid()` (los tres defaults pasan `validateTemplate`), `validateTemplateDetectsMissingFixedProperty()`, `validateTemplateDetectsBrokenYaml()`, `validateTemplateDetectsWrongType()`, `applyTemplateSetsCreatedAndPreservesBody()`, `applyTemplateSetsProjectLink()` (assert sobre el valor re-parseado, no sobre la serialización), `applyTemplatePreservesCustomProperties()`, `todayStampFormat()` (`/^\d{4}-\d{2}-\d{2}$/`).
- [ ] Ejecutar `npm test -- tests/templates.test.ts` y verificar que falla.
- [ ] Extraer el slicing de `parseNote.ts` a `src/domain/frontmatter.ts` (mismas reglas: `---` en la primera línea, CRFL→LF, cuerpo devuelto intacto) e importarlo en `parseNote.ts`.
- [ ] Implementar `src/domain/templates.ts`.
- [ ] Ejecutar `npm test -- tests/templates.test.ts`, `npm test` y `npm run typecheck`.

Esperado: suite completa en verde, incluidos los tests de `parseNote` sin modificar.

- [ ] Commit como `feat: añadir módulo de plantillas del dominio`.

## Tarea 3: Tipos y parser con credenciales y validaciones V2

**Archivos:** Modificar `src/domain/types.ts`, `src/domain/parseNote.ts` y `tests/parseNote.test.ts`.

**Interfaces:**

```ts
// types.ts
export interface ProjectRecord { path: string; title: string; folderPath: string; properties: Record<string, unknown>; }
export interface CredentialEntry { service: string; user: string; password: string; url?: string; notes?: string; [extra: string]: unknown; }
export interface ParsedCredentialsNote { path: string; entries: CredentialEntry[]; }
export interface CredentialsRecord extends ParsedCredentialsNote { projectPath: string; }
export interface DashboardData { projects: ProjectRecord[]; tasks: TaskRecord[]; credentials: CredentialsRecord[]; issues: DashboardIssue[]; }
export type ParsedNote =
  | { kind: "project"; project: ProjectRecord }
  | { kind: "task"; task: TaskRecord }
  | { kind: "credentials"; credentials: ParsedCredentialsNote }
  | { kind: "issue"; issue: DashboardIssue };
```

`parseProjectTaskNote(note, resolveProject)` mantiene su firma. El parser fija `folderPath` como el directorio padre de `note.path`. Validaciones nuevas — proyecto: `status` ∈ `{active, on-hold, done}` y presencia de `created`, `tags`, `description`, `client`. Tarea: presencia de `created` y `priority` ∈ `{low, medium, high}`; `due`, si es cadena no vacía, debe cumplir `/^\d{4}-\d{2}-\d{2}$/`. Credenciales: `credentials` debe ser lista; cada entrada debe ser objeto con `service`, `user` y `password` como cadenas no vacías (un fallo en cualquier entrada → un solo issue para la nota, mencionando el índice de la entrada). El mensaje de tipo desconocido pasa a `esperado 'project', 'task' o 'credentials'`.

- [ ] Escribir los tests nuevos en `tests/parseNote.test.ts`: `parsesValidProjectV2()` (con las seis fijas), `reportsInvalidProjectStatus()`, `reportsMissingProjectFixedProperty()`, `reportsInvalidTaskPriority()`, `reportsInvalidTaskDue()`, `parsesValidCredentials()`, `reportsCredentialEntryMissingField()`, `preservesExtraCredentialFields()`, `reportsCredentialsNotAList()`; actualizar los tests existentes de proyecto/tarea válidos para incluir las fijas nuevas.
- [ ] Ejecutar `npm test -- tests/parseNote.test.ts` y verificar que falla.
- [ ] Implementar las validaciones y la variante `credentials` en `src/domain/parseNote.ts` y los tipos en `src/domain/types.ts`.
- [ ] Mantener el typecheck en verde entre tareas: añadir `credentials: []` a los fixtures de `DashboardData` en `tests/presentDashboard.test.ts` y al agregado que devuelve `load()` en `src/data/ProjectTaskRepository.ts` (provisional hasta la Tarea 5, que lo llena de verdad).
- [ ] Ejecutar `npm test -- tests/parseNote.test.ts`, `npm test` y `npm run typecheck`.

Esperado: cada entrada inválida produce su issue específico en español; los campos extra de credenciales y las properties personalizadas se conservan.

- [ ] Commit como `feat: validar properties fijas V2 y parsear credenciales`.

## Tarea 4: Operaciones de carpeta en el VaultAdapter

**Archivos:** Modificar `src/data/VaultAdapter.ts`, `src/data/ObsidianVaultAdapter.ts` y el `VaultAdapter` falso de `tests/ProjectTaskRepository.test.ts`.

**Interfaces:** El interface `VaultAdapter` gana tres métodos:

```ts
listSubfolders(folderPath: string): string[];      // rutas vault-relative de las subcarpetas directas
exists(path: string): boolean;                     // true si existe archivo o carpeta en esa ruta
renameFolder(folderPath: string, newPath: string): Promise<void>;
```

`ObsidianVaultAdapter` los implementa con `vault.getAbstractFileByPath` + `TFolder` (listar hijos carpeta, comprobar existencia de archivo o carpeta) y `fileManager.renameFile(folder, newPath)` (acepta `TFolder` y mueve todo el contenido). El falso en memoria gana un árbol de carpetas: `createFolder` registra la ruta, `listSubfolders` devuelve las carpetas hijas directas, `exists` consulta archivos y carpetas, `renameFolder` mueve el subárbol completo (carpetas y archivos cuyo path empiece por `folderPath + "/"`).

- [ ] Extender el interface `VaultAdapter` y la implementación de Obsidian con los tres métodos.
- [ ] Extender el falso en memoria con el árbol de carpetas y las tres operaciones (movimiento de subárbol incluido).
- [ ] Ejecutar `npm test` y `npm run typecheck`.

Esperado: la suite existente sigue en verde (el repositorio aún no usa los métodos nuevos); typecheck limpio.

- [ ] Commit como `feat: añadir operaciones de carpeta al adaptador de vault`.

## Tarea 5: Escaneo V2 del repositorio y semilla de plantillas

**Archivos:** Modificar `src/data/ProjectTaskRepository.ts` y `tests/ProjectTaskRepository.test.ts`.

**Interfaces:** `load(): Promise<DashboardData>` ahora devuelve también `credentials`. Consume de la Tarea 2: `TEMPLATE_FILE_NAMES`, `FIXED_TEMPLATE_PROPERTIES`, `DEFAULT_TEMPLATE_CONTENT`, `validateTemplate`, `TemplateKind`. Consume de la Tarea 4: `listSubfolders`, `exists`. Produce para la Tarea 6: helpers privados `seedTemplates(): Promise<void>` y `templateIssue(kind: TemplateKind): Promise<string | null>` (lee y valida la plantilla; devuelve el mensaje o `null`).

Comportamiento de `load()`:

1. `createFolder(projectsFolder)` y semilla: para cada `TemplateKind`, si `!exists(templatesFolder + "/" + TEMPLATE_FILE_NAMES[kind])` → crear con `DEFAULT_TEMPLATE_CONTENT[kind]`.
2. Validar las tres plantillas; cada una inválida añade un issue con la ruta de la plantilla.
3. `listMarkdownFiles(projectsFolder)` → cada nota suelta genera el issue: `Nota suelta de la estructura V1: mueve '<basename>' a la carpeta de su proyecto.`
4. `listSubfolders(projectsFolder)` menos `templatesFolder` (comparación de rutas normalizadas) → para cada carpeta `<F>`: si `!exists(<F>/<nombreDeF>.md)` → issue `La carpeta '<nombreDeF>' no contiene su nota hub '<nombreDeF>.md'.` Si existe, leer y parsear: `kind: "project"` → `ProjectRecord`; `kind: "issue"` → issue tal cual; otro `kind` → issue `La nota hub de '<nombreDeF>' debe ser de tipo 'project'.`
5. Por cada proyecto válido: `listMarkdownFiles(<F> + "/Tareas")` → parsear cada nota (`kind: "task"` → `TaskRecord`; `kind: "issue"` → issue; `kind: "project"` → issue `Nota de proyecto fuera de lugar: sólo la nota hub de cada carpeta puede ser 'type: project'.`; `kind: "credentials"` → ignorar). Si existe `<F>/Credenciales.md` → parsear (`kind: "credentials"` → `CredentialsRecord` con `projectPath` = ruta de la nota hub; `kind: "issue"` → issue; otro `kind` → issue `'Credenciales.md' del proyecto '<título>' debe ser de tipo 'credentials'.`)
6. `Archivos/` y cualquier nivel por debajo de los hijos directos de `Tareas/` no se listan jamás.

- [ ] Escribir los tests: `seedsOnlyMissingTemplates()`, `reportsInvalidTemplate()`, `excludesTemplatesFolderFromScan()`, `reportsStrayV1Note()`, `reportsFolderWithoutMatchingHub()`, `loadsProjectTreeWithTasksAndCredentials()`, `missingCredentialsNoteIsNotAnIssue()`, `missingSubfoldersAreTolerated()`, `taskLocationDoesNotOverrideWikilink()`, `hubWithWrongTypeIsAnIssue()`, `invalidCredentialEntrySurfacesIssue()`.
- [ ] Ejecutar `npm test -- tests/ProjectTaskRepository.test.ts` y verificar que fallan.
- [ ] Reescribir `load()` con el flujo de arriba (los tests V1 de escaneo plano que ya no aplican se reescriben contra el árbol V2; los de validación por nota se conservan adaptando rutas).
- [ ] Ejecutar `npm test -- tests/ProjectTaskRepository.test.ts`, `npm test` y `npm run typecheck`.

Esperado: escaneo V2 completo con aislamiento de issues por nota; plantillas sembradas sin sobrescribir.

- [ ] Commit como `feat: escanear la estructura de carpetas por proyecto y sembrar plantillas`.

## Tarea 6: Mutaciones V2 del repositorio

**Archivos:** Modificar `src/data/ProjectTaskRepository.ts` y `tests/ProjectTaskRepository.test.ts`.

**Interfaces:** Firmas públicas sin cambios respecto a la V1, todas `Promise<void>`: `createProject(title)`, `createTask(title, projectPath)`, `renameProject(path, title)`, `renameTask(path, title)`, `reassignTask(path, projectPath)`, `setTaskStatus(path, status)`. Nuevo comportamiento: `createProject` y `createTask` **lanzan `Error`** con el mensaje de `templateIssue` cuando su plantilla es inválida (bloqueo de creación). El wikilink de proyecto se construye como la V1: `"[[" + <ruta de la nota hub sin ".md"> + "]]"`. Se reutilizan los helpers privados de sanitización y desambiguación de la V1, aplicándolos también a nombres de carpeta.

Comportamientos:

- `createProject(title)`: sanitizar y desambiguar el nombre de carpeta (`exists`); `createFolder` de `<F>`, `<F>/Tareas` y `<F>/Archivos`; escribir la nota hub con `applyTemplate(plantillaProyecto, "project", { title, today: todayStamp() })` en `<F>/<nombre>.md` y `Credenciales.md` con la plantilla de credenciales.
- `createTask(title, projectPath)`: `folderPath` = directorio padre de `projectPath`; sanitizar y desambiguar dentro de `<folderPath>/Tareas`; escribir con `applyTemplate(plantillaTarea, "task", { title, today, projectLink })`.
- `renameProject(path, title)`: si el título sanitizado coincide con el actual, no-op. Secuencia obligatoria: (1) renombrar la nota hub al nuevo basename dentro de la misma carpeta; (2) `renameFolder` al nuevo nombre (desambiguado si existe); (3) para cada tarea cuyo `projectPath` era la ruta antigua, llamar a `processFrontMatter` con un ref de la ruta NUEVA (prefijo de carpeta sustituido) poniendo `project` al nuevo wikilink.
- `renameTask(path, title)`: renombrar dentro de su `Tareas/` (comportamiento V1).
- `reassignTask(path, projectPath)`: primero `processFrontMatter` con el nuevo wikilink, después `rename` del archivo a `<nuevoFolder>/Tareas/<basename>` (basename desambiguado si colisiona).
- `setTaskStatus`: sin cambios.

- [ ] Escribir los tests: `createProjectCreatesFullStructure()` (carpeta, subcarpetas, hub con las seis fijas y `created` de hoy, `Credenciales.md`), `createProjectAppliesCustomTemplateProperties()`, `createProjectBlockedByInvalidTemplate()` (lanza `Error` con el mensaje de la plantilla), `createTaskWritesIntoProjectTasksFolder()` (wikilink correcto, `priority: medium` por defecto), `renamingProjectUpdatesLinkedTasksAtNewPaths()`, `renameProjectDisambiguatesExistingFolder()`, `reassignTaskMovesFileAndUpdatesLink()`, `createTaskBlockedByInvalidTemplate()`; conservar los tests V1 de sanitización, preservación de cuerpo/properties y `setTaskStatus` adaptando rutas.
- [ ] Ejecutar `npm test -- tests/ProjectTaskRepository.test.ts` y verificar que fallan.
- [ ] Implementar las seis mutaciones con los comportamientos de arriba, enrutando todo cambio de property por `processFrontMatter`.
- [ ] Ejecutar `npm test`, `npm run typecheck` y `npm run build`.

Esperado: suite completa en verde; ninguna mutación reescribe archivos completos ni toca properties ajenas.

- [ ] Commit como `feat: crear, renombrar y reasignar proyectos y tareas en la estructura V2`.

## Tarea 7: Cableado en `main.ts`, DashboardView y estilos

**Archivos:** Modificar `src/main.ts`, `src/ui/DashboardView.ts` y `styles.css`.

**Interfaces:** `main.ts` sigue construyendo `ProjectTaskRepository(adapter, settings, resolveProject?)`; el merge de ajustes es `Object.assign({}, DEFAULT_SETTINGS, await this.loadData())`. `DashboardView.refresh()` consume `DashboardData` con `credentials` (la vista las ignora de momento).

- [ ] En `main.ts`, eliminar cualquier referencia a `tasksFolder` (la creación de carpetas al arranque la hace ahora `load()` del repositorio).
- [ ] En `DashboardView.renderProjectChips`, añadir al chip un indicador de `status` del proyecto: elemento con clase `devhelper-project-status devhelper-project-status--<active|on-hold|done>` y `aria-label` con el estado en español («Activo», «En pausa», «Terminado»).
- [ ] En `styles.css`, estilar el indicador como punto de 8 px con variables de Obsidian (p.ej. `var(--color-green)`/`var(--color-yellow)`/`var(--color-base-50)`), visible en ambos breakpoints sin desplazar el título del chip.
- [ ] Verificar que las secciones Archivos y Contraseña siguen placeholder inertes y la papelera deshabilitada.
- [ ] Ejecutar `npm run typecheck`, `npm test` y `npm run build`.

Esperado: todo en verde; `main.js` emitido.

- [ ] Commit como `feat: adaptar el dashboard y los ajustes a la estructura V2`.

## Tarea 8: Verificación integral en el vault de prueba

**Archivos:** Ninguno del repo salvo correcciones; se recrea `D:\proyects\devhelper-test-vault\` (no se commitea).

- [ ] Ejecutar `npm run typecheck`, `npm test` y `npm run build`; suite completa en verde.
- [ ] Borrar y recrear `D:\proyects\devhelper-test-vault\`, copiar `main.js`, `manifest.json` y `styles.css` a `.obsidian/plugins/devhelper-dashboard/` y abrir el vault.
- [ ] Recorrer manualmente los criterios de aceptación del spec (1–9): semilla de plantillas, creación de proyecto con estructura completa, creación de tarea con enlace en el grafo, renombrado de proyecto con enlaces actualizados (con «Actualizar enlaces automáticamente» de Obsidian desactivado), reasignación con movimiento de archivo, edición de plantilla (añadir property → aparece; quitar fija → issue + bloqueo), nota suelta V1 → issue, credenciales incompletas → issue, preservación de cuerpo y properties personalizadas.
- [ ] Anotar cualquier desviación y corregirla en su módulo (bug → test que lo reproduce primero, después el fix).

Esperado: los 9 criterios de aceptación verificados a mano; si hubo fixes, `npm test` sigue en verde.

- [ ] Commit de cierre sólo si hubo correcciones, como `fix: <descripción>`.
