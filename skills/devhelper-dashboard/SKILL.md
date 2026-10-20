---
name: devhelper-dashboard
description: Contrato de las notas Markdown administradas por el plugin DevHelper Dashboard en este vault. Usa cuando alguien pida crear, listar, renombrar o razonar sobre proyectos, tareas, notas simples, credenciales, archivos, eventos de calendario o plantillas del plugin. Carga la skill hija correspondiente según el tipo de nota.
---

# devhelper-dashboard (núcleo)

## Cuándo me invocan

- «¿Qué tipo de nota es X?» — identificar por YAML.
- «¿Cómo creo un proyecto / tarea / nota / credencial / archivo / evento en este vault?»
- Cualquier operación sobre notas del plugin que no sepas resolver.

Cuando el disparador sea específico, **carga la skill hija**:

| Tarea | Skill |
|-------|-------|
| Crear/editar/listar proyectos | `devhelper-projects` |
| Crear/editar/cerrar tareas | `devhelper-tasks` |
| Crear/editar notas simples | `devhelper-notes` |
| Crear/listar credenciales | `devhelper-credentials` |
| Copiar/listar/borrar archivos | `devhelper-files` |
| Identificar el proyecto General | `devhelper-general` |
| Crear/editar/listar eventos de calendario | `devhelper-calendar` |
| Usar o sugerir plantillas | `devhelper-templates` |

## Modelo de datos (universal)

- **Frontmatter YAML**, `---` en la primera línea, parser `js-yaml.load`.
- Una sola prop `type` por nota. Props desconocidas se preservan intactas.
- El cuerpo Markdown del usuario se conserva siempre.
- **Carpetas configurables** — leer SIEMPRE con:

  ```bash
  obsidian eval 'app.plugins.plugins["devhelper-dashboard"].settings.projectsFolder'
  ```

  Si la lectura falla, defaults: `projectsFolder=Projects`, `templatesFolder=Projects/_templates`, `calendarFolder=Calendario`, `calendarTemplatesFolder=Calendario/_templates`.

- **Sanitización de nombres** al crear archivos:
  - `\ / : * ? " < > | #` → `-`
  - colapsar `-` repetidos
  - trim `.` y espacios en los bordes
  - vacío → `Untitled`
  - colisión → sufijo ` 2`, ` 3`, … antes de `.md`

- **Regla Archivos/General**: el proyecto `Projects/General/` es sombra; **nunca** lo crees ni lo selecciones. Aloja archivos y credenciales compartidas visibles en modo «Todos». Si necesitas identificarlo: basename de carpeta o título `general`/`General` case-insensitive.

## Política de borrado

- Borrar **sólo** papelera de Obsidian con confirmación humana.
- Una IA **no borra proyectos ni carpetas**. Si el usuario lo pide, devolver instrucciones para usar el plugin.
- Tareas, notas simples, archivos y eventos de calendario: proponer el borrado como instrucción para que el usuario confirme.

## Política de credenciales

- **Nunca** se genera el prefijo `enc:v1:` a mano.
- Antes de crear/editar credenciales, comprobar si el vault tiene maestra:

  ```bash
  obsidian eval 'JSON.stringify({salt: !!app.plugins.plugins["devhelper-dashboard"].settings.credSaltB64, verifier: !!app.plugins.plugins["devhelper-dashboard"].settings.credVerifier})'
  ```

- Si hay maestra, **delegar al plugin**: pedir al usuario que desbloquee desde el dashboard y use el modal de credenciales. La IA sólo lista `service` (campo en claro).
- Si no hay maestra y el usuario pide crear la primera credencial, instruirle a fijar la maestra desde el dashboard primero.

## Plantillas

- Antes de crear una nota, listar plantillas disponibles:

  ```bash
  obsidian ls path=<projectsFolder>/_templates
  obsidian ls path=<calendarFolder>/_templates
  ```

- Si hay plantilla apropiada (p. ej. `proyecto.md`, `tarea.md`, `evento.md`), leerla y aplicar sus props fijas preservando cuerpo y props desconocidas.
- Nunca sobrescribir plantillas existentes.

## Lo que NO debe hacer

- No leer ni escribir `data.json` directamente.
- No modificar el cuerpo Markdown al editar propiedades (usa `obsidian property:set`).
- No generar blobs `enc:v1:` a mano.
- No crear ni borrar la carpeta `<projectsFolder>/General/`.

## Errores comunes

- Frontmatter sin `---` en línea 1 → ir al panel «Notas con problemas».
- `project` apuntando a un path inexistente → mismo panel.
- `status` con valor distinto de `open`/`done` → mismo panel.
- Credenciales en plano cuando hay maestra → migrar con el botón del plugin, no desde la IA.

## Ejemplos YAML mínimos

Proyecto (`Projects/<título>.md`):

```yaml
---
type: project
---
```

Tarea (`<carpeta-del-proyecto>/<título>.md`):

```yaml
---
type: task
project: "[[Projects/Mi Proyecto]]"
status: open
---
```

Nota simple:

```yaml
---
type: note
project: "[[Projects/Mi Proyecto]]"
created: 2026-10-20
---
```

Evento de calendario:

```yaml
---
type: calendar-event
date: 2026-11-05
kind: reunion
allDay: true
status: open
---
```
