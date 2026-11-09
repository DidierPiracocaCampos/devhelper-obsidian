---
name: devhelper-buttons
description: "Añadir, crear o editar botones de la barra del dashboard DevHelper que ejecutan código JavaScript (`type: toolbar-button`). Cada botón es una nota en `buttonsFolder` con un bloque js (acción directa) o varios encabezados `##` (menú). Usa cuando el usuario pida «añade un botón…» o «crea un botón en la barra que…»."
---

# devhelper-buttons

## Cuándo me invocan

- «Añade un botón a la barra que ejecute `npm run build`»
- «Crea un botón que cree una tarea en el proyecto actual»
- «Haz un botón de despliegue con varias opciones»
- «Cambia el icono / el orden / el código del botón X»

## Ubicación

- Los botones son notas Markdown en `buttonsFolder` (default `Botones`, carpeta
  del vault, **no recursiva**: las subcarpetas no se leen).
- Leer la carpeta de `.obsidian/plugins/devhelper-dashboard/data.json`
  (clave `buttonsFolder`, **sólo lectura**) o con
  `obsidian eval 'app.plugins.plugins["devhelper-dashboard"].settings.buttonsFolder'`.
  Si falla, usar `Botones`.
- Nombre de archivo: `<label>.md` sanitizado (`\ / : * ? " < > | #` → `-`,
  colapsar `-`, trim `.`/espacios, vacío → `Untitled`; colisión → ` 2`, ` 3`…).
- Plantilla: `<templatesFolder>/boton.md` (se siembra sin sobrescribir). Léela y
  úsala de base si existe.

## Formato de la nota

````markdown
---
type: toolbar-button
label: Despliegue        # obligatorio; tooltip y aria-label
icon: rocket             # opcional; icono Lucide, default square-terminal
order: 10                # opcional; número, ascendente; default al final
enabled: true            # opcional; default true; false = no se pinta
---
Texto libre opcional (descripción, se ignora).

## Build
```js
const r = await ctx.run("npm run build", { cwd: "D:/proyects/x" });
ctx.notice(r.code === 0 ? "Build OK" : r.stderr);
```

## Abrir changelog
```js
await app.workspace.openLinkText("CHANGELOG", "");
```
````

Reglas del parser (`src/domain/toolbarButtons.ts`, nunca lanza):

- La portada `---` debe ser la **primera línea**. Sin portada o con `type`
  distinto de `toolbar-button` la nota se ignora sin aviso.
- `label` obligatorio (string no vacío); si falta, la nota es un issue y no se pinta.
- Bloques de código válidos: vallas ```` ``` ```` o `~~~` con lenguaje `js` o
  `javascript` (case-insensitive). Otros lenguajes se ignoran.
- **Acción directa**: sin encabezados `##`; se ejecuta el **primer** bloque js.
  Sin bloque js → issue.
- **Menú**: si hay encabezados `## ` (fuera de bloques de código), cada uno es
  una opción (texto del encabezado = etiqueta) con el **primer** bloque js hasta
  el siguiente `##`. Opción sin bloque js → aviso y se omite; menú sin ninguna
  opción válida → issue.
- Un botón de menú no se puede ejecutar sin elegir opción.

## Entorno del script

El código se ejecuta como cuerpo de `AsyncFunction("app", "obsidian", "ctx", code)`:
`await` de primer nivel disponible; no hace falta envolverlo en una función.

