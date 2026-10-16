# DevHelper Dashboard

Plugin de Obsidian que ofrece un dashboard adaptable de proyectos y tareas
respaldados por notas Markdown. Las notas son la única fuente de verdad:
el plugin no duplica proyectos ni tareas en su almacenamiento. Las
Properties personalizadas del usuario y el cuerpo Markdown se conservan al
editar.

## Características de la V1

- Vista propia del plugin (comando y botón de ribbon en la barra lateral).
- Carpetas predeterminadas `Projects/` y `Tasks/`, configurables desde
  los ajustes.
- Creación, renombrado y reasignación de proyectos y tareas enlazadas.
- Cambio de estado de tarea entre `open` y `done` (botones
  *Marcar como hecho* / *Reabrir* en cada tarjeta).
- Sincronización bidireccional: cambios manuales en las notas se
  reflejan en el dashboard, y las ediciones desde el dashboard se
  aplican al Markdown.
- Avisos de validación visibles en el dashboard, con un botón *Abrir
  nota* para corregir la nota afectada.
- Estética adaptable: lienzo oscuro, paneles claros y tarjetas de tarea
  oscuras, que siguen los colores del tema activo de Obsidian y se
  acomodan a paneles estrechos o anchos.

## Instalación en un vault

1. Ejecuta `npm run build` en la raíz del proyecto.
2. Copia los tres archivos de release a la carpeta del plugin dentro de
   tu vault:
   - `main.js`
   - `manifest.json`
   - `styles.css`
   
   Destino:
   ```
   <vault>/.obsidian/plugins/devhelper-dashboard/
   ```
3. En Obsidian abre **Ajustes → Complementos → Complementos de la
   comunidad** (o **Ajustes → Complementos**), habilita el plugin
   `devhelper-dashboard` y, si lo deseas, muestra su vista con el botón
   del ribbon *layout-dashboard* o con el comando **Dashboard DevHelper**.

En un vault nuevo el plugin arranca sin carpetas ni notas previas; las
carpetas por defecto `Projects/` y `Tasks/` se crean al primer uso.

> Las rutas de las carpetas se pueden cambiar en
> **Ajustes → DevHelper Dashboard**. Si la entrada queda vacía o es
> inválida, el plugin recupera el valor por defecto seguro.

## Desarrollo

Requisitos: Node.js ≥ 18.

```bash
npm install        # instala dependencias (solo la primera vez)
npm run dev        # watch con esbuild + sourcemap inline (recarga al guardar)
npm run build      # build de producción con minificación → emite main.js
npm run typecheck  # tsc --noEmit (verifica tipos sin emitir archivos)
npm run test       # vitest run (suite completa de tests)
```

Artefactos que produce el build (a copiar en la carpeta del plugin):
`main.js`, `manifest.json`, `styles.css`.

## Estructura de las notas

El plugin solo administra notas dentro de las carpetas configuradas. Las
notas válidas deben cumplir el siguiente esquema de Properties
(frontmatter YAML):

- **Proyecto** (`Projects/<titulo>.md`)
  ```yaml
  ---
  type: project
  ---
  ```
- **Tarea** (`Tasks/<titulo>.md`)
  ```yaml
  ---
  type: task
  project: "[[Projects/Ruta/Al/Proyecto]]"
  status: open
  ---
  ```

El título que muestra el dashboard es el nombre base del archivo (sin
extensión). El wikilink de `project` apunta al proyecto correspondiente
en su carpeta.

Estados de tarea admitidos:

- `open` — pendiente (aparece como **Pendiente**).
- `done` — completada (aparece como **Hecho**).

Cualquier Property distinta de las administradas (`type`, `project`,
`status`) queda intacta al editar desde el dashboard. El cuerpo
Markdown del usuario también se conserva.

## Edición desde el dashboard

Desde la cabecera del dashboard se pueden crear proyectos y tareas. En
cada tarjeta de tarea o proyecto hay botones para:

- **Editar** — abrir el modal de edición (permite renombrar y, en
  tareas, reasignar el proyecto enlazado).
- **Marcar como hecho / Reabrir** — alterna el estado entre `open` y
  `done`.
- **Abrir** — abrir la nota subyacente en el editor de Obsidian.

El dashboard reordena automáticamente los proyectos por título
(ascendente, sin distinguir mayúsculas) y, dentro del proyecto
seleccionado, coloca primero las tareas `open` y luego las `done`.

## Errores de validación

La sección **Notas con problemas** aparece al final del dashboard
siempre que alguna nota administrada tenga formato inválido. Muestra
la ruta de la nota, una descripción del problema y un botón **Abrir
nota** para corregirla directamente. Los problemas cubren, como
mínimo:

- YAML o frontmatter malformado.
- Falta de `type`, falta de `project`/`status` en tareas, o valores no
  admitidos.
- Enlaces de proyecto que no apuntan a una nota de proyecto.

Una nota inválida no impide usar el resto del dashboard: el resto de
proyectos y tareas sigue disponible.

## Límite de la V1

Esta versión **no incluye borrado de proyectos ni de tareas** desde el
dashboard ni desde los modales. Si necesitas eliminar una nota, hazlo
directamente desde el vault de Obsidian; el dashboard se refrescará al
detectar el cambio.

Quedan fuera del alcance de la V1 (en el roadmap para versiones
posteriores): integración con IA, skills propias del sistema,
calendario, manejo de archivos, contraseñas cifradas y plantillas de
vault.

## Temas y adaptación de ancho

