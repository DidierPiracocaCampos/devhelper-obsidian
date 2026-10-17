# Plan de implementación: Rediseño de layout del Dashboard DevHelper

> **Para trabajadores agénticos:** SUB-SKILL OBLIGATORIO: Usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan sintaxis de casilla (`- [ ]`) para el seguimiento.

**Objetivo:** Rediseñar la vista del Dashboard DevHelper para que se parezca al producto DevHelper de referencia, conservando toda la funcionalidad de proyectos/tareas y montando las secciones nuevas (calendario, archivos, contraseñas, buscador y rail de iconos) como placeholders visuales sin datos ni lógica.

**Arquitectura:** Se reorganiza el render de `DashboardView.ts` en métodos `render*` por sección y se amplía `styles.css` con un layout de dos columnas que colapsa en paneles estrechos. La capa de dominio (`types.ts`, `parseNote.ts`, `presentDashboard.ts`) y el repositorio (`ProjectTaskRepository.ts`) **no se tocan**. Solo se añade un módulo de dominio nuevo y puro, `weekStrip`, para calcular la semana del calendario.

**Stack tecnológico:** TypeScript, Obsidian Plugin API (`ItemView`, `setIcon`, `Modal`), esbuild, Vitest; DOM nativo y variables de tema de Obsidian, sin framework de UI.

**Spec:** `docs/superpowers/specs/2026-10-17-devhelper-dashboard-layout-redesign.md`

## Restricciones globales

- Las notas Markdown son la única fuente de verdad; los datos de proyectos y tareas no se duplican en el almacenamiento del plugin.
- La capa de dominio y el repositorio quedan intactos: **no** se modifican `src/domain/types.ts`, `src/domain/parseNote.ts`, `src/domain/presentDashboard.ts` ni `src/data/*`.
- El borrado real sigue fuera de alcance: **no** se crean métodos `delete*` ni confirmaciones. Los iconos de papelera son **solo decorativos y deshabilitados**.
- Toda la funcionalidad actual se conserva: selección de proyecto, creación/edición de proyecto y tarea, toggle `open`/`done`, issues visibles.
- Todo el texto de UI es en español.
- El tema se conserva: canvas `--background-primary`, paneles `--background-secondary`, tarjetas `--background-primary-alt`; bordes `--background-modifier-border`.
- `selectedProjectPath` sigue siendo estado en memoria de la vista; si el proyecto desaparece, `presentDashboard` cae al primer proyecto ordenado.
- Iconos vía `setIcon()` de Obsidian (lucide). **Cero assets nuevos.**

## Foco de revisión

- **Panel estrecho (< 640px y < 320px):** el grid de dos columnas debe colapsar a una columna y ocultar el rail de iconos sin desbordamiento ni recorte. → paso de verificación manual en la Tarea 5.
- **`getWeekStrip` en el borde de mes (semana que cruza dos meses):** los días deben conservar el número de día correcto de cada mes y `monthLabel` se deriva de `today`. → test en la Tarea 1 con `new Date(2026, 9, 1)`.
- **Proyecto seleccionado que desaparece (renombrado/borrado externo):** `refresh()` debe caer al primer proyecto y los chips no deben pintar una selección colgante. → ya lo garantiza `presentDashboard`; la Tarea 2 debe consumir `presentation.selectedProject` sin recalcular.
- **Controles placeholder pulsados:** los botones inertes no deben lanzar errores ni mutar nada. → la Tarea 4 los deja `disabled` o sin listener; verificación manual en la Tarea 5.
- **Círculo de estado:** debe alternar `open`↔`done`, pintarse verde relleno en `done` y hueco gris en `open`, y tachar el título al completar. → la Tarea 3 reusa `toggleTaskStatus`; verificación manual en la Tarea 5.

---

## Mapa de archivos

