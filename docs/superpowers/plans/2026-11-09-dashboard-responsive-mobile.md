# Dashboard responsive + móvil Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el dashboard (`DashboardView`) se vea y se use bien en Obsidian móvil (teléfono y tablet) y en cualquier ancho de panel (split, sidebar), sin regresiones en escritorio ancho.

**Architecture:** Los breakpoints dejan de mirar el viewport (`@media (max-width)`) y pasan a mirar el ancho real de la hoja con *container queries*: la hoja `.workspace-leaf-content[data-type="devhelper-dashboard"]` se declara contenedor `devhelper-dashboard` y todo el layout estrecho cuelga de `@container devhelper-dashboard (…)`. Tres escalones: **medio** (≤ 900px), **compacto** (≤ 640px) y **mínimo** (≤ 380px). Lo táctil (tamaño de los objetivos, zoom de iOS) va con `@media (pointer: coarse)` y con las clases de body de Obsidian `.is-mobile` / `.is-phone`. La única lógica nueva en TS es la pulsación larga sobre los chips de favoritos (iOS no lanza `contextmenu`).

**Tech Stack:** TypeScript, API de Obsidian 1.9+, CSS (container queries, `env(safe-area-inset-*)`), Vitest.

**Spec:** No hay spec aparte: la petición del 2026-11-09 («revisar el responsive de todo el dashboard… que se vea bien en mobile») más las decisiones de la sección *Requisitos* son el spec. Contexto de layout: `docs/superpowers/specs/2026-10-17-devhelper-dashboard-layout-redesign.md`.

## Requisitos (spec de este plan)

1. Mismo aspecto actual en escritorio con la hoja > 900px (paridad visual).
2. Hoja de 641–900px: tareas + rail arriba y mini-calendario a todo el ancho debajo; nada se recorta.
3. Hoja ≤ 640px (teléfono, sidebar): una columna; los chips de favoritos se desplazan en horizontal en una sola línea; el buscador ocupa la fila entera; no hay scroll horizontal de página.
4. Hoja ≤ 380px: las tarjetas apilan título y acciones (lo que hoy hace `max-width: 320px`).
5. Puntero grueso: todo objetivo táctil mide ≥ 40px; los inputs usan `font-size: 16px` en `.is-mobile` (evita el zoom automático de iOS).
6. En móvil se oculta la pista `Ctrl+K` y el padding inferior respeta `env(safe-area-inset-bottom)`.
7. Una pulsación larga de 500ms sobre un chip de favorito abre el mismo menú que el clic derecho, sin seleccionar el chip y sin abrir el menú dos veces en Android.

## Global Constraints

- Contenedor: `container: devhelper-dashboard / inline-size;` sobre `.workspace-leaf-content[data-type="devhelper-dashboard"]` (nunca sobre `.devhelper-dashboard-root`: un contenedor no se puede consultar a sí mismo).
- Breakpoints exactos: `@container devhelper-dashboard (max-width: 900px)`, `(max-width: 640px)` y `(max-width: 380px)`.
- En la sección del dashboard de `styles.css` (todo lo anterior al banner `Calendar view (vista mensual)`) no queda ningún `@media (max-width…)` ni `@media (min-width…)`.
- Paleta fija, sin depender del tema: `#0e0e10`, `#141417`, `#1b1b1e`, `#efeff1`, `#fafafa`. No se introducen colores nuevos.
- Los selectores de botones repiten el padre (especificidad 0,2,0) para ganar a `button:not(.clickable-icon)` de Obsidian.
- Todo el texto de la UI en español.
- `minAppVersion` sigue en `1.9.0` (Electron y los WebView de Obsidian móvil soportan container queries).
- Tras cada tarea: `npm run typecheck`, `npm test` y `npm run build` en verde.

## Review Focus

