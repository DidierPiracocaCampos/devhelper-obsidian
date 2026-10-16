# Plan de implementación: Dashboard DevHelper para Obsidian V1

> **Para trabajadores agénticos:** SUB-SKILL OBLIGATORIO: Usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan sintaxis de casilla (`- [ ]`) para el seguimiento.

**Objetivo:** Construir un plugin de Obsidian que ofrezca un dashboard adaptable para proyectos respaldados por Markdown y tareas enlazadas.

**Arquitectura:** Un `ItemView` propio de Obsidian renderiza la selección de proyectos, las tarjetas de tareas y los problemas de validación de notas. Una capa de repositorio lee y escribe Markdown a través de un adaptador de vault estrecho; el almacenamiento del plugin contiene solo los ajustes. Una pestaña de ajustes pequeña configura las carpetas de proyectos y tareas.

**Stack tecnológico:** TypeScript, Obsidian Plugin API, esbuild, Vitest, parser YAML (`js-yaml`); DOM nativo y variables de tema de Obsidian, sin framework de UI.

**Spec:** `docs/superpowers/specs/2026-10-04-obsidian-project-dashboard-design.md`

## Restricciones globales

- Las notas Markdown son la única fuente de verdad; los datos de proyectos y tareas no deben duplicarse en el almacenamiento del plugin.
- Las carpetas por defecto son `Projects/` y `Tasks/`, configurables desde los ajustes.
- Properties requeridas: proyecto `type: project`; tarea `type: task`, `project` como wikilink y `status: open|done`.
- Preservar las Properties definidas por el usuario y el cuerpo Markdown al editar.
- La V1 admite crear, editar y completar tareas; no admite borrado.
- La integración con IA, las skills propias, el calendario, el manejo de archivos, las contraseñas cifradas y las plantillas de vault quedan fuera de la V1.
- El dashboard sigue la estética acordada (fondo oscuro / panel claro / tarjeta oscura) y se adapta a los temas de Obsidian y al ancho del panel.
- Orden determinista: proyectos por `title` ascendente (sin distinguir mayúsculas; desempate por `path`); tareas por `status` (`open` antes que `done`) y luego `title` ascendente (sin distinguir mayúsculas; desempate por `path`).
- Nombres de archivo seguros y únicos: al crear o renombrar, sustituir `\ / : * ? " < > |` y `#` por `-`, recortar `.` y espacios finales, usar `Untitled` si el resultado queda vacío, y si la ruta ya existe añadir ` 2`, ` 3`, … antes de `.md`.
- `selectedProjectPath` es estado en memoria de la vista (no se persiste); si el proyecto desaparece tras un refresco, se selecciona el primer proyecto ordenado (o `null` si no hay ninguno).

## Foco de revisión

- YAML/frontmatter malformado o sin terminar: el parser debe devolver un problema específico de la nota sin abortar el escaneo del vault.
- Falta `type`, falta `project`/`status` en tareas, o un valor de estado no admitido: la validación debe devolver un problema preciso y dejar la nota sin cambios.
- Enlaces de proyecto de tarea sin resolver o que apuntan a una nota que no es proyecto: el repositorio debe reportar la tarea afectada y mantener disponibles los demás registros.
- Títulos duplicados o no seguros y carpetas anidadas ausentes: el repositorio debe generar una ruta segura y única (también al renombrar), crear las carpetas que falten y no sobrescribir nunca otra nota.
- Rutas de carpeta inseguras (absolutas, `..`, barras invertidas): `normalizeVaultFolderPath` debe rechazarlas o normalizarlas sin salir del vault.
- Orden de presentación no determinista: los tests de `presentDashboard` deben fijar el orden secundario (título) para evitar pruebas frágiles.
- El proyecto seleccionado desaparece (renombrado/borrado externamente): `refresh()` debe caer al primer proyecto sin romper la vista.
- Ediciones o renombrados de Markdown con el dashboard abierto: la verificación de integración/manual debe refrescar la vista y demostrar que las Properties personalizadas y el cuerpo sobreviven a las escrituras del dashboard.

---

## Mapa de archivos

