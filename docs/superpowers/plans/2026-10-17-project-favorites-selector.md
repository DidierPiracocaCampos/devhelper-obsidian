# Plan de implementación: Selector de proyectos con favoritos y vista «Todos»

> **Para trabajadores agénticos:** SUB-SKILL OBLIGATORIO: Usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan sintaxis de casilla (`- [ ]`) para el seguimiento.

**Objetivo:** Sustituir la fila actual de chips de proyecto por «Todos» + chips de favoritos (persistidos como `favorite: true` en el frontmatter de cada nota hub) + botón «+» con modal buscador, con menú contextual de click derecho («Abrir nota», «Abrir carpeta», «Quitar de mis favoritos») y lista plana de todas las tareas con badge de proyecto en la vista «Todos».

**Arquitectura:** El dominio gana la prop `favorite` en `ProjectRecord` (parseo tolerante) y un tipo de selección discriminada `DashboardSelection` consumido por `presentDashboard` (nuevo modo «all» con fallback a «all»). El repositorio gana la mutación atómica `setProjectFavorite` y `createProject` devuelve el path del hub. La vista reescribe la fila de chips (sin título ni borde), añade el menú contextual con `obsidian.Menu`, un `ProjectPickerModal` (`FuzzySuggestModal`) y el badge de proyecto en tarjetas; `styles.css` se reestiliza según la referencia visual y pierde el CSS muerto.

**Stack tecnológico:** TypeScript, Obsidian Plugin API (`Menu`, `FuzzySuggestModal`, `Notice`), esbuild, Vitest, `js-yaml`; DOM nativo y variables de tema de Obsidian, sin framework de UI.

**Spec:** `docs/superpowers/specs/2026-10-17-project-favorites-selector-design.md`

## Restricciones globales

- Las notas Markdown son la única fuente de verdad; `data.json` NO se toca (sigue guardando sólo `projectsFolder` y `templatesFolder`).
- Toda mutación es atómica por property vía `processFrontMatter`; prohibido leer y reescribir archivos completos; se preservan el cuerpo y las properties del usuario.
- `favorite` nunca es property fija de plantilla ni genera issue: ausente o no booleana → `false`.
- La selección vive sólo en memoria en la vista (nunca se persiste); valor inicial siempre `{ kind: "all" }`.
- Orden de chips: sort determinista actual (título asc case-insensitive, desempate `path`).
- El menú contextual tiene EXACTAMENTE tres opciones: «Abrir nota», «Abrir carpeta», «Quitar de mis favoritos».
- Sin borrado: no se crean métodos `delete*`; la papelera sigue decorativa y deshabilitada.
- Todo el texto nuevo de UI, issues y mensajes de error en español.
- Tras cada tarea: `npm run typecheck` y `npm test` en verde antes del commit. Commits con conventional-commits en español (`feat:`, `fix:`, `docs:`, `style:`).

## Foco de revisión

- Nota hub existente sin prop `favorite` → debe aparecer como NO favorita sin generar issue → test `parsesMissingFavoriteAsFalse()` (Tarea 1).
- `favorite` con valor no booleano (`favorite: "yes"`) → `false`, sin issue → test `parsesInvalidFavoriteAsFalse()` (Tarea 1).
- Proyecto seleccionado que desaparece (renombrado/borrado externo) → la presentación cae a «Todos» en lugar de quedarse en un path fantasma → test `fallsBackToAllWhenSelectedProjectIsMissing()` (Tarea 3).
- Usuario con plantilla de proyecto forkeada (sin `favorite`): el proyecto creado desde el picker debe quedar favorito igualmente porque la vista lo marca sobre el path devuelto por `createProject` → test `createProjectReturnsHubPath()` (Tarea 2) + paso de verificación manual del flujo (Tarea 4).
- Quitar de favoritos el proyecto seleccionado → la vista resetea la selección a «Todos» (el proyecto sigue existiendo, así que el presenter no puede detectarlo) → paso de verificación manual en la Tarea 4 (lógica de vista, sin harness de UI).
- Modo «Todos» con tareas de varios proyectos → orden global `open` primero (no agrupado por proyecto) → test `sortsAllTasksOpenFirstAcrossProjects()` (Tarea 3).

