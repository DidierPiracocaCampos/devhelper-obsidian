# Calendario responsive + móvil Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la vista mensual (`CalendarView`) y su modal de eventos se vean y se usen bien en Obsidian móvil y en cualquier ancho de hoja, sin regresiones en escritorio.

**Architecture:** La misma estrategia que el plan del dashboard. La hoja `.workspace-leaf-content[data-type="devhelper-calendar"]` se declara contenedor `devhelper-calendar` y los breakpoints pasan a `@container devhelper-calendar (…)`, con dos escalones: **compacto** (≤ 640px) y **mínimo** (≤ 380px), más uno intermedio sólo para la topbar (≤ 480px: «Nuevo» queda como icono). En compacto la rejilla pasa a celdas cuadradas con número centrado y puntitos. El modal, que no vive dentro de la hoja, usa las clases de body de Obsidian (`.is-phone`, `.is-mobile`). En TS sólo cambian dos cosas: una clase para la etiqueta «Nuevo» y desplazar el panel de día a la vista al elegir un día en ancho compacto.

**Tech Stack:** TypeScript, API de Obsidian 1.9+, CSS (container queries), Vitest.

**Spec:** No hay spec aparte: la petición del 2026-11-09 más la sección *Requisitos* son el spec. Contexto: `docs/superpowers/specs/2026-10-19-calendario-mensual-design.md`.

**Dependencia:** Este plan usa `tests/helpers/cssBlocks.ts` (`readStyles`, `splitSections`, `atRuleBodies`, `ruleBody`, `ruleBodyContaining`) de la Task 1 del plan `2026-11-09-dashboard-responsive-mobile.md`, y `ruleBodyContaining` de su Task 4. Si ese plan no se ha ejecutado, ejecuta antes sus Tasks 1 y 4.

## Requisitos (spec de este plan)

1. Paridad visual en escritorio con la hoja > 640px.
2. Hoja ≤ 640px: la rejilla 6×7 cabe sin scroll horizontal en 360px; las celdas son cuadradas (`aspect-ratio: 1`), con el número centrado y hasta 4 puntitos (uno por `kind`) visibles.
3. Hoja ≤ 480px: la topbar queda en una sola línea («‹ Hoy › Mes Año» + «+» redondo sin texto) y el año nunca se recorta.
4. Hoja ≤ 380px: topbar en dos filas (navegación arriba, acciones abajo), rejilla con `gap: 2px` y tarjetas de evento apiladas.
5. Al tocar un día en ancho compacto, el panel de día se desplaza a la vista (`block: "nearest"`). En escritorio no se mueve nada.
6. Objetivos táctiles ≥ 40px con puntero grueso; en el modal de eventos, las filas en línea (fechas/hora) se apilan en teléfono y los inputs usan `font-size: 16px`.
7. El padding inferior respeta `env(safe-area-inset-bottom)`.

## Global Constraints

- Contenedor: `container: devhelper-calendar / inline-size;` sobre `.workspace-leaf-content[data-type="devhelper-calendar"]`.
- Breakpoints exactos: `@container devhelper-calendar (max-width: 640px)`, `(max-width: 480px)` y `(max-width: 380px)`.
- En la sección del calendario de `styles.css` (desde el banner `Calendar view (vista mensual)`) no queda ningún `@media (max-width…)` ni `@media (min-width…)`.
- Paleta fija ya existente (`#0e0e10`, `#141417`, `#232328`, `#26262c`, `#3f3f46`, `#fafafa`, colores de `kind`). Sin colores nuevos.
- Selectores de botones con el padre repetido (0,2,0) frente a `button:not(.clickable-icon)` de Obsidian.
- Las escrituras siguen pasando por el modal o la confirmación, nunca desde un render path.
- Texto de la UI en español. Tras cada tarea: `npm run typecheck`, `npm test` y `npm run build` en verde.

## Review Focus

