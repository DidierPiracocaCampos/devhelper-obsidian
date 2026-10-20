---
name: devhelper-projects
description: "Crear, renombrar y listar proyectos (`type: project`) en este vault, respetando las carpetas configuradas de DevHelper Dashboard. Usa cuando el usuario pida crear un proyecto, renombrarlo, marcarlo como favorito o listar los existentes."
---

# devhelper-projects

## Cuándo me invocan

- «Créame un proyecto llamado X»
- «Renombra el proyecto Y a Z»
- «Lista los proyectos» / «¿cuántos proyectos hay?»
- «¿Existe el proyecto X?»

## Receta: crear un proyecto

1. Leer la carpeta configurada:

   ```bash
   obsidian eval 'app.plugins.plugins["devhelper-dashboard"].settings.projectsFolder'
   ```

   Caer a `Projects` si falla. **No** usar la carpeta por defecto si el vault la cambió.
2. Sanitizar el nombre aplicando la regla del núcleo
   (`\ / : * ? " < > | #` → `-`; colapsar `-`; trim `.`/espacios; vacío → `Untitled`).
3. Comprobar colisión con:

   ```bash
   obsidian exists path="<projectsFolder>/<slug>.md"
   ```

   Si existe, sufijar ` 2`, ` 3`, … hasta encontrar un hueco.
4. Crear la nota con frontmatter mínimo:

   ```bash
   obsidian create path="<projectsFolder>/<slug>.md" content="---\ntype: project\ncreated: <YYYY-MM-DD>\n---\n\n# <Título legible>\n" silent
   ```

5. **No** añadir `isGeneral: true` ni `favorite: true` salvo que el usuario lo pida.

## Receta: renombrar un proyecto

1. Confirmar el path actual con `obsidian exists path=<old>.md`.
2. Avisar al usuario: el renombrado **afecta a las tareas enlazadas** — el plugin actualiza la prop `project:` automáticamente, pero una edición manual puede dejar enlaces rotos.
3. Renombrar:

   ```bash
   obsidian file:rename path=<old>.md newname="<nuevo-título>.md"
   ```

4. Si el vault tenía `isGeneral: true` o `favorite: true`, recrear esas props con `obsidian property:set`.

## Receta: marcar favorito

```bash
obsidian property:set path="<projectsFolder>/<título>.md" name="favorite" value="true"
```

## Receta: listar proyectos

```bash
obsidian search query="type: project" path=<projectsFolder> format=path
```

Excluir siempre `General.md` (basename `General` o carpeta `general`/`General`).

## Lo que NO debe hacer

- No crear `Projects/General/General.md` (lo siembra el plugin).
- No borrar proyectos (delegar al plugin con confirmación humana).
- No usar caracteres inseguros en el nombre del archivo.

## Errores comunes

- Nombre con caracteres prohibidos por Windows/Obsidian → tras la sanitización del paso 2 desaparece.
- Colisión: si el path ya existe, crear con sufijo ` 2`/` 3`/`...` (no sobrescribir).

## Ejemplos YAML

Mínimo:

```yaml
---
type: project
---
```

Con fecha y favorito:

```yaml
---
type: project
created: 2026-10-20
favorite: true
---
```
