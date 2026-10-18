# AGENTS.md

Notas operativas para agentes de IA trabajando en este repositorio. OpenCode, Claude Code y
otros harnesses deberían leer este archivo al iniciar.

## Qué es este repo

Plugin de Obsidian escrito en TypeScript: **DevHelper Dashboard**. Presenta proyectos y
tareas respaldados por notas Markdown (`type: project`, `type: task`, `project: "[[…]]"`,
`status: open|done`) en una vista propia del plugin.

Estado: **V3 entregada** (favoritos + vista «Todos»). V1 (`0df6689` → 8 commits), V2
(`→ 13a4109`, 8 commits) y V3 (`→ c713c09`, 5 commits sobre `master`) están en `master`.
Sobre `master`: unificación **main + Archivos/General + credenciales cifradas** (proyecto
sombra `General`, `FileRecord` + binarios en vault, `type: credentials` con AES-GCM,
presenter acotado por selección, secciones Archivos/Contraseña/Notas vivas).
La suite completa pasa en verde, `main.js` se construye, `manifest.json` y `styles.css`
están listos para instalarse (conteo exacto en «Tests» y «Verificación local»).

## Comandos

```bash
npm install              # instala dependencias (genera package-lock.json)
npm run dev              # esbuild en watch + sourcemap inline
npm run build            # bundle de producción a main.js (minificado)
npm run typecheck        # tsc --noEmit
npm test                 # vitest run (suite completa)
npm test -- tests/<f>    # suite individual
npm run update:test-vault # build + copia main.js/manifest.json/styles.css al vault de prueba y recarga el plugin
```

Después de cualquier cambio, ejecuta **typecheck + test + build** antes de comprometer.

## Layout del código

- `src/main.ts` — entrypoint; exporta `DevHelperDashboardPlugin` como default.
  Carga settings, instancia `ProjectTaskRepository` con `ObsidianVaultAdapter`,
  registra vista, comando `open-dashboard`, ribbon (`layout-dashboard`), settings tab
  y listeners `vault.on('create|modify|delete|rename')` + `metadataCache.on('changed')`
  con debounce de 250 ms. `onunload` cancela el timer pendiente.
- `src/settings.ts` — `PluginSettings`, `DEFAULT_SETTINGS = { projectsFolder: "Projects",
  templatesFolder: "Projects/_templates", credentialLockTimeoutMinutes: 15 }`, y
  `normalizeVaultFolderPath(path, fallback): string`. La
  normalización RECHAZA rutas absolutas, letras de unidad y `..` ANTES de trim barras.
  `mergePluginSettings(defaults, stored)` conserva el material clave de credenciales
  (`credSaltB64` / `credVerifier`) al persistir: la pestaña de ajustes sólo edita las dos
  carpetas + el timeout, y un merge ingenuo borraría la sal y el verificador del
  `data.json` (bloqueando todas las credenciales). `data.json` guarda por tanto cinco
  claves: `projectsFolder`, `templatesFolder`, `credentialLockTimeoutMinutes`,
  `credSaltB64` (sal PBKDF2 en base64, una por vault) y `credVerifier` (testigo cifrado
  de la maestra, `devhelper-ok`). Nunca edites `credSaltB64`/`credVerifier` a mano.
- `src/ui/SettingsTab.ts` — `PluginSettingTab` con dos `TextComponent` de carpetas más un
  campo numérico de timeout de bloqueo (`credentialLockTimeoutMinutes`, minutos),
  persiste vía `plugin.saveData()` con `mergePluginSettings` para no perder
  `credSaltB64`/`credVerifier`. No expone la sal ni el verificador.
- `src/domain/types.ts` — interfaces puras: `ProjectRecord` (incluye `favorite: boolean`
  que el frontmatter expone como chip visible en la fila de favoritos, más `isGeneral?: boolean`
  sólo `true` en el hub sombra `Projects/General/General.md`, excluido de chips/favoritos/picker
  y de selección directa), `TaskRecord`,
  `DashboardIssue`, `DashboardData`, `NoteSnapshot`, `ParsedNote`, `ResolveProjectFn`,
  más `NoteRecord` (nota simple: sólo `project` + `created`, sin `status`), `CredentialEntry`
  (`service` en claro; `user`/`password`/`url`/`notes` cifrados; claves extra libres),
  `ParsedCredentialsNote` / `CredentialsRecord` (`projectPath` + `needsMigration` cuando
  alguna entrada sigue en claro) y `FileRecord` (`path`, `name` con extensión, `extension`
  sin punto en minúsculas, `projectPath` del hub propietario).
