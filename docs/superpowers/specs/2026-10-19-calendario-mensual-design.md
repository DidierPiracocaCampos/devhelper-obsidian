# Diseño: calendario mensual con vista propia (recordatorios + rangos + recurrencia)

## Objetivo

Sacar el mini-calendario actual (tira semanal visual e inerte en `DashboardView.renderSideColumn`) a una pantalla propia por mes, manteniendo la tarjeta lateral como resumen + puerta de entrada.

Decisiones acordadas con el usuario antes del diseño: modelo mixto (lateral sigue + botón abre vista mes), 4 tipos (evento / reunión / fecha límite / aviso), eventos globales en `Calendario/` con link opcional a proyecto, vista mes en grid Lun-Dom con puntitos por tipo y clic en día que abre panel del día con lista + crear, y V1 con día puntual + hora puntual + recurrencia + rango multi-día tipo vacaciones.

## Alcance

### Incluye

- Nuevo tipo de nota `type: calendar-event`, un `.md` por recordatorio en `Calendario/`.
- Campos: `kind`, `date`, `endDate?`, `time?`, `allDay`, `recurrence`, `recurrenceEnd?`, `project?` opcional, `created`, `status` (open|done para tachar avisos).
- Rango inclusivo `[date..endDate]` + recurrencia (`none|daily|weekly|monthly|yearly`) con expansión virtual (no materializa ficheros), tope 6 meses sin `recurrenceEnd`.
- Settings: `calendarFolder` (default `Calendario`) + `calendarTemplatesFolder` (default `Calendario/_templates`), con misma normalización que proyectos.
- Templates: nuevo `TemplateKind "calendar-event"` (`evento.md`) con semilla y validación.
- Repo: scan de `Calendario/`, CRUD `createCalendarEvent` / `updateCalendarEvent` / `setCalendarEventStatus` / `deleteCalendarEvent` (papelera + confirmación), todo atómico vía `processFrontMatter`.
- Presenter puro: `getMonthGrid` + `expandOccurrences` + `presentCalendar`, orden `date → allDay primero → time → title`.
- UI: `CalendarView` nueva (`VIEW_TYPE_DEVHELPER_CALENDAR`, comando "Abrir calendario", ribbon `calendar-days`), grid mes + panel día + `CalendarEventFormModal`. `DashboardView` lateral pasa a funcional (navegar semana + puntitos + botón abrir).
- Tests nuevos (parser, grid, expansión, repo, settings) y `AGENTS.md` actualizado.

### Excluye

- Notificaciones push / recordatorios del SO.
- Invitados, videollamada, adjuntos o sincronización externa (Google/Outlook/iCal).
- Cambio de `kind` a taxonomía personalizada por el usuario (4 fijos en V1; `nota` suelta se modela como body del evento o `type: note` existente, no como 5º kind).
- Import/export iCal (.ics).
- Borrado de carpetas o de proyectos (sigue fuera de alcance).
- Recurrencia avanzada (RRULE completo, "cada 2 semanas", "tercer lunes"): solo daily/weekly/monthly/yearly + fin opcional.

## Modelo de datos

```yaml
---
type: calendar-event
kind: evento        # evento | reunion | fecha_limite | aviso
date: 2026-11-04   # YYYY-MM-DD obligatorio
endDate: 2026-11-08  # opcional, inclusivo, >= date
time: "10:30"      # opcional HH:mm 24h, solo si allDay: false
allDay: true       # default true; si hay time => false
recurrence: none   # none | daily | weekly | monthly | yearly
recurrenceEnd: 2027-02-01  # opcional YYYY-MM-DD, tope de expansión
project: "[[Mi Proyecto]]" # opcional; ausente = global
created: 2026-10-19
status: open       # open | done
---
Texto libre de la nota del día / detalles del evento.
```

Reglas:

- Título = basename (misma sanitización que tareas: `\/:*?"<>|#` → `-`, colapsar `-`, trim `./ `, vacío → `Untitled`, colisión → ` 2`, ` 3`).
- `endDate < date` → issue en español, no tumba el resto.
- `time` valida `HH:mm`; si `allDay: true` y hay `time`, el `time` se ignora (la UI no lo envía); `kind/recurrence/status` fuera de enum → issue.
- `project` presente pero irresoluble → issue (igual que tareas); ausente → global válido.
- Rango + recurrencia combinan: se repite el bloque completo `[date..endDate]`. Mensual repite mismo día de mes (si el mes no trae ese día, ese mes se omite); anual repite mismo mes/día (29-feb solo en bisiestos).
- `status: done` tacha el evento (misma semántica que tareas); no filtra por defecto.

## Carpetas, settings y templates

- `PluginSettings` añade `calendarFolder: "Calendario"`, `calendarTemplatesFolder: "Calendario/_templates"`.
- `normalizeVaultFolderPath` + `mergePluginSettings` reutilizados (no tocar `credSaltB64`/`credVerifier`).
- `SettingsTab`: dos `TextComponent` más con la misma validación.
- Estructura plana: `Calendario/*.md` son eventos; `Calendario/_templates/` excluido del scan (igual que `Projects/_templates`).
- `templates.ts`: `TemplateKind` suma `"calendar-event"`, `TEMPLATE_FILE_NAMES["calendar-event"] = "evento.md"`, `FIXED_TEMPLATE_PROPERTIES["calendar-event"] = ["type","kind","date","allDay","recurrence","created","status"]`, semilla por defecto (kind evento, allDay true, recurrence none, status open).
- Repo siembra `Calendario/` + `_templates/evento.md` al primer `load()`, nunca sobrescribe forks del usuario. Semilla inválida → issue, no lanza.

## Repositorio y presenter

### `parseNote`

Nuevo `kind: "calendar-event"` → `CalendarEventRecord`:

```ts
interface CalendarEventRecord {
  path: string; title: string;
  kind: "evento" | "reunion" | "fecha_limite" | "aviso";
  date: string; endDate?: string;
  time?: string; allDay: boolean;
  recurrence: "none" | "daily" | "weekly" | "monthly" | "yearly";
  recurrenceEnd?: string;
  projectPath?: string; // undefined = global
  status: "open" | "done";
  properties: Record<string, unknown>;
}
```

`ParsedNote` suma `{ kind: "calendar-event"; event: CalendarEventRecord }`. Todo error → `{ kind: "issue" }` en español.

### `ProjectTaskRepository`

- `load()` escanea además `calendarFolder/*.md` (no recursivo). `DashboardData` suma `calendarEvents: CalendarEventRecord[]`.
- `createCalendarEvent(input): Promise<string>` devuelve path creado (para seleccionar el día).
- `updateCalendarEvent(path, patch)` solo toca las keys pedidas vía `processFrontMatter`.
- `setCalendarEventStatus(path, status)` atómico sobre `status`.
- `deleteCalendarEvent(path)` a papelera tras `ConfirmDeleteModal` (la vista confirma; el repo ejecuta trash).
- Una mutación = un solo cambio atómico; body + props custom se preservan.

### `domain/calendar.ts` (nuevo, puro, sin Obsidian)

- `getMonthGrid(year, month1_12): MonthCell[][]` → 6×7 celdas Lun-Dom, `inMonth`, `isoDate YYYY-MM-DD`, `isToday`.
- `expandOccurrences(events, year, month): Map<string, CalendarOccurrence[]>` donde `CalendarOccurrence = { event, occurrenceDate }`. Rango = una entrada por día inclusivo; recurrencia desplaza el bloque (daily +1d, weekly +7d, monthly mismo día mes, yearly mismo mes/día); tope `recurrenceEnd` o 6 meses desde `date`.
- `presentCalendar(data, year, month)` → `{ grid, byDate, counts }` ordenado por `allDay primero → time → title case-insensitive → path`.
- `monthLabel` en español vía `Intl.DateTimeFormat("es-ES", { month: "long" })` (igual que `weekStrip`).

`presentDashboard` no cambia su contrato salvo pasar `calendarEvents` para que el lateral pinte puntitos.

## UI

### Dashboard lateral (mixto)

`renderSideColumn` deja de ser placeholder:

- `‹ Hoy ›` navegan la semana visible (estado en memoria, sin persistir).
- `+` abre `CalendarView` en el mes/día visible.
- Puntitos bajo cada día con color por `kind` (4 colores vía variables Obsidian, leyenda en tooltip).
- Click en día → abre `CalendarView` con ese día seleccionado.

### `CalendarView` (nueva `ItemView`)

- `VIEW_TYPE_DEVHELPER_CALENDAR = "devhelper-calendar"`, `getDisplayText "Calendario DevHelper"`, icono `calendar-days`.
- `main.ts`: `registerView`, comando `open-calendar` ("Abrir calendario"), ribbon propio, `activateCalendarView(date?)`, y el debounce de vault refresca dashboard + calendario.
- Estado en memoria: `year, month, selectedIsoDate` (default hoy). Cada `refresh()` re-lee `repository.load()` + `presentCalendar`; sin snapshot (igual que dashboard).
- Layout: topbar (`« Octubre 2026 Hoy »` + `[+ Nuevo]`), grid 7 col (cabecera L M X J V S D), celdas fuera-de-mes atenuadas, hoy con anillo, badges/puntos por kind, celda seleccionada marcada.
- Panel día: `4 nov — 3 eventos` + lista (hora o "Todo el día" + título + badge kind + badge proyecto opcional) + lápiz/papelera + `[+ Añadir aquí]` (pre-rellena fecha).
- `CalendarEventFormModal` (patrón `TaskFormModal`): título, kind select, fecha inicio, fin opcional (checkbox "varios días"), todo-el-día checkbox + hora, recurrencia select + fin recurrencia, proyecto opcional (reusa `ProjectPickerModal` filtrado no-General), validación inline en español.
- Empty states con `appendEmptyState` ("No hay eventos este mes / este día").
- Responsive: `@media (max-width: 640px)` una columna (panel día debajo), `@media (max-width: 320px)` acciones apiladas (mismo patrón que dashboard).
- Todo texto UI en español.

## Flujo de datos

`Vault (Calendario/*.md)` → `ObsidianVaultAdapter` → `ProjectTaskRepository.load()` → `parseProjectTaskNote` → `DashboardData{calendarEvents}` → `presentCalendar` (expansión virtual) → `CalendarView` / `DashboardView lateral`. Escritura: modal → repo (`processFrontMatter` / `createMarkdown` / `trash`) → `refresh()` ambas vistas vía debounce 250ms.

## Errores

Todos a `DashboardData.issues` con "Abrir nota":

- Falta `type`, `kind`, `date`; `date/endDate/recurrenceEnd` no `YYYY-MM-DD`; `endDate < date`; `time` no `HH:mm`; enums inválidos; `project` roto; frontmatter ausente/YAML inválido.
- Plantilla calendario inválida → un issue, no bloquea.
- `Calendario/` ausente → se siembra; sin eventos → empty state, nunca lanza.

## Tests

Sin mocks, con `VaultAdapter` en memoria (patrón actual). Nuevos:

- `tests/calendar.test.ts`: grid 6×7 Lun-Dom, `inMonth`, bisiesto, `monthLabel` español, `isToday`.
- `tests/parseNote.calendar.test.ts` o extensión de `parseNote.test.ts`: 12 casos (válido mínimo, hora, rango, recurrencia, proyecto opcional, cada modo de error).
- `tests/presentCalendar.test.ts`: rango inclusivo, daily/weekly/monthly/yearly, tope 6 meses, orden, combinación rango+recurrencia.
- `tests/ProjectTaskRepository.calendar.test.ts`: siembra carpetas, `create/update/status/delete`, `processFrontMatter` preserva body, trash.
- `tests/settings.test.ts`: normalización de las 2 carpetas nuevas + preservación `credSaltB64`/`credVerifier`.
- Objetivo: 163 → ~195 en verde. `npm run typecheck` limpio, `npm run build` emite `main.js`.

## Verificación local

```bash
npm run typecheck
npm test
npm run build
git status --short
```

Más `npm run update:test-vault` y apertura manual: comando "Abrir calendario", crear evento puntual / con hora / recurrente / rango vacaciones, comprobar puntitos en lateral y panel día.
