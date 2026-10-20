# Diseño: skills de IA para el modelo de datos de DevHelper Dashboard

## Objetivo

Distribuir, junto con el plugin, una familia de **skills de IA** (frontmatter
YAML + Markdown) que documenten el modelo de datos del plugin para que una IA
— humana o automatizada — pueda **crear, editar, validar y razonar** sobre
las notas Markdown respaldadas por DevHelper Dashboard sin generar notas
inválidas que caigan al panel **Notas con problemas**.

Una IA cualquiera que abra el vault hoy no sabe la estructura de carpetas ni
las propiedades YAML que el plugin espera. El resultado típico es:

- Notas `type: project` con la prop mal escrita (`Type`, `tipo`, `proyecto`).
- Tareas con `project` apuntando a un path inexistente o sin cerrar comillas.
- Credenciales guardadas en claro cuando el plugin esperaba cifradas.
- Archivos copiados a la carpeta raíz en vez de a `<Proyecto>/Archivos/`.
- Eventos de calendario sin `kind` o sin respetar `allDay` ↔ `time`.

Las skills eliminan ese ensayo-y-error recogiendo el contrato del plugin
(ya disperso entre `AGENTS.md`, los specs y el código TS) en documentos
pequeños, semiactivos, en español, que el harness cargue cuando se pida
trabajar con el vault.

**Decisiones acordadas con el usuario antes del diseño**:

- Skills semiactivas: cuando se cargan, dan recetas paso a paso y validan
  antes de escribir.
- Texto en español (consistente con el UI del plugin y `AGENTS.md`).
- Una skill núcleo (`devhelper-dashboard`) y 8 hijas por subsistema.
- **Validan contra el vault real** antes de escribir, usando `obsidian-cli`
  (ya disponible en el harness).
- **Viven junto al plugin en el vault** (`<vault>/.obsidian/plugins/devhelper-dashboard/skills/devhelper-*/SKILL.md`),
  incluidas en el release, sin código TS nuevo en el plugin.

## Alcance

### Incluye

- Una skill núcleo `devhelper-dashboard` con las convenciones comunes.
- Ocho skills hijas, una por subsistema del plugin entregado en V1–V3 + Archivos + General + credenciales + calendario:
  - `devhelper-projects` — proyectos
  - `devhelper-tasks` — tareas
  - `devhelper-notes` — notas simples (`type: note`)
  - `devhelper-credentials` — credenciales cifradas (`type: credentials`)
  - `devhelper-files` — sección Archivos (`FileRecord` + binarios)
  - `devhelper-general` — proyecto sombra `Projects/General/`
  - `devhelper-calendar` — eventos (`type: calendar-event`)
  - `devhelper-templates` — uso de plantillas (`Projects/_templates`,
    `Calendario/_templates`)
- Modificaciones mínimas al release pipeline para empaquetar las skills con
  el plugin:
  - `src/skills/devhelper-*/SKILL.md` como fuente.
  - `esbuild.config.mjs` añade un paso de copia a `skills/devhelper-*/SKILL.md`
    en el root (no bundlea, solo copia).
  - `package.json` lista `skills/**` en `files` junto a `main.js`,
    `manifest.json` y `styles.css`.
  - `scripts/update-test-vault.mjs` (en el script npm `update:test-vault`)
    copia también las skills al vault de pruebas, recargando el plugin.
- Documentación en `AGENTS.md` describiendo la nueva carpeta `skills/` y la
  convención de distribución.