1. Calendario abierto en la sidebar de un escritorio ancho (hoja de 320px con viewport de 1920px): debe salir el layout compacto. Lo fija el test `usa container queries y no @media de ancho` (Task 1).
2. «Septiembre 2026», el mes más largo, en 360px con «Nuevo» como icono: el año no se recorta ni salta de línea. Lo fija el test `la etiqueta del mes no se recorta` (Task 2).
3. Un día con eventos de los 4 `kind` en una celda de unos 44px: los 4 puntitos caben en una fila. Lo fija el test `cuatro puntitos caben en la celda compacta` (Task 1).
4. Elegir un día en escritorio no debe provocar saltos de scroll; sólo se desplaza en compacto. Lo fijan los tests de `isCompactWidth` en el límite 640/641 (Task 3).
5. En el modal de eventos en teléfono, «fecha inicio» y «fecha fin» en la misma fila (cada una con `min-width: 140px`) desbordan a 320px. Lo fija el test `el modal apila filas en teléfono` (Task 4).

---

### Task 1: Contenedor + rejilla compacta

**Files:**
- Create: `tests/styles.calendar-responsive.test.ts`
- Modify: `styles.css`: banner del calendario (`:1427-1440`), `.devhelper-calendar-root` (`:1442`), bloques `@media` del final (`:1919-1973`)

**Interfaces:**
- Consumes: `readStyles`, `splitSections`, `atRuleBodies`, `ruleBody` de `tests/helpers/cssBlocks.ts`.

- [ ] **Step 1: Tests que fallan** (sobre `calendar` de `splitSections`; "bloque 640" = cuerpo de `@container devhelper-calendar (max-width: 640px)`):
  - `declara la hoja del calendario como contenedor`: `ruleBody(css, '.workspace-leaf-content[data-type="devhelper-calendar"]')` contiene `container: devhelper-calendar / inline-size`.
  - `usa container queries y no @media de ancho`: `atRuleBodies(calendar, /^@media[^{]*\((max|min)-width/)` tiene longitud `0`.
  - `celdas cuadradas en compacto`: el bloque 640 contiene `.devhelper-calendar-month-card .devhelper-calendar-cell` con `aspect-ratio: 1`, `min-height: 0`, `align-items: center` y `padding: 4px 0`; y `.devhelper-calendar-month-card .devhelper-calendar-cell-day` con `align-self: center` y `margin: 0`.
  - `cuatro puntitos caben en la celda compacta`: el bloque 640 contiene `.devhelper-calendar-month-card .devhelper-calendar-dot` con `width: 5px` y `height: 5px`, y `.devhelper-calendar-month-card .devhelper-calendar-dots` con `gap: 2px` y `flex-wrap: nowrap`.
  - `rejilla compacta sin alto mínimo`: el bloque 640 contiene `.devhelper-calendar-month-card .devhelper-calendar-grid` con `min-height: 0`, `gap: 4px` y `grid-template-rows: none`.
  - `raíz compacta con safe area`: el bloque 640 contiene `.devhelper-calendar-root` con `padding: 8px 8px calc(16px + env(safe-area-inset-bottom))`.
  - `tarjeta del mes compacta`: el bloque 640 contiene `.devhelper-calendar-month-card` con `padding: 10px 8px 12px` y `border-radius: 16px`.
- [ ] **Step 2: Ejecuta** `npm test -- tests/styles.calendar-responsive.test.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementa:** añade la regla de contenedor; convierte el `@media (max-width: 640px)` del calendario en `@container devhelper-calendar (max-width: 640px)` y sustituye sus reglas de celda (`min-height: 44px`) por las de los tests; convierte `@media (max-width: 320px)` en `@container devhelper-calendar (max-width: 380px)` sin cambiar su contenido en esta tarea. Ajusta el banner del calendario (que todavía habla de paneles claros `#f4f4f5`) para que describa el contenedor y los escalones.
- [ ] **Step 4: Ejecuta** `npm test`. Esperado: PASS.
- [ ] **Step 5: Commit** con `feat: calendario por container queries con rejilla compacta`.

### Task 2: Topbar adaptable

**Files:**
- Modify: `src/ui/CalendarView.ts:299` (`addBtn.createSpan({ text: "Nuevo" })` pasa a `addBtn.createSpan({ cls: "devhelper-calendar-add-label", text: "Nuevo" })`)
- Modify: `styles.css`: bloques 480 (nuevo) y 380 del calendario
- Test: `tests/styles.calendar-responsive.test.ts`