- `src/domain/weekStrip.ts` **(nuevo)**: función pura `getWeekStrip` que calcula la semana ISO (Lun–Dom) de una fecha y el nombre del mes en español.
- `tests/weekStrip.test.ts` **(nuevo)**: tests unitarios de `weekStrip`.
- `src/ui/DashboardView.ts`: reorganización del bloque de render en `renderTopBar`, `renderProjectChips`, `renderTasksPanel`, `renderTaskCard`, `renderSideColumn` (rail + calendario), `renderBottomSections` (archivos + contraseñas) e `renderIssues`.
- `styles.css`: nuevo layout de dos columnas, chips, FABs circulares, rail de iconos, tarjeta de calendario y secciones placeholder.
- `AGENTS.md`: matiza la regla de borrado y actualiza la descripción de `DashboardView` y `styles.css`.

No se tocan los modales (`ProjectFormModal.ts`, `TaskFormModal.ts`) salvo reuso; tampoco `src/main.ts`, `src/settings.ts` ni `src/data/*`.

## Convenciones de verificación por tarea

La vista no tiene arnés de tests DOM (los tests del repo cubren dominio y repositorio). Por eso las tareas de vista (2–4) se verifican con `npm run typecheck` + `npm run build`, y los cambios visuales se confirman de forma manual en el vault de test `D:\proyects\devhelper-test-vault\` (con el plugin activo). La Tarea 5 cierra con la suite completa.

---

## Tarea 1: Función pura `weekStrip`

**Archivos:**
- Crear: `src/domain/weekStrip.ts`
- Crear: `tests/weekStrip.test.ts`

**Interfaces:**
- Produce:
  ```ts
  export interface WeekDay {
    day: number;      // día del mes (1-31)
    weekday: number;  // 0 = lunes … 6 = domingo (ISO)
    isToday: boolean; // true solo para el día que coincide con `today`
  }
  export interface WeekStrip {
    monthLabel: string; // "Octubre" (mes de `today`, primera letra en mayúscula)
    days: WeekDay[];    // exactamente 7, empezando en lunes
  }
  export function getWeekStrip(today: Date): WeekStrip;
  ```
  El módulo **no importa nada de `obsidian`**.

- [ ] **Paso 1: Escribir los tests que fallan** en `tests/weekStrip.test.ts`

  ```ts
  import { describe, it, expect } from "vitest";
  import { getWeekStrip } from "../src/domain/weekStrip";

  describe("getWeekStrip", () => {
    it("devuelve 7 días empezando en lunes (semana ISO) con hoy marcado", () => {
      // 17 de octubre de 2026 es sábado; su lunes es el 12.
      const strip = getWeekStrip(new Date(2026, 9, 17));
      expect(strip.days).toHaveLength(7);
      expect(strip.days.map((d) => d.day)).toEqual([
        12, 13, 14, 15, 16, 17, 18,
      ]);
      expect(strip.days.map((d) => d.weekday)).toEqual([
        0, 1, 2, 3, 4, 5, 6,
      ]);
      expect(strip.days.find((d) => d.isToday)?.day).toBe(17);
    });

    it("marca exactamente un día como hoy", () => {
      const strip = getWeekStrip(new Date(2026, 9, 17));
      expect(strip.days.filter((d) => d.isToday)).toHaveLength(1);
    });

    it("mantiene los días correctos cuando la semana cruza dos meses", () => {
      // 1 de octubre de 2026 es jueves; su lunes es el 28 de septiembre.
      const strip = getWeekStrip(new Date(2026, 9, 1));
      expect(strip.days[0]!.day).toBe(28);
      expect(strip.days[0]!.weekday).toBe(0);
      expect(strip.days[3]!.day).toBe(1);
      expect(strip.days[3]!.isToday).toBe(true);
    });

    it("deriva monthLabel del mes de today, con la primera letra en mayúscula", () => {
      expect(getWeekStrip(new Date(2026, 9, 17)).monthLabel).toBe("Octubre");
      expect(getWeekStrip(new Date(2026, 9, 1)).monthLabel).toBe("Octubre");
    });
  });
  ```

- [ ] **Paso 2: Ejecutar los tests para confirmar que fallan**

  Run: `npm test -- tests/weekStrip.test.ts`
  Esperado: FAIL — `getWeekStrip` no existe / no exporta.

- [ ] **Paso 3: Implementar `getWeekStrip(today: Date): WeekStrip` en `src/domain/weekStrip.ts`**

  - Calcular el lunes de la semana ISO: `const monday = new Date(today); const offset = (today.getDay() + 6) % 7; monday.setDate(today.getDate() - offset);`
  - Generar 7 días sumando `i` días al lunes, con `weekday = i` y `isToday` comparando año/mes/día contra `today` (fecha local).
  - `monthLabel` con `new Intl.DateTimeFormat("es-ES", { month: "long" }).format(today)` y capitalizando la primera letra.

- [ ] **Paso 4: Ejecutar los tests para confirmar que pasan**

  Run: `npm test -- tests/weekStrip.test.ts`
  Esperado: PASS (4 tests).

- [ ] **Paso 5: Commit**

  ```bash
  git add src/domain/weekStrip.ts tests/weekStrip.test.ts
  git commit -m "feat: añade weekStrip puro para la semana del calendario"
  ```

---

## Tarea 2: Esqueleto de layout + barra superior (Proyectos como chips)

**Archivos:**
- Modificar: `src/ui/DashboardView.ts` — bloque de render (métodos `render`, `renderHeader`, `renderEmptyState` y añadir `renderTopBar`/`renderProjectChips`).
- Modificar: `styles.css` — clases base de grid, barra superior, chips y FABs.

**Interfaces:**
- Consume: `presentDashboard(data, selectedProjectPath)` (ya existente) y `sortProjectsForSelect` (método privado ya existente) para ordenar los chips.
- Produce (métodos privados de la vista y clases CSS):
  - `renderTopBar(data: DashboardData): void`
  - `renderProjectChips(data: DashboardData): void`
  - Clases CSS nuevas: `.devhelper-topbar`, `.devhelper-chip-list`, `.devhelper-chip`, `.devhelper-chip.is-selected`, `.devhelper-chip-menu`, `.devhelper-icon-button`, `.devhelper-fab`, `.devhelper-search`.

- [ ] **Paso 1: Convertir `render` a un grid de secciones**

  En `DashboardView.render(data)`, reemplazar la secuencia `renderHeader` + `renderProjectSection` + `renderIssues` por:

  - Mantener `contentEl` con la clase `.devhelper-dashboard-root`.
  - Crear una barra superior con `this.renderTopBar(data)`.
  - Mantener `renderProjectSection` (todavía sin cambios, será el panel de tareas) y `renderIssues` para que la vista siga funcional de forma incremental.
  - El resto de secciones (columna lateral y fila inferior) se añaden en tareas posteriores.

- [ ] **Paso 2: Implementar `renderTopBar` y `renderProjectChips`**

  - `renderTopBar(data)` crea `div.devhelper-topbar` con:
    - Título `h2` "Proyectos".
    - Los chips: `this.renderProjectChips(data)`.
    - Botón de filtro (`button.devhelper-icon-button`, icono `funnel` vía `setIcon`), **inerte** (sin listener; `aria-label` "Filtrar").
    - Botón **+** grande (`button.devhelper-fab`, icono `plus`) que llama a `this.openCreateProject()`.
    - `<input type="search" disabled>` con clase `.devhelper-search` y placeholder `"Pregunta sobre tu workspace…"`, más un hint visual `Ctrl+K`.
  - `renderProjectChips(data)` sustituye al `<select>` actual:
    - Itera `this.sortProjectsForSelect(data.projects)`.
    - Por cada proyecto crea `button.devhelper-chip` con el `title`; si `project.path === this.selectedProjectPath` añade `is-selected`.
    - Clic en el chip → `this.setSelectedProjectPath(project.path)`.
    - Cada chip lleva un botón `button.devhelper-chip-menu` (icono `more-horizontal`, `aria-label` "Opciones de proyecto") que abre un pequeño menú con *Editar* (`this.openEditProject(project)`) y *Abrir nota* (`this.openNote(project.path)`). El menú puede ser un `div` posicionado o el menú nativo de Obsidian; elige la opción más simple que sea accesible.
  - Eliminar `renderHeader` y el `<select>` (el método `renderEmptyState` y `sortProjectsForSelect` se conservan; `sortProjectsForSelect` queda en uso por los chips).

- [ ] **Paso 3: Añadir CSS base (grid, topbar, chips, FABs)**

  En `styles.css`:
  - `.devhelper-dashboard-root` pasa a `display: grid` con dos columnas en escritorio (`grid-template-columns: 1fr auto;`), `gap: 12px;`.
  - `.devhelper-topbar` en `display: flex` con los chips a la izquierda y filtro/+/buscador a la derecha (`margin-left: auto`), envolviendo con `flex-wrap: wrap`.
  - `.devhelper-chip` pill con `border-radius: 999px`; `is-selected` usa `--background-secondary` (claro) y el resto `--background-primary-alt` (oscuro), ambos con `border: 1px solid var(--background-modifier-border)`.
  - `.devhelper-icon-button` y `.devhelper-fab` circulares (`border-radius: 50%`); el FAB es más grande.
  - `.devhelper-search` ocupa el ancho restante con apariencia de input deshabilitado.
  - Actualizar el comentario de cabecera de `styles.css` para reflejar el nuevo layout contract.

- [ ] **Paso 4: Verificar compilación**

  Run: `npm run typecheck` → limpio.
  Run: `npm run build` → emite `main.js`.

- [ ] **Paso 5: Verificación manual (vault de test)**

  Abrir el dashboard en `D:\proyects\devhelper-test-vault\`: los proyectos se ven como chips, el clic selecciona, «···» abre Editar/Abrir, y el botón **+** abre «Nuevo proyecto». El buscador y el filtro no hacen nada.

- [ ] **Paso 6: Commit**

  ```bash
  git add src/ui/DashboardView.ts styles.css
  git commit -m "feat: reestructura el layout con chips de proyecto en la barra superior"
  ```

---

## Tarea 3: Tarjetas de tarea rediseñadas + FABs del panel Tareas

**Archivos:**
- Modificar: `src/ui/DashboardView.ts` — `renderProjectSection` (se convierte en `renderTasksPanel`) y `renderTaskCard`.
- Modificar: `styles.css` — tarjeta de tarea, subtítulo, círculo de estado y FABs del panel.

**Interfaces:**
- Consume: `TaskRecord`, `toggleTaskStatus`, `openEditTask`, `openNote` (ya existentes).
- Produce (clases CSS): `.devhelper-tasks-panel`, `.devhelper-task-card`, `.devhelper-task-title`, `.devhelper-task-subtitle`, `.devhelper-task-actions`, `.devhelper-status-circle`, `.devhelper-status-circle--open`, `.devhelper-status-circle--done`, `.devhelper-panel-fabs`.

- [ ] **Paso 1: Renombrar `renderProjectSection` a `renderTasksPanel` y añadir FABs**

  - El panel conserva el encabezado del proyecto (título + `devhelper-project-path`).
  - Añadir en su borde derecho un contenedor `.devhelper-panel-fabs` con dos botones:
    - `button.devhelper-icon-button` (icono `funnel`), **inerte**.
    - `button.devhelper-fab` (icono `plus`) que llama a `this.openCreateTask()`.
  - Mantener el estado vacío «Este proyecto aún no tiene tareas.» cuando no hay tareas.

- [ ] **Paso 2: Reescribir `renderTaskCard` con el nuevo look**

  - El título `h4.devhelper-task-title` con clic → `this.openNote(task.path)`.
  - Debajo, un `p.devhelper-task-subtitle` con texto `"Sin descripción"` (muted; placeholder, ver spec).
  - Acciones (`div.devhelper-task-actions`):
    - `button` papelera (icono `trash-2`), **deshabilitado** (`disabled = true`) con `title` "Disponible en una versión futura".
    - `button` editar (icono `pencil`) → `this.openEditTask(task)`.
    - `button.devhelper-status-circle` clicable → `this.toggleTaskStatus(task)`; clase `--done` cuando `task.status === "done"`, si no `--open`; `aria-label` "Cambiar estado".
  - Conservar la clase `is-done` en la tarjeta para el tachado del título.
  - Eliminar los botones de texto anteriores ("Marcar como hecho"/"Reabrir", "Editar", "Abrir").

- [ ] **Paso 3: Añadir CSS de tarjeta, subtítulo, círculo y FABs**

  - `.devhelper-task-title` conserva `is-done` → `line-through` + `--text-muted`.
  - `.devhelper-task-subtitle` en `--text-muted`, `font-size: 0.85em`.
  - `.devhelper-status-circle`: `width/height: 18px; border-radius: 50%; border: 2px solid var(--text-muted);`.
  - `.devhelper-status-circle--done`: `background` verde relleno (`#22c55e`) y borde del mismo color.
  - `.devhelper-status-circle--open`: fondo transparente (hueco).
  - `.devhelper-panel-fabs` en `display: flex; flex-direction: column; gap: 8px;` alineado al borde del panel.
  - La papelera deshabilitada usa `opacity` reducida y `cursor: not-allowed`.

