# Diseño: Estructura de carpetas por proyecto, plantillas y credenciales (V2)

## Objetivo

Evolucionar el plugin de la estructura plana de la V1 (`Projects/*.md` y `Tasks/*.md`
sueltas) a una estructura autocontenida por proyecto: cada proyecto es una carpeta con
su nota hub, su nota de credenciales, su directorio de tareas y su directorio de
archivos. Las notas se crean a partir de plantillas editables que viven en el vault y
que definen un conjunto de properties fijas ampliables por el usuario.

Las notas Markdown siguen siendo la única fuente de verdad. Se mantiene la filosofía
de la V1: validación local por nota con issues accionables, mutaciones atómicas por
property vía `processFrontMatter` y preservación del cuerpo y las properties
personalizadas.

## Alcance de la V2

### Incluye

- Nueva estructura de carpetas por proyecto (nota hub + `Credenciales.md` + `Tareas/`
  + `Archivos/`), creada completa al dar de alta un proyecto desde el dashboard.
- Plantillas de nota (`proyecto.md`, `tarea.md`, `credenciales.md`) como archivos
  editables en el vault, sembradas por el plugin en el primer arranque.
- Properties fijas por tipo de nota; el usuario puede añadir properties, nunca quitar
  las fijas.
- Nota de credenciales por proyecto con lista estructurada en frontmatter, parseada y
  validada por el plugin (sin UI dedicada todavía).
- Ajustes del plugin: `projectsFolder` y `templatesFolder`. Desaparece `tasksFolder`.
- Adaptación mínima del dashboard a la nueva estructura (los chips de proyecto muestran
  el `status`). Las secciones Archivos y Contraseña siguen siendo placeholders inertes.
- Issues nuevos para los problemas de estructura (notas sueltas de la V1, carpetas sin
  nota hub, plantillas inválidas, entradas de credenciales incompletas).

### Excluye

- **Búsqueda e indexación de proyectos.** Queda en el roadmap; las properties fijas se
  eligen ya pensando en ese índice futuro.
- UI de credenciales y de archivos (las secciones del dashboard siguen placeholder).
- Migración automática o comando de migración de la estructura V1. Ruptura limpia: la
  V2 no entiende la estructura plana y la señala con issues explicativos.
- Borrado de proyectos/tareas/credenciales (sigue siendo placeholder de roadmap).
- Cambios en los modales de creación: siguen pidiendo sólo el título (y el proyecto, en
  el de tareas). Las properties nuevas se editan directamente en la nota.

## Estructura de carpetas

```
Projects/                              <- projectsFolder (configurable)
├── _templates/                        <- templatesFolder (default: Projects/_templates/)
│   ├── proyecto.md
│   ├── tarea.md
│   └── credenciales.md
└── Web Cliente/                       <- una carpeta por proyecto
    ├── Web Cliente.md                 <- nota hub (type: project)
    ├── Credenciales.md                <- nombre fijo (type: credentials)
    ├── Tareas/                        <- nombre fijo
    │   └── Diseñar landing.md         <- type: task
    └── Archivos/                      <- nombre fijo; archivos sueltos del usuario
```

Reglas:

- La **nota hub** (`<Carpeta>/<Carpeta>.md`, con `type: project` y el mismo nombre que
  su carpeta, comparación exacta) es lo que define al proyecto. El título mostrado es
  el basename de la nota hub.
- Los nombres `Tareas/`, `Archivos/` y `Credenciales.md` son fijos y en español,
  coherentes con la regla de que todo el texto del producto está en español.
- La estructura completa se crea al crear el proyecto. El escaneo es **tolerante**: si
  faltan `Tareas/`, `Archivos/` o `Credenciales.md` no se genera ningún issue (el
  proyecto simplemente no tiene tareas o credenciales); sólo la ausencia de la nota hub
  es un problema.
- `templatesFolder` se **excluye** del escaneo: las plantillas llevan `type:` de
  andamiaje y no deben aparecer como proyectos, tareas ni credenciales.
