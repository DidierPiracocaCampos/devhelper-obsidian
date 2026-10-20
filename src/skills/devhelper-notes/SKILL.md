---
name: devhelper-notes
description: Crear, renombrar, reasignar y listar notas simples (`type: note`) en este vault, dentro de la carpeta del proyecto que las aloja. Usa cuando el usuario pida añadir una nota suelta a un proyecto, o mover una nota entre proyectos.
---

# devhelper-notes

## Cuándo me invocan

- «Añada una nota 'X' al proyecto Y»
- «Renombra la nota X» / «mueve la nota X al proyecto Z»
- «Lista las notas del proyecto Y»

## Modelo de datos

- Una nota simple vive en `<projectsFolder>/<proyecto>/Notas/<título>.md` por
  convención (verificar primero con `obsidian file:read`).
- Props mínimas:

  ```yaml
  ---
  type: note
  project: "[[<projectsFolder>/<proyecto>]]"
  created: <YYYY-MM-DD>
  ---
  ```

- `status` **no existe** en notas simples (sólo en tareas y eventos).

## Receta: crear

1. Confirmar el proyecto destino (`obsidian exists`).
2. Crear la carpeta `<projectsFolder>/<proyecto>/Notas/` si no existe
   (`obsidian folder:create path=<ruta>`).
3. Aplicar sanitización del núcleo al nombre del archivo.
4. Crear la nota:

   ```bash
   obsidian create path="<projectsFolder>/<proyecto>/Notas/<título>.md" \
     content="---\ntype: note\nproject: \"[[<projectsFolder>/<proyecto>]]\"\ncreated: <YYYY-MM-DD>\n---\n\n" \
     silent
   ```

## Receta: reasignar a otro proyecto

Mover la nota **no** se hace borrando y creando: el plugin acepta cambiar
`project:` y mover el archivo a la carpeta destino.

1. Crear la nota destino con el mismo cuerpo y `project:` actualizado.
2. Borrar la nota origen a la papelera con confirmación humana:

   ```bash
   obsidian file:trash path=<origen>.md   # NO usar — pedir confirmación al usuario
   ```

   Por seguridad, la IA **propone** el trash y pide al usuario que lo ejecute
   desde el dashboard.

## Receta: renombrar

```bash
obsidian file:rename path="<carpeta>/<nota>.md" newname="<nuevo>.md"
```

`project:` no se ve afectado.

## Receta: listar por proyecto

```bash
obsidian search query="type: note path:<projectsFolder>/<proyecto>/Notas" format=path
```

## Lo que NO debe hacer

- No asignar `type: note` a una tarea o evento (son tipos distintos).
- No borrar notas sin confirmación humana.

## Errores comunes

- Nota sin `project:` → va a «Notas con problemas».
- `created:` no es fecha (`YYYY-MM-DD`) → corregir a formato ISO con `property:set`.

## Ejemplos YAML

Mínimo:

```yaml
---
type: note
project: "[[Projects/Mi Proyecto]]"
---
```

Con fecha:

```yaml
---
type: note
project: "[[Projects/Mi Proyecto]]"
created: 2026-10-20
---
```
