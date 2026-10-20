---
name: devhelper-general
description: Identificar el proyecto sombra `Projects/General/` del dashboard de DevHelper Dashboard. Aloja los archivos y credenciales compartidas visibles en modo «Todos». La IA nunca lo crea ni lo selecciona. Usa cuando el usuario pregunte por la sección «Archivos de Todos» o por las credenciales compartidas.
---

# devhelper-general

## Cuándo me invocan

- «¿Qué hay en la sección Archivos de Todos?»
- «¿Dónde están las credenciales compartidas?»
- «¿Existe el proyecto General?»

## Naturaleza del proyecto

- `Projects/General/` (o la `<projectsFolder>` configurada + `/General/`) es **un proyecto sombra** sembrado por el plugin al primer uso. NO es un proyecto normal.
- Vive en `[[Projects/General]]` y su archivo es
  `<projectsFolder>/General/General.md`.
- **Nunca** aparece como chip de favorito, en el picker de proyectos, ni
  como selección directa del dashboard. Excepción: el modo «Todos» muestra
  sus archivos y (si existen) sus credenciales.

## Identificación

General se reconoce por:

- basename de la carpeta exactamente `general`/`General`/`GENERAL`, o
- título de la nota exactamente `General`.

Caso-insensitive. Cualquier otra variante de carpeta o título **no** es
General y debe tratarse como proyecto normal.

## Lo que aloja

- **Archivos compartidos**: `<projectsFolder>/General/Archivos/`.
- **Credenciales compartidas**: `<projectsFolder>/General/Credenciales.md`.

Ambas rutas siguen las reglas de `devhelper-files` y `devhelper-credentials`.

## Lo que la IA NO debe hacer

- **No** crear `Projects/General/General.md` a mano. Lo siembra el plugin al primer uso (a través del repositorio, no desde la IA).
- **No** añadir General a favoritos (`favorite: true` no tiene sentido).
- **No** seleccionar General como proyecto activo. Cualquier intento de
  reasignar `project:` a `[[<projectsFolder>/General]]` debe rechazarse.
- **No** borrar la carpeta General: si el usuario lo pide, devolverle al plugin.

## Recetas

### Comprobar si General existe

```bash
obsidian exists path="<projectsFolder>/General/General.md"
```

### Sembrar General

**Delegar al plugin.** Indicar al usuario que abra el dashboard; el plugin lo
siembra al primer uso.

### Listar archivos compartidos

Ver `devhelper-files` sección «Receta: listar archivos de un proyecto», sustituyendo el nombre del proyecto por `General`.

### Listar credenciales compartidas

Ver `devhelper-credentials` sección «Receta: listar `service` por proyecto», sustituyendo el nombre del proyecto por `General`.

## Errores comunes

- Asumir que `General` es un proyecto seleccionable → no lo es. Si el usuario lo pide para crear una tarea, devolver al plugin.
- Creer que cualquier carpeta o título que contiene «general» es la sombra → la regla de identificación es estricta (basename o título exacto, case-insensitive).