---

## Mapa de archivos

- `src/domain/types.ts`: `ProjectRecord.favorite: boolean`.
- `src/domain/parseNote.ts`: lectura tolerante de `favorite` en `buildProject`.
- `src/domain/presentDashboard.ts`: `DashboardSelection`, firma nueva, modo «all» y fallback.
- `src/data/ProjectTaskRepository.ts`: `setProjectFavorite`; `createProject(): Promise<string>`.
- `src/ui/ProjectPickerModal.ts` *(nuevo)*: `FuzzySuggestModal` de no favoritos + «Crear proyecto nuevo…».
- `src/ui/DashboardView.ts`: estado `selection`, reescritura de chips, menú contextual, `openProjectFolder`, topbar sin título/filtro/FAB-crear, badge en tarjetas.
- `styles.css`: reestilizado de topbar/chips/buscador, `.devhelper-chip-add`, `.devhelper-task-project-badge`, borrado de `.devhelper-chip-menu` y `.devhelper-project-status*`.
- `tests/parseNote.test.ts`, `tests/presentDashboard.test.ts`, `tests/ProjectTaskRepository.test.ts`: suites actualizadas.
- `AGENTS.md`: reglas actualizadas al final.

## Tarea 1: Prop `favorite` en el dominio

**Archivos:**
- Modificar `src/domain/types.ts` (interfaz `ProjectRecord`).
- Modificar `src/domain/parseNote.ts` (`buildProject`).
- Test: `tests/parseNote.test.ts`.

**Interfaces:**
- Produce: `ProjectRecord` pasa a `{ path: string; title: string; folderPath: string; favorite: boolean; properties: Record<string, unknown> }`. La Tarea 2 (repositorio) y la Tarea 3 (presenter/fixtures) consumen este campo.

- [ ] **Paso 1: Escribir los tests que fallan**

En `tests/parseNote.test.ts`, dentro del describe de proyectos, cuatro casos nuevos sobre una nota proyecto válida (frontmatter completo con `type/status/created/tags/description/client`):

```ts
it("parsesFavoriteTrue()", /* favorite: true  → result.project.favorite === true */);
it("parsesFavoriteFalse()", /* favorite: false → result.project.favorite === false */);
it("parsesMissingFavoriteAsFalse()", /* sin prop → false */);
it("parsesInvalidFavoriteAsFalse()", /* favorite: "yes" → false, sin issue */);
```

Los proyectos de los tests nuevos deben asertar `result.kind === "project"` antes de mirar `favorite`.

- [ ] **Paso 2: Ejecutar `npm test -- tests/parseNote.test.ts` y verificar que los 4 fallan** (TS error: `favorite` no existe en `ProjectRecord`).

- [ ] **Paso 3: Implementar**

En `src/domain/types.ts`, añadir `favorite: boolean;` a `ProjectRecord` con comentario de una línea (prop opcional en frontmatter; `true` = chip visible en la fila de favoritos).

En `src/domain/parseNote.ts` (`buildProject`), construir el record con `favorite: properties.favorite === true`.

- [ ] **Paso 4: Ejecutar `npm test -- tests/parseNote.test.ts` (verde) y luego `npm run typecheck`**

Esperado: los tests de parseo pasan. El typecheck fallará en `tests/presentDashboard.test.ts` y `tests/ProjectTaskRepository.test.ts` por fixtures de `ProjectRecord` sin `favorite`: añadir `favorite: false` a esos fixtures en este mismo paso hasta dejar typecheck y suite completa (`npm test`) en verde.

- [ ] **Paso 5: Commit**

