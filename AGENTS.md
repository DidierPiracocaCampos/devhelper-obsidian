# AGENTS.md

Notas operativas para agentes de IA trabajando en este repositorio. OpenCode, Claude Code y
otros harnesses deberían leer este archivo al iniciar.

## Qué es este repo

Plugin de Obsidian escrito en TypeScript: **DevHelper Dashboard**. Presenta proyectos y
tareas respaldados por notas Markdown (`type: project`, `type: task`, `project: "[[…]]"`,
`status: open|done`) en una vista propia del plugin.

Estado: **V3 entregada** (favoritos + vista «Todos»). V1 (`0df6689` → 8 commits), V2
(`→ 13a4109`, 8 commits) y V3 (`→ c713c09`, 5 commits sobre `master`) están en `master`.
92 tests pasan, `main.js` se construye, `manifest.json` y `styles.css` están listos para
instalarse.

## Comandos

```bash
npm install              # instala dependencias (genera package-lock.json)
npm run dev              # esbuild en watch + sourcemap inline
npm run build            # bundle de producción a main.js (minificado)
npm run typecheck        # tsc --noEmit
npm test                 # vitest run (suite completa)
npm test -- tests/<f>    # suite individual
```

Después de cualquier cambio, ejecuta **typecheck + test + build** antes de comprometer.

## Layout del código

- `src/main.ts` — entrypoint; exporta `DevHelperDashboardPlugin` como default.
  Carga settings, instancia `ProjectTaskRepository` con `ObsidianVaultAdapter`,
  registra vista, comando `open-dashboard`, ribbon (`layout-dashboard`), settings tab
  y listeners `vault.on('create|modify|delete|rename')` + `metadataCache.on('changed')`
  con debounce de 250 ms. `onunload` cancela el timer pendiente.
- `src/settings.ts` — `PluginSettings`, `DEFAULT_SETTINGS = { projectsFolder: "Projects",
  templatesFolder: "Projects/_templates" }`, y `normalizeVaultFolderPath(path, fallback): string`. La
  normalización RECHAZA rutas absolutas, letras de unidad y `..` ANTES de trim barras.
- `src/ui/SettingsTab.ts` — `PluginSettingTab` con dos `TextComponent`, persiste vía
  `plugin.saveData()`.
- `src/domain/types.ts` — interfaces puras: `ProjectRecord` (incluye `favorite: boolean`
  que el frontmatter expone como chip visible en la fila de favoritos), `TaskRecord`,
  `DashboardIssue`, `DashboardData`, `NoteSnapshot`, `ParsedNote`, `ResolveProjectFn`.
- `src/domain/parseNote.ts` — `parseProjectTaskNote(note, resolveProject): ParsedNote`.
  Devuelve siempre un `ParsedNote` discriminado; **nunca lanza**. Errores → `kind: "issue"`.
  Usa `js-yaml.load` y la portada `---` debe ser la PRIMERA línea.
- `src/domain/presentDashboard.ts` — `presentDashboard(data, selection)` con
  `DashboardSelection` discriminado (`{ kind: "all" }` o `{ kind: "project"; path }`).
  Orden determinista: proyectos por `title` asc case-insensitive con desempate `path`;
  tareas por `status` (`open` antes que `done`) y luego título. Modo «all»: `selectedProject`
  es `null`, `showAll` es `true` y se listan todas las tareas. Fallback: si la selección
  pide un proyecto inexistente o no hay proyectos, se cae a `{ kind: "all" }` para
  garantizar que el panel nunca quede vacío.
- `src/domain/weekStrip.ts` — función pura `getWeekStrip(today: Date): WeekStrip`;
  sin imports de Obsidian; calcula la semana ISO (Lun–Dom) de una fecha y el nombre
  del mes en español.
- `src/data/VaultAdapter.ts` — interface pura (`VaultNoteRef`, 10 métodos:
  `listMarkdownFiles`, `read`, `createFolder`, `createMarkdown`, `rename`,
  `processFrontMatter`, `resolveLink`, `listSubfolders`, `exists`, `renameFolder`).
- `src/data/ObsidianVaultAdapter.ts` — única con `import "obsidian"`. `createFolder` crea
  cada nivel por separado (Obsidian sólo crea uno). `processFrontMatter` usa
  `app.fileManager.processFrontMatter`. `rename` devuelve ref del nuevo path.
