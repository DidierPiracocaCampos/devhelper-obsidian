# Calendario mensual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la vista mensual propia del calendario con eventos globales, rangos y recurrencia virtual.

**Architecture:** Dominio puro nuevo (`types` + `calendar.ts`) reutilizado por parser, repo y dos vistas; `Calendario/` plano como segunda fuente de verdad junto a `Projects/`; `CalendarView` como segundo `ItemView` con refresh compartido por debounce.

**Tech Stack:** TypeScript, Obsidian API (`ItemView`, `Modal`, `FuzzySuggestModal`), `js-yaml`, Vitest, esbuild.

**Spec:** `docs/superpowers/specs/2026-10-19-calendario-mensual-design.md`

## Global Constraints

- Todo texto UI, issues y errores en español.
- Las notas Markdown son la única fuente de verdad; `data.json` solo guarda carpetas, timeout y material clave (`credSaltB64`/`credVerifier`).
- Una mutación = un solo cambio atómico vía `processFrontMatter`; preservar body y props custom.
- Sanitización de nombres: `\ / : * ? " < > |` y `#` → `-`, colapsar `-`, trim `.`/espacios, vacío → `Untitled`, colisión → ` 2`, ` 3`.
- Borrado solo a papelera con confirmación (`ConfirmDeleteModal` o equivalente).
- Sin imports `obsidian` en `src/domain/` ni `src/data/CredentialSession.ts`; solo `ObsidianVaultAdapter.ts` y `src/ui/*` importan `obsidian`.
- Orden determinista: `date → allDay primero → time → title case-insensitive → path`.
- `npm run typecheck` limpio, `npm test` verde, `npm run build` emite `main.js` antes de cada commit.

## Review Focus

- Rango `endDate < date` no tumba el load: aparece como issue con "Abrir nota" y el resto de eventos del mes se siguen viendo.
- `time: "25:00"` o `date: "2026-13-40"` no lanza: va a issues en español.
- Recurrencia sin `recurrenceEnd` no expande infinito: tope 6 meses desde `date`.
- Febrero bisiesto y mensual día 31: abril sin día 31 omite esa ocurrencia, no desplaza al día 30.
- `project: "[[Roto]]"` irresoluble no crea evento huérfano silencioso: es issue; `project` ausente es global válido y visible en mes.

---

### Task 1: Dominio calendario (tipos + grid + expansión)

**Files:**
- Create: `src/domain/calendar.ts`
- Modify: `src/domain/types.ts`
- Test: `tests/calendar.test.ts`, `tests/presentCalendar.test.ts`

**Interfaces:**
- Consumes: `ProjectRecord`, `NoteSnapshot` (existentes, solo para firma).
- Produces: `CalendarEventRecord`, `CalendarKind`, `CalendarRecurrence`, `MonthCell`, `CalendarOccurrence`, `getMonthGrid(year: number, month1_12: number, today?: Date) => MonthCell[][]`, `expandOccurrences(events: CalendarEventRecord[], year: number, month1_12: number) => Map<string, CalendarOccurrence[]>`, `presentCalendar(data: DashboardData, year: number, month1_12: number) => CalendarPresentation`.

- [ ] **Step 1: Write the failing test `tests/calendar.test.ts`**

```ts
// grid octubre 2026: 6x7, primera celda lunes 2026-09-28, monthLabel "Octubre"
expect(getMonthGrid(2026, 10).flat().length).toBe(42);
// bisiesto febrero 2028 trae 29 y monthLabel "Febrero"
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/calendar.test.ts`
Expected: FAIL with "getMonthGrid not defined"

- [ ] **Step 3: Implement `types.ts` + `calendar.ts` en `src/domain/calendar.ts`**

Signatures exactas: `CalendarKind = "evento" | "reunion" | "fecha_limite" | "aviso"`, `CalendarRecurrence = "none" | "daily" | "weekly" | "monthly" | "yearly"`, `MonthCell { isoDate: string; day: number; inMonth: boolean; isToday: boolean }`, `CalendarOccurrence { event: CalendarEventRecord; occurrenceDate: string }`. `monthLabel` vía `Intl.DateTimeFormat("es-ES", { month: "long" })` con mayúscula inicial (igual que `weekStrip`).

