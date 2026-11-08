# Plan: publicar el plugin DevHelper Dashboard y el theme DevHelper en GitHub (público)

Fecha: 2026-11-08

## Estado de partida

- `DidierPiracocaCampos/devhelper-obsidian` **ya es público** (rama `master`,
  sin releases). Contiene plugin + theme (`theme/`) + docs internas de agentes.
- El plugin no tiene `LICENSE` en la raíz (solo `theme/LICENSE`, con copyright «DevHelper»).
- Versiones desalineadas: `manifest.json` 0.3.0, `package.json` 0.1.0; no hay `versions.json`.
- `author` es «DevHelper» en ambos manifests; varios commits usan `devhelper@example.com` / `devhelper@local`.
- El theme vive en una subcarpeta y el catálogo de themes de Obsidian exige
  `manifest.json` + `theme.css` en la **raíz** de un repo propio.

Objetivo: dos repos públicos listos para la tienda comunitaria de Obsidian:

1. `devhelper-obsidian` → plugin `devhelper-dashboard` (repo actual).
2. `obsidian-devhelper-theme` → theme `DevHelper` (repo nuevo).

---

## Fase 0 — Revisión de seguridad antes de exponer más (bloqueante)

- [ ] Escanear todo el historial en busca de secretos: `gitleaks detect` o
      `mcp github run_secret_scanning`. Revisar en especial `tests/` (fixtures de
      credenciales cifradas) y `docs/`.
- [ ] Confirmar que `data.json` (sal + verificador) nunca se commiteó (`git log --all -- '**/data.json'`).
- [ ] Decidir si `docs/superpowers/`, `.agents/`, `AGENTS.md`/`CLAUDE.md`,
      `skills-lock.json` se quedan públicos o se mueven/eliminan. Recomendación:
      mantener `docs/` (son specs útiles), quitar `.superpowers/` y `.worktrees/`
      si aparecen, y añadir `.claude/` al `.gitignore`.

## Fase 1 — Preparar el repo del plugin

- [ ] `LICENSE` MIT en la raíz con `Copyright (c) 2026 Didier Piracoca`.
- [ ] `manifest.json`: `author: "Didier Piracoca"`, `authorUrl: "https://github.com/DidierPiracocaCampos"`,
      revisar `minAppVersion` (Bases requiere ≥ 1.9; ajustar si el plugin las usa) y
      descripción en inglés corta que no contenga «Obsidian» (requisito de la revisión).
- [ ] Alinear `package.json.version` con `manifest.json.version` y crear `versions.json`
      (`{"0.3.0": "<minAppVersion>"}`). Añadir script `npm version` → `version-bump.mjs`
      (patrón del sample-plugin) que actualice manifest + versions.json.
- [ ] README: añadir versión en inglés (o README bilingüe), capturas del dashboard,
      sección de instalación vía BRAT y vía tienda, y nota de seguridad sobre credenciales cifradas.
- [ ] Quitar el theme del repo del plugin cuando el repo del theme exista (Fase 3),
      dejando un enlace en el README.
- [ ] `npm run typecheck && npm test && npm run build` en verde.

## Fase 2 — Releases automáticas del plugin

- [ ] `.github/workflows/release.yml`: al hacer push de un tag `x.y.z` (sin `v`),
      `npm ci && npm run build` y crear un GitHub Release con los assets
      `main.js`, `manifest.json`, `styles.css`.
- [ ] `.github/workflows/ci.yml`: typecheck + test + build en cada PR/push.
- [ ] Primer release: `git tag 0.3.0 && git push origin 0.3.0`; verificar assets en el release.
- [ ] Probar instalación limpia con **BRAT** (`DidierPiracocaCampos/devhelper-obsidian`) en un vault vacío.

## Fase 3 — Repo nuevo para el theme

- [ ] Crear `DidierPiracocaCampos/obsidian-devhelper-theme` (público) conservando
      historia: `git subtree split --prefix=theme -b theme-only` y push de esa rama como `main`.
- [ ] En la raíz: `manifest.json` (`name: "DevHelper"`, `author: "Didier Piracoca"`,
      `authorUrl`, `version: 1.0.0`, `minAppVersion`), `theme.css`, `LICENSE`, `README.md`,
      `screenshot.png` **en la raíz** (512×288, 16:9 — la tienda lo lee de ahí).
- [ ] Workflow opcional que ejecute `scripts/check-theme.mjs` en CI.
- [ ] Release `1.0.0` con `theme.css` + `manifest.json` como assets.
- [ ] Comprobar que el nombre «DevHelper» no está ya en `community-css-themes.json`.

## Fase 4 — Envío a la tienda comunitaria de Obsidian

- [ ] Fork de `obsidianmd/obsidian-releases`.
- [ ] Plugin: añadir entrada al final de `community-plugins.json`
      (`id: devhelper-dashboard`, `name`, `author`, `description`, `repo`) y abrir PR con la plantilla.
- [ ] Theme: añadir entrada a `community-css-themes.json`
      (`name: DevHelper`, `author`, `repo`, `screenshot: screenshot.png`, `modes: ["dark"]`) en PR separado.
- [ ] Atender el bot de validación y la revisión manual (suele pedir: no usar `innerHTML`,
      no `console.log` en producción, usar `normalizePath`, no hardcodear `.obsidian`
      → `app.vault.configDir`, limpiar listeners en `onunload`).

## Fase 5 — Después de publicar

- [ ] Topics en GitHub: `obsidian`, `obsidian-plugin`, `obsidian-theme`, `productivity`.
- [ ] Actualizar `D:\vault` para instalar desde la tienda / BRAT en vez de copia manual.
- [ ] Anunciarlo en el README del perfil (`DidierPiracocaCampos`) y en el portafolio.

## Decisiones abiertas

1. ¿Descripción y README en inglés (mejor para la revisión y alcance) o solo español?
2. ¿Reescribir el autor de los commits antiguos (`devhelper@example.com`) o dejarlos?
   Reescribir obliga a `push --force` sobre un repo público; recomendación: dejarlos.
3. ¿Nombre del repo del theme: `obsidian-devhelper-theme` o `devhelper-theme`?