- `src/domain/parseNote.ts` — `parseProjectTaskNote(note, resolveProject): ParsedNote`.
  Devuelve siempre un `ParsedNote` discriminado; **nunca lanza**. Errores → `kind: "issue"`.
  Usa `js-yaml.load` y la portada `---` debe ser la PRIMERA línea. Acepta también
  `type: note` (sólo `project` + `created`) y `type: credentials` (lista de entradas con
  `service` obligatorio; `password` en claro o `enc:v1:…`, nunca mezcla corrupta que tumbe
  el resto: las entradas malformadas van a `entryIssues` y las válidas se conservan).
- `src/domain/credentialsCrypto.ts` — cifrado puro sin imports de Obsidian (WebCrypto,
  funciona en Vitest/Node y en Electron). AES-GCM 256 + PBKDF2-SHA256 con 210 000
  iteraciones. Formato de campo cifrado `enc:v1:<iv-b64>:<cipher-b64>` (IV fresco de 12 B
  por cifrado; sal de 16 B, una por vault). `service` nunca se cifra (se usa para buscar);
  `user`/`password`/`url`/`notes` sí. `VERIFIER_PLAINTEXT = "devhelper-ok"`: al fijar la
  maestra se cifra y se guarda en `credVerifier`; desbloquear deriva la clave y la
  comprueba contra el testigo (`"Contraseña incorrecta."` si no coincide, sin dejar clave).
- `src/data/CredentialSession.ts` — clave maestra derivada **sólo en memoria** (`CryptoKey`,
  nunca en disco). `unlock(password, saltB64, verifier)`, `lock()`, `touch()` (rearma el
  temporizador), `setTimeoutMinutes(m)` y `msUntilLock()`. Auto-bloqueo por temporizador con
  callback `onExpire` (la vista vuelve al estado bloqueado). Sin imports de Obsidian:
  testeable con fake timers.
- `src/domain/presentDashboard.ts` — `presentDashboard(data, selection)` con
  `DashboardSelection` discriminado (`{ kind: "all" }` o `{ kind: "project"; path }`).
  Orden determinista: proyectos por `title` asc case-insensitive con desempate `path`;
  tareas por `status` (`open` antes que `done`) y luego título; notas por título;
  archivos por `name` case-insensitive con desempate `path`. Modo «all»: `selectedProject`
  es `null`, `showAll` es `true` y se listan todas las tareas **y notas**. **Regla Archivos/
  General:** en `showAll` sólo se muestran los `files` del proyecto sombra `General`
  (`isGeneral: true`; sin General → lista vacía, nunca lanza); en modo proyecto, sólo los
  del proyecto pedido (pedir General directo → fallback a «all»). Fallback: si la selección
  pide un proyecto inexistente o no hay proyectos, se cae a `{ kind: "all" }` para
  garantizar que el panel nunca quede vacío. `resolveVisibleCredentialsRecord(data, selection)`:
  en modo proyecto devuelve el `Credenciales.md` de ese proyecto (`null` si aún no existe —
  crear la primera entrada materializa la nota); en «all» devuelve el de **General**
  (credenciales compartidas/globales; `null` si no hay General y la vista pide elegir
  proyecto). General se reconoce por basename de carpeta o título `general` case-insensitive.
- `src/domain/weekStrip.ts` — función pura `getWeekStrip(today: Date): WeekStrip`;
  sin imports de Obsidian; calcula la semana ISO (Lun–Dom) de una fecha y el nombre
  del mes en español.
- `src/data/VaultAdapter.ts` — interface pura (`VaultNoteRef`, 11 métodos:
  `listMarkdownFiles`, `read`, `createFolder`, `createMarkdown`, `rename`,
  `processFrontMatter`, `resolveLink`, `listSubfolders`, `exists`, `renameFolder`,
  `trash`).
- `src/data/ObsidianVaultAdapter.ts` — única con `import "obsidian"`. `createFolder` crea
  cada nivel por separado (Obsidian sólo crea uno). `processFrontMatter` usa
  `app.fileManager.processFrontMatter`. `rename` devuelve ref del nuevo path.
