# Diseño: Archivos por proyecto + proyecto sombra General (Todos)

Fecha: 2026-10-18
Estado: aprobado en conversación (brainstorming) — listo para plan de implementación.

## Resumen

Activar la sección `Archivos` del dashboard (hoy placeholder inerte en
`src/ui/DashboardView.ts:739`): listar, añadir y filtrar por nombre los ficheros
de `<Proyecto>/Archivos/`, más introducir el proyecto sombra `Projects/General/`
(`General.md` + `Tareas/` + `Archivos/` + `Credenciales.md`) cuyo contenido solo
es visible en modo «Todos».

## Decisiones tomadas (con el usuario)

1. **Añadir = copiar desde el sistema.** `<input type=file multiple>` oculto →
   `arrayBuffer()` → `repository.addFile()` a `Archivos/` con desambiguación
   (`nombre 2, 3…`). No se crea `.md` vacío en esta iteración.
2. **Alcance por selección.** En proyecto: archivos de ese proyecto. En «Todos»:
   `Todo + General` — tareas de todos + tareas de General (badge «General»);
   archivos en Todos = solo `General/Archivos/`.
3. **General = proyecto sombra.** Vive en `Projects/General/` con la misma
   estructura que cualquier proyecto. Se siembra si falta, se valida igual,
   pero nunca aparece en chips, favoritos, picker ni como selección directa.
4. **Filtro = contiene por nombre.** Case-insensitive en memoria, mismo patrón
   que `applyTaskQueryFilter` de tareas, con fila «Sin resultados».

## Comportamiento detallado

### Datos (`src/domain/types.ts`)

- Nuevo `FileRecord { path, name, extension, projectPath }`.
- `DashboardData` gana `files: FileRecord[]`.
- `ProjectRecord` gana `isGeneral?: boolean` (solo el hub `General.md`).
- `presentDashboard`: General excluido de selección directa; en `showAll` suma
  sus tareas y designa sus archivos como fuente de la sección en Todos.

### Vault + repo

- `VaultAdapter`: `listFiles(folder): VaultNoteRef[]` (no recursivo, toda
  extensión, ordenado) + `createBinary(path, data: ArrayBuffer)`. `trash()` se
  reutiliza para borrar ficheros.
- `ObsidianVaultAdapter`: `listFiles` vía `TFolder.children` filtrando `TFile`;
  `createBinary` vía `vault.createBinary`.
- `Repository.load()`: tras `seedTemplates()` → `ensureGeneral()` (crea carpeta,
  `General.md` por plantilla proyecto, `Tareas/`, `Archivos/`,
  `Credenciales.md` por plantilla credenciales; nunca sobrescribe). Luego
  escanea `<F>/Archivos/` de cada proyecto a `files[]`.
- `Repository.addFile(projectPath, name, data)`: sanitiza solo el stem
  (extensión intacta, reutiliza `sanitizeFilename`), desambigua con
  `uniqueFilePath`, asegura `Archivos/`, `createBinary`.
- Las credenciales de General se parsean a `DashboardData.credentials` pero sin
  UI dedicada (igual que V2). La sección Contraseña sigue placeholder.

### Vista + filtro (`src/ui/DashboardView.ts`)

- `renderBottomSections(data, presentation)` (hoy sin args). Estado nuevo
  `fileQuery=""` + `showFileFilters=false`.
- Card de archivo: nombre + clic abre (`openLinkText`) + papelera con
  confirmación (`ConfirmDeleteModal`) → `trash` + `refresh`.
- Botón `+` habilitado (hoy `disabled`): en proyecto copia a su `Archivos/`;
  en Todos copia a `General/Archivos/`.
- Filtro: funnel despliega `input "Buscar archivos…"`, filtrado en memoria sin
  `refresh` al teclear. Vacíos: «No hay archivos» / «Sin resultados».
- `styles.css`: reutiliza `.devhelper-task-filters/-search`; añade
  `.devhelper-file-list` mínima. Todo texto en español.

### Errores (español, accionables)

- Nombre inseguro, colisión irresoluble, binario que falla al copiar,
  `General.md` roto → issue como hub normal + `Notice` descriptivo.
- Regla dura: binarios nunca pasan por `processFrontMatter`; mutaciones
  atómicas; cuerpo y props de notas intactos.

## Cambios por módulo

- `src/domain/types.ts` — `FileRecord`, `files`, `isGeneral`.
- `src/domain/presentDashboard.ts` — exclusión de General de chips/selección,
  inclusión en `showAll`.
- `src/data/VaultAdapter.ts` + `ObsidianVaultAdapter.ts` — `listFiles`,
  `createBinary`.
- `src/data/ProjectTaskRepository.ts` — `ensureGeneral`, escaneo `Archivos/`,
  `addFile` + `uniqueFilePath` (preserva extensión).
- `src/ui/DashboardView.ts` — sección Archivos real, `fileQuery`, input file,
  abrir/borrar.
- `styles.css` — lista archivos mínima.
- `tests/` — falso adapter con store binario: siembra General, `load` lista
  archivos, `addFile` desambigua/preserva extensión, General oculto de chips.

## Criterios de aceptación

1. En proyecto seleccionado se listan sus archivos; el `+` copia un externo y
   aparece sin `refresh` manual.
2. El filtro por nombre oculta/muestra en vivo con «Sin resultados» si no hay
   coincidencia.
3. En «Todos» los archivos son los de `General/Archivos/` y las tareas incluyen
   las de General con badge.
4. `Projects/General/` se crea solo por primera vez y nunca aparece en
   chips/favoritos/picker.
5. `npm run typecheck`, `npm test`, `npm run build` en verde.

## Verificación

- `npm run typecheck`, `npm test`, `npm run build` antes de cada commit.
- Vault de prueba: crear proyecto, añadir pdf/png a su `Archivos/`, filtrar,
   borrar a papelera; borrar `General/` y comprobar re-siembra; modo Todos.
