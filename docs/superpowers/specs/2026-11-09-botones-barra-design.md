# Botones configurables de la barra — diseño

Fecha: 2026-11-09
Estado: aprobado en brainstorming, pendiente de plan

## Objetivo

Permitir que el usuario añada botones a la barra de herramientas del dashboard
(`renderToolbarRail`, la columna estrecha entre tareas y calendario) que ejecuten
el JavaScript que él quiera, con acceso a la API de Obsidian y a utilidades del
plugin. Un botón puede ejecutar una acción directa o abrir un popover con varias
opciones, cada una con su propio código.

Requisito clave: **que una IA externa (Claude Code, OpenCode…) pueda crear y
editar botones con facilidad**. Por eso cada botón es una nota Markdown en el
vault (una IA sólo tiene que escribir un archivo) y el plugin distribuye una
skill `devhelper-buttons` que enseña el formato y la API `ctx`.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Dónde vive un botón | Una nota Markdown por botón en `buttonsFolder` (por defecto `Botones/`) |
| Opciones del popover | En la misma nota: un encabezado `##` por opción con su bloque `js` |
| Seguridad | Sólo interruptor global `allowButtonScripts` (apagado por defecto); encendido ejecuta sin preguntar |
| API disponible | `app`, `obsidian` y `ctx` completo, incluido `ctx.run` para shell (sólo escritorio) |
| Entregable de IA | Skill `src/skills/devhelper-buttons/SKILL.md` |

## 1. Modelo de datos

### Carpeta

- Ajuste nuevo `buttonsFolder`, por defecto `"Botones"`, normalizado con
  `normalizeVaultFolderPath`.
- Fuera de `projectsFolder`: cualquier carpeta allí sería un proyecto sin hub.
- El repositorio la crea si falta. Escaneo **no recursivo** (como `Calendario/`).

### Formato de la nota

````markdown
---
type: toolbar-button
label: Despliegue        # obligatorio; tooltip y aria-label
icon: rocket             # opcional; icono Lucide, default "square-terminal"
order: 10                # opcional; número; orden ascendente, empate por label
enabled: true            # opcional; default true; false = no se pinta
---
Texto libre opcional (descripción, se ignora).

## Build
```js
const r = await ctx.run("npm run build", { cwd: "D:/proyects/x" });
ctx.notice(r.code === 0 ? "Build OK" : r.stderr);
```

## Abrir changelog
```js
await app.workspace.openLinkText("CHANGELOG", "");
```
````

### Reglas del parser

`parseToolbarButton(note: NoteSnapshot): ParsedToolbarButton` — función pura, sin
imports de Obsidian, **nunca lanza**. Resultado discriminado:

- `{ kind: "ignored" }` — la nota no tiene portada o `type` ≠ `toolbar-button`.
  No genera aviso (permite notas de documentación en la carpeta).
- `{ kind: "button"; button: ToolbarButtonRecord; issues: DashboardIssue[] }`
- `{ kind: "issue"; issue: DashboardIssue }` — botón inválido, no se pinta.

Reglas:

1. La portada `---` debe ser la primera línea (igual que `parseNote`); YAML con
   `js-yaml.load`. YAML que no parsea o sin `type: toolbar-button` → `ignored`
2. `label`: string no vacío tras trim. Ausente → `issue` «Falta «label» en el botón».
3. `icon`: string no vacío; si no, `"square-terminal"`. No se valida contra Lucide
   (`setIcon` con un nombre inexistente deja el botón vacío; la vista pinta el
   icono por defecto si `setIcon` no produjo hijos).
4. `order`: número finito; si no, `Number.MAX_SAFE_INTEGER` (al final).
5. `enabled`: booleano; si no, `true`.
6. Cuerpo (tras la portada):
   - Bloques de código válidos: vallas ```` ``` ```` o `~~~` con lenguaje `js` o
     `javascript` (case-insensitive). Otros lenguajes se ignoran.
   - Si el cuerpo contiene encabezados de nivel 2 (`^## `, fuera de bloques de
     código), el botón es de **menú**: cada `##` define una opción con
     `label` = texto del encabezado (trim) y `code` = el **primer** bloque js entre
     ese encabezado y el siguiente `##`. Encabezado sin bloque js → aviso
     «La opción «X» no tiene bloque de código js» (se omite la opción, el botón
     sigue). Menú sin ninguna opción válida → `issue`.
   - Si no hay `##`, el botón es de **acción directa**: `code` = primer bloque js
     del cuerpo. Sin bloque js → `issue` «El botón «X» no tiene bloque de código js».