1. Dashboard abierto en la sidebar derecha de un escritorio ancho (viewport 1920px, hoja 320px): debe salir el layout compacto. Lo fija el test `usa container queries y no @media de ancho` (Task 1).
2. Teléfono con 15 o más favoritos: los chips se quedan en una sola fila con scroll horizontal y no ocupan cinco líneas. Lo fija el test `chips en una fila desplazable en compacto` (Task 3).
3. Títulos largos sin espacios (p. ej. una URL como nombre de tarea) en una hoja de 360px: elipsis, sin scroll horizontal de página. Lo fija el test `la raíz compacta no desborda en horizontal` (Task 3).
4. En Android la pulsación larga dispara también `contextmenu` y el menú se abriría dos veces. Lo fija el test `traga el contextmenu que sigue a la pulsación larga` (Task 5).
5. En iOS, al enfocar el filtro de tareas (hoy con fuente < 16px) la página hace zoom. Lo fija el test `inputs a 16px en móvil` (Task 4).

---

### Task 1: Base de container queries + migración de los breakpoints actuales

Paridad de comportamiento: lo que hoy hacen `@media (max-width: 640px)`, `(max-width: 320px)` y `(min-height: 900px) and (min-width: 641px)` pasa a container queries. En esta tarea no cambia el diseño.

**Files:**
- Create: `tests/helpers/cssBlocks.ts`
- Create: `tests/styles.dashboard-responsive.test.ts`
- Modify: `styles.css:1-40` (comentario «Layout contract»), `styles.css:1319-1424` (bloques de media)

**Interfaces:**
- Produces (helpers de test que reutiliza el plan del calendario):
  - `readStyles(): string`: `styles.css` del repo sin comentarios `/* … */`.
  - `splitSections(css: string): { dashboard: string; calendar: string }`: corta por el banner `Calendar view (vista mensual)`; la detección se hace sobre el CSS **con** comentarios antes de quitarlos, así que la función recibe el texto crudo y devuelve las dos mitades ya sin comentarios.
  - `atRuleBodies(css: string, prelude: RegExp): string[]`: cuerpos (entre llaves, con llaves equilibradas) de las at-rules cuyo preludio casa con `prelude`.
  - `ruleBody(css: string, selector: string): string | null`: declaraciones del primer bloque cuyo selector exacto (tras normalizar espacios) es `selector`.

- [ ] **Step 1: Escribe los tests que fallan** en `tests/styles.dashboard-responsive.test.ts`:
  - `declara la hoja del dashboard como contenedor`: `ruleBody(css, '.workspace-leaf-content[data-type="devhelper-dashboard"]')` contiene `container: devhelper-dashboard / inline-size`.
  - `usa container queries y no @media de ancho`: en `dashboard`, `atRuleBodies(dashboard, /^@media[^{]*\((max|min)-width/)` tiene longitud `0`.
  - `compacto apila en columna`: el cuerpo de `@container devhelper-dashboard (max-width: 640px)` contiene una regla `.devhelper-dashboard-root` con `flex-direction: column`.
  - `mínimo apila la tarjeta`: el cuerpo de `@container devhelper-dashboard (max-width: 380px)` contiene `.devhelper-task-card` con `flex-direction: column`.
  - `pantallas altas conservan el reparto 2fr/1fr`: existe un `@media (min-height: 900px)` cuyo cuerpo contiene `@container devhelper-dashboard (min-width: 641px)` con `grid-template-rows: auto 2fr 1fr auto`.
- [ ] **Step 2: Ejecuta** `npm test -- tests/styles.dashboard-responsive.test.ts`. Esperado: FAIL (no existe el contenedor; hay `@media (max-width: 640px)`).
- [ ] **Step 3: Implementa los helpers** de `tests/helpers/cssBlocks.ts` con un escáner de llaves a mano (sin dependencias nuevas).
- [ ] **Step 4: Migra el CSS:** añade la regla de contenedor junto a `.devhelper-dashboard-root`; renombra `@media (max-width: 640px)` → `@container devhelper-dashboard (max-width: 640px)` y `@media (max-width: 320px)` → `@container devhelper-dashboard (max-width: 380px)`; anida el de pantallas altas como `@media (min-height: 900px) { @container devhelper-dashboard (min-width: 641px) { … } }`. Actualiza el comentario «Layout contract» con los tres escalones.
- [ ] **Step 5: Ejecuta** `npm test`, `npm run typecheck` y `npm run build`. Esperado: todo verde.
- [ ] **Step 6: Commit**

