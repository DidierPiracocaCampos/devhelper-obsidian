# Spec de diseño: Selector de proyectos con favoritos y vista «Todos»

Fecha: 2026-10-17
Estado: aprobado en conversación (brainstorming) — listo para plan de implementación.

## Resumen

Rediseñar la sección de selección de proyectos del dashboard: una fila de chips
sin título ni borde compuesta por el chip fijo **«Todos»**, un chip por cada
proyecto **favorito** (sólo el nombre, sin dot de estado ni botón «···») y un
botón **«+»** final que abre un modal buscador para añadir favoritos o crear un
proyecto nuevo. El click derecho sobre un chip de favorito abre un menú
contextual con exactamente tres opciones: «Abrir nota», «Abrir carpeta» y
«Quitar de mis favoritos». La referencia visual es una fila de píldoras oscuras
con el chip seleccionado en claro, y el buscador decorativo a la derecha con el
hint `Ctrl K` dentro del campo.

## Decisiones tomadas (con el usuario)

1. **Buscador**: fuera de alcance funcional; se mantiene decorativo y sólo se
   reestiliza para parecerse a la referencia (oscuro, redondeado, hint dentro).
2. **Persistencia de favoritos**: prop `favorite: true` en el frontmatter de la
   nota hub del proyecto. NO se toca `data.json` (se mantiene la regla dura:
   «las notas Markdown son la única fuente de verdad») y la mutación es atómica
   por prop vía `processFrontMatter`.
3. **Vista «Todos»**: lista plana con TODAS las tareas de TODOS los proyectos
   (orden actual: `open` antes que `done`, luego título), con el nombre del
   proyecto como **badge** dentro de cada tarjeta.
4. **Selección inicial**: siempre «Todos» al abrir la vista. La selección sigue
   viviendo sólo en memoria (nunca se persiste).
5. **Orden de chips**: alfabético (sort determinista actual, título asc
   case-insensitive con desempate por path). Sin reorden manual.
6. **Crear proyecto**: vive dentro del modal buscador (entrada «Crear proyecto
   nuevo…»); al crearlo se marca favorito automáticamente y queda seleccionado.
   El FAB «+» de crear que hoy está a la derecha de la topbar desaparece, igual
   que el botón filtro inerte de la topbar.
7. **Menú contextual**: exactamente tres opciones («Abrir nota», «Abrir
   carpeta», «Quitar de mis favoritos»). La opción «Editar» actual se elimina
   de la UI de chips (el renombrado sigue disponible editando la nota).
8. **Modal buscador**: al elegir un proyecto se añade y se cierra (patrón
   `FuzzySuggestModal`, como el Quick Switcher). Sin multiselección.

## Comportamiento detallado

### Fila de chips

- La sección NO tiene título (desaparece el `h2 "Proyectos"`) ni borde/fondo de
  panel: los chips viven directamente sobre el lienzo oscuro.
- Chip «Todos»: siempre el primero; seleccionado por defecto al abrir.
- Chips de favoritos: `data.projects.filter(favorite)` en orden alfabético.
  Texto plano con el título del proyecto. Sin indicador de `status` ni botón de
  menú (ese markup y su CSS se eliminan).
- Si no hay favoritos, la fila es «Todos» + «+» (no hay chip placeholder).
- Botón «+» al final: icono simple (`plus`), `aria-label` "Añadir proyecto a
  favoritos".

### Menú contextual (click derecho sobre chip de favorito)

Usa `obsidian.Menu` con `contextmenu` (`preventDefault`). Opciones en este orden:

1. **Abrir nota** → abre la nota hub (`project.path`), como el `openNote` actual.
2. **Abrir carpeta** → revela la carpeta del proyecto (`project.folderPath`) en
   el explorador de archivos de Obsidian. Se implementa en la vista (misma
   categoría que `openNote`: navegación de workspace, no lectura/escritura de
   datos) vía la hoja `file-explorer` y su API interna `revealInFolder`, con
   guardas `typeof` y un `Notice` en español como fallback si la API no está
   disponible.
3. **Quitar de mis favoritos** → `repository.setProjectFavorite(path, false)`.
   Si el proyecto quitado era el seleccionado, la selección cae a «Todos»
   (la vista resetea la selección explícitamente; el presenter no puede
   detectarlo porque el proyecto sigue existiendo).

### Vista «Todos» en el panel de tareas

- El panel lista todas las tareas de todos los proyectos con el comparador
  actual (`open` primero, luego título asc case-insensitive, desempate path).
- Cada tarjeta muestra un **badge** con el título del proyecto al que pertenece
  (mapa `path → título` construido desde `data.projects`; fallback al path si
  el proyecto no se encuentra).
- El FAB «Nueva tarea» del panel sigue existiendo; su `defaultProjectPath` es
  el proyecto seleccionado o `null` en modo «Todos» (el modal ya soporta null
  y muestra el desplegable de proyectos).

### Modal buscador de favoritos (`ProjectPickerModal`)

- `FuzzySuggestModal` sobre los proyectos **no favoritos**, ordenados
  alfabéticamente.
- Primera entrada fija: «Crear proyecto nuevo…» → abre `ProjectFormModal` en
  modo create; tras crear, el proyecto se marca favorito y queda seleccionado.
- Elegir un proyecto → `setProjectFavorite(path, true)`, el modal se cierra y
  el chip recién añadido queda seleccionado.

### Buscador decorativo