- `src/data/ProjectTaskRepository.ts` — escanea carpetas configuradas, llama al parser,
  expone siete mutaciones (`createProject`, `createTask`, `renameProject`, `renameTask`,
  `reassignTask`, `setTaskStatus`, `setProjectFavorite`). `createProject(title)` devuelve
  **`Promise<string>`** con el *hub path* del proyecto recién creado (la carpeta
  `Projects/<slug>/` que la vista usa para promoverlo a favorito y seleccionarlo).
  El resto de mutaciones devuelven **`Promise<void>`**. `renameProject` actualiza la
  prop `project` de las tareas afectadas aunque Obsidian tenga auto-link-update
  desactivado (lee la nota raw, parsea con `js-yaml`, compara, y reescribe sólo esa
  prop con `processFrontMatter`). `setProjectFavorite(path, favorite)` opera sólo sobre
  la prop `favorite` y nunca toca el cuerpo ni otras props.
- `src/ui/DashboardView.ts` — `ItemView`
  (`VIEW_TYPE_DEVHELPER_DASHBOARD = "devhelper-dashboard"`).
  `selection: DashboardSelection` vive aquí (en memoria, nunca persistido), inicial
  `{ kind: "all" }` para que el dashboard siempre abra mostrando «Todos».
  Cada `refresh()` re-llama `repository.load()` + `presentDashboard` y reescribe
  `this.selection` con el resultado del presenter (cubriendo el fallback a «all»);
  **no hay snapshot en memoria**. La fila de chips se compone como «Todos» +
  favoritos (filtrados por `data.projects.filter(p => p.favorite)` y ordenados con
  el mismo comparador del presenter) + un chip final «+» que abre el picker. El
  menú contextual del botón derecho sobre cada chip de favorito expone tres
  opciones: «Abrir nota», «Abrir carpeta» y «Quitar de mis favoritos». En modo
  «Todos» cada tarjeta de tarea muestra un *badge* con el nombre del proyecto al
  que pertenece. `openProjectFolder(folderPath)` intenta la API interna de Obsidian
  y, si falla, lanza un `Notice` descriptivo como degradación elegante. El render
  se organiza en métodos `renderTopBar`, `renderProjectChips`, `renderTasksPanel`,
  `renderTaskCard`, `renderEmptyState`, `renderSideColumn` (rail + calendario),
  `renderBottomSections` (Archivos + Contraseña) y `renderIssues`. Sin acciones
  de borrado: la papelera está deshabilitada y es decorativa.
- `src/ui/ProjectFormModal.ts`, `src/ui/TaskFormModal.ts` — `obsidian.Modal` con
  validación inline. `TaskFormModal` recibe `defaultProjectPath` y por defecto usa el
  proyecto seleccionado.
- `src/ui/ProjectPickerModal.ts` — `obsidian.FuzzySuggestModal` que la vista usa para
  añadir favoritos. Lista los proyectos **no favoritos** (la vista los pre-filtra) con
  una entrada sintética inicial «Crear proyecto nuevo…» y devuelve
  `ProjectPickerResult` (`{ kind: "create" }` o `{ kind: "project"; project }`) al
  callback que se le pasa en el constructor; el placeholder del input es «Buscar
  proyecto…».
- `styles.css` — usa variables Obsidian (`--background-primary`, `--background-secondary`,
  `--text-normal`, `--interactive-accent`, etc.). Lienzo oscuro, paneles claros
  redondeados, tarjetas de tarea oscuras. Layout en grid de dos columnas (`1fr auto`)
  con la barra superior (`grid-column: 1 / -1`) y la fila inferior (Archivos +
  Contraseña) ocupando ambas columnas. La *topbar* ya no es un panel con borde ni
  título: es simplemente la fila transparente que aloja los chips de favoritos y los
  controles a la derecha; el selector `<select>` antiguo, el menú `···` del chip y el
  círculo de estado junto al título de la tarea han sido retirados. Los chips de
  favoritos conservan `is-selected` claro; las tarjetas de tarea muestran un *badge*
  con el nombre del proyecto (visible en modo «Todos»); FABs circulares; placeholder
  sections inertes. Breakpoints: `@media (max-width: 640px)` → una columna, oculta
  el rail; `@media (max-width: 320px)` → controles y acciones apilados sin recorte.

## Tests (`tests/`)

- `tests/settings.test.ts` — 10 tests.
- `tests/parseNote.test.ts` — 29 tests con casos específicos por modo de error y la
  nueva prop `favorite` que el parser preserva en `ProjectRecord.properties`.
- `tests/presentDashboard.test.ts` — 7 tests sobre orden determinista, modo «all»,
  filtro por proyecto y fallback automático a «all» cuando el proyecto desaparece.
- `tests/weekStrip.test.ts` — 4 tests; cubre semana ISO, transición de mes,
  `monthLabel` y marca exacta de `isToday`.