- `src/data/ProjectTaskRepository.ts` — escanea carpetas configuradas, llama al parser,
  expone diecisiete mutaciones (proyectos/tareas/notas/archivos/credenciales/favoritos:
  `createProject`, `createTask`, `renameProject`, `renameTask`,
  `reassignTask`, `setTaskStatus`, `setProjectFavorite`, `deleteTask`, `createNote`,
  `renameNote`, `deleteNote`, `createCredential`, `updateCredential`, `deleteCredential`,
  `migratePlaintextCredentials`, `addFile`, `deleteFile`). `createProject(title)` devuelve
  **`Promise<string>`** con el *hub path* del proyecto recién creado (la carpeta
  `Projects/<slug>/` que la vista usa para promoverlo a favorito y seleccionarlo).
  `migratePlaintextCredentials` devuelve **`Promise<number>`** (entradas migradas).
  El resto de mutaciones devuelven **`Promise<void>`**. `renameProject` actualiza la
  prop `project` de las tareas afectadas aunque Obsidian tenga auto-link-update
  desactivado (lee la nota raw, parsea con `js-yaml`, compara, y reescribe sólo esa
  prop con `processFrontMatter`). `setProjectFavorite(path, favorite)` opera sólo sobre
  la prop `favorite` y nunca toca el cuerpo ni otras props. Además: notas simples
  (`createNote` / `renameNote` / `deleteNote`, esta última a la papelera como las tareas);
  Archivos (el repositorio siembra el proyecto sombra `Projects/General/General.md` al
  primer uso vía el método privado `ensureGeneralProject`; `addFile` copia un binario o texto del sistema a `<Proyecto>/Archivos/` con
  desambiguación ` 2`, ` 3`, …; `deleteFile` a la papelera tras confirmación); y
  credenciales sobre `Credenciales.md` por carpeta de proyecto (`createCredential` /
  `updateCredential` / `deleteCredential` sólo con sesión desbloqueada, `service` en claro
  y resto cifrado; `migratePlaintextCredentials` cifra de una vez las entradas heredadas en
  claro y devuelve el conteo, ofrecida cuando `needsMigration` es `true`).
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
  `renderBottomSections` (Archivos + Contraseña) y `renderIssues`, más panel de Notas
  (tarjetas con filtro por título) y sección Archivos viva (filtro «Buscar archivos…»,
  botón «Añadir archivo» que copia a `<Proyecto>/Archivos/`, botón ver-en-explorador
  por archivo y papelera con confirmación). La sección Contraseña pide la maestra al
  desbloquear (fijarla la primera vez crea sal + verificador en `data.json`); bloqueada
  muestra sólo `service`; desbloqueada permite ver/copiar credenciales y CRUD completo,
  con aviso de migración en un clic si hay entradas en claro. Las credenciales se
  renderizan como tarjetas oscuras al estilo de las tareas. El lápiz de
  la tarjeta abre la nota; la papelera pide confirmación y manda la tarea a la
  papelera de Obsidian (`deleteTask`).
- `src/ui/ProjectFormModal.ts`, `src/ui/TaskFormModal.ts` — `obsidian.Modal` con
  validación inline. `TaskFormModal` recibe `defaultProjectPath` y por defecto usa el
  proyecto seleccionado.
- `src/ui/NoteFormModal.ts`, `src/ui/CredentialFormModal.ts` — modales de creación/edición
  de notas simples y de entradas de credencial (esta última sólo opera con la sesión
  desbloqueada y cifra `user`/`password`/`url`/`notes` antes de persistir).
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
  con el nombre del proyecto (visible en modo «Todos»); FABs circulares; las credenciales
  reutilizan el estilo de tarjeta oscura de las tareas. Breakpoints: `@media (max-width: 640px)` → una columna, oculta
  el rail; `@media (max-width: 320px)` → controles y acciones apilados sin recorte.

## Tests (`tests/`) — 163 en total, todos en verde

- `tests/settings.test.ts` — 14 tests (normalización de carpetas + preservación del
  material clave `credSaltB64`/`credVerifier` en `mergePluginSettings`).
- `tests/parseNote.test.ts` — 39 tests con casos específicos por modo de error, la
  prop `favorite`, notas simples `type: note` y credenciales `type: credentials`
  (entradas válidas + `entryIssues` sin tumbar el resto).
- `tests/presentDashboard.test.ts` — 20 tests sobre orden determinista, modo «all»,
  filtro por proyecto y fallback automático a «all» cuando el proyecto desaparece,
  más acotación de `tasks`/`notes`/`files` por selección y regla Archivos→General.
- `tests/weekStrip.test.ts` — 4 tests; cubre semana ISO, transición de mes,
  `monthLabel` y marca exacta de `isToday`.
- `tests/templates.test.ts` — 10 tests; cubre validación y aplicación de plantillas.
- `tests/credentialsCrypto.test.ts` — 8 tests (formato `enc:v1`, round-trip AES-GCM,
  verificador, errores en español ante blob corrupto o clave errónea).
- `tests/CredentialSession.test.ts` — 8 tests (unlock/lock, timeout con fake timers,
  `touch`, `onExpire`, contraseña incorrecta sin dejar clave).