7. Todos los mensajes en español e incluyen el `path` de la nota (campo de
   `DashboardIssue`).

### Tipos (`src/domain/toolbarButtons.ts`)

```ts
export interface ToolbarButtonOption { label: string; code: string; }

export interface ToolbarButtonRecord {
  path: string;
  label: string;
  icon: string;
  order: number;
  enabled: boolean;
  action:
    | { kind: "direct"; code: string }
    | { kind: "menu"; options: ToolbarButtonOption[] };
}
```

`sortToolbarButtons(buttons)`: por `order` asc, luego `label` case-insensitive,
luego `path`. Devuelve copia.

## 2. Ejecución y `ctx`

### Interruptor global

- Ajuste nuevo `allowButtonScripts: boolean`, default `false`.
- Apagado: los botones **se pintan** (clase `is-disabled-script`, atenuados). Al
  pulsar → `Notice` «Los botones con código están desactivados. Actívalos en
  Ajustes → DevHelper Dashboard.» No se compila ni ejecuta nada.
- Encendido: se ejecuta sin confirmación.

### Runner (`src/ui/buttons/ButtonRunner.ts`)

Sin imports de Obsidian: recibe dependencias inyectadas para ser testeable.

```ts
export interface ButtonRunnerDeps {
  app: unknown;
  obsidian: unknown;
  isAllowed(): boolean;
  notice(msg: string, ms?: number): void;
  getProject(): { path: string; title: string } | null;
  repo: ButtonRepoApi;               // subconjunto público de ProjectTaskRepository
  exec: ShellExec;                    // implementación de ctx.run
  refresh(): void;
  openCalendar(isoDate?: string): void;
  logError(message: string, err: unknown, code: string): void;
}

export class ButtonRunner {
  constructor(deps: ButtonRunnerDeps);
  isRunning(key: string): boolean;
  run(button: ToolbarButtonRecord, option: ToolbarButtonOption | null): Promise<RunResult>;
}

export type RunResult =
  | { kind: "ok" }
  | { kind: "blocked" }          // interruptor apagado
  | { kind: "busy" }             // ya se está ejecutando esa misma clave
  | { kind: "error"; message: string };
```

- Clave de ejecución: `path` + `"#" + option.label` (o sólo `path` en directa).
  Mientras corre, `run` con la misma clave devuelve `busy` sin ejecutar.
- Compila con `new AsyncFunction("app", "obsidian", "ctx", code)` donde
  `AsyncFunction = Object.getPrototypeOf(async function () {}).constructor`.
  Error de sintaxis al compilar → `error` (no lanza).
- Cualquier error (sync o async) → `Notice` «Error en «Despliegue › Build»: <msg>»
  (o «Error en «Label»: …» en directa), `logError` con el código, y `error`.
- `ctx` (`ButtonContext`):

| Miembro | Contrato |
|---|---|
| `ctx.project` | `{ path, title }` del proyecto seleccionado o `null` en «Todos» |
| `ctx.repo` | `createTask`, `createNote`, `setTaskStatus`, `createCalendarEvent`, `updateCalendarEvent`, `setCalendarEventStatus`, `renameTask`, `reassignTask`, `load` del repositorio (métodos ligados) |
| `ctx.run(cmd, { cwd?, timeoutMs? })` | `Promise<{ code: number; stdout: string; stderr: string }>`; `cwd` default raíz del vault; `timeoutMs` default 60000 |
| `ctx.notice(msg, ms?)` | `Notice` |
| `ctx.refresh()` | refresca dashboard y calendario (`scheduleDashboardRefresh`) |
| `ctx.openCalendar(isoDate?)` | `activateCalendarView` |
| `ctx.button` | `{ label, option, path }` (`option` = label de la opción o `null`) |