```bash
git add src/domain/types.ts src/domain/parseNote.ts tests/parseNote.test.ts tests/presentDashboard.test.ts tests/ProjectTaskRepository.test.ts
git commit -m "feat: añadir prop favorite al registro de proyecto"
```

## Tarea 2: `setProjectFavorite` y `createProject` devuelve el hub path

**Archivos:**
- Modificar `src/data/ProjectTaskRepository.ts`.
- Test: `tests/ProjectTaskRepository.test.ts`.

**Interfaces:**
- Produce: `async setProjectFavorite(path: string, favorite: boolean): Promise<void>` — parche atómico de la única prop `favorite` vía `adapter.processFrontMatter`.
- Produce: `createProject(title: string): Promise<string>` — mismo comportamiento que hoy pero devuelve el `hubPath` creado (la Tarea 4 lo marca favorito justo después).
- Consume: el `VaultAdapter` actual; no gana métodos.

- [ ] **Paso 1: Escribir los tests que fallan**

En `tests/ProjectTaskRepository.test.ts` (usando el fake vault y un proyecto creado vía `createProject` o escrito a mano en el fake):

```ts
it("setProjectFavoriteAddsMissingPropPreservingRest()", async () => {
  // arrange: proyecto válido sin prop favorite, con prop extra del usuario y cuerpo
  // act: await repo.setProjectFavorite(hubPath, true)
  // assert: load() → project.favorite === true; la prop extra y el cuerpo siguen intactos
});

it("setProjectFavoriteTurnsOffExistingProp()", async () => {
  // arrange: proyecto con favorite: true
  // act: setProjectFavorite(hubPath, false)
  // assert: load() → project.favorite === false
});

it("createProjectReturnsHubPath()", async () => {
  const hubPath = await repo.createProject("Web Rediseño");
  expect(hubPath).toBe("Projects/Web Rediseño/Web Rediseño.md");
});
```

Para asertar cuerpo/properties preservados, leer la nota cruda del fake (`files` interno o vía `adapter.read`) y comprobar que contiene la prop extra y el cuerpo original.

- [ ] **Paso 2: Ejecutar `npm test -- tests/ProjectTaskRepository.test.ts` y verificar que fallan** (`setProjectFavorite` no existe; `createProject` devuelve `void`).

- [ ] **Paso 3: Implementar**

En `src/data/ProjectTaskRepository.ts`:

```ts
async setProjectFavorite(path: string, favorite: boolean): Promise<void> {
  const ref = { path, basename: basenameOf(path) };
  await this.adapter.processFrontMatter(ref, (frontmatter) => {
    frontmatter["favorite"] = favorite;
  });
}
```

Cambiar la firma de `createProject` a `Promise<string>` y devolver `hubPath` al final (la variable ya existe). Ajustar el comentario de cabecera del método.

- [ ] **Paso 4: Ejecutar `npm test -- tests/ProjectTaskRepository.test.ts`, `npm run typecheck` y `npm test` completos**

Esperado: todo en verde (los callers actuales de `createProject` ignoran el valor devuelto; no rompe nada).

- [ ] **Paso 5: Commit**

```bash
git add src/data/ProjectTaskRepository.ts tests/ProjectTaskRepository.test.ts
git commit -m "feat: mutación setProjectFavorite y createProject devuelve el hub path"
```

## Tarea 3: `DashboardSelection` y modo «Todos» en `presentDashboard`

**Archivos:**
- Modificar `src/domain/presentDashboard.ts`.
- Modificar `src/ui/DashboardView.ts` (adaptación mínima para compilar; la reescritura de chips es la Tarea 4).
- Test: `tests/presentDashboard.test.ts`.

**Interfaces:**
- Produce:

```ts
export type DashboardSelection =
  | { kind: "all" }
  | { kind: "project"; path: string };

export interface DashboardPresentation {
  selection: DashboardSelection;         // efectiva, tras fallback
  selectedProject: ProjectRecord | null; // null en modo «all»
  showAll: boolean;
  tasks: TaskRecord[];
  issues: DashboardIssue[];
}

export function presentDashboard(
  data: DashboardData,
  selection: DashboardSelection,
): DashboardPresentation;
```

- Reglas: `{ kind: "all" }` → `showAll: true`, `selectedProject: null`, `tasks` = TODAS ordenadas con `compareTasks`. `{ kind: "project", path }` con path existente → como hoy, `showAll: false`, `selection` efectiva = la pedida. Path inexistente o sin proyectos → cae a `{ kind: "all" }`.
- Consume: `ProjectRecord.favorite` no se usa aquí (lo usa la vista en la Tarea 4).

- [ ] **Paso 1: Reescribir `tests/presentDashboard.test.ts` contra la nueva firma**

Migrar los 8 tests actuales (`null` → `{ kind: "all" }`; `path` → `{ kind: "project", path }`) teniendo en cuenta el nuevo contrato (antes `null` elegía el primer proyecto; ahora «all» muestra todo). Casos mínimos:

```ts
it("returnsEmptyPresentationForEmptyData()");
it("selectsAllTasksWhenSelectionIsAll()");          // showAll, selectedProject null
it("sortsAllTasksOpenFirstAcrossProjects()");       // open de B antes que done de A
it("selectsRequestedProject()");                    // filtra sus tareas
it("sortsProjectTasksOpenBeforeDone()");
it("fallsBackToAllWhenSelectedProjectIsMissing()"); // path fantasma → showAll
it("returnsIssuesVerbatim()");
```

Los fixtures `project(...)` del test ganan `favorite: false` si no se hizo en la Tarea 1.

- [ ] **Paso 2: Ejecutar `npm test -- tests/presentDashboard.test.ts` y verificar que falla** (firma inexistente).

- [ ] **Paso 3: Reescribir `src/domain/presentDashboard.ts`**

Mantener `compareProjects`/`compareTasks`/`compareIgnoreCase`. Nueva lógica de selección según las reglas de Interfaces. Actualizar el comentario de cabecera (contrato de selección: «all» por defecto, fallback a «all»).

- [ ] **Paso 4: Adaptar `src/ui/DashboardView.ts` lo mínimo para compilar**

- Sustituir `private selectedProjectPath: string | null = null;` por `private selection: DashboardSelection = { kind: "all" };`.
- `setSelectedProjectPath(path)` → `setSelection(selection: DashboardSelection): void` (mismo cuerpo: asignar + `void this.refresh()`).
- En `render()`: llamar `presentDashboard(data, this.selection)`; sincronizar `this.selection = presentation.selection`; la rama `presentation.selectedProject === null` pasa a decidir por `presentation.showAll` (si `showAll` → renderizar el panel de tareas con `presentation.tasks` aunque `selectedProject` sea null; de momento sin badge — llega en la Tarea 5 — y con cabecera de panel genérica: título «Todas las tareas», sin path).
- Los chips actuales: `is-selected` cuando `selection.kind === "project" && selection.path === project.path`; el click llama `setSelection({ kind: "project", path: project.path })`.
- `openCreateTask`: `defaultProjectPath: this.selection.kind === "project" ? this.selection.path : null`.

Esta adaptación es deliberadamente temporal: la Tarea 4 reescribe la fila de chips.

- [ ] **Paso 5: Ejecutar `npm test -- tests/presentDashboard.test.ts`, `npm run typecheck` y `npm test` completos**

Esperado: suite completa en verde.

- [ ] **Paso 6: Commit**

```bash
git add src/domain/presentDashboard.ts src/ui/DashboardView.ts tests/presentDashboard.test.ts
git commit -m "feat: selección discriminada y vista Todas las tareas en el presenter"
```

## Tarea 4: Fila de chips con favoritos, menú contextual y `ProjectPickerModal`