- [ ] **Step 4: Write the failing test `tests/presentCalendar.test.ts`**

```ts
// rango 2026-11-04..2026-11-06 expande 3 días; weekly con recurrenceEnd corta; sin recurrenceEnd corta a 6 meses; mensual 31-ene omite febrero
expect(expandOccurrences([rango], 2026, 11).get("2026-11-05")?.length).toBe(1);
```

- [ ] **Step 5: Implement `expandOccurrences` + `presentCalendar`**

Algoritmo: por evento genera bloques `[date..endDate ?? date]`; si `recurrence === "none"` filtra al mes; si no, itera `cursor = date` desplazando (`+1d`, `+7d`, mismo día mes siguiente, mismo mes/día año siguiente) hasta `recurrenceEnd ?? date+6meses`, emitiendo cada bloque solapado con el mes. Orden por `allDay primero → time → title → path`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/calendar.test.ts tests/presentCalendar.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/domain/calendar.ts src/domain/types.ts tests/calendar.test.ts tests/presentCalendar.test.ts
git commit -m "feat: dominio calendario con grid mensual y expansion virtual"
```

### Task 2: Parser + templates de evento

**Files:**
- Modify: `src/domain/parseNote.ts`, `src/domain/templates.ts`
- Test: `tests/parseNote.test.ts`, `tests/templates.test.ts`

**Interfaces:**
- Consumes: `CalendarEventRecord`, `getMonthGrid` (Task 1, solo tipos).
- Produces: `parseProjectTaskNote` extendido con `{ kind: "calendar-event"; event: CalendarEventRecord }`, `TemplateKind` suma `"calendar-event"`, `TEMPLATE_FILE_NAMES["calendar-event"] = "evento.md"`.

- [ ] **Step 1: Write the failing parser tests (añadir a `tests/parseNote.test.ts`)**

```ts
// válido mínimo type calendar-event + kind evento + date 2026-11-04 + created
// hora time "10:30" allDay false; rango endDate; recurrence weekly; project ausente = global; endDate<date = issue; time "25:00" = issue; kind "fiesta" = issue
expect(parseProjectTaskNote({ path: "Calendario/X.md", basename: "X.md", content: minimo }, () => null).kind).toBe("calendar-event");
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/parseNote.test.ts`
Expected: FAIL (kind issue, no calendar-event)

- [ ] **Step 3: Implement `parseNote.ts` calendario**

Validar `DATE_REGEX ^\d{4}-\d{2}-\d{2}$` + fecha real vía `new Date`, `TIME_REGEX ^([01]\d|2[0-3]):[0-5]\d$`; `allDay` default `true` (si `time` presente y `allDay` true → ignorar `time`); `recurrence` default `none`; `status` default `open`; `endDate` opcional `>= date`; `project` string `"[[...]]"` → `resolveProject`, ausente → `projectPath: undefined`, roto → issue. Mensajes en español, nunca lanza.

- [ ] **Step 4: Write the failing template tests (añadir a `tests/templates.test.ts`)**

```ts
expect(TEMPLATE_FILE_NAMES["calendar-event"]).toBe("evento.md");
expect(validateTemplate(DEFAULT_TEMPLATE_CONTENT["calendar-event"], "calendar-event")).toBeNull();
```

- [ ] **Step 5: Implement `templates.ts` calendario**

`FIXED_TEMPLATE_PROPERTIES["calendar-event"] = ["type","kind","date","allDay","recurrence","created","status"]`, semilla `type: calendar-event, kind: evento, date vacía, allDay: true, recurrence: none, created: 1970-01-01, status: open`. `applyTemplate` estampa `created` + `today` (igual que task/note, sin `project` obligatorio).

- [ ] **Step 6: Run tests**

Run: `npm test -- tests/parseNote.test.ts tests/templates.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/domain/parseNote.ts src/domain/templates.ts tests/parseNote.test.ts tests/templates.test.ts
git commit -m "feat: parser y plantilla de calendar-event"
```

### Task 3: Settings + carpetas calendario

**Files:**
- Modify: `src/settings.ts`, `src/ui/SettingsTab.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `PluginSettings.calendarFolder`, `PluginSettings.calendarTemplatesFolder`, `DEFAULT_SETTINGS = { projectsFolder: "Projects", templatesFolder: "Projects/_templates", calendarFolder: "Calendario", calendarTemplatesFolder: "Calendario/_templates", credentialLockTimeoutMinutes: 15 }`.