### Shell (`src/ui/buttons/shellExec.ts`)

- `createShellExec({ isDesktop, vaultBasePath })` → `ShellExec`.
- En móvil (`Platform.isMobile` desde la vista) rechaza con
  `Error("ctx.run sólo está disponible en escritorio")`.
- En escritorio: `require("child_process").exec` cargado perezosamente (esbuild
  ya marca builtins de Node como externos), con `timeout` y `windowsHide: true`.
  Código de salida distinto de 0 **no** rechaza: se devuelve en `code`. Timeout o
  fallo de arranque → rechaza con mensaje en español.
- `vaultBasePath` sale de `(app.vault.adapter as FileSystemAdapter).getBasePath()`
  cuando existe.

## 3. Interfaz

### Barra (`DashboardView.renderToolbarRail`)

- Primero el botón ⚙ Ajustes (sin cambios).
- Después los botones `enabled`, ordenados con `sortToolbarButtons`, como
  `devhelper-icon-button` (44px, estilo actual). `aria-label`/`title` = `label`.
- Botón de menú: clase `has-options` con un puntito en la esquina (CSS).
- Clic:
  - directa → `runner.run(button, null)`;
  - menú → `Menu` nativo de Obsidian con un ítem por opción, mostrado con
    `showAtPosition` bajo el botón; cada ítem → `runner.run(button, option)`.
- Mientras corre: clase `is-running` (spinner CSS) y `disabled`.
- Clic derecho / pulsación larga (`attachLongPress`) → `Menu` con «Abrir nota del
  botón» (`app.workspace.openLinkText(path, "")`) y «Desactivar»
  (`setButtonEnabled(path, false)`).
- Responsive: hereda las reglas actuales de `.devhelper-toolbar-rail` (fila
  horizontal en compacto). Sin `@media` de ancho nuevos.

### Ajustes (`SettingsTab`), sección «Botones de la barra»

1. Texto «Carpeta de botones» (`buttonsFolder`).
2. Toggle «Permitir botones con código» (`allowButtonScripts`) con descripción:
   «Ejecuta el JavaScript de las notas de botón con acceso completo al vault y,
   en escritorio, al sistema. Actívalo sólo si confías en esas notas.»
3. Lista de botones detectados (incluidos los desactivados): icono, label, «N
   opciones» o «Acción directa», toggle `enabled` (→ `setButtonEnabled`) y botón
   «Abrir».
4. Botón «Crear botón» → `createButton("Nuevo botón")` desde la plantilla y abre
   la nota.

`SettingsHost` gana acceso al `ToolbarButtonRepository` y a `app.workspace` para
abrir notas. `mergePluginSettings` conserva y normaliza las dos claves nuevas.

### Refresco

Los listeners del vault ya disparan `scheduleDashboardRefresh` para cualquier
cambio; `DashboardView.refresh()` recarga también los botones
(`buttonRepository.load()`), así que la barra se actualiza cuando la IA o el
usuario edita una nota de botón.

### Plantilla

`ToolbarButtonRepository.seedTemplate()` siembra `<templatesFolder>/boton.md`
(sin sobrescribir) con un ejemplo de acción directa y un comentario explicando el
modo menú. `createButton(title)` copia esa plantilla (si falta, usa el contenido
por defecto embebido), sanitiza el nombre y desambigua (` 2`, ` 3`…) con las
mismas reglas que el resto del repositorio.

## 4. Arquitectura

| Unidad | Responsabilidad | Depende de |
|---|---|---|
| `src/domain/toolbarButtons.ts` | tipos, `parseToolbarButton`, `sortToolbarButtons` | `js-yaml` |
| `src/data/ToolbarButtonRepository.ts` | asegurar carpeta, `load()` → `{ buttons, issues }`, `seedTemplate`, `createButton`, `setButtonEnabled` | `VaultAdapter` |
| `src/ui/buttons/ButtonRunner.ts` | `ctx`, compilación, ejecución, errores, anti-doble-clic | deps inyectadas |
| `src/ui/buttons/shellExec.ts` | `ctx.run` | `child_process` (perezoso) |
| `src/ui/DashboardView.ts` | pintar botones, `Menu`, clic derecho/long-press | lo anterior |
| `src/ui/SettingsTab.ts` | sección «Botones de la barra» | `ToolbarButtonRepository` |
| `src/settings.ts` | `buttonsFolder`, `allowButtonScripts`, merge | — |
| `src/main.ts` | instanciar repositorio + runner, cablear vista y ajustes | — |