**Archivos:**
- Crear `src/ui/ProjectPickerModal.ts`.
- Modificar `src/ui/DashboardView.ts`.

**Interfaces:**
- Consume (Tareas 1-3): `ProjectRecord.favorite`, `repository.setProjectFavorite(path, favorite)`, `repository.createProject(title): Promise<string>`, `DashboardSelection`, `view.setSelection(...)`, `presentation.showAll`.
- Produce:

```ts
// src/ui/ProjectPickerModal.ts
export type ProjectPickerResult =
  | { kind: "create" }
  | { kind: "project"; project: ProjectRecord };

export class ProjectPickerModal extends FuzzySuggestModal<
  { kind: "create" } | { kind: "project"; project: ProjectRecord }
> {
  constructor(
    app: App,
    projects: ProjectRecord[], // ya filtrados: sólo NO favoritos, ordenados
    onChoose: (result: ProjectPickerResult) => void,
  );
}
```

`getItems()` = `[{ kind: "create" }, ...projects.map(p => ({ kind: "project", project: p }))]`; `getItemText()` = `"Crear proyecto nuevo…"` para `create`, `project.title` para el resto; `onChooseItem` delega en el callback. Placeholder del modal: `"Buscar proyecto…"`.

- [ ] **Paso 1: Crear `src/ui/ProjectPickerModal.ts`**

Implementación directa de la interfaz anterior (no hay harness de UI: la verificación es typecheck + revisión + prueba manual). `setIcon` no hace falta; texto plano.

- [ ] **Paso 2: Reescribir `renderProjectChips` en `DashboardView.ts`**

- Chip «Todos» primero: texto `Todos`, `is-selected` cuando `presentation.showAll`, click → `setSelection({ kind: "all" })`. Para ello `renderProjectChips` pasa a recibir la `presentation` (cambiar la firma y el call site en `render`).
- Chips de favoritos: `data.projects.filter(p => p.favorite)` ordenados con `sortProjectsForSelect`. Botón con texto plano (SIN dot de `status` y SIN botón «···»: eliminar ese markup). `is-selected` cuando `selection.kind === "project"` y path coincide. Click → `setSelection({ kind: "project", path })`.
- `contextmenu` sobre cada chip de favorito: `evt.preventDefault()` y `new Menu()` con exactamente:
  1. `Abrir nota` → `this.openNote(project.path)`.
  2. `Abrir carpeta` → `this.openProjectFolder(project.folderPath)`.
  3. `Quitar de mis favoritos` → `await repository.setProjectFavorite(project.path, false)`; si `this.selection.kind === "project" && this.selection.path === project.path` → `this.setSelection({ kind: "all" })` (que refresca); si no, `await this.refresh()`.
- Botón «+» final: clase `devhelper-chip-add`, `setIcon(..., "plus")`, `aria-label` "Añadir proyecto a favoritos" → `void this.openAddFavorite()`.
- Eliminar el chip placeholder «Sin proyectos».

- [ ] **Paso 3: Nuevos métodos de la vista**

```ts
private openProjectFolder(folderPath: string): void {
  // Revela la carpeta en el explorador de archivos. `revealInFolder` es
  // API interna del file-explorer: guardas typeof + Notice de fallback.
  const abstract = this.app.vault.getAbstractFileByPath(folderPath);
  const leaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
  const view = leaf?.view as unknown as { revealInFolder?: (f: unknown) => void };
  if (abstract && view && typeof view.revealInFolder === "function") {
    view.revealInFolder(abstract);
  } else {
    new Notice("No se pudo abrir la carpeta en el explorador de archivos.");
  }
}

private async openAddFavorite(): Promise<void> {
  const projects = (await this.repository.load()).projects
    .filter((p) => !p.favorite)
    .sort(/* mismo comparador que sortProjectsForSelect */);
  const modal = new ProjectPickerModal(this.app, projects, (result) => {
    if (result.kind === "create") {
      this.openCreateProject();
    } else {
      void (async () => {
        await this.repository.setProjectFavorite(result.project.path, true);
        this.setSelection({ kind: "project", path: result.project.path });
      })();
    }
  });
  modal.open();
}
```