- La sanitización de nombres de la V1 (`\ / : * ? " < > |` y `#` → `-`, colapso de `-`
  repetidos, trim de `.`/espacios, vacío → `"Untitled"`, sufijos ` 2`, ` 3`, … ante
  colisión) se aplica también al nombre de la carpeta del proyecto, que siempre coincide
  con el basename de la nota hub.

## Datos y formato Markdown

### Proyecto (nota hub)

Properties fijas (no eliminables por el usuario):

| Property | Valores admitidos | Validación |
|---|---|---|
| `type` | `project` | obligatoria, valor exacto |
| `status` | `active`, `on-hold`, `done` | obligatoria, uno de esos valores |
| `created` | `YYYY-MM-DD` | obligatoria; la fija el plugin al crear |
| `tags` | lista (puede estar vacía) | sólo presencia |
| `description` | texto | sólo presencia (puede quedar vacía) |
| `client` | texto | sólo presencia (puede quedar vacía) |

### Tarea

Properties fijas:

| Property | Valores admitidos | Validación |
|---|---|---|
| `type` | `task` | obligatoria, valor exacto |
| `project` | wikilink `[[...]]` al proyecto | obligatoria, debe resolverse a una nota hub válida |
| `status` | `open`, `done` | obligatoria, uno de esos valores |
| `created` | `YYYY-MM-DD` | obligatoria; la fija el plugin al crear |
| `due` | `YYYY-MM-DD` o vacío | si tiene valor, debe ser fecha válida |
| `priority` | `low`, `medium`, `high` | obligatoria, uno de esos valores (default `medium`) |

### Credenciales

Una nota `Credenciales.md` por proyecto:

- Properties fijas: `type: credentials` y `credentials` (lista, posiblemente vacía).
- Cada entrada de la lista exige `service`, `user` y `password` (texto plano en el
  vault, decisión consciente del usuario). `url` y `notes` son campos opcionales
  reconocidos; cualquier campo extra se preserva.
- Si `Credenciales.md` no existe, el proyecto no tiene credenciales y no es un error.

Ejemplo:

```yaml
---
type: credentials
credentials:
  - service: Hosting
    user: admin
    password: "s3cret"
    url: https://panel.ejemplo.com
    notes: cuenta principal
---
```

### Relación tarea↔proyecto

La property `project: "[[...]]"` es la **fuente de verdad** de la relación: es lo que
crea el enlace en el grafo de Obsidian. La carpeta `Tareas/` es la ubicación física de
la tarea. Consecuencias:

- Una tarea cuyo wikilink apunta al proyecto A aunque el archivo esté en `Tareas/` de B
  pertenece a A; la ubicación no se valida contra el wikilink.
- `reassignTask` actualiza la property `project` **y mueve el archivo** a la carpeta
  `Tareas/` del nuevo proyecto.
- `renameProject` mantiene los enlaces incluso con el auto-link-update de Obsidian
  desactivado (regla heredada de la V1), actualizando la property `project` de las
  tareas afectadas una a una.

## Plantillas

- Las tres plantillas son archivos Markdown normales en `templatesFolder`
  (por defecto `Projects/_templates/`): `proyecto.md`, `tarea.md`, `credenciales.md`.
- **Semilla:** al cargar, el plugin crea `templatesFolder` y siembra las plantillas que
  falten con el contenido por defecto. Nunca sobrescribe una plantilla existente: las
  ediciones del usuario se conservan.
- **Contenido por defecto sembrado:**

`proyecto.md`:
```yaml
---
type: project
status: active
created: 1970-01-01
tags: []
description:
client:
---
```

`tarea.md`:
```yaml
---
type: task
project: "[[Proyecto]]"
status: open
created: 1970-01-01
due:
priority: medium
---
```

`credenciales.md`:
```yaml
---
type: credentials
credentials: []
---
```

- **Uso al crear:** el plugin lee la plantilla, parsea su frontmatter con `js-yaml`,
  sustituye los valores generados (título → nombre de archivo, `created` → fecha de
  hoy, `project` → wikilink del proyecto destino en las tareas) y escribe la nota con
  el cuerpo de la plantilla tal cual.