- Verificación manual con el vault de prueba (`obsidian-cli` contra
  `D:\proyects\devhelper-test-vault\`): para cada skill, ejecutar el flujo
  central y comprobar que la nota resultante parsea (aparece en el dashboard)
  sin tocar código TS.

### Excluye

- Comandos del plugin para listar/instalar/cargar skills. Las skills se
  descubren por convención de ruta — los harnesses (OpenCode, Claude Code)
  ya las buscan en esa ubicación.
- Tests unitarios automatizados para el contenido de las skills (es
  documentación). La verificación es manual y se cubre con escenarios
  reproducibles en el plan.
- Publicación como paquete externo (estilo `kepano/obsidian-skills`); las
  skills se distribuyen exclusivamente con el plugin.
- Internacionalización a otros idiomas (sólo español).
- Cambios en el código TS del plugin. El plugin no sabe que existen las
  skills; las transporta.
- Skills para temas visuales (`theme/`) o para el buttonbar — esos no son
  parte del modelo de datos y no entran en este spec.

## Conceptos por skill (modelo de datos que cada una enseña)

Esta sección fija el **contrato** que cada skill debe reflejar, derivado de
`AGENTS.md` y de los specs ya entregados. La redacción final se ajusta en
plan/implementación.

### Núcleo — `devhelper-dashboard`

- **Frontmatter universal**: YAML, `---` en la primera línea, parser
  `js-yaml.load`. Una sola prop `type` por nota. Props desconocidas se
  preservan intactas.
- **Carpetas configurables** (leer siempre con `obsidian-cli eval
  app.plugins.plugins['devhelper-dashboard'].settings` antes de escribir;
  caer a los defaults si la lectura falla): `projectsFolder` (defecto
  `Projects`), `templatesFolder` (defecto `Projects/_templates`),
  `calendarFolder` (defecto `Calendario`), `calendarTemplatesFolder`
  (defecto `Calendario/_templates`).
- **Sanitización de nombres**: `\ / : * ? " < > | #` → `-`; colapsar `-`
  repetidos; trim `.` y espacios en los bordes; vacío → `Untitled`. Si el
  destino existe, sufijo ` 2`, ` 3`, … antes de `.md`.
- **Regla Archivos/General**: el proyecto `Projects/General/` es sombra y se
  siembra al primer uso; nunca aparece como selección, chip de favorito ni
  opción del picker.
- **Borrado**: sólo papelera de Obsidian, con confirmación humana. Una IA
  **no** borra: pide al usuario que confirme o que use el plugin.
- **Plantillas**: la IA usa plantillas cuando existan (`<projectsFolder>/_templates/`).
  Al crear, primero lista las plantillas con `obsidian-cli` y, si hay al
  menos una, pregunta al usuario cuál usar. Si no hay, usa la prop
  mínima y deja el cuerpo vacío salvo `# <Título>`.
- **Cuando invocar una skill hija**: cada hija tiene una sección
  «Cuándo me invocan» explícita (p. ej. *«Créame una tarea»* activa
  `devhelper-tasks`).

### `devhelper-projects`

- Ruta: `<projectsFolder>/<Título-slug>.md`.
- Props mínimas:
  ```yaml
  ---
  type: project
  created: <YYYY-MM-DD>   # opcional pero recomendado
  favorite: false         # opcional; true para subir a chips
  ---
  ```
- `isGeneral: true` lo lleva **sólo** `Projects/General/General.md`; las IAs
  no crean General a mano (lo siembra el plugin al primer uso).
- Recetas: crear, renombrar (cuidado: hay que actualizar `project:` en las
  tareas que apuntaban), marcar favorito, listar. Borrado: no desde IA.

### `devhelper-tasks`

- Ruta: dentro de `projectsFolder/<proyecto>/Tareas/` si la plantilla por
  proyecto lo exige, si no dentro de la carpeta del proyecto. Verificar
  convención leyendo la carpeta del proyecto de destino con `obsidian-cli`.
- Props mínimas:
  ```yaml
  ---
  type: task
  project: "[[Projects/<proyecto>]]"
  status: open
  ---
  ```
- `status` ∈ `{open, done}`. Cambio de estado: nunca leer-y-reescribir la
  nota entera, sólo `property:set name=status value=...`.
- Recetas: crear (con proyecto pre-existente obligatorio), renombrar,
  reasignar proyecto (puede ser `[[Projects/Otro]]`), cambiar estado,
  reabrir, mover a papelera (con confirmación humana).

### `devhelper-notes`

- Notas simples sin estado, sólo `type: note` con `project` y `created`.
- Ruta: dentro de la carpeta del proyecto que las aloja
  (`<projectsFolder>/<proyecto>/Notas/` por convención; verificar primero).
- Props mínimas:
  ```yaml
  ---
  type: note
  project: "[[Projects/<proyecto>]]"
  created: <YYYY-MM-DD>
  ---
  ```
- Recetas: crear, renombrar, reasignar (mover entre proyectos cambiando
  sólo `project:` y borrando el archivo antiguo a la papelera con
  confirmación), listar por proyecto.

### `devhelper-credentials`

- Ruta: `<projectsFolder>/<proyecto>/Credenciales.md`.
- Props mínimas:
  ```yaml
  ---
  type: credentials
  credentials: []
  ---
  ```
- Reglas de campos: `service` siempre en claro; `user`, `password`, `url`,
  `notes` siempre cifrados con prefijo `enc:v1:<iv>:<cipher>` cuando el vault
  tiene maestra fijada. Entradas heredadas en claro (sin `enc:v1:`) sólo
  aparecen como `needsMigration: true` y se migran con un clic desde la UI
  (no desde IA sin confirmación humana).
- **La IA nunca escribe secretos en claro** si existe maestra. Pasos:
  1. Leer `credSaltB64`/`credVerifier` de `data.json` para saber si hay
     maestra. **No** se lee la maestra.
  2. Si existe maestra: la IA **no puede crear credenciales** — el plugin
     exige clave maestra en memoria y la IA no la tiene. Devolver al usuario
     pidiéndole que la desbloquee desde la UI o que use `devhelper-credentials`
     en modo «leer sin secretos» (sólo `service`).
  3. Si no existe maestra y el usuario pide crear la primera credencial,
     instruirle a fijar la maestra desde el dashboard primero.
- Recetas: listar `service` por proyecto, contar entradas en claro, migrar
  plano → cifrado (sólo bajo confirmación humana, delegando a
  `migratePlaintextCredentials`).

### `devhelper-files`

- Sección Archivos del dashboard; binarios en el vault.
- Ruta: `<projectsFolder>/<proyecto>/Archivos/<nombre>` (con desambiguación
  ` 2`, ` 3`, …).
- Convención: en modo «Todos» los archivos que se muestran son los de
  `Projects/General/`; en modo proyecto, los del proyecto seleccionado.
  Una IA que pregunte «dónde está el archivo X» debe buscar primero en
  General y luego en el proyecto preguntado.
- Recetas: añadir archivo (pedir al usuario la ruta origen en el sistema;
  la IA invoca `obsidian-cli` para copiar), listar archivos del proyecto,
  eliminar a la papelera (con confirmación humana).

### `devhelper-general`

- Proyecto sombra `Projects/General/General.md`. La IA **no** lo crea ni lo
  selecciona: explicar cuándo aparece y cómo vive.
- Reglas de uso:
  - Aloja los archivos compartidos (visibles en modo «Todos»).
  - Aloja las credenciales compartidas (mismo `Credenciales.md` que el resto,
    pero dentro de General).
  - La IA escribe archivos/credenciales en General **sólo si el usuario lo
    pide explícitamente** y, aun así, recomienda el proyecto destino.
- Recetas: comprobar si General existe, identificar General en cualquier
  nota de vault (título o carpeta exactamente `general`/`General`),
  sembrar General vacío si el usuario lo pide (delegar al plugin).

### `devhelper-calendar`

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
- `time` (formato `HH:mm` 24h) **sólo si** `allDay: false`. `endDate`
  (inclusivo) y `recurrence: none|daily|weekly|monthly|yearly` son
  opcionales. `project` ausente = evento global; si está presente debe
  apuntar a un proyecto existente.
- `endDate` debe ser ≥ `date`; valores inválidos van al panel
  «Notas con problemas», **no** se «corrigen solos» desde la IA.
- Recetas: crear, listar por mes, expandir ocurrencias para responder
  «¿qué hay el día X?» (regla de los 6 meses sin `recurrenceEnd`), borrar.

### `devhelper-templates`

- Rutas: `<templatesFolder>/` y `<calendarTemplatesFolder>/`.
- Plantillas reconocidas por nombre de archivo (`evento.md`,
  `proyecto.md`, `tarea.md`, `nota.md`, etc.); la IA las lee con
  `obsidian-cli read file=...` y aplica `type`, `kind` y props fijas si
  las tienen.
- Reglas: nunca sobrescribir plantillas existentes; si la carpeta no
  existe, preguntar antes de crearla.
- Recetas: listar plantillas disponibles, sugerir la mejor plantilla
  para una operación (crear evento → `evento.md` si existe), aplicar
  plantilla preservando cuerpo y propiedades del usuario.

## Release pipeline

### Estructura en el repo del plugin

```
src/
  skills/                              # ← nueva carpeta, fuente de skills
    devhelper-dashboard/SKILL.md       # núcleo
    devhelper-projects/SKILL.md
    devhelper-tasks/SKILL.md
    devhelper-notes/SKILL.md
    devhelper-credentials/SKILL.md
    devhelper-files/SKILL.md
    devhelper-general/SKILL.md
    devhelper-calendar/SKILL.md
    devhelper-templates/SKILL.md
```

### Estructura en el release

```
main.js
manifest.json
styles.css
skills/                                # ← nueva carpeta,copiada tal cual
  devhelper-dashboard/SKILL.md
  devhelper-projects/SKILL.md
  ... (las 9)
```

Igual que hoy con `main.js`/`styles.css`, el directorio de release es el
root del repo. `esbuild.config.mjs` añade un paso de copia idempotente
(`fs.cpSync("src/skills", "skills", { recursive: true })`) que se ejecuta
tanto en `npm run dev` como en `npm run build`.

### Cambios en código de release

- `esbuild.config.mjs`:
  - Importar `node:fs`.
  - Tras `esbuild.build` / `esbuild.context(...)`, ejecutar
    `fs.cpSync(srcSkillsDir, outSkillsDir, { recursive: true })`.
  - Definir las dos rutas una sola vez; usar `path.resolve` para que
    funcione desde `cwd` y desde `scripts/`.
- `package.json`:
  - Añadir `"skills/**"` al array `files`.
- `scripts/update-test-vault.mjs`:
  - Añadir la copia de la carpeta `skills/` al vault de prueba (al lado de
    `main.js`/`manifest.json`/`styles.css`). Recargar el plugin después con
    `obsidian plugin:reload id=devhelper-dashboard`.

Estos tres cambios son **únicos** del flujo de release y no afectan al
runtime del plugin.

## Convenciones de redacción

Aplcian a los 9 SKILL.md por igual:

- **Frontmatter**:
  ```yaml
  ---
  name: devhelper-<área>
  description: <una frase, en español, dirigida al harness: «Use when …»>
  ---
  ```
  Sin `description` en español largo — el harness necesita una frase corta en
  inglés/español que active el matching automático. Inspirado en las skills de
  `kepano/obsidian-skills` ya en uso.

- **Estructura interna**:
  1. **Cuándo me invocan** — lista de disparadores explícitos.
  2. **Modelo de datos** — props obligatorias/opcionales, defaults, ruta,
     sanitización.
  3. **Recetas** — pasos numerados, comandos `obsidian-cli` exactos.
  4. **Errores comunes** — 3-4 casos que caen al panel Notas con problemas.
  5. **Lo que NO debe hacer** — atajos prohibidos (modificar `data.json`,
     generar `enc:v1:` a mano, saltarse plantillas, …).
  6. **Ejemplos YAML** — frontmatter válido mínimo y extendido.

- **Tono**: imperativo directo, frases cortas, español de España consistente
  con el UI del plugin. Sin emojis. Sin tablas extensas; preferir listas.

- **Tamaño**: cada SKILL.md entre 80 y 200 líneas. Si una skill crece más,
  pasar contenido a `references/<tema>.md` y enlazarlo.

- **Cero referencias a código TS del plugin**. Las skills describen el
  **contrato de la nota**, no la implementación. Si una referencia es
  inevitable (p. ej. para localizar `data.json`), se usa el nombre del
  producto («DevHelper Dashboard») y el path del vault.

- **No incluir secretos**. Las skills no contienen claves, IVs ni ejemplos
  de blob cifrado real. Si necesitan mostrar el formato, usan
  `enc:v1:<iv-base64>:<cipher-base64>` con placeholders.

## Verificación manual

Se ejecuta contra el vault de prueba
(`D:\proyects\devhelper-test-vault\`). Para cada skill:

1. **Cargar la skill** en el harness (`use_skill`).
2. **Disparador positivo**: ejecutar el escenario central descrito en la
   skill (p. ej. *«Créame un proyecto de prueba llamado `Smoke Test`»*).
3. **Verificar en el dashboard**: abrir la vista, comprobar que la nota
   aparece bajo el chip correcto, que los proyectos inválidos van a issues.
4. **Verificar el archivo en disco**: `obsidian-cli read path=...` o leer
   el archivo con la herramienta de files y comprobar que el YAML es válido
   y las props están bien escritas.
5. **Disparador negativo**: ejecutar una operación prohibida (p. ej. borrar
   un proyecto) y comprobar que la skill rechaza con el mensaje
   «Lo que NO debe hacer» correspondiente.

### Escenarios mínimos por skill

| Skill | Disparador positivo | Disparador negativo |
|-------|---------------------|---------------------|
| Núcleo | «¿Qué tipo de nota es X?» — identificar `type` por YAML. | Intentar listar `data.json`; rechazar. |
| projects | «Créame un proyecto llamado Smoke Test» | Borrar un proyecto; rechazar. |
| tasks | «Créame una tarea 'Prueba' en Smoke Test, abierta» | Crear tarea con `project` apuntando a un proyecto inexistente; comprobar que va a issues. |
| notes | «Añada una nota 'Idea X' a Smoke Test» | Crear nota sin `project`; rechazar. |
| credentials | «¿Cuántas credenciales tiene Smoke Test?» | Crear credencial con maestra activa; rechazar y decir que hay que desbloquear desde la UI. |
| files | «Copie /tmp/diagrama.png a Smoke Test» | Borrar archivo de General; pedir confirmación humana. |
| general | «¿Qué hay en la sección Archivos de Todos?» | Crear General manualmente; rechazar. |
| calendar | «Créeme un evento 'Reunión' el 2026-11-05 a las 10:00, weekly por 4 semanas, en Smoke Test» | Crear evento con `endDate < date`; rechazar. |
| templates | «Liste las plantillas disponibles para proyectos» | Sobrescribir `evento.md`; rechazar. |

La verificación manual queda como gate de aceptación del plan. Si algún
escenario falla, se reabre la skill correspondiente antes de cerrar el plan.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Las IAs no cargan skills desde `.obsidian/plugins/devhelper-dashboard/skills/` (descubrimiento no estándar) | Documentar la convención en `AGENTS.md`; si en pruebas ningún harness las carga, mover a `<vault>/.obsidian/skills/` y ajustar el plan. |
| El release pipeline copia incorrectamente las skills (codificación, permisos) | Tras añadir el paso de copia, ejecutar `npm run build` y `ls skills/devhelper-dashboard/`; verificar que el archivo no está vacío y termina en `\n`. |
| Una skill contiene instrucciones obsoletas después de un cambio del plugin | Recomendar en `AGENTS.md` que cualquier cambio al modelo de datos actualice la skill correspondiente en el mismo commit. Sin gate automático. |
| Las IAs intentan generar `enc:v1:` a mano | Sección «Lo que NO debe hacer» en `devhelper-credentials` + ejemplo de rechazo en verificación manual. |
| Las IAs saltan la validación del vault real y escriben paths absolutos | El frente de validación en cada receta de creación insiste en leer `settings.*Folder` antes de calcular rutas. |

## Decisiones que se cierran aquí

- Skills semiactivas, en español, validando con `obsidian-cli`.
- Núcleo + 8 hijas; ninguna combinación mayor.
- Distribución: copia estática junto al plugin en el vault.
- Sin código TS nuevo en el plugin; sin tests automatizados para el
  contenido de las skills (verificación manual).
- Sin internacionalización a otros idiomas.
- Sin publicación como paquete externo.

## Decisiones pendientes

- (Nada técnica abierta. Cualquier cambio material del usuario reabre el spec
  antes de pasar a plan.)
