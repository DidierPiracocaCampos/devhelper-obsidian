---
name: devhelper-templates
description: Usar y sugerir las plantillas configuradas (`Plantillas/`, `Plantillas/Calendario/`) del dashboard de DevHelper Dashboard. La IA las lee con `obsidian-cli` y aplica props fijas preservando cuerpo y props del usuario. Usa cuando el usuario pida crear una nota de cualquier tipo y pueda existir plantilla.
---

# devhelper-templates

## Cuándo me invocan

- Antes de **cualquier** operación de creación (`devhelper-projects`,
  `devhelper-tasks`, `devhelper-notes`, `devhelper-calendar`).
- Cuando el usuario pregunta qué plantillas hay disponibles.

## Modelo de datos

- Las plantillas son notas Markdown ordinarias con frontmatter (parcial o
  completo) que el plugin aplica al crear.
- Rutas:
  - `<templatesFolder>/` — plantillas de proyecto/tarea/nota
    (reconocidas por nombre: `proyecto.md`, `tarea.md`, `nota.md`, etc.).
  - `<calendarTemplatesFolder>/` — plantillas de evento de calendario
    (reconocidas: `evento.md`, `reunion.md`, `fecha_limite.md`, `aviso.md`).
- Las plantillas **nunca** se sobrescriben.

## Receta: listar plantillas

```bash
obsidian ls path="<templatesFolder>"
obsidian ls path="<calendarTemplatesFolder>"
```

Si la carpeta no existe, no crearla por defecto: preguntar al usuario antes
de `folder:create`.

## Receta: aplicar una plantilla

1. Leer la plantilla:

   ```bash
   obsidian read path="<ruta-plantilla>.md"
   ```

2. Tomar el frontmatter de la plantilla como base. NO sobre-escribir:
   - `type`: ya viene fijo en la plantilla; respetarlo salvo que el usuario pida otro.
   - `kind` (eventos): viene de la plantilla (`reunion.md` → `kind: reunion`); respetarlo salvo que el usuario pida otro.
   - Cualquier prop `created:` o `created` del usuario debe sobreescribir la de la plantilla.
3. Si el usuario pasa un título o fecha, completar las props mínimas:
   - Para `proyecto.md`: `created: <YYYY-MM-DD>` opcional.
   - Para `tarea.md`: `project: "[[<...>/<proyecto>]]"`, `status: open`,
     `created: <YYYY-MM-DD>`.
   - Para `nota.md`: `project: "[[<...>/<proyecto>]]"`,
     `created: <YYYY-MM-DD>`.
   - Para `evento.md`: `title: <título>`, `date: <YYYY-MM-DD>`,
     `kind: <de la plantilla>`.
4. Crear la nota sustituyendo el frontmatter y preservando cualquier cuerpo
   no-frontmatter de la plantilla. Si la plantilla sólo tiene frontmatter,
   añadir `# <Título legible>` como cuerpo mínimo.

## Receta: sugerir plantilla

Cuando el usuario pida crear un evento `reunion`, preferir
`<calendarTemplatesFolder>/reunion.md` si existe. Si no,
preferir `evento.md` y sobrescribir `kind: reunion`. Para tareas,
preferir `<templatesFolder>/tarea.md`. Si no hay ninguna,
ir al mínimo del modelo de datos de la skill correspondiente.

## Lo que NO debe hacer

- No sobrescribir plantillas existentes (`obsidian create ... silent overwrite` está prohibido).
- No crear la carpeta de plantillas si no existe: preguntar primero.
- No alterar el cuerpo de la plantilla: sólo se aplica al crear notas nuevas.

## Errores comunes

- Carpeta de plantillas ausente → preguntar al usuario si la crea, no asumir.
- Prop `type:` ausente en la plantilla → completarla con el tipo conocido del nombre del archivo (no inventar).
- Conflicto entre el `kind:` de la plantilla y el pedido del usuario → gana el usuario.

## Ejemplos YAML

Plantilla mínima de proyecto (`Plantillas/proyecto.md`):

```yaml
---
type: project
created: <YYYY-MM-DD>
---

# <Título del proyecto>

<Descripción inicial>
```

Plantilla mínima de tarea (`Plantillas/tarea.md`):

```yaml
---
type: task
project: "[[<projectsFolder>/<proyecto>]]"
status: open
created: <YYYY-MM-DD>
---

# <Título de la tarea>

<Detalles>
```

Plantilla mínima de evento (`Plantillas/Calendario/evento.md`):

```yaml
---
type: calendar-event
title: <Título>
date: <YYYY-MM-DD>
kind: evento
allDay: true
status: open
---
```