- **Validación estricta:** si a una plantilla le falta una property fija de su tipo o
  su frontmatter no parsea, se genera un issue sobre la plantilla y se **bloquea la
  creación** de ese tipo de nota hasta que el usuario la corrija. Las properties
  añadidas por el usuario a la plantilla se copian a las notas nuevas.
- Las notas ya creadas no se modifican cuando la plantilla cambia: las plantillas sólo
  afectan a creaciones futuras.

## Interfaz

- El dashboard lee la nueva estructura: la lista de proyectos proviene de las notas
  hub; las tareas, de la carpeta `Tareas/` del proyecto seleccionado.
- Los chips de proyecto muestran el `status` (indicador visual discreto).
- Las secciones Archivos y Contraseña permanecen como placeholders inertes.
- La pestaña de ajustes muestra dos campos: `projectsFolder` y `templatesFolder`.
- Todos los textos nuevos (issues, mensajes, ajustes) están en español.

## Arquitectura y flujo

Cambios por módulo:

- **`src/settings.ts`** — `PluginSettings` pasa a `{ projectsFolder, templatesFolder }`
  con defaults `"Projects"` y `"Projects/_templates"`. La clave antigua `tasksFolder`
  presente en un `data.json` viejo se ignora al cargar (merge con defaults).
  `normalizeVaultFolderPath` se reutiliza para ambas rutas.
- **`src/domain/types.ts`** — `ProjectRecord` gana `folderPath`. Nuevos tipos
  `CredentialEntry { service, user, password, url?, notes?, [extra: string]: unknown }`
  y `CredentialsRecord { path, projectPath, entries }`. `DashboardData` gana
  `credentials: CredentialsRecord[]`. `ParsedNote` gana `kind: "credentials"`.
- **`src/domain/parseNote.ts`** — valida las properties fijas y los valores de
  `status`/`priority`/`due` en proyectos y tareas, y parsea notas `type: credentials`
  validando cada entrada. Sigue sin lanzar excepciones: todo problema → `kind: "issue"`.
- **`src/domain/templates.ts`** *(nuevo, sin imports de Obsidian)* — contenido por
  defecto de las tres plantillas, lista de properties fijas por tipo,
  `validateTemplate(content, kind)` (detecta frontmatter roto y fijas ausentes) y
  `applyTemplate(content, valores)` (sustituye los valores generados y devuelve la nota
  final). Testeable con Vitest.
- **`src/data/VaultAdapter.ts`** — el interface gana operaciones de carpeta: listar
  subcarpetas directas de una ruta, comprobar si una ruta existe y renombrar una
  carpeta. `ObsidianVaultAdapter` las implementa con
  `vault.getAbstractFileByPath`/`TFolder` y `fileManager.renameFile`.
- **`src/data/ProjectTaskRepository.ts`** —
  - `load()`: siembra las plantillas ausentes; lista las subcarpetas directas de
    `projectsFolder` (excluyendo `templatesFolder`); para cada una busca su nota hub y
    la parsea; parsea las tareas hijas directas de `Tareas/` y `Credenciales.md` si
    existe; las notas `.md` sueltas en la raíz de `projectsFolder` generan el issue de
    estructura V1. El contenido de `Archivos/` y cualquier nota más profunda que
    `Tareas/` se ignora por completo.
  - `createProject(title)`: sanitiza y desambigüa el nombre, crea la carpeta y sus
    subcarpetas, y escribe la nota hub y `Credenciales.md` aplicando las plantillas.
  - `createTask(title, projectPath)`: aplica la plantilla de tarea con el wikilink del
    proyecto y escribe la nota en su `Tareas/`.
  - `renameProject`: renombra primero la nota hub (nuevo basename, misma carpeta),
    después la carpeta (Obsidian mueve todo su contenido) y por último actualiza la
    property `project` de las tareas afectadas.
  - `renameTask`: renombra el archivo dentro de su `Tareas/`.
  - `reassignTask`: actualiza la property `project` y mueve el archivo.
  - `setTaskStatus`: sin cambios.
  - Todas las mutaciones siguen siendo atómicas por property vía `processFrontMatter`;
    nunca se lee y reescribe el archivo completo.