- `manifest.json`, `package.json`, `package-lock.json`, `tsconfig.json`, `esbuild.config.mjs`: identidad del plugin, dependencias, comprobación de tipos y bundles de producción/desarrollo.
- `src/main.ts`: ciclo de vida del plugin, comando, botón de ribbon, registro de la vista, carga de ajustes y cableado de eventos del vault.
- `src/settings.ts`, `src/ui/SettingsTab.ts`: ajustes por defecto y persistidos de carpetas, más su UI de ajustes de Obsidian.
- `src/domain/types.ts`, `src/domain/parseNote.ts`, `src/domain/presentDashboard.ts`: registros de dominio validados, parseo del frontmatter Markdown y orden determinista del dashboard.
- `src/data/VaultAdapter.ts`, `src/data/ObsidianVaultAdapter.ts`, `src/data/ProjectTaskRepository.ts`: frontera de vault testeable y lecturas/escrituras de proyectos y tareas.
- `src/ui/DashboardView.ts`, `src/ui/ProjectFormModal.ts`, `src/ui/TaskFormModal.ts`: dashboard, creación y edición de proyectos/tareas, acciones de estado y acciones sobre problemas de validación.
- `styles.css`: estilos adaptables del dashboard usando variables de tema de Obsidian.
- `tests/settings.test.ts`, `tests/parseNote.test.ts`, `tests/presentDashboard.test.ts`, `tests/ProjectTaskRepository.test.ts`: tests unitarios enfocados.
- `README.md`: desarrollo, instalación, esquema Markdown y comportamiento de la V1.
- `.gitignore`: solo dependencias generadas y salidas de build; no ignorar ni alterar `.agents/` ni `skills-lock.json` existentes.

## Tarea 1: Crear el esqueleto de un plugin de Obsidian compilable

**Archivos:** Crear `manifest.json`, `package.json`, `package-lock.json` (generado por npm), `tsconfig.json`, `esbuild.config.mjs`, `.gitignore`, `src/main.ts`, `styles.css` y `README.md`.

**Interfaces:** `src/main.ts` exporta la subclase `Plugin` por defecto. El manifest inicial usa ID de plugin `devhelper-dashboard`, nombre visible `DevHelper Dashboard`, versión `0.1.0`, versión mínima de Obsidian `1.4.0`, autor `DevHelper` e `isDesktopOnly: false`; verifica la disponibilidad del ID antes de cualquier envío al marketplace.

- [ ] Crear el manifest y la configuración de TypeScript/esbuild; marcar `obsidian` como dependencia externa del bundle.
- [ ] Añadir los scripts npm `dev`, `build`, `typecheck` y `test`; usar `obsidian` para los tipados de API, Vitest para los tests y `js-yaml` (más `@types/js-yaml`) para el parseo del frontmatter; fijar versiones en `devDependencies` y añadir `"engines": { "node": ">=18" }`; generar el lockfile con `npm install`.
- [ ] Añadir el punto de entrada mínimo del plugin y una hoja de estilos vacía consciente del tema; limitar `.gitignore` a archivos generados como `node_modules/`, `main.js` y source maps.
- [ ] Ejecutar `npm run typecheck` y `npm run build`.

Ejecutar: `npm run typecheck; npm run build`
Esperado: ambos comandos salen con éxito y el build emite `main.js` sin empaquetar Obsidian.

- [ ] Commit como `build: crear esqueleto del plugin DevHelper para Obsidian`.

## Tarea 2: Añadir ajustes y normalización de rutas de carpetas

**Archivos:** Crear `src/settings.ts`, `src/ui/SettingsTab.ts` y `tests/settings.test.ts`; modificar `src/main.ts` y `package.json` solo si es necesario para ejecutar tests.

**Interfaces:** `PluginSettings` tiene `projectsFolder: string` y `tasksFolder: string`. `DEFAULT_SETTINGS` es `{ projectsFolder: "Projects", tasksFolder: "Tasks" }`. `normalizeVaultFolderPath(path: string, fallback: string): string` recorta espacios y barras `/` iniciales/finales y devuelve una ruta relativa al vault; una entrada vacía devuelve `fallback`. Reemplaza `\` por `/`, colapsa `/` repetidas y rechaza (devolviendo `fallback`) las rutas absolutas (que empiezan por `/` o por letra de unidad como `C:`) y cualquier ruta con un segmento `..`.

- [ ] Escribir los tests `usesDefaultFolders()` y `normalizesFolderPath()` que verifican los valores por defecto `Projects`/`Tasks`, el recorte de espacios y `/` circundantes, y el fallback para entrada vacía.
- [ ] Añadir los tests `rejectsAbsolutePath()`, `rejectsParentTraversal()` y `collapsesSlashes()` que verifican que una ruta absoluta, una con `..` y una con `//` o `\` se normalizan a una ruta relativa segura o devuelven `fallback`.
- [ ] Ejecutar `npm test -- tests/settings.test.ts` y verificar que los nuevos tests fallan porque el módulo de ajustes no está implementado.
- [ ] Implementar los valores por defecto y la normalización en `src/settings.ts`.
- [ ] Implementar un `PluginSettingTab` con entradas de texto para ambas carpetas; persistir solo los ajustes con `loadData()`/`saveData()` del plugin.
- [ ] Ejecutar `npm test -- tests/settings.test.ts` y `npm run typecheck`.

