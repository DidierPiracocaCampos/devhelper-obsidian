---
name: devhelper-files
description: Copiar, listar y borrar archivos de la sección «Archivos» del dashboard de DevHelper Dashboard. Siempre dentro de `<projectsFolder>/<proyecto>/Archivos/`. En modo «Todos» los archivos que se muestran son los de `Projects/General/`. Usa cuando el usuario pida trabajar con la sección Archivos.
---

# devhelper-files

## Cuándo me invocan

- «Copie X al proyecto Y»
- «Lista los archivos del proyecto Y»
- «¿Dónde está el archivo Z?»
- «Borra el archivo X» (sólo proponer; el borrado lo confirma el usuario en la UI).

## Reglas de ruta

1. Leer `projectsFolder`:

   ```bash
   obsidian eval 'app.plugins.plugins["devhelper-dashboard"].settings.projectsFolder'
   ```

2. La sección Archivos usa **siempre** la carpeta
   `<projectsFolder>/<proyecto>/Archivos/`. Si no existe, crearla:

   ```bash
   obsidian folder:create path="<projectsFolder>/<proyecto>/Archivos"
   ```

3. El nombre del archivo se sanitiza con las reglas del núcleo.
4. Si el destino existe, sufijar ` 2`, ` 3`, … hasta encontrar un hueco.

## Receta: añadir un archivo

1. Pedir al usuario la ruta origen en el sistema (la IA **no** la asume).
2. Validar la ruta origen (`Test-Path`). Si no existe, abortar.
3. Determinar carpeta destino (proyecto indicado o `Projects/General/Archivos`
   si el usuario pidió «archivo global»).
4. Copiar:

   ```powershell
   Copy-Item -LiteralPath <origen> -Destination "<projectsFolder>/<proyecto>/Archivos/<nombre>"
   ```

5. Confirmar que la copia existe:

   ```bash
   obsidian exists path="<projectsFolder>/<proyecto>/Archivos/<nombre>"
   ```

## Receta: listar archivos de un proyecto

```bash
obsidian ls path="<projectsFolder>/<proyecto>/Archivos"
```

Si el usuario pregunta «¿qué hay en Todos?» usar primero:

```bash
obsidian ls path="<projectsFolder>/General/Archivos"
```

antes que cualquier proyecto. Esa es la regla Archivos/General.

## Receta: eliminar

**Proponer** al usuario y pedir confirmación. Borrar sólo con:

```bash
obsidian file:trash path="<projectsFolder>/<proyecto>/Archivos/<archivo>"
```

(o `General` si procede). La papelera es el único destino válido.

## Lo que NO debe hacer

- No copiar a la raíz del vault ni a `<projectsFolder>/`.
- No borrar archivos sin confirmación humana.
- No leer archivos binarios como notas: el plugin los maneja como `FileRecord`.

## Errores comunes

- Carpeta `<proyecto>/Archivos/` no existe → crearla con `folder:create` antes de copiar.
- Nombre con caracteres prohibidos → sanitizar.
- Sobre-escritura → la regla «sufijo ` 2`» del núcleo lo evita.

## Ejemplos YAML

No aplica. Los archivos son binarios fuera del modelo de notas. La
verificación usa `obsidian exists` y `obsidian ls`.
