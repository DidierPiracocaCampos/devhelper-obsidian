# Skills de IA para DevHelper Dashboard — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empaquetar y entregar con el plugin una familia de 9 skills de IA (1 núcleo + 8 hijas) que documenten el modelo de datos del plugin, instaladas automáticamente en `<vault>/.obsidian/plugins/devhelper-dashboard/skills/` cada vez que el usuario instala el plugin.

**Architecture:** Las skills son archivos Markdown estáticos bajo `src/skills/devhelper-*/SKILL.md`. Un paso de copia en `esbuild.config.mjs` las duplica a la raíz del release como `skills/devhelper-*/SKILL.md`. `package.json` los incluye en `files`. El plugin no las carga en runtime; los harnesses las descubren por convención de ruta. El script `update-test-vault` las copia al vault de prueba junto a `main.js`/`manifest.json`/`styles.css`.

**Tech Stack:** Node ≥ 18, esbuild (existente), `node:fs.cpSync` (nativo), Bash/PowerShell para verificación manual con el CLI de Obsidian.

**Spec:** `docs/superpowers/specs/2026-10-20-devhelper-ai-skills-design.md`

## Global Constraints

- Copia estática de `src/skills/devhelper-*/SKILL.md` al root del release en `skills/devhelper-*/SKILL.md`. Sin código TypeScript nuevo, sin nuevos entrypoints.
- `package.json` `files` debe quedar `["main.js", "manifest.json", "styles.css", "skills/**"]` en este orden.
- Las 9 skills son semiactivas, en español, con frontmatter YAML (`name`, `description` en español dirigidas al harness).
- Sanitización de nombres de archivo (en ejemplos y recetas):
  `\ / : * ? " < > | #` → `-`; colapsar `-` repetidos; trim `.` y espacios en los bordes; vacío → `Untitled`; colisión → ` 2`, ` 3`, … antes de `.md`.