- [ ] **Step 1: Write the failing test**

```ts
expect(DEFAULT_SETTINGS.calendarFolder).toBe("Calendario");
expect(normalizeVaultFolderPath("  Calendario/ ", "Calendario")).toBe("Calendario");
// merge preserva credSaltB64/credVerifier con nuevas keys
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/settings.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `settings.ts` + `SettingsTab.ts`**

Dos `Setting` nuevos "Carpeta de calendario" y "Carpeta de plantillas de calendario" con `normalizeVaultFolderPath(value, defaults.*)` y `writeSettings` existente (no tocar material clave).

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/settings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts src/ui/SettingsTab.ts tests/settings.test.ts
git commit -m "feat: settings de carpetas de calendario"
```

### Task 4: Repositorio calendario (scan + CRUD)

**Files:**
- Modify: `src/data/ProjectTaskRepository.ts`
- Test: `tests/ProjectTaskRepository.calendar.test.ts` (nuevo, fake adapter en memoria)

**Interfaces:**
- Consumes: `CalendarEventRecord`, `parseProjectTaskNote` calendario (Task 2), `settings.calendarFolder/calendarTemplatesFolder` (Task 3), `DEFAULT_TEMPLATE_CONTENT["calendar-event"]`, `VaultAdapter`.
- Produces: `DashboardData.calendarEvents`, `createCalendarEvent(input: { title: string; kind: CalendarKind; date: string; endDate?: string; time?: string; allDay?: boolean; recurrence?: CalendarRecurrence; recurrenceEnd?: string; projectLink?: string; body?: string }): Promise<string>`, `updateCalendarEvent(path: string, patch: Partial<...>): Promise<void>`, `setCalendarEventStatus(path, status): Promise<void>`, `deleteCalendarEvent(path): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// seed Calendario/ + _templates/evento.md; create devuelve "Calendario/Fiesta.md"; load lo lista; update cambia time vía processFrontMatter preservando body; delete lo saca del load; endDate<date va a issues
const path = await repo.createCalendarEvent({ title: "Fiesta", kind: "evento", date: "2026-11-04" });
expect((await repo.load()).calendarEvents.length).toBe(1);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/ProjectTaskRepository.calendar.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement scan + siembra + CRUD**

Scan plano `listMarkdownFiles(calendarFolder)` excluyendo `calendarTemplatesFolder`; siembra carpetas + plantilla con `createFolder`/`createMarkdown` sin sobrescribir; usa `sanitize + disambiguate` existentes; `processFrontMatter` para updates; `trash` para delete.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/ProjectTaskRepository.calendar.test.ts`
Expected: PASS (y suite completa `npm test` sin regresiones)

- [ ] **Step 5: Commit**

```bash
git add src/data/ProjectTaskRepository.ts tests/ProjectTaskRepository.calendar.test.ts
git commit -m "feat: repositorio de eventos de calendario"
```

### Task 5: Vista mes + modal + estilos

**Files:**
- Create: `src/ui/CalendarView.ts`, `src/ui/CalendarEventFormModal.ts`
- Modify: `styles.css`
- Test: manual en vault de prueba + `npm run build`

**Interfaces:**
- Consumes: `presentCalendar`, repo CRUD (Task 4), `ProjectPickerModal` existente para `project?`.
- Produces: `CalendarView extends ItemView { refresh(): Promise<void> }`, `VIEW_TYPE_DEVHELPER_CALENDAR = "devhelper-calendar"`.

- [ ] **Step 1: Implementar `CalendarView`**