- `tests/ProjectTaskRepository.test.ts` — 60 tests con un `VaultAdapter` falso en
  memoria. Cubre sanitize, disambiguate, propiedades y cuerpo preservados, renombrado
  que actualiza tareas, edición manual round-tripped, `setProjectFavorite` aislado,
  `createProject` devolviendo el hub path y promoción automática del recién creado,
  `deleteTask` a la papelera (desaparece del siguiente `load`, error si no existe),
  más notas simples, siembra de General, `addFile`/`deleteFile`, CRUD de credenciales
  y `migratePlaintextCredentials`.

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
- **Borrado sólo a la papelera, con confirmación.** `deleteTask` / `deleteNote` /
  `deleteFile` mandan a la papelera de Obsidian (recuperable, nunca
  borrado permanente) tras confirmación explícita (`ConfirmDeleteModal`).
  `deleteCredential` elimina la entrada de la nota `Credenciales.md` (también con
  confirmación). No hay borrado de proyectos ni de carpetas. No hay borrado silencioso.
- **Las notas Markdown son la única fuente de verdad.** No crees un store paralelo en
  la config del plugin; `data.json` sólo guarda las dos carpetas configurables, el timeout
  de bloqueo y el material clave (`credSaltB64`, `credVerifier`). La sal y el verificador
  los gestiona el propio plugin al fijar/desbloquear la maestra; nunca los edites a mano
  ni los expongas en la UI.
- **Regla Archivos/General.** El proyecto sombra `Projects/General/General.md` se siembra
  automáticamente y nunca aparece en chips, favoritos, picker ni como selección directa.
  En modo «Todos» la sección Archivos muestra sólo los ficheros de General; en modo
  proyecto, sólo los de ese proyecto (`<Proyecto>/Archivos/`). Los binarios viven en el
  vault y se copian con `addFile` (con desambiguación); nunca se leen como notas.
- **Credenciales cifradas.** `service` en claro (es la clave de búsqueda); `user`,
  `password`, `url` y `notes` siempre cifrados (`enc:v1:…`) antes de persistir. La clave
  derivada vive sólo en `CredentialSession` en memoria, con auto-bloqueo por timeout
  configurable. Sin sesión desbloqueada no hay lectura ni escritura de secretos: la vista
  muestra sólo `service`. Las entradas heredadas en claro se marcan con `needsMigration`
  y se migran en un clic (`migratePlaintextCredentials`).
- **Las propiedades del usuario y el cuerpo se preservan al editar.** Es un requisito
  del spec, no una nice-to-have.
- **Todo el texto UI es en español** (panel, modales, issues, mensajes de error).

## Verificación local antes de commit

```bash
npm run typecheck   # debe quedar limpio
npm test            # 163/163 verde
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
`.obsidian/plugins/devhelper-dashboard/`. Para actualizarlo tras un cambio
usa `npm run update:test-vault` (hace build + copia `main.js`,
`manifest.json` y `styles.css` al vault e intenta recargar el plugin).
Para verificar manualmente:

1. Abrir Obsidian apuntando a ese vault
   (`obsidian://open?path=D:\proyects\devhelper-test-vault` o desde el selector de
   vaults).
2. Activar el plugin **DevHelper Dashboard** en Settings → Community plugins.
3. Ejecutar el comando **Abrir el dashboard de proyectos y tareas** (o pulsar el
   icono de ribbon `layout-dashboard`).
4. El plugin siembra automáticamente el proyecto sombra `Projects/General/` al primer
   uso (Archivos globales y credenciales compartidas viven ahí).

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
- Spec Archivos + proyecto sombra General:
  `docs/superpowers/specs/2026-10-18-archivos-y-proyecto-general-design.md`
- Plan Archivos + General ejecutado:
  `docs/superpowers/plans/2026-10-18-archivos-y-proyecto-general.md`
- Spec credenciales cifradas con maestra global:
  `docs/superpowers/specs/2026-10-18-encrypted-credentials-design.md`
- Plan credenciales ejecutado:
  `docs/superpowers/plans/2026-10-18-encrypted-credentials.md`
- Plan unificación main + Archivos + credenciales (Task 6, este cierre):
  `docs/superpowers/plans/2026-10-18-unify-main-archivos-credentials.md`

Si recibes un plan nuevo en el mismo formato, emplea `superpowers:subagent-driven-development`
(o `superpowers:executing-plans` si no hay subagentes disponibles) para entregarlo
tarea por tarea, con ledger en
`.superpowers/sdd/<plan-basename>/progress.md`. Lee **primero** este AGENTS.md, luego
el spec, luego el plan, antes de tocar código.