- Sin emojis. Sin referencias al código TS del plugin (sólo al contrato de la nota y a comandos del CLI de Obsidian).
- Una IA **no** escribe secretos en claro cuando hay maestra fijada; nunca genera `enc:v1:` a mano. Una IA **no** borra proyectos, carpetas ni archivos: pide confirmación humana.
- Carpetas configurables (`projectsFolder`, `templatesFolder`, `calendarFolder`, `calendarTemplatesFolder`) se leen siempre con `obsidian-cli eval app.plugins.plugins['devhelper-dashboard'].settings.<clave>` antes de escribir; nunca hard-coded en la skill.
- Verificación manual con `D:\proyects\devhelper-test-vault\` (existente) y Obsidian abierto.

## Review Focus

1. **El harness no descubre las skills en `<vault>/.obsidian/plugins/devhelper-dashboard/skills/`.** Si la verificación manual (cargar la skill con un disparador positivo) falla, mover la fuente a una ruta estándar — p. ej. `<vault>/.obsidian/skills/` — y ajustar `esbuild.config.mjs` y `scripts/update-test-vault.mjs` para publicar allí. Este plan incluye un fallback (último task) por si ocurre.
2. **Una skill contiene instrucciones obsoletas al evolucionar el plugin.** El commit de cualquier cambio de modelo de datos (frontmatter, rutas, props, comportamiento) debe actualizar la skill correspondiente en el mismo commit. Anotado al final del plan; sin gate automático.
3. **Una IA crea secretos en claro aunque exista maestra.** La skill `devhelper-credentials` debe detectar la presencia de `credSaltB64`/`credVerifier` y bloquear. La verificación manual crea una credencial bajo maestra y comprueba que la skill rechaza.
4. **Una IA mete archivos en `Projects/` raíz en vez de en `<proyecto>/Archivos/`.** La skill `devhelper-files` debe exigir leer `settings.projectsFolder` antes de componer la ruta; la verificación manual añade un `.png` a un proyecto y lo lista con `obsidian-cli`.
5. **Una IA mete eventos de calendario con `endDate < date` esperando corrección silenciosa.** La skill `devhelper-calendar` rechaza este caso y la verificación manual confirma que el caso va al panel «Notas con problemas» sin que la IA «arregle» el `endDate`.

---

## Task 1: Estructura fuente y release pipeline

**Files:**
- Create: `src/skills/.gitkeep`
- Modify: `esbuild.config.mjs:1-52` (añadir import `node:fs`, paso de copia tras build)
- Modify: `package.json:25-29` (añadir `"skills/**"` a `files`)
- Create: `docs/superpowers/plans/2026-10-20-devhelper-ai-skills.md` (ya creado)

**Interfaces:**
- Consumes: nada.
- Produces: existe `src/skills/` lista para rellenarse; `npm run build` crea `skills/devhelper-dashboard/SKILL.md` al final del proceso de build.

- [ ] **Step 1: Crear `src/skills/.gitkeep`**

Contenido:

```
# Marcador para que la carpeta exista antes del primer SKILL.md real.
```

- [ ] **Step 2: Modificar `package.json` para incluir `skills/**` en `files`**

Reemplazar el array `files` (líneas 25-29) por:

```json
"files": [
  "main.js",
  "manifest.json",
  "styles.css",
  "skills/**"
]
```

- [ ] **Step 3: Añadir paso de copia de skills a `esbuild.config.mjs`**

Editar `esbuild.config.mjs`:

1. Añadir `import { cpSync, existsSync, mkdirSync } from "node:fs";` (mantener la importación de `process` que ya existe; añadir la importación `import { resolve } from "node:path";`).
2. Definir dos constantes al inicio del archivo tras `externalModules`:

```js
const skillsSource = resolve(__dirname, "src/skills");
const skillsOutput = resolve(__dirname, "skills");
```

Como `esbuild` ejecuta el script desde el root del repo, `__dirname` apunta a esa raíz; si el script se ejecuta con `cwd` distinto, añadir `process.chdir` antes del resolve. La forma robusta es:

```js
const repoRoot = resolve(process.cwd());
const skillsSource = resolve(repoRoot, "src/skills");
const skillsOutput = resolve(repoRoot, "skills");
```

3. Añadir una función `copySkills()` justo antes de la rama `if (prod)`:

```js
function copySkills() {
  if (!existsSync(skillsSource)) return;
  mkdirSync(skillsOutput, { recursive: true });
  cpSync(skillsSource, skillsOutput, { recursive: true });
}
```

4. Llamar `copySkills()` después de `await esbuild.build(buildOptions)` (rama `prod`) y después de `await ctx.watch()` (rama `dev`). En dev, copiar en cada cambio del bundle. Si prefieres evitar tocar el disco en cada watch build, encapsula en una opción `prod ? "always" : "once"` y copia sólo la primera vez en dev; documenta la decisión en el cuerpo de la función con un comentario que diga «en dev copia al inicio para no ralentizar el watch; re-copia manual ejecutando `node esbuild.config.mjs --production`».

- [ ] **Step 4: Verificar que el build sigue emitiendo `main.js` y crea `skills/`**

Run: `npm run build`
Expected: termina sin error; existe `skills/`; `ls skills/` muestra `devhelper-dashboard` u otro directorio creado por una task posterior. Si no existe ningún SKILL.md todavía, esto es esperable: la carpeta puede estar vacía (cpSync con carpeta vacía no crea el directorio en algunos FS; si ocurre, reemplaza `mkdirSync + cpSync` por `cpSync(skillsSource, skillsOutput, { recursive: true, force: true })`).

- [ ] **Step 5: Commit**

```bash
git add src/skills/.gitkeep package.json esbuild.config.mjs
git commit -m "build: introduce src/skills/ source folder and copy step"
```

---

## Task 2: Skill núcleo `devhelper-dashboard`

**Files:**
- Create: `src/skills/devhelper-dashboard/SKILL.md`

**Interfaces:**
- Consumes: nada. Es la primera skill y referencia a las otras 8.
- Produces: frontmatter, tabla de cuándo invocar cada hija, convenciones comunes (frontmatter universal, sanitización, regla Archivos/General, política de borrado, política de credenciales, plantillas).

- [ ] **Step 1: Eliminar `src/skills/.gitkeep`**

Run: `Remove-Item src/skills/.gitkeep -ErrorAction SilentlyContinue`

- [ ] **Step 2: Crear `src/skills/devhelper-dashboard/SKILL.md`**

Estructura exacta (en este orden, sin más secciones):

```markdown
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
```

Adaptar a los defaults y a la longitud objetivo del spec (la skill núcleo completa cabe en 100-140 líneas; recortar tablas si hace falta).

- [ ] **Step 3: Compilar y verificar copia**

Run: `npm run build`
Expected: termina sin error; existe `skills/devhelper-dashboard/SKILL.md`; el archivo empieza por `---` y termina en `\n`.

Run: `Get-Content skills/devhelper-dashboard/SKILL.md | Select-Object -First 5`
Expected: las 5 primeras líneas son el frontmatter, la quinta es `---` (cierre) y la sexta empieza por `# devhelper-dashboard`.

- [ ] **Step 4: Commit**

```bash
git add src/skills/devhelper-dashboard/SKILL.md skills/devhelper-dashboard/SKILL.md
git commit -m "docs(skills): add devhelper-dashboard core skill"
```

---

## Task 3: Skill `devhelper-projects`

**Files:**
- Create: `src/skills/devhelper-projects/SKILL.md`

**Interfaces:**
- Consumes: convenciones de `devhelper-dashboard` (Task 2).
- Produces: recetas para crear/renombrar/marcar favorito/listar proyectos sin generar notas inválidas.

- [ ] **Step 1: Crear `src/skills/devhelper-projects/SKILL.md`**

Estructura:

```markdown
---
name: devhelper-projects
description: Crear, renombrar y listar proyectos (`type: project`) en este vault, respetando las carpetas configuradas de DevHelper Dashboard. Usa cuando el usuario pida crear un proyecto, renombrarlo, marcarlo como favorito o listar los existentes.
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
```

- [ ] **Step 2: Verificar copia en el root del repo**

Run: `npm run build`
Expected: `skills/devhelper-projects/SKILL.md` existe y empieza por `---`.

- [ ] **Step 3: Commit**

```bash
git add src/skills/devhelper-projects/SKILL.md skills/devhelper-projects/SKILL.md
git commit -m "docs(skills): add devhelper-projects skill"
```

---

## Task 4: Skill `devhelper-tasks`

**Files:**
- Create: `src/skills/devhelper-tasks/SKILL.md`

**Interfaces:**
- Consumes: `devhelper-dashboard` (Task 2).

- [ ] **Step 1: Crear `src/skills/devhelper-tasks/SKILL.md`**

Estructura:

```markdown
---
name: devhelper-tasks
description: Crear, reabrir, renombrar, reasignar y cambiar de estado tareas (`type: task`) en este vault, respetando las carpetas configuradas y el wikilink `project` de DevHelper Dashboard. Usa cuando el usuario pida trabajar con tareas.
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
```

- [ ] **Step 2: Verificar copia**

Run: `npm run build`
Expected: `skills/devhelper-tasks/SKILL.md` existe.

- [ ] **Step 3: Commit**

```bash
git add src/skills/devhelper-tasks/SKILL.md skills/devhelper-tasks/SKILL.md
git commit -m "docs(skills): add devhelper-tasks skill"
```

---

## Task 5: Skill `devhelper-notes`

**Files:**
- Create: `src/skills/devhelper-notes/SKILL.md`

**Interfaces:**
- Consumes: `devhelper-dashboard` (Task 2).

- [ ] **Step 1: Crear `src/skills/devhelper-notes/SKILL.md`**

Estructura:

```markdown
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
```

- [ ] **Step 2: Verificar copia**

Run: `npm run build`
Expected: `skills/devhelper-notes/SKILL.md` existe.

- [ ] **Step 3: Commit**

```bash
git add src/skills/devhelper-notes/SKILL.md skills/devhelper-notes/SKILL.md
git commit -m "docs(skills): add devhelper-notes skill"
```

---

## Task 6: Skill `devhelper-credentials`

**Files:**
- Create: `src/skills/devhelper-credentials/SKILL.md`

**Interfaces:**
- Consumes: `devhelper-dashboard` (Task 2).

- [ ] **Step 1: Crear `src/skills/devhelper-credentials/SKILL.md`**

Estructura:

```markdown
---
name: devhelper-credentials
description: Listar, contar y razonar sobre credenciales cifradas (`type: credentials`) en este vault. La IA nunca escribe secretos en claro cuando hay maestra fijada: delega al plugin. Usa cuando el usuario pida consultar o crear credenciales.
---

# devhelper-credentials

## Cuándo me invocan

- «Lista las credenciales del proyecto X» (sólo `service`).
- «¿Hay credenciales en claro?» (comprobar `needsMigration`).
- «Migra las credenciales del proyecto X» (delegar al plugin).

## Modelo de datos

- Ruta: `<projectsFolder>/<proyecto>/Credenciales.md`.
- Props mínimas:

  ```yaml
  ---
  type: credentials
  credentials: []
  ---
  ```

- `service` siempre en claro (clave de búsqueda).
- `user`, `password`, `url`, `notes` siempre cifrados con prefijo `enc:v1:<iv-b64>:<cipher-b64>` cuando hay maestra.
- Entradas heredadas en claro se marcan con `needsMigration: true` a nivel de nota.

## Detección de maestra

Antes de **cualquier** operación de escritura:

```bash
obsidian eval 'JSON.stringify({
  salt: !!app.plugins.plugins["devhelper-dashboard"].settings.credSaltB64,
  verifier: !!app.plugins.plugins["devhelper-dashboard"].settings.credVerifier
})'
```

- `salt && verifier === true` → **maestra activa**. La IA **NO** puede crear/editar credenciales. Devolver:

  > El vault tiene maestra fijada. Para crear o editar credenciales, desbloquéala desde el dashboard y usa el modal del plugin. Yo puedo seguir listando `service`.

- `salt && verifier === false` → **sin maestra**. Si el usuario pide crear la primera credencial, instruirle a fijar la maestra desde el dashboard primero. La IA sólo asiste con la lista `service` hasta entonces.

## Receta: listar `service` por proyecto

```bash
obsidian read path="<projectsFolder>/<proyecto>/Credenciales.md"
```

Devolver sólo los valores `service:` (líneas que estén dentro de `credentials:`).
No devolver valores `user`, `password`, `url` ni `notes`, estén en claro o cifrados.

## Receta: contar entradas en claro

```bash
obsidian read path="<projectsFolder>/<proyecto>/Credenciales.md" | Select-String "service:|user:|password:"
```

Contar entradas cuya `user:` o `password:` **no** empiece por `enc:v1:`. Si el contador > 0, hay migración pendiente.

## Receta: migración a cifrado

**Delegar al plugin.** Indicar al usuario:

> Hay N credenciales en claro. Púlsa el botón «Migrar al cifrado» del dashboard para que el plugin las cifre en un solo paso.

Si la IA intenta generar `enc:v1:` a mano, **fallará el descifrado**.

## Lo que NO debe hacer

- **Nunca** escribir `user:`, `password:`, `url:` o `notes:` en claro si hay maestra.
- **Nunca** generar `enc:v1:` a mano: el plugin cifra con su clave maestra en memoria y la IA no la tiene.
- **Nunca** borrar una credencial desde la IA: pedir al usuario que la elimine desde el dashboard.
- **Nunca** devolver valores de `user` o `password`, estén cifrados o no.

## Errores comunes

- Crear credencial en claro bajo maestra → la nota parsea pero queda marcada como `needsMigration` y los secretos quedan expuestos.
- Confundir `[[Projects/General/Credenciales]]` con la credencial del usuario normal: `devhelper-general` describe cuándo General aloja credenciales compartidas.

## Ejemplos YAML

Válido:

```yaml
---
type: credentials
credentials:
  - service: Hosting
    user: "enc:v1:<iv>:<cipher>"
    password: "enc:v1:<iv>:<cipher>"
    url: "enc:v1:<iv>:<cipher>"
---
```

Válido con migración pendiente (`needsMigration` la marca el plugin al parsear
entradas en claro; la IA no la escribe):

```yaml
---
type: credentials
needsMigration: true
credentials:
  - service: Hosting
    user: admin
    password: "enc:v1:<iv>:<cipher>"
---
```
```

- [ ] **Step 2: Verificar copia**

Run: `npm run build`
Expected: `skills/devhelper-credentials/SKILL.md` existe.

- [ ] **Step 3: Commit**

```bash
git add src/skills/devhelper-credentials/SKILL.md skills/devhelper-credentials/SKILL.md
git commit -m "docs(skills): add devhelper-credentials skill"
```

---

## Task 7: Skill `devhelper-files`

**Files:**
- Create: `src/skills/devhelper-files/SKILL.md`

**Interfaces:**
- Consumes: `devhelper-dashboard` (Task 2), `devhelper-general` (Task 8).

- [ ] **Step 1: Crear `src/skills/devhelper-files/SKILL.md`**

Estructura:

```markdown
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
```

- [ ] **Step 2: Verificar copia**

Run: `npm run build`
Expected: `skills/devhelper-files/SKILL.md` existe.

- [ ] **Step 3: Commit**

```bash
git add src/skills/devhelper-files/SKILL.md skills/devhelper-files/SKILL.md
git commit -m "docs(skills): add devhelper-files skill"
```

---

## Task 8: Skill `devhelper-general`

**Files:**
- Create: `src/skills/devhelper-general/SKILL.md`

**Interfaces:**
- Consumes: `devhelper-dashboard` (Task 2).

- [ ] **Step 1: Crear `src/skills/devhelper-general/SKILL.md`**

Estructura:

```markdown
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
```

- [ ] **Step 2: Verificar copia**

Run: `npm run build`
Expected: `skills/devhelper-general/SKILL.md` existe.

- [ ] **Step 3: Commit**

```bash
git add src/skills/devhelper-general/SKILL.md skills/devhelper-general/SKILL.md
git commit -m "docs(skills): add devhelper-general skill"
```

---

## Task 9: Skill `devhelper-calendar`

**Files:**
- Create: `src/skills/devhelper-calendar/SKILL.md`

**Interfaces:**
- Consumes: `devhelper-dashboard` (Task 2), `devhelper-templates` (Task 10).

- [ ] **Step 1: Crear `src/skills/devhelper-calendar/SKILL.md`**

Estructura:

```markdown
---
name: devhelper-calendar
description: Crear, listar y razonar sobre eventos del calendario mensual de DevHelper Dashboard (`type: calendar-event`). Respetar `allDay` ↔ `time`, validar `endDate >= date`, y `kind` ∈ {evento, reunion, fecha_limite, aviso}. Usa cuando el usuario pida trabajar con eventos.
---

# devhelper-calendar

## Cuándo me invocan

- «Créame un evento 'X' el 2026-11-05»
- «¿Qué hay el día Y?»
- «Lista los eventos de este mes» / «marzo de 2026»
- «Repite el evento 'X' cada lunes hasta junio»

## Modelo de datos

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

- `time` (formato `HH:mm` 24h) **sólo** si `allDay: false`. Si el usuario
  da hora y `allDay: true`, se ignora `time` en favor de todo el día.
- `endDate` (inclusivo) y `recurrence: none|daily|weekly|monthly|yearly`
  opcionales.
- `project` ausente = evento global. Si está presente, **debe** apuntar a un
  proyecto existente:

  ```yaml
  project: "[[<projectsFolder>/<título>]]"
  ```

- `status` ∈ `{open, done}`; mismo uso que en tareas.

## Validaciones (siempre antes de `create`)

```powershell
# ¿endDate >= date?
if ($endDate -lt $date) { Write-Error "endDate debe ser >= date"; exit 1 }

# ¿kind válido?
$valid = @("evento","reunion","fecha_limite","aviso")
if ($valid -notcontains $kind) { Write-Error "kind no válido"; exit 1 }

# ¿time y allDay compatibles?
if (-not $allDay -and -not $time) { Write-Error "allDay=false requiere time"; exit 1 }
if ($allDay -and $time) { Write-Warning "Se ignorará time porque allDay=true" }
```

## Receta: crear un evento

1. Leer `calendarFolder`:

   ```bash
   obsidian eval 'app.plugins.plugins["devhelper-dashboard"].settings.calendarFolder'
   ```

   Caer a `Calendario`.
2. Si hay plantilla disponible (ver `devhelper-templates`), leerla y
   aplicar sus props fijas. Si no, partir de las props mínimas del modelo.
3. Sanitizar el título (regla del núcleo).
4. Componer el archivo y crearlo:

   ```bash
   obsidian create path="<calendarFolder>/<YYYY-MM-DD>_<título-slug>.md" \
     content="---\ntype: calendar-event\ntitle: <título>\ndate: <YYYY-MM-DD>\nkind: <kind>\nallDay: <true|false>\ntime: <HH:mm>\nstatus: open\n---\n\n" \
     silent
   ```

5. Validar inmediatamente con `obsidian read` y comprobar que el YAML es
   válido (frontmatter limpio, `kind` correcto, etc.).

## Receta: responder «¿qué hay el día X?»

1. El plugin **expande virtualmente** los rangos y recurrencias (sin
   materializar notas). El límite por defecto sin `recurrenceEnd` es **6
   meses** desde `date`.
2. La IA NO itera notas — pregunta al plugin vía:

   ```bash
   obsidian eval 'app.plugins.plugins["devhelper-dashboard"] && "ok"'
   # y luego abrir el calendario en el día pedido con:
   obsidian eval 'const w=app.workspace; const leaf=w.getLeavesOfType("devhelper-calendar")[0]; if(leaf){const v=leaf.view; v.setSelectedIsoDate("<YYYY-MM-DD>"); v.refresh();} else {w.openLinkText("DevHelper Calendar","",true);} '
   ```

   Si abrir el calendario en línea de comandos es complejo, la IA puede
   enumerar candidatos leyendo `<calendarFolder>/` y filtrando por fecha
   con `Select-String`.

## Receta: borrar

Pedir al usuario confirmación y proponer:

```bash
obsidian file:trash path="<calendarFolder>/<YYYY-MM-DD>_<título-slug>.md"
```

(o `obsidian eval` invocando `deleteCalendarEvent(path)` si el vault lo
expone). Nunca borrar sin confirmación.

## Lo que NO debe hacer

- No aceptar `endDate < date`: rechazarlo antes de crear.
- No usar `kind` fuera de los cuatro fijos.
- No generar fechas inválidas: `YYYY-MM-DD` siempre.
- No materializar ocurrencias como notas separadas (el plugin las expande virtualmente).
- No borrar sin confirmación humana.

## Errores comunes

- `endDate < date` → rechazo explícito, NO «corregir» silenciosamente.
- `time` HH:mm con segundos o AM/PM → normalizar a `HH:mm` 24h o rechazar.
- Mes con día 31 → `recurrence: monthly` omite febrero sin desplazar (lo decide el plugin; la IA sólo respeta la regla, no la corrige).

## Ejemplos YAML

Todo el día:

```yaml
---
type: calendar-event
title: Entrega del informe
date: 2026-11-05
kind: fecha_limite
allDay: true
status: open
---
```

Con hora:

```yaml
---
type: calendar-event
title: Reunión con el equipo
date: 2026-11-05
kind: reunion
allDay: false
time: 10:00
status: open
---
```

Rango + recurrencia:

```yaml
---
type: calendar-event
title: Sprint semanal
date: 2026-11-05
endDate: 2026-11-12
kind: reunion
allDay: false
time: 09:00
recurrence: weekly
recurrenceEnd: 2027-02-28
project: "[[Projects/Mi Proyecto]]"
status: open
---
```

Global (sin proyecto):

```yaml
---
type: calendar-event
title: Aviso general
date: 2026-11-05
kind: aviso
allDay: true
status: open
---
```
```

- [ ] **Step 2: Verificar copia**

Run: `npm run build`
Expected: `skills/devhelper-calendar/SKILL.md` existe.

- [ ] **Step 3: Commit**

```bash
git add src/skills/devhelper-calendar/SKILL.md skills/devhelper-calendar/SKILL.md
git commit -m "docs(skills): add devhelper-calendar skill"
```

---

## Task 10: Skill `devhelper-templates`

**Files:**
- Create: `src/skills/devhelper-templates/SKILL.md`

**Interfaces:**
- Consumes: `devhelper-dashboard` (Task 2).

- [ ] **Step 1: Crear `src/skills/devhelper-templates/SKILL.md`**

Estructura:

```markdown
---
name: devhelper-templates
description: Usar y sugerir las plantillas configuradas (`Projects/_templates/`, `Calendario/_templates/`) del dashboard de DevHelper Dashboard. La IA las lee con `obsidian-cli` y aplica props fijas preservando cuerpo y props del usuario. Usa cuando el usuario pida crear una nota de cualquier tipo y pueda existir plantilla.
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
  - `<projectsFolder>/_templates/` — plantillas de proyecto/tarea/nota
    (reconocidas por nombre: `proyecto.md`, `tarea.md`, `nota.md`, etc.).
  - `<calendarFolder>/_templates/` — plantillas de evento de calendario
    (reconocidas: `evento.md`, `reunion.md`, `fecha_limite.md`, `aviso.md`).
- Las plantillas **nunca** se sobrescriben.

## Receta: listar plantillas

```bash
obsidian ls path="<projectsFolder>/_templates"
obsidian ls path="<calendarFolder>/_templates"
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
`<calendarFolder>/_templates/reunion.md` si existe. Si no,
preferir `evento.md` y sobrescribir `kind: reunion`. Para tareas,
preferir `<projectsFolder>/_templates/tarea.md`. Si no hay ninguna,
ir al mínimo del modelo de datos de la skill correspondiente.

## Lo que NO debe hacer

- No sobrescribir plantillas existentes (`obsidian create ... silent overwrite` está prohibido).
- No crear la carpeta `_templates/` si no existe: preguntar primero.
- No alterar el cuerpo de la plantilla: sólo se aplica al crear notas nuevas.

## Errores comunes

- Carpeta `_templates/` ausente → preguntar al usuario si la crea, no asumir.
- Prop `type:` ausente en la plantilla → completarla con el tipo conocido del nombre del archivo (no inventar).
- Conflicto entre el `kind:` de la plantilla y el pedido del usuario → gana el usuario.

## Ejemplos YAML

Plantilla mínima de proyecto (`Projects/_templates/proyecto.md`):

```yaml
---
type: project
created: <YYYY-MM-DD>
---

# <Título del proyecto>

<Descripción inicial>
```

Plantilla mínima de tarea (`Projects/_templates/tarea.md`):

```yaml
---
type: task
project: "<[[<projectsFolder>/<proyecto>]]>"
status: open
created: <YYYY-MM-DD>
---

# <Título de la tarea>

<Detalles>
```

Plantilla mínima de evento (`Calendario/_templates/evento.md`):

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
```

- [ ] **Step 2: Verificar copia**

Run: `npm run build`
Expected: `skills/devhelper-templates/SKILL.md` existe.

- [ ] **Step 3: Commit**

```bash
git add src/skills/devhelper-templates/SKILL.md skills/devhelper-templates/SKILL.md
git commit -m "docs(skills): add devhelper-templates skill"
```

---

## Task 11: Sincronizar el vault de prueba y ampliar `update-test-vault.mjs`

**Files:**
- Modify: `scripts/update-test-vault.mjs:1-59` (copia también `skills/` con recursión)

**Interfaces:**
- Consumes: estructura del root del release (Task 1, Task 2-10).
- Produces: tras `npm run update:test-vault`, el vault de prueba contiene
  `<pluginDir>/skills/devhelper-*/SKILL.md` además del resto.

- [ ] **Step 1: Modificar `scripts/update-test-vault.mjs`**

1. Cambiar la importación de `node:fs` para incluir `cpSync`:

   ```js
   import { copyFileSync, cpSync, mkdirSync, statSync, existsSync } from "node:fs";
   ```

2. Tras el bucle `for (const file of FILES)`, añadir la copia recursiva:

   ```js
   const skillsRepo = resolve(repoRoot, "skills");
   const skillsTest = resolve(pluginDir, "skills");
   if (existsSync(skillsRepo) && statSync(skillsRepo).isDirectory()) {
     mkdirSync(skillsTest, { recursive: true });
     cpSync(skillsRepo, skillsTest, { recursive: true });
     console.log("[update-test-vault]   skills/ OK");
   }
   ```

3. Conservar el bloque `try { obsidian plugin:reload } catch { ... }` sin cambios.

- [ ] **Step 2: Verificar manualmente con el vault de prueba**

Run: `npm run build`
Expected: sin error; existe `skills/devhelper-dashboard/SKILL.md` (validado en tasks anteriores).

Run: `node scripts/update-test-vault.mjs`
Expected: imprime `skills/ OK` antes del `obsidian plugin:reload`. Si Obsidian está abierto, las skills aparecen en el vault y el plugin se recarga.

Run: `Get-ChildItem 'D:\proyects\devhelper-test-vault\.obsidian\plugins\devhelper-dashboard\skills'`
Expected: lista los nueve directorios `devhelper-{dashboard,projects,tasks,notes,credentials,files,general,calendar,templates}`.

- [ ] **Step 3: Commit**

```bash
git add scripts/update-test-vault.mjs
git commit -m "build: copy skills/ into the test vault"
```

---

## Task 12: Verificación manual de las 9 skills (gate de aceptación)

**Files:** ningún cambio de código; sólo verificación contra el vault de prueba.

**Interfaces:**
- Consumes: vault de prueba con plugin recargado y skills presentes.

- [ ] **Step 1: Preparar el vault**

1. Confirmar que Obsidian está abierto apuntando a `D:\proyects\devhelper-test-vault\` (ver `AGENTS.md` → «Vault de prueba»).
2. Confirmar plugin activo y dashboard sembrado (`Projects/General/General.md` creado).

- [ ] **Step 2: Cargar la skill núcleo y disparar el caso positivo**

Desde la sesión del harness:

1. Cargar `devhelper-dashboard` (`use_skill`).
2. Preguntar: «¿Qué tipo de nota es `Projects/General/General.md`?».
3. Esperado: la IA identifica `type: project` (con `isGeneral: true`) sin necesidad de recargar el plugin.

- [ ] **Step 3: Ejecutar el escenario positivo de cada hija**

| Skill | Disparador | Resultado esperado |
|-------|------------|--------------------|
| `devhelper-projects` | «Créeme un proyecto llamado `Smoke Test Projects`» | Existe `Projects/Smoke Test Projects.md` con YAML `type: project`; aparece como chip en el dashboard. |
| `devhelper-tasks` | «Créame una tarea `Smoke Task` en `Smoke Test Projects`, abierta» | Existe la tarea, `project: "[[Projects/Smoke Test Projects]]"`, `status: open`; aparece en el dashboard bajo el chip. |
| `devhelper-notes` | «Añada una nota `Smoke Note` a `Smoke Test Projects`» | Existe la nota con `type: note`, `project:` correcto; aparece en el panel Notas del proyecto. |
| `devhelper-credentials` | «¿Cuántas credenciales tiene `Smoke Test Projects`?» (sin maestra) | Devuelve `0` y, si se le pide crear, devuelve «fije la maestra primero». |
| `devhelper-files` | «Copie `<ruta-origen>` a `Smoke Test Projects`» | Existe en `Projects/Smoke Test Projects/Archivos/<archivo>` (crear `Archivos/` si no existía). |
| `devhelper-general` | «¿Existe `Projects/General/General.md`?» | `true`. No se ofrece crear General. |
| `devhelper-calendar` | «Créeme un evento `Smoke Event` el 2026-11-05 a las 10:00, weekly por 4 semanas, en `Smoke Test Projects`» | Existe en `Calendario/2026-11-05_Smoke Event.md` con `kind: evento` (o el kind que el plugin asuma al no haber `kind`), YAML correcto, `recurrence: weekly`, `recurrenceEnd: 2026-12-03`. Aparece en el calendario del día 5 y expandido virtualmente hasta el 3 de diciembre. |
| `devhelper-templates` | «Liste las plantillas de proyecto» | Devuelve `Projects/_templates/proyecto.md` si existe (sembrada por el plugin), vacío si no. |

- [ ] **Step 4: Ejecutar el escenario negativo de cada hija**

| Skill | Disparador | Resultado esperado |
|-------|------------|--------------------|
| `devhelper-projects` | «Borre el proyecto Smoke Test Projects» | La IA rechaza con la regla de no borrar y devuelve instrucciones para el plugin. |
| `devhelper-tasks` | «Créeme una tarea en proyecto `Inexistente`» | La IA detecta `obsidian exists === false` y devuelve «proyecto no existe», sin crear la tarea. |
| `devhelper-notes` | «Créame una nota sin proyecto» | La IA rechaza (faltaría `project:`). |
| `devhelper-credentials` | «Crear la primera credencial con maestra activa» | La IA detecta `salt && verifier` y pide al usuario que la desbloquee desde el dashboard. No crea la entrada. |
| `devhelper-files` | «Borre el archivo de General» | La IA propone la papelera y pide confirmación humana; NO ejecuta el trash automáticamente. |
| `devhelper-general` | «Créeme el proyecto General a mano» | La IA rechaza y deriva al plugin. |
| `devhelper-calendar` | «Créeme un evento el 2026-11-12 con `endDate: 2026-11-05`» | La IA rechaza por `endDate < date`. |
| `devhelper-templates` | «Sobrescribe `Projects/_templates/proyecto.md`» | La IA rechaza y propone `folder:create` para una variante con sufijo. |

- [ ] **Step 5: Escenarios transversales**

1. **Harness discovery**: abrir la skill con `use_skill devhelper-dashboard` desde la sesión. Si el harness no la encuentra, **abrir issue** y mover al fallback (Task 13).
2. **Concurrencia simple**: crear 5 proyectos en 5 turnos consecutivos. El dashboard los lista ordenados por título en modo «Todos».
3. **Refresco en vivo**: con el dashboard abierto, crear un proyecto desde una segunda sesión. El dashboard refresca por los listeners `vault.on('create')` con debounce de 250 ms.

- [ ] **Step 6: Capturar resultados**

Para cada escenario, anotar PASS/FAIL en una nota interna (no en repo) y seguir a Task 13 si todo pasa o reabrir la skill correspondiente si algo falla.

- [ ] **Step 7: Commit del progreso de verificación (sin cambios de código)**

Si todo ha pasado, no hay commit. Si se ha retocado algo, commitear con alcance limitado.

---

## Task 13: Documentar la carpeta `skills/` en `AGENTS.md` y añadir entrada en `skills-lock.json` local

**Files:**
- Modify: `AGENTS.md` (añadir sección «Skills de IA distribuidas»)

- [ ] **Step 1: Añadir entrada en `AGENTS.md`**

Pegar tras la sección «Tests (224 en total…)» y antes de «Convenciones y reglas duras»:

```
## Skills de IA distribuidas (9)