- [ ] **Step 1: Tests que fallan:**
  - `«Nuevo» como icono en ≤480`: el cuerpo de `@container devhelper-calendar (max-width: 480px)` oculta `.devhelper-calendar-add .devhelper-calendar-add-label` (`display: none`) y deja `.devhelper-calendar-topbar .devhelper-calendar-add` con `width: 36px`, `padding: 0` y `border-radius: 50%`.
  - `la etiqueta del mes no se recorta`: el bloque 480 contiene `.devhelper-calendar-month-label` con `white-space: nowrap`, `font-size: 1.05em` y `flex: 0 0 auto`.
  - `flechas compactas`: el bloque 480 contiene `.devhelper-calendar-topbar .devhelper-calendar-nav` con `gap: 2px`.
  - `topbar en dos filas en ≤380`: el cuerpo de `@container devhelper-calendar (max-width: 380px)` contiene `.devhelper-calendar-topbar` con `flex-direction: column` y `.devhelper-calendar-topbar .devhelper-calendar-actions` con `justify-content: flex-end`.
- [ ] **Step 2: Ejecuta** el archivo. Esperado: FAIL.
- [ ] **Step 3: Implementa** el cambio de clase en TS y las reglas CSS. El `aria-label="Nuevo evento"` del botón ya existe, así que el botón sigue siendo accesible con la etiqueta oculta. En el bloque 380, quita el `justify-content: space-between` heredado de las acciones para que «+» quede a la derecha.
- [ ] **Step 4: Ejecuta** `npm run typecheck` y `npm test`. Esperado: verde.
- [ ] **Step 5: Commit** con `feat: topbar del calendario adaptable a móvil`.

### Task 3: Panel de día en móvil (scroll a la vista + tarjetas)

**Files:**
- Create: `src/ui/responsive.ts`
- Create: `tests/responsive.test.ts`
- Modify: `src/ui/CalendarView.ts:389-393` (listener de click de la celda)
- Modify: `styles.css`: bloques 640 y 380 del calendario
- Test: `tests/styles.calendar-responsive.test.ts`

**Interfaces:**
- Produces:
  - `export const COMPACT_MAX_WIDTH = 640;`
  - `export function isCompactWidth(width: number): boolean`: devuelve `true` si `0 < width <= COMPACT_MAX_WIDTH`. `0` (hoja oculta o sin layout) devuelve `false`.

- [ ] **Step 1: Tests que fallan** en `tests/responsive.test.ts`: `isCompactWidth(640) === true`, `isCompactWidth(641) === false`, `isCompactWidth(360) === true`, `isCompactWidth(0) === false`.
- [ ] **Step 2: Tests CSS que fallan:**
  - `panel de día compacto`: el bloque 640 contiene `.devhelper-day-panel` con `padding: 14px 14px` y `border-radius: 16px`, y `.devhelper-day-panel-header h3` con `font-size: 1.1em`.
  - `tarjeta de evento con badges que envuelven`: el bloque 640 contiene `.devhelper-event-card .devhelper-event-badges` con `flex-wrap: wrap`.
- [ ] **Step 3: Ejecuta** `npm test -- tests/responsive.test.ts tests/styles.calendar-responsive.test.ts`. Esperado: FAIL.
- [ ] **Step 4: Implementa** `isCompactWidth` y las reglas CSS. En el click de la celda, después de `renderDayPanel(...)`: si `isCompactWidth(this.contentEl.clientWidth)`, busca `.devhelper-day-panel` y llama a `scrollIntoView({ block: "nearest", behavior: "smooth" })`.
- [ ] **Step 5: Ejecuta** `npm run typecheck`, `npm test` y `npm run build`. Esperado: verde.
- [ ] **Step 6: Commit** con `feat: panel de día del calendario usable en móvil`.

### Task 4: Táctil y modal de eventos en teléfono