- **`src/main.ts`** — wiring de ajustes nuevos y de la semilla de plantillas al cargar.
- **`src/ui/DashboardView.ts`** — adaptación mínima a la nueva estructura; indicador de
  `status` en los chips; placeholders intactos.
- **`src/ui/SettingsTab.ts`** — campos `projectsFolder` y `templatesFolder`.
- **`styles.css`** — sólo lo necesario para el indicador de `status` en los chips.

## Fallos y validación

Issues nuevos (todos con ruta, motivo en español y acción para abrir la nota cuando
aplique):

1. Nota `.md` suelta directamente en la raíz de `projectsFolder`: *"Pertenece a la
   estructura antigua (V1); muévela a la carpeta de su proyecto."*
2. Subcarpeta de `projectsFolder` sin nota hub (`<Carpeta>/<Carpeta>.md` ausente).
3. Nota con `type: project` que no es la nota hub de su carpeta (proyecto fuera de
   lugar).
4. Nota hub o tarea sin property fija, o con `status`/`priority`/`due` inválidos.
5. Tarea con `project` que no resuelve a una nota hub válida (regla V1).
6. Entrada de `credentials` sin `service`, `user` o `password` (issue sobre
   `Credenciales.md`).
7. Plantilla con frontmatter inválido o sin una property fija de su tipo: issue sobre
   la plantilla y bloqueo de la creación de ese tipo hasta corregirla.

Se ignoran silenciosamente (no son datos administrados): el contenido de `Archivos/`,
las notas en subniveles por debajo de `Tareas/`, y cualquier nota fuera de
`projectsFolder`.

## Criterios de aceptación

1. En un vault nuevo, al activar el plugin se crean `Projects/` y
   `Projects/_templates/` con las tres plantillas sembradas.
2. Crear el proyecto "Web Cliente" genera la carpeta `Projects/Web Cliente/` con su
   nota hub, `Credenciales.md`, `Tareas/` y `Archivos/`, y la nota hub lleva todas las
   properties fijas.
3. Crear una tarea la coloca en `Tareas/` del proyecto con el wikilink `project`
   resoluble en el grafo de Obsidian.
4. Renombrar el proyecto renombra nota hub y carpeta; las tareas conservan el enlace
   (property `project` actualizada) aunque el auto-link-update de Obsidian esté
   desactivado.
5. Reasignar una tarea a otro proyecto actualiza su property `project` y mueve el
   archivo a la `Tareas/` del nuevo proyecto.
6. Añadir una property a una plantilla hace que las notas creadas después la incluyan;
   quitar una property fija genera un issue y bloquea la creación de ese tipo.
7. Una nota suelta de la V1 en la raíz de `Projects/` genera el issue explicativo y no
   impide usar el resto del dashboard.
8. Una entrada de credenciales incompleta genera un issue; las entradas completas se
   parsean y están disponibles en `DashboardData`.
9. Toda edición desde el dashboard preserva el cuerpo Markdown y las properties
   personalizadas (regla V1).
10. `npm run typecheck`, `npm test` y `npm run build` terminan en verde.

## Verificación

- Recrear el vault de prueba `D:\proyects\devhelper-test-vault\` desde cero (ruptura
  limpia) y recorrer: arranque y semilla de plantillas, creación de proyecto y tarea,
  renombrado de proyecto, reasignación de tarea, edición manual de notas y plantillas,
  y cada tipo de issue.
- Suites automatizadas: `templates`, `parseNote`, `presentDashboard`, `settings`,
  `weekStrip` y `ProjectTaskRepository` (con el `VaultAdapter` falso en memoria,
  extendido con el árbol de carpetas).
- `npm run typecheck`, `npm test`, `npm run build` antes de cada commit.

## Roadmap

- Índice de proyectos sobre las properties fijas y búsqueda en el dashboard.
- Sección Contraseña del dashboard alimentada por `Credenciales.md`.
- Sección Archivos del dashboard alimentada por `Archivos/`.
- Comando de migración V1→V2.
- Borrado de proyectos y tareas.
- Skills de IA propias del sistema (según el roadmap de la V1).
