# Botones configurables de la barra — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botones de usuario en la barra del dashboard, definidos como notas Markdown en `Botones/`, que ejecutan JavaScript (acción directa o popover con opciones), gestionables desde Ajustes y documentados en una skill de IA.

**Architecture:** Parser puro (`src/domain/toolbarButtons.ts`) → repositorio propio sobre `VaultAdapter` (`src/data/ToolbarButtonRepository.ts`) → runner con dependencias inyectadas que construye `ctx` y ejecuta con `AsyncFunction` (`src/ui/buttons/ButtonRunner.ts`, más `shellExec.ts` para `ctx.run`). `DashboardView.renderToolbarRail` y `SettingsTab` consumen esas piezas; `main.ts` las cablea.

**Tech Stack:** TypeScript, Obsidian API (`Menu`, `Notice`, `setIcon`, `Platform`, `FileSystemAdapter`), `js-yaml`, Vitest, esbuild.

**Spec:** `docs/superpowers/specs/2026-11-09-botones-barra-design.md` (leer antes de empezar; leer también `AGENTS.md`).

## Global Constraints

- Todo texto de UI, avisos y errores en español.
- `buttonsFolder` default `"Botones"`; `allowButtonScripts` default `false`.
- Nota de botón: `type: toolbar-button`; `label` obligatorio; `icon` default `"square-terminal"`; `order` default `Number.MAX_SAFE_INTEGER`; `enabled` default `true`.
- Bloques válidos: vallas ```` ``` ```` o `~~~` con lenguaje `js`/`javascript` (case-insensitive).
- `ctx.run` default `cwd` = raíz del vault, `timeoutMs` = 60000; móvil rechaza con `"ctx.run sólo está disponible en escritorio"`.
- Sin mocks en tests: fakes en memoria (patrón de `tests/ProjectTaskRepository.calendar.test.ts`).
- «Una mutación = una prop»: `setButtonEnabled` sólo toca `enabled` vía `processFrontMatter`.
- Sólo `src/data/ObsidianVaultAdapter.ts` y `src/ui/**` importan `obsidian`; `ButtonRunner.ts` y `shellExec.ts` tampoco lo importan.
- Tras cada tarea: `npm run typecheck && npm test && npm run build` en verde antes del commit. Commits en conventional-commits en español, terminados con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Notas con CRLF** (Windows, IAs que escriben `\r\n`): el parser debe reconocer portada, `##` y vallas igual que con `\n`. → test en Task 2.
2. **Valla de código sin cerrar**: no es un bloque; produce el issue «sin bloque de código js», nunca lanza ni se traga el resto. → test en Task 2.
3. **Settings obsoletos**: `SettingsTab.writeSettings` reemplaza `host.settings` por un objeto nuevo, así que cualquier pieza que guarde la referencia vieja no ve el toggle. Runner y repositorio leen settings vía getter `() => PluginSettings`. → test en Task 5 (toggle a mitad de sesión) y Task 3 (cambio de carpeta).
4. **`buttonsFolder` dentro de `projectsFolder`** (p. ej. `Projects/Botones`): se convertiría en un proyecto sin hub. `mergePluginSettings` cae a `"Botones"`. → test en Task 1.
5. **Script que lanza un no-`Error`** (`throw "texto"`, `Promise.reject(42)`): el mensaje es `String(err)`, no `undefined`. → test en Task 5.

---

### Task 1: Ajustes `buttonsFolder` y `allowButtonScripts`

**Files:**
- Modify: `src/settings.ts` (interfaz, `DEFAULT_SETTINGS`, `mergePluginSettings`)
- Modify: `src/main.ts:44-48` (cargar con `mergePluginSettings(DEFAULT_SETTINGS, await this.loadData())` en vez de `Object.assign`)
- Test: `tests/settings.test.ts`

**Interfaces:**
- Produces: `PluginSettings.buttonsFolder: string`, `PluginSettings.allowButtonScripts: boolean`.

- [ ] **Step 1: Tests que fallan** en `tests/settings.test.ts`:
  - `DEFAULT_SETTINGS.buttonsFolder === "Botones"` y `DEFAULT_SETTINGS.allowButtonScripts === false`.
  - `mergePluginSettings(DEFAULT_SETTINGS, { buttonsFolder: " /Mis/Botones/ " }).buttonsFolder === "Mis/Botones"`.
  - `buttonsFolder: "../x"` → `"Botones"`.
  - `buttonsFolder: "Projects/Botones"` con `projectsFolder: "Projects"` → `"Botones"`; también `"Projects"` exacto → `"Botones"` (comparación case-insensitive).
  - `allowButtonScripts: "true" as unknown as boolean` → `false`; `true` → `true`.
  - merge con `{ credSaltB64: "s", credVerifier: "v", allowButtonScripts: true }` conserva los tres.
- [ ] **Step 2:** `npm test -- tests/settings.test.ts` → FAIL (propiedades inexistentes).
- [ ] **Step 3:** Implementar en `src/settings.ts`. `allowButtonScripts: stored?.allowButtonScripts === true`. `buttonsFolder` normalizado con `normalizeVaultFolderPath`, y si su forma en minúsculas es igual a `projectsFolder` normalizado o empieza por `projectsFolder + "/"` → `defaults.buttonsFolder`. Cambiar `main.ts` para cargar con `mergePluginSettings`.
- [ ] **Step 4:** `npm test -- tests/settings.test.ts` → PASS; `npm run typecheck` limpio.
- [ ] **Step 5:** Commit `feat: ajustes de carpeta de botones y permiso de scripts`.

---

### Task 2: Parser `parseToolbarButton`

**Files:**
- Create: `src/domain/toolbarButtons.ts`
- Test: `tests/toolbarButtons.test.ts`

**Interfaces:**
- Consumes: `NoteSnapshot`, `DashboardIssue` de `src/domain/types.ts`.
- Produces (exportados):
  - `ToolbarButtonOption { label: string; code: string }`
  - `ToolbarButtonRecord { path; label; icon; order; enabled; action: { kind: "direct"; code } | { kind: "menu"; options: ToolbarButtonOption[] } }`
  - `ParsedToolbarButton = { kind: "ignored" } | { kind: "button"; button: ToolbarButtonRecord; issues: DashboardIssue[] } | { kind: "issue"; issue: DashboardIssue }`
  - `parseToolbarButton(note: NoteSnapshot): ParsedToolbarButton`
  - `sortToolbarButtons(buttons: ToolbarButtonRecord[]): ToolbarButtonRecord[]`
  - `DEFAULT_BUTTON_ICON = "square-terminal"`
  - `DEFAULT_BUTTON_TEMPLATE: string` (contenido de `boton.md`: portada `type: toolbar-button`, `label: Nuevo botón`, `icon: square-terminal`, `order: 100`, `enabled: true`; un bloque js `ctx.notice("Hola desde " + ctx.button.label);` y un comentario HTML `<!-- … -->` explicando que añadir encabezados `## Opción` con su bloque js convierte el botón en menú).

- [ ] **Step 1: Tests que fallan** (helper `note(content, path = "Botones/B.md")`):
  - directa: portada válida + un bloque ```` ```js ```` → `kind: "button"`, `action.kind === "direct"`, `code` exacto sin vallas, `issues` vacío.
  - menú: dos `##` con bloques → `options` `[{label:"Build",…},{label:"Abrir changelog",…}]` en orden.
  - `## Vacía` sin bloque entre otras dos válidas → 2 opciones + 1 issue cuyo `message` es `La opción «Vacía» no tiene bloque de código js`.
  - menú sin opciones válidas → `kind: "issue"`.
  - sin `label` → `kind: "issue"`, mensaje `Falta «label» en el botón`; `label: "  "` igual.
  - sin bloque js → `kind: "issue"`, mensaje `El botón «X» no tiene bloque de código js`.
  - bloque ```` ```python ```` únicamente → issue anterior.
  - `type: task` → `ignored`; sin portada → `ignored`; YAML roto → `ignored`.
  - defaults: sin `icon/order/enabled` → `"square-terminal"`, `Number.MAX_SAFE_INTEGER`, `true`; `enabled: false` respetado; `order: "x"` → default.
  - `~~~javascript` y ```` ```JS ```` válidos.
  - `## dentro` escrito dentro de un bloque js de una acción directa no crea opciones (sigue `direct`).
  - **CRLF:** el caso menú con `\r\n` produce el mismo resultado que con `\n` (y `code` sin `\r`).
  - **Valla sin cerrar:** ```` ```js ```` sin cierre → issue «no tiene bloque de código js».
  - todos los issues llevan `path` de la nota.
  - `sortToolbarButtons`: order 1 < order 2; mismo order → label `"a"` antes de `"B"`; mismo label → por `path`; no muta la entrada.
- [ ] **Step 2:** `npm test -- tests/toolbarButtons.test.ts` → FAIL (módulo inexistente).
- [ ] **Step 3:** Implementar. Normalizar `\r\n`→`\n` al inicio. Portada: misma regla que `parseNote` (primera línea `---`, `js-yaml.load` en try/catch). Cuerpo: recorrer líneas con un estado «dentro de valla» (abre con ```` ``` ````/`~~~` + info string, cierra con la misma secuencia de valla); sólo cuentan los `##` fuera de valla; cada bloque recogido guarda su lenguaje (primera palabra del info string, en minúsculas) y su línea de inicio para asignarlo a la sección. Valla abierta al final del archivo se descarta.
- [ ] **Step 4:** `npm test -- tests/toolbarButtons.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat: parser de notas de botón de la barra`.

---

### Task 3: `ToolbarButtonRepository`

**Files:**
- Create: `src/data/ToolbarButtonRepository.ts`
- Create: `tests/helpers/fakeVault.ts` (fake `VaultAdapter` en memoria, copiando la forma del de `tests/ProjectTaskRepository.calendar.test.ts`; expone `files: Map<string,string>` y `folders: Set<string>`; `processFrontMatter` parsea/reescribe sólo la portada con `js-yaml` y preserva el cuerpo)
- Test: `tests/ToolbarButtonRepository.test.ts`

**Interfaces:**
- Consumes: Task 2 (`parseToolbarButton`, `sortToolbarButtons`, `DEFAULT_BUTTON_TEMPLATE`), `sanitizeFilename` de `src/data/ProjectTaskRepository.ts`, `VaultAdapter`.
- Produces:
  - `constructor(adapter: VaultAdapter, getSettings: () => PluginSettings)`
  - `load(): Promise<{ buttons: ToolbarButtonRecord[]; issues: DashboardIssue[] }>` — asegura la carpeta, siembra la plantilla, devuelve **todos** los botones (incluidos `enabled: false`) ordenados; issues de botones inválidos + issues no fatales.
  - `createButton(title: string): Promise<string>` — devuelve el path creado.
  - `setButtonEnabled(path: string, enabled: boolean): Promise<void>`
  - `BUTTON_TEMPLATE_FILE_NAME = "boton.md"` (exportado).

- [ ] **Step 1: Tests que fallan:**
  - `load()` sobre vault vacío crea `Botones` y `Plantillas/boton.md` con `DEFAULT_BUTTON_TEMPLATE`; devuelve `buttons: []`.
  - plantilla editada por el usuario no se sobrescribe en un segundo `load()`.
  - dos notas válidas + una inválida + una `type: note` → 2 botones ordenados, 1 issue.
  - incluye botones `enabled: false`.
  - no lee subcarpetas (`Botones/sub/X.md` ignorado).
  - `createButton("Deploy: prod?")` crea `Botones/Deploy- prod-.md` (lo que dé `sanitizeFilename`) con el contenido de la plantilla del vault y `label` reemplazado por el título original; segunda llamada igual → `… 2.md`; sin plantilla en disco usa `DEFAULT_BUTTON_TEMPLATE`.
  - `setButtonEnabled(path, false)` cambia sólo `enabled`; cuerpo e `icon` intactos; path inexistente → rechaza con `No existe el botón «path»`.
  - **settings vivos:** cambiar el objeto devuelto por `getSettings` a otro con `buttonsFolder: "Otros"` hace que el siguiente `load()` lea `Otros`.
- [ ] **Step 2:** `npm test -- tests/ToolbarButtonRepository.test.ts` → FAIL.
- [ ] **Step 3:** Implementar. `createButton`: leer plantilla (o default), fijar `label` con `processFrontMatter` tras crear el archivo (no por reemplazo de texto), desambiguar con `adapter.exists` y sufijos ` 2`, ` 3`… hasta 1000 (error en español si se agota).
- [ ] **Step 4:** `npm test -- tests/ToolbarButtonRepository.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat: repositorio de botones de la barra`.

---

### Task 4: `shellExec` (`ctx.run`)

**Files:**
- Create: `src/ui/buttons/shellExec.ts`
- Test: `tests/shellExec.test.ts`

**Interfaces:**
- Produces:
  - `ShellResult { code: number; stdout: string; stderr: string }`
  - `ShellOptions { cwd?: string; timeoutMs?: number }`
  - `ShellExec = (cmd: string, options?: ShellOptions) => Promise<ShellResult>`
  - `createShellExec(opts: { isDesktop: boolean; defaultCwd: string | null }): ShellExec`

- [ ] **Step 1: Tests que fallan:**
  - `isDesktop: false` → rechaza con `"ctx.run sólo está disponible en escritorio"`.
  - escritorio: `run('node -e "process.stdout.write(\'hola\')"')` → `{ code: 0, stdout: "hola" }`.
  - `node -e "process.exit(3)"` → resuelve con `code: 3` (no rechaza).
  - `stderr` capturado con `process.stderr.write`.
  - `cwd`: `node -e "process.stdout.write(process.cwd())"` con `cwd: os.tmpdir()` devuelve esa ruta (comparar con `fs.realpathSync`).
  - `timeoutMs: 200` con `node -e "setTimeout(()=>{},5000)"` → rechaza con mensaje que contiene `superó el tiempo límite`.
- [ ] **Step 2:** `npm test -- tests/shellExec.test.ts` → FAIL.
- [ ] **Step 3:** Implementar con `require("child_process").exec` cargado dentro de la función (comentario: esbuild deja `child_process` externo; en móvil nunca se evalúa). `windowsHide: true`, `maxBuffer: 10 * 1024 * 1024`. Error con `killed`/`signal` por timeout → rechaza `El comando superó el tiempo límite de N ms`; error con `code` numérico → resolver con ese código; otro error de arranque → rechaza `No se pudo ejecutar el comando: <msg>`. Confirmar que `esbuild.config.mjs` marca builtins como externos; si no, añadir `"child_process"` a `external`.
- [ ] **Step 4:** `npm test -- tests/shellExec.test.ts` → PASS; `npm run build` → OK.
- [ ] **Step 5:** Commit `feat: ejecución de comandos de shell para botones`.

---

### Task 5: `ButtonRunner`

**Files:**
- Create: `src/ui/buttons/ButtonRunner.ts`
- Test: `tests/ButtonRunner.test.ts`

**Interfaces:**
- Consumes: Task 2 tipos, Task 4 `ShellExec`.
- Produces:
  - `ButtonRepoApi` = `Pick<ProjectTaskRepository, "load" | "createTask" | "createNote" | "setTaskStatus" | "renameTask" | "reassignTask" | "createCalendarEvent" | "updateCalendarEvent" | "setCalendarEventStatus">`
  - `ButtonContext { project; repo: ButtonRepoApi; run: ShellExec; notice(msg: string, ms?: number): void; refresh(): void; openCalendar(isoDate?: string): void; button: { label: string; option: string | null; path: string } }`
  - `ButtonRunnerDeps` y `RunResult` exactamente como en la spec §2.
  - `class ButtonRunner { constructor(deps: ButtonRunnerDeps); isRunning(key: string): boolean; run(button, option | null): Promise<RunResult> }`
  - `runKey(button: ToolbarButtonRecord, option: ToolbarButtonOption | null): string` (exportada; `path` o `path + "#" + option.label`).
  - `DISABLED_SCRIPTS_MESSAGE = "Los botones con código están desactivados. Actívalos en Ajustes → DevHelper Dashboard."`

- [ ] **Step 1: Tests que fallan** (deps falsas que registran llamadas; botón directo y botón de menú construidos a mano):
  - `isAllowed: () => false` → `blocked`, `notice` recibe `DISABLED_SCRIPTS_MESSAGE`, el código (`ctx.notice("x")`) no se ejecuta.
  - código con `await Promise.resolve(); ctx.notice(ctx.button.label + "|" + ctx.button.option)` → `ok`; notice `"Despliegue|Build"` para opción y `"Label|null"` para directa.
  - `ctx.project` devuelve lo de `getProject()`; `ctx.refresh()`, `ctx.openCalendar("2026-11-09")`, `ctx.run("x")` y `ctx.repo.load()` llegan a las deps; `app` y `obsidian` llegan como parámetros: con deps `app: { id: "APP" }` y `obsidian: { id: "OBS" }`, el código `ctx.notice(app.id + obsidian.id)` produce el notice `"APPOBS"`.
  - `throw new Error("boom")` → `error` con `message: "boom"`, notice `Error en «Despliegue › Build»: boom`, `logError` llamado con el código.
  - error async (`await Promise.reject(new Error("tarde"))`) → `error`.
  - sintaxis inválida (`ctx.notice(`) → `error`, no lanza.
  - **no-Error:** `throw "texto"` → message `"texto"`; `await Promise.reject(42)` → `"42"`.
  - **busy:** dos `run` concurrentes del mismo botón (código que espera a una promesa controlada por el test) → la segunda devuelve `busy`; `isRunning(runKey(...))` es `true` durante y `false` después (también tras error).
  - **toggle vivo:** `isAllowed` que lee una variable; primera ejecución `blocked`, cambiar la variable, segunda `ok`.
- [ ] **Step 2:** `npm test -- tests/ButtonRunner.test.ts` → FAIL.
- [ ] **Step 3:** Implementar. `AsyncFunction = Object.getPrototypeOf(async function () {}).constructor`. Liberar el lock en `finally`. Mensaje: `err instanceof Error ? err.message : String(err)`. Nombre: `option ? \`${label} › ${option.label}\` : label`.
- [ ] **Step 4:** `npm test -- tests/ButtonRunner.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat: runner de scripts de botones con ctx`.

---

### Task 6: Barra del dashboard + cableado en `main.ts`

**Files:**
- Modify: `src/ui/DashboardView.ts` (constructor, `refresh`, `renderToolbarRail`, `renderIssues` recibe issues concatenados)
- Modify: `src/main.ts`
- Modify: `styles.css` (sección del dashboard, junto a `.devhelper-toolbar-rail`)
- Test: `tests/styles.dashboard-responsive.test.ts` debe seguir verde (no añadir `@media` de ancho).

**Interfaces:**
- Consumes: Task 3 `ToolbarButtonRepository`, Task 4 `createShellExec`, Task 5 `ButtonRunner`/`runKey`.
- Produces: `DashboardView` recibe un 6.º parámetro `buttonDeps: ToolbarButtonDeps`:
  ```ts
  export interface ToolbarButtonDeps {
    repository: ToolbarButtonRepository;
    isAllowed(): boolean;
    exec: ShellExec;
    refresh(): void;
  }
  ```
  La vista construye su `ButtonRunner` con `getProject` = proyecto de `this.selection` (`{ path, title }` o `null` en «all»), `app: this.app`, `obsidian` = el módulo importado (`import * as obsidian from "obsidian"`), `notice: (m, ms) => new Notice(m, ms)`, `openCalendar: this.openCalendar`, `logError: console.error` con prefijo `DevHelper:`.

- [ ] **Step 1:** `main.ts`: instanciar `this.buttonRepository = new ToolbarButtonRepository(adapter, () => this.settings)`; `exec = createShellExec({ isDesktop: Platform.isDesktopApp, defaultCwd: vault.adapter instanceof FileSystemAdapter ? vault.adapter.getBasePath() : null })`; pasar `ToolbarButtonDeps` con `isAllowed: () => this.settings.allowButtonScripts` y `refresh: () => this.scheduleDashboardRefresh()`.
- [ ] **Step 2:** `refresh()`: cargar `buttonRepository.load()` junto a `repository.load()`; guardar `this.buttons` (sólo `enabled`) e issues; concatenar issues de botones a los del presenter en `renderIssues`.
- [ ] **Step 3:** `renderToolbarRail()`: tras ⚙, un `button.devhelper-icon-button` por botón (`aria-label`/`title` = label; `setIcon(el, icon)` y si `el.childElementCount === 0` repetir con `DEFAULT_BUTTON_ICON`). Clases: `has-options` si es menú; `is-disabled-script` si `!isAllowed()`; `is-running` + `disabled` mientras `runner.isRunning(key)` (el clic añade la clase antes de `await` y la quita al terminar). Directa → `runner.run(b, null)`. Menú → `new Menu()` con un ítem por opción, `showAtPosition({ x: rect.left, y: rect.bottom })`. Clic derecho (`contextmenu`) y `attachLongPress` → menú «Abrir nota del botón» (`app.workspace.openLinkText(path, "")`) y «Desactivar» (`setButtonEnabled(path, false)` + `refresh`).
- [ ] **Step 4:** CSS: `.devhelper-toolbar-rail .devhelper-icon-button.has-options` con `position: relative` y `::after` punto de 6px `#fafafa` en la esquina superior derecha; `.is-disabled-script { opacity: .45 }`; `.is-running` con animación de giro en el svg (`@keyframes devhelper-spin`). Selectores con padre repetido (0,2,0) como el resto del archivo.
- [ ] **Step 5:** `npm run typecheck && npm test && npm run build` → todo verde.
- [ ] **Step 6: Verificación manual:** `npm run update:test-vault`; en `D:\vault` crear `Botones/Prueba.md` (directa, `ctx.notice("ok")`) y `Botones/Menu.md` (dos opciones). Con `allowButtonScripts` en su default `false`, pulsar `Prueba` muestra `DISABLED_SCRIPTS_MESSAGE` (la ejecución real se verifica en Task 7, que añade el toggle). Comprobar además: se pintan en orden, el menú sale bajo el botón, clic derecho abre la nota, una nota inválida aparece en el panel de avisos, y editar la nota refresca la barra.
- [ ] **Step 7:** Commit `feat: botones de usuario en la barra del dashboard`.

---

### Task 7: Sección «Botones de la barra» en Ajustes

**Files:**
- Modify: `src/ui/SettingsTab.ts`
- Modify: `src/main.ts` (el host de ajustes expone el repositorio de botones y refresca vistas al guardar)

**Interfaces:**
- Consumes: Task 3 (`load`, `createButton`, `setButtonEnabled`), Task 1 settings.
- Produces: `SettingsHost` gana `buttonRepository: ToolbarButtonRepository`, `openNote(path: string): void` y `refreshViews(): void`.

- [ ] **Step 1:** En `display()`, encabezado `new Setting(containerEl).setName("Botones de la barra").setHeading()`, luego:
  - texto «Carpeta de botones» (desc: «Carpeta del vault con las notas de botón. Por defecto «Botones».»), normalizado con `mergePluginSettings` al guardar.
  - toggle «Permitir botones con código» con la descripción exacta de la spec §3.
  - contenedor de lista que se rellena async con `buttonRepository.load()`: por botón un `Setting` con nombre = label, desc = `N opciones` / `Acción directa`, icono vía `setIcon` en `nameEl` prefijo, toggle `enabled` → `setButtonEnabled` y botón «Abrir» → `openNote`. Sin botones → texto «No hay botones. Crea uno o pide a tu IA que lo haga (skill devhelper-buttons).».
  - botón «Crear botón» → `createButton("Nuevo botón")`, `openNote(path)`, repintar la lista.
- [ ] **Step 2:** `writeSettings` llama `host.refreshViews()` tras guardar (para que el toggle y la carpeta se reflejen en la barra).
- [ ] **Step 3:** `npm run typecheck && npm test && npm run build` → verde.
- [ ] **Step 4: Verificación manual** en el vault de prueba (`npm run update:test-vault`): activar el toggle → `Prueba` muestra «ok», cada opción de `Menu` ejecuta la suya, `ctx.run('node -v')` devuelve versión, un `throw` muestra `Error en «…»`, desactivar desde Ajustes oculta el botón, «Crear botón» crea y abre la nota, cambiar la carpeta mueve la lectura.
- [ ] **Step 5:** Commit `feat: gestión de botones de la barra en ajustes`.

---

### Task 8: Skill `devhelper-buttons` y documentación

**Files:**
- Create: `src/skills/devhelper-buttons/SKILL.md`
- Modify: `src/skills/devhelper-dashboard/SKILL.md` (enlace a la nueva skill + clave `buttonsFolder`/`allowButtonScripts` en la lista de `data.json`)
- Modify: `src/skills/devhelper-templates/SKILL.md` (plantilla `boton.md`)
- Modify: `AGENTS.md` (layout de los ficheros nuevos, `data.json` con nueve claves, recuento de tests real, «Skills de IA distribuidas (10)», spec y plan en «Documentos de diseño»)
- Test: `tests/skills.test.mjs` (existente)

- [ ] **Step 1:** Escribir la skill con el contenido de la spec §5: frontmatter `name: devhelper-buttons` y `description` **entre comillas dobles** que mencione «añadir/crear/editar botones de la barra del dashboard DevHelper que ejecutan código»; secciones: cuándo usarla, ubicación (leer `buttonsFolder` de `.obsidian/plugins/devhelper-dashboard/data.json`, default `Botones`), formato (directa vs `##`), referencia `app`/`obsidian`/`ctx` (tabla de la spec §2 con firmas), cinco ejemplos copiables (tarea en proyecto actual con `ctx.repo.createTask`, `npm run build` con `ctx.run`, abrir nota, menú de despliegue, evento hoy con `ctx.repo.createCalendarEvent`), reglas para la IA y verificación. Verificar firmas reales de `createTask`/`createCalendarEvent` en `src/data/ProjectTaskRepository.ts` antes de escribir los ejemplos.
- [ ] **Step 2:** `npm test -- tests/skills.test.mjs` → PASS (tras `npm run build`, que copia a `skills/`).
- [ ] **Step 3:** Actualizar `devhelper-dashboard`, `devhelper-templates` y `AGENTS.md`; contar tests con `npm test` y poner el número exacto en AGENTS.md (dos sitios: encabezado de «Tests» y «Verificación local»).
- [ ] **Step 4:** `npm run typecheck && npm test && npm run build` → verde; `git status --short` sólo muestra los ficheros de esta tarea.
- [ ] **Step 5:** Commit `docs: skill devhelper-buttons y AGENTS.md para botones de la barra`.