```bash
git add tests/helpers/cssBlocks.ts tests/styles.dashboard-responsive.test.ts styles.css
git commit -m "feat: breakpoints del dashboard por container queries"
```

### Task 2: Escalón medio (641–900px)

**Files:**
- Modify: `styles.css`: nuevo bloque `@container devhelper-dashboard (max-width: 900px)` antes del de 640px; regla `.devhelper-search-wrap` (`:214-225`)
- Test: `tests/styles.dashboard-responsive.test.ts`

**Interfaces:**
- Consumes: helpers de Task 1.

- [ ] **Step 1: Tests que fallan:**
  - `medio: tareas + rail, calendario debajo`: el bloque de 900px contiene `.devhelper-dashboard-root` con `grid-template-columns: 1fr auto` y `.devhelper-side-column` con `grid-column: 1 / -1`.
  - `medio: el mini-calendario reparte los días`: el bloque de 900px contiene `.devhelper-calendar .devhelper-calendar-day` y `.devhelper-calendar-weekdays span` con `flex: 1 1 0`.
  - `el buscador nunca supera su contenedor`: `ruleBody(css, '.devhelper-search-wrap')` contiene `max-width: 100%`.
- [ ] **Step 2: Ejecuta** el archivo. Esperado: FAIL.
- [ ] **Step 3: Implementa:** dentro del bloque de 900px, la raíz pasa a `grid-template-columns: 1fr auto` (tareas + rail), `.devhelper-side-column` a fila completa debajo de tareas con `align-self: stretch`, y los días y cabeceras del mini-calendario a `flex: 1 1 0; width: auto` para llenar el ancho. En la regla base del buscador, `width: 340px` se mantiene y se añade `max-width: 100%`.
- [ ] **Step 4: Ejecuta** `npm test`. Esperado: PASS.
- [ ] **Step 5: Commit** con `feat: escalón medio del dashboard (≤900px)`.

### Task 3: Escalón compacto (≤ 640px), pensado para teléfono

**Files:**
- Modify: `styles.css`: bloque `@container devhelper-dashboard (max-width: 640px)` y bloque nuevo `.is-mobile`
- Test: `tests/styles.dashboard-responsive.test.ts`

- [ ] **Step 1: Tests que fallan** (todos sobre el bloque de 640px salvo que se diga otra cosa):
  - `chips en una fila desplazable en compacto`: `.devhelper-chip-list` con `flex-wrap: nowrap`, `overflow-x: auto` y `scrollbar-width: none`; `.devhelper-chip-list .devhelper-chip` con `flex: 0 0 auto`.
  - `la raíz compacta no desborda en horizontal`: `.devhelper-dashboard-root` con `padding: 8px 12px calc(16px + env(safe-area-inset-bottom))` y `min-width: 0`; `.devhelper-task-main` con `min-width: 0`.
  - `el buscador ocupa la fila`: `.devhelper-topbar-controls .devhelper-search-wrap` con `width: 100%` y `height: 44px`.
  - `paneles más compactos`: `.devhelper-tasks-panel` con `padding: 12px 14px` y `border-radius: 16px`; `.devhelper-section` con `padding: 12px 14px`.
  - `sin pista Ctrl+K en compacto ni en móvil`: el bloque de 640px oculta `.devhelper-search-hint` (`display: none`) y existe `ruleBody(css, '.is-mobile .devhelper-search-hint')` con `display: none`.