- `tests/templates.test.ts` — 8 tests; cubre validación y aplicación de plantillas.
- `tests/ProjectTaskRepository.test.ts` — 34 tests con un `VaultAdapter` falso en
  memoria. Cubre sanitize, disambiguate, propiedades y cuerpo preservados, renombrado
  que actualiza tareas, edición manual round-tripped, `setProjectFavorite` aislado,
  `createProject` devolviendo el hub path y promoción automática del recién creado.

Los tests **no usan mocks** — usan un `VaultAdapter` en memoria que simula
determinísticamente los métodos del API.

## Convenciones y reglas duras

- **Una mutación = un sólo cambio atómico en una prop.** Cada método de mutación opera
  sólo sobre la prop que controla: `type` en creación, `project` en creación de tarea /
  reasignación, `status` en cambio de estado. Nunca leer-y-reescribir el archivo
  completo; pasar siempre por `processFrontMatter`.
- **Sanitización de nombres de archivo** (en `ProjectTaskRepository`):
  `\ / : * ? " < > |` y `#` → `-`; colapsar `-` repetidos; trim `.`/espacios al borde;
  vacío → `"Untitled"`. En caso de colisión, sufija ` 2`, ` 3`, … antes de `.md`.
- **Borrado es placeholder.** No se crean métodos `delete*` ni confirmaciones de
  borrado. Los iconos de papelera que aparezcan en la UI son puramente decorativos
  y van deshabilitados; la papelera sigue activa sólo en el roadmap futuro. Hoy la
  única forma de retirar una nota es a través de las utilidades estándar del vault
  (file explorer, ribbon de notas, etc.).
- **Las notas Markdown son la única fuente de verdad.** No crees un store paralelo en
  la config del plugin; `data.json` sólo guarda las dos carpetas configurables.
- **Las propiedades del usuario y el cuerpo se preservan al editar.** Es un requisito
  del spec, no una nice-to-have.
- **Todo el texto UI es en español** (panel, modales, issues, mensajes de error).

## Verificación local antes de commit

```bash
npm run typecheck   # debe quedar limpio
npm test            # 92/92 verde
npm run build       # emite main.js
git status --short  # ver qué se va a commitear
```

Luego `git log -5` para confirmar mensajes siguiendo conventional-commits Spanish
(`build:`, `feat:`, `fix:`, `docs:`).

## Releases

El plugin se publica como copia manual de `main.js`, `manifest.json` y `styles.css`
dentro de `<vault>/.obsidian/plugins/devhelper-dashboard/`. `package.json` ya declara
estos archivos en `files`.

## Habilidades (skills) cargadas en este harness

- `obsidian-cli` — para interactuar con un vault Obsidian abierto (lectura, escritura,
  comandos del plugin, eval, screenshots, reload).
- `subagent-driven-development` — flujo de implementación por tareas con revisión por
  revisor. Usado para entregar la V1; el estado del plan vive en git (8 commits).

## Vault de prueba

`D:\proyects\devhelper-test-vault\` está creado y tiene el plugin ya copiado en
`.obsidian/plugins/devhelper-dashboard/`. Para verificar manualmente:

1. Abrir Obsidian apuntando a ese vault
   (`obsidian://open?path=D:\proyects\devhelper-test-vault` o desde el selector de
   vaults).
2. Activar el plugin **DevHelper Dashboard** en Settings → Community plugins.
3. Ejecutar el comando **Abrir el dashboard de proyectos y tareas** (o pulsar el
   icono de ribbon `layout-dashboard`).
4. El plugin creará automáticamente las carpetas `Projects/` y `Tasks/` al primer
   uso, según el spec.

Limpieza: borrar la carpeta `D:\proyects\devhelper-test-vault\` cuando ya no haga
falta; no se commitea al repo.

## Documentos de diseño

- Spec: `docs/superpowers/specs/2026-10-04-obsidian-project-dashboard-design.md`
- Plan ejecutado: `docs/superpowers/plans/2026-10-04-devhelper-dashboard-v1.md`
- Spec V2 (estructura de carpetas por proyecto, plantillas y credenciales):
  `docs/superpowers/specs/2026-10-17-projects-structure-design.md`
- Plan V2 (pendiente de ejecutar):
  `docs/superpowers/plans/2026-10-17-projects-structure-v2.md`
- Spec V3 (favoritos + vista «Todos»):
  `docs/superpowers/specs/2026-10-17-project-favorites-selector-design.md`
- Plan V3 ejecutado:
  `docs/superpowers/plans/2026-10-17-project-favorites-selector.md`

Si recibes un plan nuevo en el mismo formato, emplea `superpowers:subagent-driven-development`
(o `superpowers:executing-plans` si no hay subagentes disponibles) para entregarlo
tarea por tarea, con ledger en
`.superpowers/sdd/<plan-basename>/progress.md`. Lee **primero** este AGENTS.md, luego
el spec, luego el plan, antes de tocar código.