- `openCreateProject` (flujo picker): tras `const hubPath = await this.repository.createProject(payload.title);` añadir `await this.repository.setProjectFavorite(hubPath, true);` y `this.setSelection({ kind: "project", path: hubPath });` (sustituye al `refresh()` suelto).
- Eliminar `openEditProject` y el menú «···» asociado (muere con los chips viejos). `ProjectFormModal` conserva su modo `edit` para uso futuro.
- `renderTopBar`: eliminar el `h2 "Proyectos"`, el botón filtro inerte y el FAB «+» de crear de la derecha; quedan los chips y, a la derecha, el buscador decorativo con su hint. Actualizar el comentario de cabecera del método.
- Importar `Notice` de `obsidian`.

- [ ] **Paso 4: Ejecutar `npm run typecheck` y `npm test`**

Esperado: verde (no hay tests de UI; las suites de dominio/repositorio no se tocan).

- [ ] **Paso 5: Verificación manual guiada (vault de prueba)**

Build con `npm run build`, copiar `main.js`/`styles.css` a `D:\proyects\devhelper-test-vault\.obsidian\plugins\devhelper-dashboard\` y comprobar: arranque en «Todos»; «+» abre el buscador y sólo lista no favoritos; añadir favorito lo selecciona; click derecho muestra las 3 opciones; «Quitar de mis favoritos» sobre el seleccionado devuelve a «Todos»; «Crear proyecto nuevo…» crea, marca favorito y selecciona. Si el vault de prueba no está disponible, dejar constancia en el commit y seguir.

- [ ] **Paso 6: Commit**

```bash
git add src/ui/ProjectPickerModal.ts src/ui/DashboardView.ts main.js
git commit -m "feat: fila de chips con favoritos, menú contextual y modal buscador"
```

## Tarea 5: Estilos de la fila de chips y badge de proyecto

**Archivos:**
- Modificar `styles.css`.
- Modificar `src/ui/DashboardView.ts` (badge en tarjetas + markup del buscador).

**Interfaces:**
- Consume: `presentation.showAll` y `presentation.tasks` (Tarea 3); markup nuevo de chips (Tarea 4).
- Produce: clases `.devhelper-chip-add`, `.devhelper-task-project-badge`, `.devhelper-search-wrap`; `renderTaskCard(task: TaskRecord, projectTitle?: string)`.

- [ ] **Paso 1: Badge de proyecto en modo «Todos» (vista)**

- `renderTasksPanel` pasa a recibir la `presentation` completa (ajustar call site). Construir `const titleByPath = new Map(data.projects.map(p => [p.path, p.title]))` — para ello `render` pasa también `data`; firma final `renderTasksPanel(presentation: DashboardPresentation, data: DashboardData)`.
- En modo `showAll`, la cabecera del panel muestra `Todas las tareas` (ya llegó en la Tarea 3) y cada tarjeta se renderiza con `renderTaskCard(task, titleByPath.get(task.projectPath) ?? task.projectPath)`; en modo proyecto, `renderTaskCard(task)` sin badge.
- `renderTaskCard(task, projectTitle?)`: si `projectTitle` definido, `card.createEl("span", { cls: "devhelper-task-project-badge", text: projectTitle })` justo después del `h4` del título.

- [ ] **Paso 2: Markup del buscador con hint interno**

En `renderTopBar`, envolver input + hint en `controls.createEl("div", { cls: "devhelper-search-wrap" })`; placeholder pasa a `Busca en el vault…` y el hint a `Ctrl K`. El input sigue `disabled`.

- [ ] **Paso 3: `styles.css`**

- `.devhelper-topbar`: quitar `background` y `border` (los chips viven sobre el lienzo oscuro), padding reducido (`4px 2px`); eliminar la regla `.devhelper-topbar h2`.
- `.devhelper-chip`: mantener píldora oscura (`--background-primary-alt`, borde hairline); `.devhelper-chip.is-selected`: `background: var(--background-secondary); color: var(--background-primary); border-color: transparent;` (píldora clara con texto oscuro, como la referencia).
- Nuevo `.devhelper-chip-add`: botón redondo pequeño transparente, `color: var(--text-muted)`, sin borde; hover con `color: var(--text-normal)`.
- Eliminar `.devhelper-chip-menu` y todo el bloque `.devhelper-project-status*` (CSS muerto tras la Tarea 4).
- `.devhelper-search-wrap`: `position: relative; display: flex; align-items: center;` ; `.devhelper-search`: fondo `--background-primary-alt`, `border-radius: 8px`, padding-right amplio; `.devhelper-search-hint`: `position: absolute; right: 8px;` sin fondo propio (o fondo sutil), texto `Ctrl K`.
- Nuevo `.devhelper-task-project-badge`: pill pequeña (`font-size: 0.75em`, `color: var(--text-muted)`, fondo `--background-primary-alt`, `border-radius: 999px`, `padding: 1px 8px`).
- Actualizar el comentario de cabecera del archivo (la topbar ya no es panel; chips de favoritos).

- [ ] **Paso 4: Ejecutar `npm run typecheck`, `npm test` y `npm run build`**

Esperado: todo en verde y `main.js` emitido.

- [ ] **Paso 5: Commit**

```bash
git add styles.css src/ui/DashboardView.ts main.js
git commit -m "style: fila de chips sin borde con seleccionado claro y badge de proyecto"
```

## Tarea 6: Documentación (AGENTS.md) y verificación final

**Archivos:**
- Modificar `AGENTS.md`.

- [ ] **Paso 1: Actualizar `AGENTS.md`**

- `src/domain/types.ts`: mencionar `ProjectRecord.favorite`.
- `src/domain/presentDashboard.ts`: documentar `DashboardSelection`, modo «all» y fallback a «all».
- `src/data/ProjectTaskRepository.ts`: «seis mutaciones» → siete con `setProjectFavorite`; anotar que `createProject` devuelve el hub path.
- Nueva entrada `src/ui/ProjectPickerModal.ts`.
- `src/ui/DashboardView.ts`: estado `selection` (en memoria, inicial «Todos»), chips = «Todos» + favoritos + «+», menú contextual de 3 opciones, badge en modo «Todos», `openProjectFolder` con API interna + fallback `Notice`.
- `styles.css`: topbar sin borde/título; eliminados chip-menu y dot de estado.
- Tests: actualizar recuento de tests por suite al valor real tras la ejecución.
- Estado del repo: añadir línea de esta entrega tras la V2.

- [ ] **Paso 2: Verificación final completa**

```bash
npm run typecheck   # limpio
npm test            # suite completa en verde
npm run build       # emite main.js
git status --short
```

- [ ] **Paso 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: actualizar AGENTS.md con favoritos y vista Todos"
```

## Autorrevisión del plan

- **Cobertura del spec:** prop `favorite` (T1), mutación + hub path (T2), selección/modo «Todos»/fallback (T3), chips/menú/picker/crear-desde-picker/topbar (T4), estilos/buscador/badge (T5), AGENTS.md (T6). Todo el spec tiene tarea.
- **Consistencia de tipos:** `DashboardSelection`, `setSelection`, `setProjectFavorite`, `createProject(): Promise<string>`, `ProjectPickerResult` y las firmas de `renderTasksPanel`/`renderTaskCard` se usan igual en las tareas que las consumen.
- **Proporción:** los pasos pin decisiones (firmas, nombres de test, textos UI) y dejan los cuerpos al implementador.