**Files:**
- Modify: `styles.css`: bloque `@media (pointer: coarse)` de la sección del calendario, reglas `.is-phone` / `.is-mobile` junto a `.devhelper-form-inline` (`:1897-1910`)
- Test: `tests/styles.calendar-responsive.test.ts`

- [ ] **Step 1: Tests que fallan:**
  - `objetivos táctiles del calendario`: el cuerpo de un `@media (pointer: coarse)` de la sección del calendario contiene `.devhelper-calendar-topbar .devhelper-calendar-step`, `.devhelper-calendar-topbar .devhelper-calendar-nav-today`, `.devhelper-calendar-topbar .devhelper-calendar-add`, `.devhelper-day-panel-header .devhelper-fab` y `.devhelper-event-card .devhelper-task-actions .devhelper-icon-button`, con `min-height: 40px` (y `min-width: 40px` en los que no son píldora: step, add, fab y acciones).
  - `el modal apila filas en teléfono`: `ruleBodyContaining(css, '.is-phone .devhelper-form-inline')` contiene `flex-direction: column` y `align-items: stretch`; y `.is-phone .devhelper-form-inline .devhelper-form-row` contiene `min-width: 0` y `width: 100%`.
  - `inputs del modal a 16px en móvil`: `ruleBodyContaining(css, '.is-mobile .devhelper-form input')` contiene `font-size: 16px`, y lo mismo para `.is-mobile .devhelper-form select`.
- [ ] **Step 2: Ejecuta** el archivo. Esperado: FAIL.
- [ ] **Step 3: Implementa:** con `«+» = 36px` del bloque 480 y puntero grueso, gana `min-width: 40px`. Comprueba que `CalendarEventFormModal` monta su contenido bajo `.devhelper-form`, como `ConfirmDeleteModal`; si usa otra clase raíz, añade `contentEl.addClass("devhelper-form")` en su `onOpen` y menciónalo en el commit.
- [ ] **Step 4: Ejecuta** `npm run typecheck`, `npm test` y `npm run build`. Esperado: verde.
- [ ] **Step 5: Commit** con `feat: calendario táctil y modal de eventos en teléfono`.

### Task 5: Verificación en el vault + documentación

**Files:**
- Modify: `CLAUDE.md` (descripción de `CalendarView` (scroll del panel en compacto) y de `styles.css` (contenedor `devhelper-calendar`, escalones 640/480/380, celdas cuadradas, «Nuevo» como icono); layout con `src/ui/responsive.ts`; sección «Tests» con los archivos nuevos y el conteo real)
- Modify: `src/skills/devhelper-calendar/SKILL.md`: **no** se toca (el modelo de datos no cambia).

- [ ] **Step 1:** Ejecuta `npm run update:test-vault`.
- [ ] **Step 2:** Con la skill `obsidian-cli`, abre el calendario en un mes con un día que tenga los 4 `kind` (crea los eventos de prueba desde el modal, en el vault de prueba, y bórralos al final con la papelera del propio calendario). Toma capturas en: hoja ancha; hoja de unos 600px; sidebar derecha (unos 320px); y `app.emulateMobile(true)` con ventana estrecha (también el modal de nuevo evento). Comprueba vía eval que `scrollWidth <= clientWidth` en `.devhelper-calendar-root`, que se ven los 4 puntitos, que «Septiembre 2026» no se recorta y que tocar un día desplaza el panel en compacto y no en ancho. Termina con `app.emulateMobile(false)`.
- [ ] **Step 3:** Si hay una regresión, corrígela en la tarea dueña, con su test, antes de seguir.
- [ ] **Step 4:** Actualiza `CLAUDE.md` y ejecuta `npm run typecheck && npm test && npm run build`.
- [ ] **Step 5: Commit** con `docs: responsive del calendario en AGENTS.md`.

## Fuera de alcance

- Deslizar para cambiar de mes: choca con los deslizamientos de borde de Obsidian móvil, que abren las sidebars. Se puede reconsiderar con un gesto limitado al centro de la rejilla.
- Vista agenda/lista alternativa para teléfono.
- Mini-calendario del rail del dashboard: va en el plan del dashboard.