Repositorio aparte para no engordar `ProjectTaskRepository`. Reutiliza `sanitizeFilename`
(ya exportada) y la misma desambiguación ` 2`, ` 3`… (se extrae a helper compartido
si hoy es privada). Los issues de botones se concatenan con los del dashboard en
`renderIssues`.

`setButtonEnabled` sólo toca la prop `enabled` vía `processFrontMatter`, conforme
a la regla «una mutación = una prop». No hay borrado de botones desde la UI
(se borran como cualquier nota).

## 5. Skill de IA

`src/skills/devhelper-buttons/SKILL.md` (española, `description` entrecomillada),
enlazada desde `devhelper-dashboard`:

- Cuándo usarla: «añade un botón…», «crea un botón en la barra que…».
- Formato exacto de la nota y reglas del parser (directa vs `##`).
- Carpeta: leer `buttonsFolder` de `.obsidian/plugins/devhelper-dashboard/data.json`
  (default `Botones`); sanitización del nombre de archivo.
- Referencia completa de `app`, `obsidian` y `ctx` con ejemplos copiables:
  crear tarea en el proyecto actual, `npm run build` con resultado, abrir nota,
  menú de despliegue multi-opción, crear evento hoy.
- Reglas: crear/editar sólo la nota del botón; nunca tocar `data.json`; nunca
  activar `allowButtonScripts` (pedírselo al usuario); preferir `ctx.repo` a
  escribir notas de tareas/eventos a mano; `ctx.run` no funciona en móvil; no
  incrustar secretos.
- Verificación: la barra se refresca sola; errores de formato en el panel de
  avisos; errores de ejecución en `Notice` + consola.

## 6. Tests (sin mocks, `VaultAdapter` en memoria)

- `tests/toolbarButtons.test.ts`: directa; menú con varias opciones; `##` sin
  código → aviso y opción omitida; menú sin opciones → issue; sin `label` → issue;
  sin bloque js → issue; `type` distinto → ignored; `enabled: false`; defaults de
  `icon`/`order`; bloques `javascript` y `~~~`; `##` dentro de un bloque de código
  no cuenta; orden de `sortToolbarButtons`.
- `tests/ToolbarButtonRepository.test.ts`: crea carpeta y plantilla sin
  sobrescribir; `load` devuelve botones + issues; `createButton` sanitiza y
  desambigua; `setButtonEnabled` preserva cuerpo y demás props.
- `tests/ButtonRunner.test.ts`: `await` funciona; `blocked` con interruptor
  apagado sin ejecutar; error sync, async y de sintaxis → `error` + notice con
  «Label › Opción»; `busy` en doble ejecución concurrente; `ctx` expone
  `project`, `button`, `notice`, `refresh`, `openCalendar`, `repo`, `run`.
- `tests/shellExec.test.ts`: móvil rechaza con el mensaje; escritorio ejecuta
  `node -e` y devuelve `code`/`stdout`; código ≠ 0 no rechaza.
- `tests/settings.test.ts`: defaults y normalización de `buttonsFolder`;
  `allowButtonScripts` no booleano → `false`; merge conserva sal/verificador.

## 7. Documentación

- AGENTS.md: layout nuevo, `data.json` con nueve claves, recuento de tests,
  10 skills.
- `devhelper-templates`: plantilla `boton.md`.
- `devhelper-dashboard`: enlace a `devhelper-buttons`.

## Fuera de alcance

Botones en la topbar del calendario, atajos de teclado por botón, iconos SVG
propios, scripts en archivos `.js` externos, confianza por hash del código,
borrado de botones desde la UI.