- [ ] **Paso 4: Verificar compilación**

  Run: `npm run typecheck` → limpio.
  Run: `npm run build` → emite `main.js`.

- [ ] **Paso 5: Verificación manual (vault de test)**

  Las tarjetas muestran título, «Sin descripción», papelera deshabilitada, lápiz y círculo; el círculo alterna `open`/`done` y se pinta verde al completar; el clic en el título abre la nota; el **+** del panel crea tarea.

- [ ] **Paso 6: Commit**

  ```bash
  git add src/ui/DashboardView.ts styles.css
  git commit -m "feat: rediseña tarjetas de tarea con círculo de estado y FABs"
  ```

---

## Tarea 4: Secciones placeholder (rail de iconos, calendario, Archivos, Contraseñas)

**Archivos:**
- Modificar: `src/ui/DashboardView.ts` — añadir `renderSideColumn` (rail + calendario) y `renderBottomSections` (archivos + contraseñas).
- Modificar: `styles.css` — rail, tarjeta de calendario, fila inferior y placeholders.

**Interfaces:**
- Consume: `getWeekStrip(today: Date): WeekStrip` (Tarea 1).
- Produce (clases CSS): `.devhelper-side-column`, `.devhelper-icon-rail`, `.devhelper-calendar`, `.devhelper-calendar-header`, `.devhelper-calendar-weekdays`, `.devhelper-calendar-days`, `.devhelper-calendar-day`, `.devhelper-calendar-day.is-today`, `.devhelper-bottom-sections`, `.devhelper-section`, `.devhelper-placeholder-empty`.