El plugin transporta una familia de skills de IA a la carpeta del plugin en el
vault (`<vault>/.obsidian/plugins/devhelper-dashboard/skills/`). Las skills son
semiactivas, en español, y enseñan el modelo de datos del plugin a IAs
externas (no se cargan en el runtime del plugin).

Fuente: `src/skills/devhelper-*/SKILL.md`. El paso de copia está en
`esbuild.config.mjs`. El comando `npm run update:test-vault` también las
publica en el vault de prueba.

- `devhelper-dashboard` — núcleo: frontmatter universal, carpetas
  configurables, sanitización, regla Archivos/General, política de borrado,
  política de credenciales, plantillas.
- `devhelper-projects` — crear/renombrar/listar proyectos.
- `devhelper-tasks` — crear/cerrar/reabrir/reasignar tareas.
- `devhelper-notes` — crear/renombrar/reasignar notas simples.
- `devhelper-credentials` — listar `service`, contar entradas en claro,
  detectar maestra y delegar.
- `devhelper-files` — copiar/listar/borrar archivos del dashboard.
- `devhelper-general` — identificar el proyecto sombra `Projects/General/`.
- `devhelper-calendar` — crear/expandir eventos (rangos, recurrencias,
  reglas `allDay`/`time`).
- `devhelper-templates` — usar y sugerir plantillas configuradas.