Esperado: los tests de ajustes pasan; los ajustes nunca incluyen registros de proyectos/tareas.

- [ ] Commit como `feat: configurar carpetas de proyectos y tareas`.

## Tarea 3: Parsear y validar el Markdown de proyectos y tareas

**Archivos:** Crear `src/domain/types.ts`, `src/domain/parseNote.ts` y `tests/parseNote.test.ts`.

**Interfaces:** `ProjectRecord` es `{ path: string; title: string; properties: Record<string, unknown> }`. `TaskRecord` es `{ path: string; title: string; projectPath: string; status: "open" | "done"; properties: Record<string, unknown> }`. `DashboardIssue` es `{ path: string; message: string }`. `DashboardData` es `{ projects: ProjectRecord[]; tasks: TaskRecord[]; issues: DashboardIssue[] }`. `NoteSnapshot` es `{ path: string; basename: string; content: string }`. `ParsedNote` es `{ kind: "project"; project: ProjectRecord } | { kind: "task"; task: TaskRecord } | { kind: "issue"; issue: DashboardIssue }`. `parseProjectTaskNote(note: NoteSnapshot, resolveProject: (link: string, sourcePath: string) => string | null): ParsedNote` devuelve una de esas variantes.

- [ ] Escribir los tests `parsesValidProject()`, `parsesValidTask()`, `reportsMalformedFrontmatter()`, `reportsMissingOrWrongType()`, `reportsMissingTaskProject()`, `reportsMissingOrInvalidTaskStatus()` y `reportsUnresolvedTaskProject()`; verificar que los registros válidos conservan las Properties personalizadas y que cada nota inválida produce su propio problema específico de ruta.
- [ ] Ejecutar `npm test -- tests/parseNote.test.ts` y verificar que los tests de comportamiento fallan antes de la implementación.
- [ ] Implementar la extracción del frontmatter y el parseo YAML con el paquete `js-yaml`; usar el nombre base de la nota como título mostrado y conservar las Properties personalizadas parseadas en cada registro válido.
- [ ] Devolver un único problema para una nota inválida en lugar de lanzar e interrumpir el escaneo completo de la carpeta.
- [ ] Ejecutar `npm test -- tests/parseNote.test.ts` y `npm run typecheck`.

Esperado: cada entrada inválida produce un problema específico de ruta; los archivos válidos se parsean sin perder Properties personalizadas.

- [ ] Commit como `feat: parsear y validar notas de proyectos y tareas`.

## Tarea 4: Implementar el adaptador de vault y el repositorio

**Archivos:** Crear `src/data/VaultAdapter.ts`, `src/data/ObsidianVaultAdapter.ts`, `src/data/ProjectTaskRepository.ts` y `tests/ProjectTaskRepository.test.ts`; usar los tipos y el parser de la Tarea 3.

**Interfaces:** `VaultNoteRef` es `{ path: string; basename: string }`. `VaultAdapter` expone `listMarkdownFiles(folderPath: string): VaultNoteRef[]`, `read(note: VaultNoteRef): Promise<string>`, `createFolder(path: string): Promise<void>` (crea la carpeta y todos sus ancestros ausentes, ya que el `createFolder` de Obsidian solo crea un nivel), `createMarkdown(path: string, content: string): Promise<VaultNoteRef>`, `rename(note: VaultNoteRef, newPath: string): Promise<VaultNoteRef>`, `processFrontMatter(note: VaultNoteRef, update: (frontmatter: Record<string, unknown>) => void): Promise<void>` y `resolveLink(linkPath: string, sourcePath: string): VaultNoteRef | null`. `ProjectTaskRepository.load(): Promise<DashboardData>` devuelve `{ projects: ProjectRecord[]; tasks: TaskRecord[]; issues: DashboardIssue[] }`. También expone `createProject(title: string): Promise<void>`, `createTask(title: string, projectPath: string): Promise<void>`, `renameProject(path: string, title: string): Promise<void>`, `renameTask(path: string, title: string): Promise<void>`, `reassignTask(path: string, projectPath: string): Promise<void>` y `setTaskStatus(path: string, status: "open" | "done"): Promise<void>`.