Se mantiene deshabilitado. Cambios puramente visuales: placeholder
«Busca en el vault…», hint «Ctrl K» posicionado DENTRO del campo a la derecha,
campo oscuro y redondeado según la imagen de referencia.

## Modelo de datos y dominio

### `ProjectRecord` gana `favorite: boolean`

`parseNote` (`buildProject`) la lee del bag de properties:
`favorite: properties.favorite === true`. Ausente, `false` o cualquier valor no
booleano (`"yes"`, `1`, …) → `false`. Nunca genera issue. Las plantillas NO se
modifican (`favorite` no es property fija).

### Nueva mutación del repositorio

```ts
async setProjectFavorite(path: string, favorite: boolean): Promise<void>
```

Cambio atómico de la única prop `favorite` vía `processFrontMatter`. Además,
`createProject(title)` pasa de `Promise<void>` a `Promise<string>` y devuelve
el path de la nota hub creada, para que la vista pueda marcarla favorita justo
después (necesario porque el nombre se sanitiza/desambigua dentro).

### Selección discriminada en `presentDashboard`

```ts
export type DashboardSelection =
  | { kind: "all" }
  | { kind: "project"; path: string };
```

`presentDashboard(data, selection)` devuelve:

```ts
interface DashboardPresentation {
  selection: DashboardSelection;         // selección efectiva (tras fallback)
  selectedProject: ProjectRecord | null; // null en modo «all»
  showAll: boolean;
  tasks: TaskRecord[];
  issues: DashboardIssue[];
}
```

Reglas:

- `{ kind: "all" }` → `showAll: true`, `selectedProject: null`, `tasks` = todas
  las tareas ordenadas con el comparador actual.
- `{ kind: "project", path }` con path existente → comportamiento actual
  (proyecto + sus tareas), `showAll: false`.
- `{ kind: "project", path }` con path inexistente (p. ej. proyecto renombrado
  o borrado fuera) → **cae a «Todos»** (`selection` efectiva `{ kind: "all" }`).
- Sin proyectos → «Todos» con lista vacía.

La vista guarda `private selection: DashboardSelection = { kind: "all" }` y la
sincroniza con `presentation.selection` tras cada render (mismo patrón que
hoy con `selectedProjectPath`).

## Cambios por archivo

- `src/domain/types.ts` — `ProjectRecord.favorite`; `DashboardSelection` se
  define en `presentDashboard.ts`.
- `src/domain/parseNote.ts` — lectura de `favorite` en `buildProject`.
- `src/domain/presentDashboard.ts` — firma nueva, modo «all», fallback a «all».
- `src/data/ProjectTaskRepository.ts` — `setProjectFavorite`;
  `createProject` devuelve `Promise<string>` (path del hub).
- `src/ui/ProjectPickerModal.ts` *(nuevo)* — `FuzzySuggestModal` de no
  favoritos + entrada «Crear proyecto nuevo…».
- `src/ui/DashboardView.ts` — estado `selection`; reescritura de
  `renderProjectChips`; menú contextual; `openProjectFolder`; topbar sin
  título/filtro/FAB-crear; badge en tarjetas en modo «Todos»; `openEditProject`
  y el menú «···» desaparecen (`ProjectFormModal` conserva su modo edit para
  uso futuro).
- `styles.css` — topbar sin borde/fondo; chips píldora oscuras con seleccionado
  claro y texto oscuro; `.devhelper-chip-add`; buscador con hint interno;
  `.devhelper-task-project-badge`; borrado de `.devhelper-chip-menu` y
  `.devhelper-project-status*`.

## Casos límite

- Proyecto existente sin prop `favorite` → no favorito, sin issue.
- `favorite` con valor no booleano → `false`, sin issue.
- Sin favoritos → fila «Todos» + «+»; el dashboard sigue funcionando.
- Quitar de favoritos el proyecto seleccionado → selección cae a «Todos».
- Proyecto seleccionado que desaparece (renombrado/borrado externo) → el
  presenter cae a «Todos».
- Usuario con plantilla de proyecto forkeada (sin `favorite`): al crear desde
  el picker, la vista marca el favorito explícitamente con `setProjectFavorite`
  sobre el path devuelto por `createProject` — no depende de la plantilla.
- `revealInFolder` no disponible (API interna cambia) → `Notice` en español y
  nada más; el dashboard no se rompe.

## Tests

- `tests/parseNote.test.ts`: `favorite: true` → `true`; `favorite: false` →
  `false`; ausente → `false`; valor inválido (`"yes"`) → `false`.
- `tests/presentDashboard.test.ts`: migrados a la nueva firma; nuevos casos
  para modo «all» (todas las tareas, `open` primero aunque mezcle proyectos) y
  fallback a «all» con path fantasma.
- `tests/ProjectTaskRepository.test.ts`: `setProjectFavorite` crea la prop si
  falta preservando el resto y el cuerpo; la pone a `false` si era `true`;
  round-trip vía `load()`; `createProject` devuelve el path del hub.

## Fuera de alcance

- Buscador funcional del vault y atajo Ctrl+K (el campo sigue decorativo).
- Reorden manual de chips (drag & drop).
- Multiselección en el modal buscador.
- Renombrar/editar proyecto desde la UI de chips (sólo las 3 opciones del menú).
- Borrado de proyectos/tareas (sigue siendo roadmap).

## Verificación

`npm run typecheck`, `npm test` (suite completa) y `npm run build` en verde.
Verificación manual opcional en el vault de prueba
(`D:\proyects\devhelper-test-vault\`).