- [ ] **Paso 1: Implementar `renderSideColumn`**

  - `div.devhelper-side-column` con dos bloques:
    1. **Rail de iconos** (`div.devhelper-icon-rail`): cuatro `button.devhelper-icon-button` inertes con iconos `funnel`, `code`, `settings`, `log-out` y `title` descriptivo en español ("Filtrar", "Código", "Ajustes", "Salir").
    2. **Calendario** (`section.devhelper-calendar`):
       - `const strip = getWeekStrip(new Date());`
       - Cabecera con `strip.monthLabel`, botones `chevron-left`, «Hoy», `chevron-right` y `plus` (todos inertes).
       - Fila de días de la semana con las letras `L M X J V S D`.
       - Fila de días (`strip.days`), cada uno `span.devhelper-calendar-day` con `text = String(day.day)`; añade `is-today` cuando `day.isToday`.
       - Texto final `"No hay eventos este día"` (`--text-muted`).

- [ ] **Paso 2: Implementar `renderBottomSections`**

  - `div.devhelper-bottom-sections` con dos `section.devhelper-section`:
    1. **Archivos**: encabezado `h3` "Archivos", estado vacío `"No hay archivos"`, y FABs `funnel` (inerte) + `plus` (inerte).
    2. **Contraseña**: encabezado `h3` "Contraseña", estado vacío `"Sin contraseñas"`, y FABs `funnel` (inerte) + `plus` (inerte).
  - Todos los botones de estas secciones quedan sin listener (o `disabled`) para que no hagan nada.