- [ ] Escribir tests de repositorio usando un `VaultAdapter` falso para: escaneo de carpetas, aislamiento de notas válidas/inválidas, enlaces de tarea sin resolver, creación de notas, edición/renombrado, actualización de enlaces al renombrar proyecto, reasignación de tarea, cambios de estado, títulos duplicados y conservación de Properties personalizadas y cuerpo.
- [ ] Añadir los tests `sanitizesUnsafeCharacters()` y `renamingToExistingTitleDisambiguates()` que verifican que un título con caracteres ilegales se sanitiza y que renombrar a un título ya existente genera una ruta nueva con sufijo sin sobrescribir la nota original.
- [ ] Ejecutar `npm test -- tests/ProjectTaskRepository.test.ts` y verificar que los tests fallan antes de la implementación.
- [ ] Implementar `ObsidianVaultAdapter` con las APIs de vault/file-manager de Obsidian, incluido `processFrontMatter` para editar Properties y la operación segura de renombrado de archivos para editar títulos; `createFolder` debe crear cada nivel de la ruta por separado.
- [ ] Implementar `ProjectTaskRepository` para escanear solo las carpetas configuradas, crear las carpetas ausentes, generar rutas Markdown seguras y únicas (sanitizando y sufijando según las restricciones globales, también al renombrar), escribir el frontmatter acordado, resolver los wikilinks de proyecto de las tareas y devolver problemas por nota.
- [ ] Escribir notas de proyecto con `---\ntype: project\n---\n`; escribir notas de tarea con `---\ntype: task\nproject: "[[<ruta de vault del proyecto sin .md>]]"\nstatus: open\n---\n`. Usar las rutas de carpetas configuradas al construir los enlaces de proyecto.
- [ ] En `renameProject`, actualizar las Properties `project` de las tareas que apuntaban a la ruta antigua del proyecto, incluso cuando la preferencia de actualización automática de enlaces de Obsidian esté desactivada; testear `renamingProjectUpdatesLinkedTasks()`.
- [ ] Garantizar que cada operación muta solo su Property controlada nombrada (`type` en la creación, `project` en creación/reasignación de tarea, `status` en el cambio de estado); no reescribir cuerpos de nota ni eliminar otras Properties.
- [ ] Ejecutar `npm test -- tests/ProjectTaskRepository.test.ts`, `npm test` y `npm run typecheck`.

Esperado: todos los tests del repositorio pasan; los títulos duplicados nunca sobrescriben notas existentes.

- [ ] Commit como `feat: gestionar notas Markdown de proyectos y tareas`.

## Tarea 5: Implementar la presentación del dashboard y los formularios

**Archivos:** Crear `src/domain/presentDashboard.ts`, `tests/presentDashboard.test.ts`, `src/ui/DashboardView.ts`, `src/ui/ProjectFormModal.ts` y `src/ui/TaskFormModal.ts`; modificar `src/main.ts` y `styles.css`.

**Interfaces:** `DashboardPresentation` es `{ selectedProject: ProjectRecord | null; tasks: TaskRecord[]; issues: DashboardIssue[] }`. `presentDashboard(data: DashboardData, selectedProjectPath: string | null): DashboardPresentation` devuelve el proyecto seleccionado, sus tareas ordenadas con `open` antes que `done` (y luego por `title` ascendente, sin distinguir mayúsculas, con desempate por `path`), y los problemas visibles; los proyectos se ordenan por `title` ascendente (sin distinguir mayúsculas, desempate por `path`). `DashboardView` recibe el repositorio, expone `refresh(): Promise<void>` y mantiene `selectedProjectPath` en memoria (si el proyecto desaparece, cae al primer proyecto ordenado, o `null` si no hay ninguno). Los formularios de proyecto crean o renombran un proyecto; los de tarea crean o editan el título y el enlace de proyecto de una tarea.