**Reglas para los mantenedores**: cualquier cambio al modelo de datos
(frontmatter, props, carpetas, reglas de validación) debe actualizar la
skill correspondiente en el mismo commit. Si añades un nuevo subsistema,
crea `src/skills/devhelper-<área>/SKILL.md` y enlázalo desde
`devhelper-dashboard`.
```

- [ ] **Step 2: Verificar que `package.json` lista `skills/**` y `npm run build` lo respeta**

Run: `npm run build`
Run: `Get-ChildItem skills`
Expected: enumera los nueve directorios `devhelper-*`.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: document skills/ convention in AGENTS.md"
```

---

## Task 14 (fallback): si el harness no descubre las skills junto al plugin

**Files:**
- Modify: `esbuild.config.mjs:skillsOutput` (cambiar a
  `<vault>/.obsidian/skills/` no aplica desde el repositorio — la fuente es el
  bundle, no el vault).
- Modify: `scripts/update-test-vault.mjs` (cambiar `skillsTest` a
  `<vault>/.obsidian/skills/`).
- Modify: `package.json` (`files` no cambia — se sigue distribuyendo desde el
  root).

Esta task sólo se ejecuta si en la Task 12, Step 5.1 ningún harness encuentra
las skills desde `<vault>/.obsidian/plugins/devhelper-dashboard/skills/`.

- [ ] **Step 1: Confirmar el fallo**

Antes de tocar nada, confirmar que el harness no carga las skills desde la
ruta actual. Probar `use_skill devhelper-dashboard`; si no resuelve,
continuar.

- [ ] **Step 2: Cambiar destino de la copia**

Modificar `scripts/update-test-vault.mjs`:

- Sustituir `resolve(pluginDir, "skills")` por `resolve(testVault, ".obsidian", "skills", "devhelper-dashboard")`.

- [ ] **Step 3: Publicar la primera vez**

Run: `node scripts/update-test-vault.mjs`
Expected: ahora existe `D:\proyects\devhelper-test-vault\.obsidian\skills\devhelper-dashboard\SKILL.md` además del resto.

- [ ] **Step 4: Probar la skill**

Cargar `devhelper-dashboard` desde el harness. Si resuelve, repetir Task 12
sobre la nueva ruta.

- [ ] **Step 5: Documentar el cambio en `AGENTS.md`**

En el bloque añadido en Task 13, sustituir la línea sobre la ubicación:

> Las skills se publican en `<vault>/.obsidian/skills/devhelper-*/` (la carpeta
> compartida que cargan OpenCode y Claude Code por convención). El destino
> viene dado por `scripts/update-test-vault.mjs`; `package.json` `files`
> sigue listando `skills/**` para que el plugin entregue una copia junto a
> `main.js` por si el usuario la prefiere.

- [ ] **Step 6: Commit**

```bash
git add scripts/update-test-vault.mjs AGENTS.md
git commit -m "build: publish skills to <vault>/.obsidian/skills/ (fallback)"
```

---

## Self-Review (plan vs spec)

1. **Spec coverage** —
   - Skill núcleo + 8 hijas → Tasks 2-10 (cubierto).
   - Modificaciones a `esbuild.config.mjs` y `package.json` → Task 1 (cubierto).
   - Copia al vault de prueba → Task 11 (cubierto).
   - Verificación manual con escenarios positivos y negativos → Task 12 (cubierto).
   - Documentación en `AGENTS.md` → Task 13 (cubierto).
   - Fallback de descubrimiento del harness → Task 14 (cubierto, opcional).
   - Sin código TS nuevo → confirmado: ninguna task toca `src/main.ts`,
     `src/data/`, `src/domain/` ni `src/ui/`.
   - Sin tests automatizados → confirmado.
2. **Step scan** — los pasos codifican nombres exactos de archivo, comandos
   literales de `obsidian-cli`, props fijas del núcleo (`type`, `project`,
   `status`, `favorite`, `kind`, `allDay`, `time`, `endDate`, `recurrence`)
   y rutas parametrizadas por `settings.<clave>`. Ningún paso deja elección
   abierta más allá de la implementación interna de la prosa.
3. **Type/signature consistency** — las 9 skills referencian el mismo
   conjunto de props (`type`, `project`, `status`, `favorite`,
   `created`, `credentials`, `kind`, `date`, `endDate`, `recurrence`,
   `time`, `allDay`); ninguna inventa una prop nueva. Las rutas son
   siempre `<projectsFolder>/...`, `<calendarFolder>/...` o
   `<templatesFolder>/...`. Los comandos `obsidian-cli` repetidos
   (`eval`, `create`, `property:set`, `exists`, `ls`, `read`,
   `file:rename`, `file:trash`) aparecen en las mismas formas en todas
   las skills. Ningún nombre propio se contradice entre tasks.
4. **Review Focus** —
   - **Harness discovery** cubierto por la Task 12, Step 5.1 + Task 14
     (fallback) + entrada en la sección Review Focus del plan.
   - **Skills obsoletas** cubierto por la regla fija en `AGENTS.md` (Task 13)
     + entrada en la sección Review Focus.
   - **Secretos en claro bajo maestra** cubierto por receta de detección
     (`devhelper-credentials`) + escenario negativo en Task 12 + entrada en
     Review Focus.
   - **Archivos fuera de `<proyecto>/Archivos/`** cubierto por la receta de
     `devhelper-files` + escenario negativo implícito (Task 12 Step 3 fila
     `devhelper-files`) + entrada en Review Focus.
   - **`endDate < date` «arreglado» en silencio** cubierto por la regla
     explícita de `devhelper-calendar` (no se corrige, se rechaza) +
     escenario negativo en Task 12 + entrada en Review Focus.

5. **Proportion** — el spec es de 410 líneas; el plan está en torno a 600
   líneas y se compone principalmente de recipes literales que cada skill
   debe contener (texto exacto que la IA va a leer, no código
   transcrito). Las recipes en el spec se replican con la diferencia de
   que en el plan se ajustan a la sintaxis SKILL.md (frontmatter YAML,
   secciones exactas, ejemplos concretos). Ese ajuste es la decisión que
   el ejecutor no puede tomar solo y, por tanto, pertenece al plan. No
   hay transcript: las listas de props vienen del spec, no del modelo.
