---
name: devhelper-tasks
description: "Crear, reabrir, renombrar, reasignar y cambiar de estado tareas (`type: task`) en este vault, respetando las carpetas configuradas y el wikilink `project` de DevHelper Dashboard. Usa cuando el usuario pida trabajar con tareas."
---

# devhelper-tasks

## Cuándo me invocan

- «Créame una tarea 'X' en el proyecto Y»
- «Marca la tarea como hecha» / «reabre la tarea X»
- «Renombra / reasigna la tarea X»
- «Lista las tareas pendientes» / «¿qué tareas tengo abiertas?»

## Antes de crear una tarea

1. Confirmar que el proyecto destino existe:

   ```bash
   obsidian exists path="<projectsFolder>/<título-proyecto>.md"
   ```

   Si **no** existe: o crearlo primero con `devhelper-projects`, o pedir al usuario el proyecto correcto.
2. Localizar la convención del proyecto: la skill núcleo recomienda
   `<projectsFolder>/<proyecto>/Tareas/` o la carpeta del proyecto si la plantilla por proyecto lo exige. Usar:

   ```bash
   obsidian file:read path="<projectsFolder>/<proyecto>.md"
   ```

   para detectar cuerpo o props que indiquen la convención. Si no la hay, mantener `<projectsFolder>/<proyecto>/Tareas/`.
3. Resolver el wikilink del proyecto: el valor de `project:` **siempre** es
   `"[[<projectsFolder>/<título-proyecto>]]"` (sin `.md`, con `[[ ]]`).

## Receta: crear una tarea

```bash
obsidian create path="<carpeta>/<tarea>.md" \
  content="---\ntype: task\nproject: \"[[<projectsFolder>/<título-proyecto>]]\"\nstatus: open\n---\n\n# <Título legible>\n" \
  silent
```

Validar inmediatamente:

```bash
obsidian read path="<carpeta>/<tarea>.md"
```

Si la salida **no** muestra el YAML limpio, ir a Errores comunes.

## Receta: cambiar estado

```bash
obsidian property:set path="<carpeta>/<tarea>.md" name="status" value="done"
# o "open" para reabrir
```

**Nunca** reescribir el archivo entero.

## Receta: reasignar proyecto

```bash
obsidian property:set path="<carpeta>/<tarea>.md" name="project" value="\"[[<projectsFolder>/<otro-proyecto>]]\""
```

Validar que el nuevo proyecto existe con `obsidian exists`.

## Receta: renombrar

```bash
obsidian file:rename path="<carpeta>/<tarea>.md" newname="<nuevo-título>.md"
```

`project:` no se ve afectado.

## Receta: listar pendientes

```bash
obsidian search query="type: task path:<projectsFolder>" format=json
```

Filtrar en `obs-cli` los `status=open` y devolver títulos agrupados por proyecto.

## Lo que NO debe hacer

- No apuntar `project:` a un path inexistente.
- No usar `status` con valores fuera de `open`/`done`.
- No reescribir el archivo; usar `property:set`.
- No borrar tareas: delegar al plugin con confirmación humana.

## Errores comunes

- `project:` como ruta sin `[[ ]]` o sin cerrar comillas → va al panel «Notas con problemas».
- `status` ausente → añadir `status: open` con `property:set`.
- YAML con sangría de tabulador en vez de espacios → `js-yaml.load` falla; rehacer sin tabs.

## Ejemplos YAML

Mínimo:

```yaml
---
type: task
project: "[[Projects/Mi Proyecto]]"
status: open
---
```

Con fecha y orden:

```yaml
---
type: task
project: "[[Projects/Mi Proyecto]]"
status: open
created: 2026-10-20
---
```