- [ ] **Paso 3: Cablear las secciones en `render`**

  En `DashboardView.render`, tras el panel de tareas y antes de `renderIssues`, llamar a `this.renderSideColumn()` y `this.renderBottomSections()`.

- [ ] **Paso 4: Añadir CSS de rail, calendario, fila inferior y placeholders**

  - `.devhelper-side-column` en columna con `gap: 12px`.
  - `.devhelper-icon-rail` en columna de botones redondos.
  - `.devhelper-calendar` panel claro (`--background-secondary`) con `border-radius: 16px`; cabecera en `flex`; la fila de días con `is-today` resaltado (por ejemplo, fondo `--interactive-accent` y texto `--text-on-accent`).
  - `.devhelper-bottom-sections` en `display: flex` con `gap: 12px` y cada `.devhelper-section` en `flex: 1`.
  - `.devhelper-placeholder-empty` en `--text-muted` y cursiva.

- [ ] **Paso 5: Verificar compilación**

  Run: `npm run typecheck` → limpio.
  Run: `npm run build` → emite `main.js`.

- [ ] **Paso 6: Verificación manual (vault de test)**

  El rail de iconos, el calendario (mes actual, hoy marcado, «No hay eventos este día»), y las secciones Archivos/Contraseñas se ven; sus botones no hacen nada.