- [ ] **Step 2: Ejecuta** el archivo. Esperado: FAIL.
- [ ] **Step 3: Implementa** las reglas anteriores sobre el bloque ya migrado en Task 1, conservando el `order` y el apilado actuales. Al ocultar la pista, el input recupera `padding-right: 12px`. La cabecera de los paneles (`.devhelper-project-header h3`, `.devhelper-section h3`) baja a `1.25em`.
- [ ] **Step 4: Ejecuta** `npm test`. Esperado: PASS.
- [ ] **Step 5: Commit** con `feat: layout compacto del dashboard para teléfono`.

### Task 4: Objetivos táctiles e inputs en móvil

**Files:**
- Modify: `styles.css`: bloque nuevo `@media (pointer: coarse)` y regla `.is-mobile` al final de la sección del dashboard
- Test: `tests/styles.dashboard-responsive.test.ts`

- [ ] **Step 1: Tests que fallan:**
  - `objetivos táctiles ≥ 40px`: el cuerpo de `@media (pointer: coarse)` contiene, con `min-width: 40px` y `min-height: 40px`, estos selectores: `.devhelper-task-actions .devhelper-icon-button`, `.devhelper-chip-list .devhelper-chip-add`, `.devhelper-calendar .devhelper-calendar-header .devhelper-icon-button` y `.devhelper-calendar .devhelper-calendar-day`.
  - `inputs a 16px en móvil`: existe una regla `.is-mobile .devhelper-task-filters .devhelper-task-search, .is-mobile .devhelper-search-wrap .devhelper-search` (cualquier orden de la lista) con `font-size: 16px`, y `.is-mobile .devhelper-task-filters .devhelper-task-search` con `height: 40px`.
- [ ] **Step 2: Ejecuta** el archivo. Esperado: FAIL.
- [ ] **Step 3: Implementa:** el área táctil crece con `min-*` y el glifo (`svg` 18px) no cambia; el día del rail con `.is-today` conserva el círculo (`border-radius: 50%`) en el tamaño nuevo. Añade en `tests/helpers/cssBlocks.ts` `ruleBodyContaining(css: string, selector: string): string | null`, que devuelve el primer bloque cuya lista de selectores (separada por comas y con espacios normalizados) incluye `selector`, y úsalo en estos tests. Lo reutiliza el plan del calendario.
- [ ] **Step 4: Ejecuta** `npm test`. Esperado: PASS.
- [ ] **Step 5: Commit** con `feat: objetivos táctiles e inputs sin zoom en móvil`.

### Task 5: Pulsación larga en los chips de favoritos

iOS no emite `contextmenu` con una pulsación larga, así que hoy en iPhone el menú «Abrir nota / Abrir carpeta / Quitar de mis favoritos» es inaccesible.

**Files:**
- Create: `src/ui/longPress.ts`
- Create: `tests/longPress.test.ts`
- Modify: `src/ui/DashboardView.ts:374-400` (extraer el menú a un método y engancharlo a las dos entradas)

**Interfaces:**
- Produces:
  - `export interface LongPressOptions { delayMs?: number; moveTolerancePx?: number; suppressMs?: number }` con valores por defecto `500`, `10` y `800`.
  - `export function attachLongPress(target: EventTarget, onLongPress: (point: { x: number; y: number }) => void, options?: LongPressOptions): () => void`. Devuelve la función que desengancha todos los listeners y cancela el temporizador pendiente.
  - En `DashboardView`: `private openFavoriteMenu(project: ProjectRecord, show: (menu: Menu) => void): void`. El clic derecho lo llama con `(m) => m.showAtMouseEvent(evt)` y la pulsación larga con `(m) => m.showAtPosition(point)`.

