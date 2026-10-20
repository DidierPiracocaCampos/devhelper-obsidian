---
name: devhelper-calendar
description: "Crear, listar y razonar sobre eventos del calendario mensual de DevHelper Dashboard (`type: calendar-event`). Respetar `allDay` ↔ `time`, validar `endDate >= date`, y `kind` ∈ {evento, reunion, fecha_limite, aviso}. Usa cuando el usuario pida trabajar con eventos."
---

# devhelper-calendar

## Cuándo me invocan

- «Créame un evento 'X' el 2026-11-05»
- «¿Qué hay el día Y?»
- «Lista los eventos de este mes» / «marzo de 2026»
- «Repite el evento 'X' cada lunes hasta junio»

## Modelo de datos

- Ruta: `<calendarFolder>/<YYYY-MM-DD>_<título-slug>.md` (carpeta plana).
- Props mínimas:

  ```yaml
  ---
  type: calendar-event
  title: <título>
  date: <YYYY-MM-DD>
  kind: evento | reunion | fecha_limite | aviso
  allDay: true
  status: open
  ---
  ```

- `time` (formato `HH:mm` 24h) **sólo** si `allDay: false`. Si el usuario
  da hora y `allDay: true`, se ignora `time` en favor de todo el día.
- `endDate` (inclusivo) y `recurrence: none|daily|weekly|monthly|yearly`
  opcionales.
- `project` ausente = evento global. Si está presente, **debe** apuntar a un
  proyecto existente:

  ```yaml
  project: "[[<projectsFolder>/<título>]]"
  ```

- `status` ∈ `{open, done}`; mismo uso que en tareas.

## Validaciones (siempre antes de `create`)

```powershell
# ¿endDate >= date?
if ($endDate -lt $date) { Write-Error "endDate debe ser >= date"; exit 1 }

# ¿kind válido?
$valid = @("evento","reunion","fecha_limite","aviso")
if ($valid -notcontains $kind) { Write-Error "kind no válido"; exit 1 }

# ¿time y allDay compatibles?
if (-not $allDay -and -not $time) { Write-Error "allDay=false requiere time"; exit 1 }
if ($allDay -and $time) { Write-Warning "Se ignorará time porque allDay=true" }
```

## Receta: crear un evento

1. Leer `calendarFolder`:

   ```bash
   obsidian eval 'app.plugins.plugins["devhelper-dashboard"].settings.calendarFolder'
   ```

   Caer a `Calendario`.
2. Si hay plantilla disponible (ver `devhelper-templates`), leerla y
   aplicar sus props fijas. Si no, partir de las props mínimas del modelo.
3. Sanitizar el título (regla del núcleo).
4. Componer el archivo y crearlo:

   ```bash
   obsidian create path="<calendarFolder>/<YYYY-MM-DD>_<título-slug>.md" \
     content="---\ntype: calendar-event\ntitle: <título>\ndate: <YYYY-MM-DD>\nkind: <kind>\nallDay: <true|false>\ntime: <HH:mm>\nstatus: open\n---\n\n" \
     silent
   ```

5. Validar inmediatamente con `obsidian read` y comprobar que el YAML es
   válido (frontmatter limpio, `kind` correcto, etc.).

## Receta: responder «¿qué hay el día X?»

1. El plugin **expande virtualmente** los rangos y recurrencias (sin
   materializar notas). El límite por defecto sin `recurrenceEnd` es **6
   meses** desde `date`.
2. La IA NO itera notas — pregunta al plugin vía:

   ```bash
   obsidian eval 'app.plugins.plugins["devhelper-dashboard"] && "ok"'
   # y luego abrir el calendario en el día pedido con:
   obsidian eval 'const w=app.workspace; const leaf=w.getLeavesOfType("devhelper-calendar")[0]; if(leaf){const v=leaf.view; v.setSelectedIsoDate("<YYYY-MM-DD>"); v.refresh();} else {w.openLinkText("DevHelper Calendar","",true);} '
   ```

   Si abrir el calendario en línea de comandos es complejo, la IA puede
   enumerar candidatos leyendo `<calendarFolder>/` y filtrando por fecha
   con `Select-String`.

## Receta: borrar

Pedir al usuario confirmación y proponer:

```bash
obsidian file:trash path="<calendarFolder>/<YYYY-MM-DD>_<título-slug>.md"
```

(o `obsidian eval` invocando `deleteCalendarEvent(path)` si el vault lo
expone). Nunca borrar sin confirmación.

## Lo que NO debe hacer

- No aceptar `endDate < date`: rechazarlo antes de crear.
- No usar `kind` fuera de los cuatro fijos.
- No generar fechas inválidas: `YYYY-MM-DD` siempre.
- No materializar ocurrencias como notas separadas (el plugin las expande virtualmente).
- No borrar sin confirmación humana.

## Errores comunes

- `endDate < date` → rechazo explícito, NO «corregir» silenciosamente.
- `time` HH:mm con segundos o AM/PM → normalizar a `HH:mm` 24h o rechazar.
- Mes con día 31 → `recurrence: monthly` omite febrero sin desplazar (lo decide el plugin; la IA sólo respeta la regla, no la corrige).

## Ejemplos YAML

Todo el día:

```yaml
---
type: calendar-event
title: Entrega del informe
date: 2026-11-05
kind: fecha_limite
allDay: true
status: open
---
```

Con hora:

```yaml
---
type: calendar-event
title: Reunión con el equipo
date: 2026-11-05
kind: reunion
allDay: false
time: 10:00
status: open
---
```

Rango + recurrencia:

```yaml
---
type: calendar-event
title: Sprint semanal
date: 2026-11-05
endDate: 2026-11-12
kind: reunion
allDay: false
time: 09:00
recurrence: weekly
recurrenceEnd: 2027-02-28
project: "[[Projects/Mi Proyecto]]"
status: open
---
```

Global (sin proyecto):

```yaml
---
type: calendar-event
title: Aviso general
date: 2026-11-05
kind: aviso
allDay: true
status: open
---
```