Estado en memoria `year/month/selectedIsoDate` (default hoy). `render`: topbar `« Octubre 2026 Hoy » + [+ Nuevo]`, grid 6×7 con `inMonth` atenuada + `is-today` anillo + celda seleccionada + puntitos, click selecciona y re-renderiza panel día sin `refresh()` completo. Panel día: lista `hora/Todo el día + título + badge kind + badge proyecto` + lápiz (abre nota o modal edición) + papelera (`ConfirmDeleteModal` → `deleteCalendarEvent`) + `[+ Añadir aquí]`.

- [ ] **Step 2: Implementar `CalendarEventFormModal`**

Campos: título, kind select 4, fecha inicio (date), checkbox "varios días" + fecha fin, todo-el-día checkbox + hora (time), recurrencia select + fin recurrencia, proyecto opcional vía picker no-General, validación inline en español (misma silueta que `TaskFormModal`).

- [ ] **Step 3: Estilos `styles.css`**

Reutilizar `.devhelper-task-card` para filas; nuevas `.devhelper-calendar-grid/.devhelper-calendar-cell/.devhelper-dot--evento|--reunion|--fecha_limite|--aviso`; breakpoints `@media (max-width: 640px)` panel debajo y `@media (max-width: 320px)` acciones apiladas.

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: limpio. Run: `npm run build`
Expected: emite `main.js`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/CalendarView.ts src/ui/CalendarEventFormModal.ts styles.css
git commit -m "feat: vista mensual de calendario con panel de dia"
```

### Task 6: Cableado app + lateral funcional

**Files:**
- Modify: `src/main.ts`, `src/ui/DashboardView.ts`
- Test: manual + `npm run typecheck`

**Interfaces:**
- Consumes: `CalendarView`, `VIEW_TYPE_DEVHELPER_CALENDAR` (Task 5), `DashboardData.calendarEvents` (Task 4).
- Produces: `activateCalendarView(isoDate?: string)`, lateral con puntitos por kind.

- [ ] **Step 1: Hacer funcional `renderSideColumn`**

Reemplazar controles inertes por `‹ Hoy ›` con estado semana en memoria + botón `+`/click-día que llama `activateCalendarView(isoDate)`. Puntitos por `kind` (`evento` accent, `reunion` morado, `fecha_limite` rojo, `aviso` ámbar vía clases CSS). Sin listeners que muten repo directamente.

- [ ] **Step 2: Cablear `main.ts`**

`registerView(VIEW_TYPE_DEVHELPER_CALENDAR, leaf => new CalendarView(...))`, comando `open-calendar` "Abrir calendario", ribbon `calendar-days`, `activateCalendarView` con `getLeaf("tab") + setViewState`, y `scheduleDashboardRefresh` → refresca hojas dashboard + calendario. `setOnExpire` sigue solo dashboard.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: limpio. Run: `npm test`
Expected: PASS (sin regresiones). Manual: `npm run update:test-vault`, abrir "Abrir calendario", crear puntual/con hora/recurrente/rango vacaciones, comprobar puntitos lateral.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/ui/DashboardView.ts
git commit -m "feat: lateral de calendario funcional y registro de vista"
```

### Task 7: Cierre docs + verificación verde

**Files:**
- Modify: `AGENTS.md`
- Test: suite completa

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: `AGENTS.md` con regla Calendario + conteo de tests actualizado.

- [ ] **Step 1: Actualizar `AGENTS.md`**

Añadir `calendarFolder/templatesFolder` a settings, `CalendarEventRecord` a tipos, `calendar.ts` a dominio, `calendar-event` a parser, `ensureCalendarFolder + CRUD` a repo, `CalendarView` a UI, regla "Rango+recurrencia se expande virtual, nunca se materializa".

- [ ] **Step 2: Verificación final**

Run: `npm run typecheck`
Expected: limpio. Run: `npm test`
Expected: ~195/195 verde. Run: `npm run build`
Expected: `main.js` emitido. Run: `git status --short`
Expected: solo archivos esperados.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: cierre calendario mensual en AGENTS"
```