- [ ] **Step 1: Tests que fallan** en `tests/longPress.test.ts`, con `vi.useFakeTimers()`, un `EventTarget` de Node y eventos `new Event("touchstart")` a los que se añade `touches` con `Object.defineProperty`:
  - `dispara tras 500ms con un dedo quieto`: `touchstart` en (100,200) y avance de 499ms: no se llama; a 500ms se llama una vez con `{ x: 100, y: 200 }`.
  - `cancela si el dedo se mueve más de 10px`: `touchmove` a (100,215) y avance de 600ms: no se llama.
  - `tolera un movimiento de hasta 10px`: `touchmove` a (106,206) y avance de 500ms: se llama.
  - `cancela al levantar el dedo antes de tiempo`: `touchend` a 300ms: no se llama.
  - `ignora dos dedos`: `touchstart` con dos `touches`: no se llama.
  - `traga el click y el contextmenu que siguen a la pulsación larga`: tras dispararse, un `click` y un `contextmenu` despachados dentro de 800ms llegan con `defaultPrevented === true` y no alcanzan a un listener del mismo target registrado después. Pasados 800ms, un `click` ya no se traga.
  - `el detach limpia`: llamar a la función devuelta en mitad de la espera evita la llamada.
- [ ] **Step 2: Ejecuta** `npm test -- tests/longPress.test.ts`. Esperado: FAIL (módulo inexistente).
- [ ] **Step 3: Implementa `attachLongPress`:** usa `window.setTimeout` y `window.clearTimeout` (`tests/setup.ts` ya mapea `window`). El tragado usa listeners de `click`/`contextmenu` en fase de captura que hacen `preventDefault()` + `stopImmediatePropagation()` mientras dure la ventana `suppressMs`. Registra `touchstart` como `{ passive: true }`.
- [ ] **Step 4: Ejecuta** el archivo. Esperado: PASS.
- [ ] **Step 5: Engancha en `DashboardView`:** extrae el cuerpo del `contextmenu` a `openFavoriteMenu` y llama a `attachLongPress(chip, (p) => this.openFavoriteMenu(project, (m) => m.showAtPosition(p)))`. No se guarda el detach: el chip se destruye en cada `empty()` del render y sus listeners mueren con él. Déjalo dicho en un comentario de una línea.
- [ ] **Step 6: Ejecuta** `npm run typecheck`, `npm test` y `npm run build`. Esperado: verde.
- [ ] **Step 7: Commit** con `feat: pulsación larga abre el menú de favoritos en móvil`.

### Task 6: Verificación en el vault + documentación

**Files:**
- Modify: `CLAUDE.md` (descripción de `styles.css`: contenedor, escalones 900/640/380, `pointer: coarse`, `.is-mobile`; sección «Tests» con los archivos nuevos y el conteo real; layout del código con `src/ui/longPress.ts`)

- [ ] **Step 1:** Ejecuta `npm run update:test-vault`.
- [ ] **Step 2:** Con la skill `obsidian-cli`, abre el dashboard y toma capturas en estos estados: hoja ancha (> 900px); hoja de unos 800px (split vertical); dashboard movido a la sidebar derecha (unos 320px); y emulación móvil con `app.emulateMobile(true)` y ventana estrecha. Comprueba en cada una: sin scroll horizontal (`document.querySelector('.devhelper-dashboard-root').scrollWidth <= clientWidth` vía eval), chips en una fila en compacto, sin pista `Ctrl+K` en móvil y objetivos ≥ 40px. Termina con `app.emulateMobile(false)`.
- [ ] **Step 3:** Si una captura muestra una regresión, corrígela en la tarea dueña (añadiendo su test) antes de seguir.
- [ ] **Step 4:** Actualiza `CLAUDE.md` y ejecuta `npm run typecheck && npm test && npm run build`.
- [ ] **Step 5: Commit** con `docs: responsive del dashboard en AGENTS.md`.

## Fuera de alcance

- Gestos de deslizar (chocan con los deslizamientos de borde de Obsidian móvil, que abren las sidebars).
- Rediseño visual o colores nuevos.
- Vista de calendario: va en `2026-11-09-calendario-responsive-mobile.md`.