La vista usa exclusivamente las variables de tema de Obsidian
(`--background-primary`, `--background-secondary`,
`--background-primary-alt`, `--background-modifier-border`,
`--text-normal`, etc.) definidas en `styles.css`, por lo que se adapta
de forma automática al tema claro y al tema oscuro sin configuración
adicional. El layout también responde al ancho del panel: las tarjetas
y los controles de la cabecera colapsan a una sola columna por debajo
de 320 px y se expanden horizontalmente en paneles anchos.

## Verificación local

La lógica del plugin está cubierta por la suite de Vitest. Para
ejecutarla:

```bash
npm test          # 46 tests: ajustes, parseo, presentación y repositorio
npm run typecheck # tsc --noEmit
npm run build     # emite main.js (minificado, sourcemap externo ausente)
```

Cada criterio de aceptación del
[spec de diseño](docs/superpowers/specs/2026-10-04-obsidian-project-dashboard-design.md)
queda satisfecho por una o más pruebas automatizadas:

1. **Instalación en un vault nuevo sin template.** — el plugin se
   inicia con vault vacío; los tests de repositorio usan `VaultAdapter`
   falsos sin carpetas previas y validan el arranque limpio.
2. **Crear proyecto y tarea enlazada.** — cubierto por los tests
   `creates a project note in the configured folder` y
   `creates a task note linked to the given project` en
   `tests/ProjectTaskRepository.test.ts`, y por los tests de parseo
   `parses a project note and preserves custom properties` y
   `parses a task note and resolves the project link to a vault path`
   en `tests/parseNote.test.ts`.
3. **Cambio de estado y agrupación por proyecto.** — cubierto por
   `flips open to done and updates only the status property` en el
   repositorio, y por los tests de `presentDashboard`
   (`returns only tasks for the selected project`,
   `places open tasks before done tasks even when title sort would
   disagree`).
4. **Cambios manuales en Markdown reflejados sin reiniciar Obsidian.**
   — cubierto por el test de integración
   `picks up status and project-link edits made directly on the file`
   en `tests/ProjectTaskRepository.test.ts`, que modifica el Markdown
   en el vault falso, recarga el repositorio y comprueba que el cambio
   llega al dashboard.
5. **Edición desde el dashboard conserva cuerpo y Properties
   personalizadas.** — cubierto por los tests
   `updates only the project property and preserves the body and other
   keys`, `flips open to done and updates only the status property` y
   `createTask does not strip unknown properties when reloading the
   note`, que verifican que solo se mutan las Properties controladas
   (`type`, `project`, `status`). El renombrado de proyecto además
   propaga el nuevo path a las tareas que lo apuntaban (`updates the
   project property of every task that linked the old path`).
6. **Una nota inválida no rompe el dashboard y permite abrir la
   nota.** — cubierto por los tests de `tests/parseNote.test.ts`
   (`returns a single issue for an unclosed frontmatter block`,
   `returns a single issue for invalid YAML inside the frontmatter`,
   `returns a single issue for a note without a type property`,
   `returns a single issue for a task missing the project property`,
   `returns a single issue for a task whose status is not open or
   done`, `returns a single issue for a task missing the status
   property`, `returns a single issue when the resolver cannot find
   the linked project`) y por el botón *Abrir nota* de la sección
   **Notas con problemas** de la vista. La persistencia del resto del
   dashboard cuando hay notas inválidas la asegura también
   `surfaces invalid notes as issues without dropping valid ones`.
   Los caracteres inseguros y los duplicados se cubren con
   `strips characters forbidden by Windows and Obsidian`,
   `returns 'Untitled' when the sanitized title is empty` y
   `appends ' 2', ' 3', ... to avoid overwriting an existing note` en
   el repositorio.
7. **Estética adaptable a temas y anchos.** — implementado en
   `styles.css` con variables de tema de Obsidian y breakpoints a 320 px
   y 480 px; no requiere test adicional porque las variables las
   resuelve el host de Obsidian en tiempo de render.

### Verificación manual en un vault de pruebas

Para una prueba manual de extremo a extremo:

1. Crea un perfil de Obsidian temporal (`obsidian --user-data-dir=...`).
2. Habilita plugins de la comunidad y desactiva el modo seguro.
3. Copia `main.js`, `manifest.json` y `styles.css` a
   `<perfil-temporal>/.obsidian/plugins/devhelper-dashboard/`.
4. Activa el plugin y abre el dashboard.
5. Recorre el flujo completo: crear un proyecto, crear una tarea
   enlazada, alternar su estado, renombrar tanto el proyecto como la
   tarea (comprobando que el wikilink `project` se actualiza en las
   tareas que lo apuntaban), reasignar una tarea a otro proyecto,
   editar manualmente una nota en el editor (recargar/refrescar el
   dashboard) e introducir notas inválidas para ver la sección
   **Notas con problemas**.

## Estructura del repositorio

```
manifest.json         # identidad del plugin (id, nombre, versión…)
package.json          # dependencias, scripts npm
tsconfig.json         # configuración de TypeScript
esbuild.config.mjs    # bundler (dev watch + build de producción)
styles.css            # estilos de la vista (variables de tema)
src/
  main.ts             # ciclo de vida del plugin: comando, ribbon, ajustes
  settings.ts         # PluginSettings + normalizeVaultFolderPath
  data/               # VaultAdapter, ObsidianVaultAdapter, ProjectTaskRepository
  domain/             # tipos, parseo de notas, presentDashboard
  ui/                 # DashboardView, ProjectFormModal, TaskFormModal
tests/                # settings, parseNote, presentDashboard, ProjectTaskRepository
```

## Licencia

MIT.