| Miembro | Contrato |
|---|---|
| `app` | `App` de Obsidian (vault, workspace, metadataCache…) |
| `obsidian` | módulo `obsidian` (`Notice`, `Modal`, `Menu`, `normalizePath`…) |
| `ctx.project` | `{ path, title }` del proyecto seleccionado (`path` = nota hub `.md`) o `null` en «Todos» |
| `ctx.repo.createTask(title, projectPath)` | `Promise<void>`; `projectPath` = ruta `.md` del hub |
| `ctx.repo.createNote(title, projectPath)` | `Promise<void>` |
| `ctx.repo.setTaskStatus(path, status)` | `Promise<void>`; `status` = `"open"` o `"done"` |
| `ctx.repo.renameTask(path, title)` | `Promise<void>` |
| `ctx.repo.reassignTask(path, projectPath)` | `Promise<void>` |
| `ctx.repo.createCalendarEvent(input)` | `Promise<string>` (path); `input`: `title`, `kind` (`evento`, `reunion`, `fecha_limite`, `aviso`), `date` `YYYY-MM-DD`, y opcionales `endDate`, `time` `HH:mm`, `allDay`, `recurrence`, `recurrenceEnd`, `projectLink` (ruta `.md` del hub), `body`, `status` |
| `ctx.repo.updateCalendarEvent(path, patch)` | `Promise<void>`; `null` borra una prop opcional |
| `ctx.repo.setCalendarEventStatus(path, status)` | `Promise<void>` |
| `ctx.repo.load()` | datos actuales del dashboard |
| `ctx.run(cmd, { cwd?, timeoutMs? })` | `Promise<{ code, stdout, stderr }>`; `code` ≠ 0 **no** rechaza; `cwd` default raíz del vault; `timeoutMs` default 60000; sólo escritorio (en móvil rechaza) |
| `ctx.notice(msg, ms?)` | muestra un `Notice` |
| `ctx.refresh()` | refresca dashboard y calendario |
| `ctx.openCalendar(isoDate?)` | abre el calendario (en ese día) |
| `ctx.button` | `{ label, option, path }` (`option` = etiqueta de la opción o `null`) |

Los métodos de `ctx.repo` están ligados: se llaman sin `this`.

## Ejemplos copiables

Tarea en el proyecto actual:

```js
if (!ctx.project) throw new Error("Selecciona un proyecto primero");
await ctx.repo.createTask("Revisar PR", ctx.project.path);
ctx.refresh();
ctx.notice("Tarea creada en " + ctx.project.title);
```

`npm run build` con resultado:

```js
const r = await ctx.run("npm run build", { cwd: "D:/proyects/mi-app", timeoutMs: 120000 });
ctx.notice(r.code === 0 ? "Build OK" : "Build falló: " + r.stderr.slice(0, 200), 6000);
```

Abrir una nota:

```js
await app.workspace.openLinkText("CHANGELOG", "");
```

Menú de despliegue (nota completa):

````markdown
---
type: toolbar-button
label: Despliegue
icon: rocket
order: 10
---
## Staging
```js
const r = await ctx.run("npm run deploy:staging", { cwd: "D:/proyects/mi-app" });
ctx.notice(r.code === 0 ? "Staging OK" : r.stderr);
```

## Producción
```js
const r = await ctx.run("npm run deploy:prod", { cwd: "D:/proyects/mi-app" });
ctx.notice(r.code === 0 ? "Producción OK" : r.stderr);
```
````

Evento hoy:

```js
const d = new Date();
const pad = (n) => String(n).padStart(2, "0");
const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
await ctx.repo.createCalendarEvent({
  title: "Daily",
  kind: "reunion",
  date,
  allDay: false,
  time: "10:00",
  ...(ctx.project ? { projectLink: ctx.project.path } : {}),
});
ctx.refresh();
ctx.openCalendar(date);
```

## Reglas para la IA

- Crear/editar **sólo la nota del botón**. Nunca tocar `data.json`.
- **Nunca activar `allowButtonScripts`**: pedirle al usuario que lo haga en
  Ajustes → DevHelper Dashboard → «Botones de la barra». Con el interruptor
  apagado los botones se ven atenuados y no ejecutan nada.
- Preferir `ctx.repo` a escribir a mano notas de tareas/eventos (plantillas,
  sanitización y propiedades las gestiona el plugin).
- `ctx.run` no funciona en móvil; avisarlo si el usuario usa Obsidian móvil.
- No incrustar secretos (contraseñas, tokens) en el código del botón.
- Avisar al usuario de que el script corre con acceso completo al vault y, en
  escritorio, al sistema: que lo revise antes de activarlo.
- No borrar botones; si el usuario lo pide, indicarle que borre la nota.

## Verificación

- La barra se refresca sola al guardar la nota.
- Errores de formato: panel de avisos del dashboard («Notas con problemas»).
- Errores de ejecución: `Notice` «Error en «Label › Opción»: …» y consola.