- [ ] Escribir los tests `showsEmptyDashboard()`, `selectsFirstProjectByDefault()`, `filtersTasksToSelectedProject()`, `ordersOpenTasksBeforeDone()` y `showsValidationIssues()` con registros y orden esperados explícitos.
- [ ] Añadir los tests `ordersProjectsByTitle()` y `ordersTasksByTitleWithinStatus()` que fijan el orden secundario determinista, y `fallsBackWhenSelectedProjectMissing()` que verifica que un `selectedProjectPath` inexistente cae al primer proyecto.
- [ ] Ejecutar `npm test -- tests/presentDashboard.test.ts` y verificar que esos tests fallan.
- [ ] Implementar `presentDashboard` y hacer pasar sus tests.
- [ ] Implementar los modales de proyecto y tarea con validación de campos requeridos; por defecto una tarea nueva se asigna al proyecto seleccionado.
- [ ] Implementar un `ItemView` propio con etiquetas en español, selección de proyecto, controles de creación, tarjetas de tarea, cambio/reabrir de estado, acciones de edición y mensajes de problema por nota con una acción para abrir la nota de origen.
- [ ] Añadir estilos adaptables basados en variables de tema de Obsidian: lienzo oscuro, paneles claros redondeados, tarjetas de tarea oscuras; incluir layouts de panel estrecho y ancho. No añadir controles de borrado.
- [ ] Ejecutar `npm test`, `npm run typecheck` y `npm run build`.

Esperado: los tests de presentación pasan y el bundle del plugin contiene la vista y los formularios completos.

- [ ] Commit como `feat: añadir vista de dashboard de proyectos y tareas`.

## Tarea 6: Cablear el ciclo de vida, el refresco y los ajustes en el plugin

**Archivos:** Modificar `src/main.ts` y `src/ui/DashboardView.ts`; actualizar `tests/ProjectTaskRepository.test.ts`.

- [ ] Registrar la vista propia, un comando `open-dashboard`, un botón de ribbon y la pestaña de ajustes en el ciclo de vida del plugin.
- [ ] Añadir manejo de refresco para eventos de crear/modificar/borrar/renombrar del vault y cambios de metadata-cache; debounce de los refrescos y usar el evento de renombrado del vault porque los cambios de metadata-cache no se emiten para renombrados.
- [ ] Garantizar que editar desde el dashboard refresca desde el Markdown guardado en lugar de depender de una copia en memoria separada.
- [ ] Añadir `reloadReadsManualMarkdownChanges()`: modificar el estado/enlace de una tarea en el vault falso, recargar los datos del repositorio y verificar que la tarea devuelta refleja el Markdown editado; la conservación de cuerpo y Properties personalizadas la verifican los tests de escritura del repositorio en la Tarea 4.
- [ ] Ejecutar `npm test`, `npm run typecheck` y `npm run build`.

Esperado: el comando y el botón de ribbon muestran una única vista de dashboard; los cambios externos de Markdown la actualizan sin reiniciar Obsidian.

- [ ] Commit como `feat: sincronizar el dashboard con los cambios del vault`.

## Tarea 7: Documentar y verificar la V1

**Archivos:** Actualizar `README.md` y, si el build final lo requiere, `manifest.json` o la configuración de build.

- [ ] Documentar los comandos de instalación/desarrollo, las carpetas configurables, las Properties requeridas, los estados de tarea, el comportamiento de edición, los errores de validación y el límite de no-borrado de la V1.
- [ ] Ejecutar `npm test`, `npm run typecheck` y `npm run build`; inspeccionar que las salidas de release incluyan `main.js`, `manifest.json` y `styles.css`.
- [ ] En un vault de prueba limpio, verificar creación y enlace de proyectos/tareas, edición/renombrado de títulos, reasignación de tarea, completado/reabrir, ediciones directas de Markdown, notas malformadas, carpetas ausentes, títulos duplicados y conservación de Properties personalizadas y cuerpo.
- [ ] Verificar la vista en un panel estrecho y en uno ancho con los temas claro y oscuro de Obsidian; confirmar que una acción de problema abre la nota afectada.
- [ ] Commit como `docs: documentar la V1 del dashboard y su verificación`.

## Verificación final

Ejecutar desde la raíz del proyecto:

```powershell
npm test
npm run typecheck
npm run build
git status --short
```

Esperado: todos los tests pasan, TypeScript no reporta errores, el bundle de producción se construye y solo quedan en el árbol de trabajo los cambios intencionales visibles para el usuario.