- [ ] **Paso 7: Commit**

  ```bash
  git add src/ui/DashboardView.ts styles.css
  git commit -m "feat: añade secciones placeholder (calendario, archivos, contraseñas, rail)"
  ```

---

## Tarea 5: Responsive, documentación y verificación final

**Archivos:**
- Modificar: `styles.css` — breakpoints responsivos.
- Modificar: `AGENTS.md` — regla de borrado matizada + descripción de `DashboardView`/`styles.css`.

**Interfaces:**
- Consume: todas las clases CSS definidas en las tareas 2–4.

- [ ] **Paso 1: Añadir breakpoints responsivos en `styles.css`**

  - `@media (max-width: 640px)`: `.devhelper-dashboard-root` a una columna (`grid-template-columns: 1fr;`), ocultar `.devhelper-icon-rail` (`display: none;`), y apilar `.devhelper-bottom-sections` en una columna.
  - Conservar y extender el `@media (max-width: 320px)` existente para que los controles y acciones se apilen sin recorte.

- [ ] **Paso 2: Actualizar `AGENTS.md`**

  - Sustituir la regla dura «Borrado de proyectos/tareas NO está en V1. No añadas botones ni métodos delete.» por una que aclare: **no se crean métodos `delete*` ni confirmaciones de borrado; los iconos de papelera de la UI son solo decorativos y deshabilitados.**
  - Actualizar la sección de `src/ui/DashboardView.ts` y `styles.css` para describir el nuevo layout (barra superior con chips, panel de tareas, columna lateral con rail + calendario, fila inferior Archivos/Contraseñas, issues) y el nuevo módulo `src/domain/weekStrip.ts`.
  - Añadir `tests/weekStrip.test.ts` a la lista de tests.

- [ ] **Paso 3: Verificación completa**

  Run: `npm run typecheck` → limpio.
  Run: `npm test` → verde (47 tests existentes + 4 de `weekStrip` = 51).
  Run: `npm run build` → emite `main.js`.
  Run: `git status --short` → revisar qué se va a commitear.

- [ ] **Paso 4: Verificación manual completa (vault de test)**

  Comprobar en escritorio y panel estrecho: chips, creación/edición de proyecto y tarea, toggle vía círculo, issues, y que los placeholders (buscador, filtro, rail, calendario, archivos, contraseñas) se ven pero no hacen nada.

- [ ] **Paso 5: Commit**

  ```bash
  git add styles.css AGENTS.md
  git commit -m "docs: añade responsive y actualiza AGENTS.md para el nuevo layout"
  ```
