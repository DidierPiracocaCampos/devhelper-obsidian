# DevHelper Dashboard

[English](#english) · [Español](#español)

---

## English

A project and task dashboard for Obsidian backed by plain Markdown notes. Your
notes are the single source of truth: the plugin never keeps a parallel store,
and your own properties and note bodies are preserved on every edit.

> The plugin UI is in Spanish.

### Features

- **Dashboard view** (ribbon icon `layout-dashboard` or command *Abrir el
  dashboard de proyectos y tareas*): favourite project chips, an «All» mode and
  a per-project view.
- **Projects, tasks and notes** as Markdown files under `Projects/<Project>/`
  (`type: project`, `type: task`, `type: note`). Create, rename, reassign and
  toggle tasks between `open` and `done`.
- **Files** per project (`Projects/<Project>/Archivos/`) plus a shared
  `General` project for vault-wide files.
- **Encrypted credentials**: AES-GCM 256 with a PBKDF2-SHA256 master password
  (210 000 iterations). Only the `service` name is stored in clear text; the key
  lives in memory and auto-locks after a configurable timeout.
- **Monthly calendar** (`Calendario/`, `type: calendar-event`) with date
  ranges and daily/weekly/monthly/yearly recurrence, expanded virtually — no
  notes are generated per occurrence.
- **Templates** (`Plantillas/`) and **Bases** (`Bases/*.base`) seeded on first
  run so the same data is browsable with Obsidian Bases.
- Two-way sync: manual edits to notes show up in the dashboard immediately.
- Validation issues are listed with an *Open note* button; one broken note
  never breaks the rest of the dashboard.
- Deletions always go to Obsidian's trash after confirmation.

Requires Obsidian **1.9.0** or newer (Bases).

### Installation

- **Community plugins** (once approved): search for *DevHelper Dashboard*.
- **BRAT**: add `DidierPiracocaCampos/devhelper-obsidian`.
- **Manual**: download `main.js`, `manifest.json` and `styles.css` from the
  [latest release](https://github.com/DidierPiracocaCampos/devhelper-obsidian/releases/latest)
  into `<vault>/.obsidian/plugins/devhelper-dashboard/` and enable the plugin.

### AI skills (optional)

Each release ships `devhelper-skills.zip`: nine `SKILL.md` files (Spanish) that
teach AI agents (Claude Code, OpenCode…) the plugin's data model. Unzip them into
`<vault>/.claude/skills/` or wherever your agent loads skills from.

### Companion theme

The dark monochrome [DevHelper theme](https://github.com/DidierPiracocaCampos/obsidian-devhelper-theme)
was designed alongside this plugin.

---

## Español

Dashboard de proyectos y tareas para Obsidian respaldado por notas Markdown.
Las notas son la única fuente de verdad: el plugin no guarda un almacén
paralelo y conserva tus Properties y el cuerpo de las notas en cada edición.

### Características

- **Vista dashboard** (icono `layout-dashboard` o comando *Abrir el dashboard
  de proyectos y tareas*): chips de proyectos favoritos, modo «Todos» y vista
  por proyecto.
- **Proyectos, tareas y notas** como archivos Markdown en
  `Projects/<Proyecto>/` (`type: project`, `type: task`, `type: note`). Crear,
  renombrar, reasignar y alternar tareas entre `open` y `done`.
- **Archivos** por proyecto (`Projects/<Proyecto>/Archivos/`) y un proyecto
  sombra `General` para los archivos globales.
- **Credenciales cifradas**: AES-GCM 256 con contraseña maestra PBKDF2-SHA256
  (210 000 iteraciones). Solo `service` va en claro; la clave vive en memoria y
  se bloquea sola tras un tiempo configurable.
- **Calendario mensual** (`Calendario/`, `type: calendar-event`) con rangos y
  recurrencia diaria/semanal/mensual/anual, expandida en memoria sin crear notas
  por ocurrencia.
- **Plantillas** (`Plantillas/`) y **Bases** (`Bases/*.base`) sembradas al
  primer uso.
- Sincronización bidireccional con las ediciones manuales.
- Avisos de validación con botón *Abrir nota*; una nota inválida no rompe el
  resto.
- El borrado siempre va a la papelera de Obsidian, con confirmación.

Requiere Obsidian **1.9.0** o superior (Bases).

### Instalación

- **Complementos de la comunidad** (cuando se apruebe): busca *DevHelper Dashboard*.
- **BRAT**: añade `DidierPiracocaCampos/devhelper-obsidian`.
- **Manual**: descarga `main.js`, `manifest.json` y `styles.css` de la
  [última release](https://github.com/DidierPiracocaCampos/devhelper-obsidian/releases/latest)
  en `<vault>/.obsidian/plugins/devhelper-dashboard/` y activa el plugin.

Las carpetas (`Projects`, `Plantillas`, `Calendario`, `Plantillas/Calendario`)
y el tiempo de bloqueo se cambian en **Ajustes → DevHelper Dashboard**.

### Skills de IA (opcional)

Cada release incluye `devhelper-skills.zip` con nueve `SKILL.md` que enseñan el
modelo de datos del plugin a agentes de IA. Descomprímelo en
`<vault>/.claude/skills/` o donde tu agente cargue skills.

### Theme

El theme oscuro monocromo [DevHelper](https://github.com/DidierPiracocaCampos/obsidian-devhelper-theme)
se diseñó junto a este plugin.

### Desarrollo

Requisitos: Node.js ≥ 18.

```bash
npm install
npm run dev        # watch con esbuild
npm run build      # build de producción → main.js + skills/
npm run typecheck
npm test
```

Publicar una versión:

```bash
npm version patch                     # sube package.json, manifest.json y versions.json
git push origin master --follow-tags  # el tag dispara la release en GitHub Actions
```

## License / Licencia

[MIT](LICENSE) © Didier Piracoca
