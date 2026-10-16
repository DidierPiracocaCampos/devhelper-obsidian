# Plan de implementación: Theme "DevHelper" para Obsidian V1

> **Para trabajadores agénticos:** SUB-SKILL OBLIGATORIO: Usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan sintaxis de casilla (`- [ ]`) para el seguimiento.

**Objetivo:** Construir un theme de Obsidian solo oscuro que replique la identidad visual monocroma de DevHelper, publicable en la tienda de temas.

**Arquitectura:** Un único `theme.css` que sobrescribe las variables CSS de Obsidian bajo `body` (interfaz) y `.theme-dark` (colores), más un `manifest.json`. Sin build ni dependencias: un script de verificación en Node (solo builtins) comprueba los requisitos de publicación y la presencia de la paleta. El theme vive en `theme/` de este repo y se moverá a un repositorio propio para publicar.

**Stack tecnológico:** CSS puro, `manifest.json`, Node (script de verificación sin dependencias), obsidian-cli para capturas de verificación.

**Spec:** `docs/superpowers/specs/2026-10-16-devhelper-theme-design.md`

## Restricciones globales

- Solo oscuro (dark only); en modo claro el usuario ve el tema base de Obsidian.
- Assets locales únicamente: prohibido `url(http...)`, `url(https...)` y `@import` remoto.
- Sin declaraciones `!important`.
- Selectores de baja especificidad; colores bajo `.theme-dark`, interfaz general bajo `body`.
- Fuentes por defecto de Obsidian (no incrustar Roboto).
- Paleta exacta de DevHelper (valores copiados del spec).
- `manifest.json` con `name: "DevHelper"`, `version: "0.1.0"`, `minAppVersion: "1.0.0"`, `author: "DevHelper"`.
- Desktop y mobile.
- Sin build, sin dependencias de npm.

## Foco de revisión

- Modo claro: el theme no debe verse roto en modo claro; debe caer limpio al tema base (catalogado dark only).
- Assets remotos colados (fuentes o imágenes): el script de verificación debe fallar si aparece `url(http...)` o `@import`.
- `!important` introducido por descuido: el script de verificación falla.
- Contraste: el texto atenuado (`#e8e8e8` al 0.5) puede bajar de AA sobre `#171717`; revisar y ajustar la opacidad si es necesario.
- Mobile: el layout móvil (toolbar inferior, safe areas) no debe quedar ilegible; verificar en iOS/Android.
- Versión de Obsidian: los selectores no deben depender de APIs más nuevas que `minAppVersion` (1.0.0).

---

## Mapa de archivos

- `theme/manifest.json` — metadatos del theme (nombre, versión, autor, `minAppVersion`).
- `theme/theme.css` — todo el CSS: paleta, forma, textura, superficies, sintaxis y mobile.
- `theme/scripts/check-theme.mjs` — verificación automática (manifest válido, sin `!important`, sin assets remotos, variables de paleta presentes, captura existente).
- `theme/screenshots/screenshot.png` — thumbnail 16:9 (`512×288`) para la galería.
- `theme/LICENSE` — MIT.
- `theme/README.md` — descripción, instalación y nota dark-only.

## Tarea 1: Crear el esqueleto del theme y el script de verificación

**Archivos:**
- Crear: `theme/manifest.json`, `theme/theme.css`, `theme/LICENSE`, `theme/README.md`, `theme/scripts/check-theme.mjs`, `theme/screenshots/screenshot.png`.

**Contrato:** `manifest.json` debe ser JSON válido con estos campos no vacíos: `name`, `version`, `minAppVersion`, `author`. `check-theme.mjs` se ejecuta con `node` y sale con código `0` si todo pasa y `1` en caso contrario; usa solo módulos builtin (`fs`, `path`). Comprueba: (a) `manifest.json` existe, parsea y tiene los cuatro campos no vacíos; (b) `theme.css` existe y no contiene `!important`, `url(http://`, `url(https://` ni `@import`; (c) `screenshots/screenshot.png` existe. Además lee un array `requiredVariables` (vacío al principio) de patrones regex y falla si `theme.css` no coincide con todos.

- [ ] Escribir `check-theme.mjs` con las comprobaciones (a), (b), (c) y el array `requiredVariables` vacío.
- [ ] Crear `manifest.json` con `name: "DevHelper"`, `version: "0.1.0"`, `minAppVersion: "1.0.0"`, `author: "DevHelper"`; crear `theme.css` con solo un comentario de cabecera; crear `LICENSE` (MIT), `README.md` con título y una nota "dark only", y un `screenshot.png` placeholder de `512×288`.

Ejecutar: `node theme/scripts/check-theme.mjs`
Esperado: sale con código `0` (todo verde).

- [ ] Commit como `build: crear esqueleto del theme DevHelper`.

## Tarea 2: Aplicar la paleta base (fondos y texto)

**Archivos:**
- Modificar: `theme/theme.css`, `theme/scripts/check-theme.mjs`.

**Contrato:** Bajo `.theme-dark` se declaran: `--background-primary: #171717`, `--background-secondary: #20201e`, `--text-normal: #e8e8e8`, `--text-muted` y `--text-faint` (opacidades 0.7 y 0.5 de `#e8e8e8` respectivamente). Bajo `body` no se fija ninguna fuente (fuentes por defecto de Obsidian).

- [ ] Añadir a `requiredVariables` en `check-theme.mjs` los patrones `/\-\-background-primary\s*:\s*#171717/`, `/\-\-background-secondary\s*:\s*#20201e/`, `/\-\-text-normal\s*:\s*#e8e8e8/`, `/\-\-text-muted\b/` y `/\-\-text-faint\b/`.
- [ ] Ejecutar `node theme/scripts/check-theme.mjs` y verificar que FALLA (faltan las variables).
- [ ] Implementar en `theme.css` el bloque `.theme-dark` con los fondos y las tres variables de texto (muted/faint vía `color-mix` o `rgba(232,232,232,…)`).
- [ ] Ejecutar `node theme/scripts/check-theme.mjs` y verificar que PASA.
- [ ] Copiar `theme/theme.css` y `theme/manifest.json` a `<vault>/.obsidian/themes/DevHelper/`, activar el theme y comprobar editor (`#171717`), sidebar (`#20201e`) y texto (`#e8e8e8`).

- [ ] Commit como `feat: aplicar paleta base de fondos y texto`.

## Tarea 3: Aplicar acentos interactivos, bordes y colores semánticos

**Archivos:**
- Modificar: `theme/theme.css`, `theme/scripts/check-theme.mjs`.

**Contrato:** Bajo `.theme-dark`: `--background-modifier-border: #363633`, `--interactive-accent: #e8e8e8`, `--text-on-accent: #171717`, `--color-green: oklch(55% 0.22 145)`, `--color-blue: oklch(70% 0.2 265)`, `--color-orange: oklch(88% 0.18 85)`, `--color-red: oklch(70% 0.25 25)`. Los enlaces se distinguen por peso/subrayado/fondo claro, sin color cromático.

- [ ] Añadir a `requiredVariables` los patrones regex de esas siete variables (nombre + valor exacto).
- [ ] Ejecutar `node theme/scripts/check-theme.mjs` y verificar que FALLA.
- [ ] Implementar las siete variables y el estilo monocromo de enlaces/selección en `theme.css`.
- [ ] Ejecutar `node theme/scripts/check-theme.mjs` y verificar que PASA.
- [ ] Verificar en el vault: elementos seleccionados en gris claro con texto oscuro, bordes `#363633`, tags/estados con los colores semánticos.

- [ ] Commit como `feat: aplicar acentos interactivos y colores semánticos`.

## Tarea 4: Añadir forma, textura y profundidad

**Archivos:**
- Modificar: `theme/theme.css`.

**Contrato:** Esquinas redondeadas asimétricas: tarjetas, modales y botones `~1rem` (radios `--radius-l`/`--radius-xl` de Obsidian); inputs `~0.25rem`. Ruido sutil: overlay `position: fixed; inset: 0` con un SVG de ruido en data-URI al `0.035` de opacidad y `pointer-events: none`. Gradiente "frost" `linear-gradient(180deg, #20201e 0%, #171717 50%, #0d0d0d 100%)` en superficies de cabecera (titlebar). Sombras suaves en tarjetas, nada profundo.

- [ ] Implementar los radios de tarjetas/botones e inputs en `theme.css`.
- [ ] Añadir el overlay de ruido (data-URI local) y el gradiente frost en la cabecera.
- [ ] Verificar en el vault: esquinas redondeadas visibles, ruido sutil, cabecera con gradiente, sin sombras fuertes.

- [ ] Commit como `feat: añadir forma, textura y profundidad`.

## Tarea 5: Estilizar las superficies de la app

**Archivos:**
- Modificar: `theme/theme.css`.

**Contrato:** Cubrir con la paleta y la forma definidas: editor (vista lectura, live preview y modo código), sidebars izquierdo/derecho, ribbon, barra de estado, tab bar/title bar, ajustes, modales, paleta de comandos, búsqueda, backlinks, outline, vista de grafo (nodos/aristas neutros, monocromo), scrollbars, tooltips, dropdowns y checkboxes.

- [ ] Aplicar las variables ya definidas a cada superficie; añadir reglas de baja especificidad solo donde haga falta (sin `!important`).
- [ ] Ejecutar `node theme/scripts/check-theme.mjs` y verificar que sigue pasando.
- [ ] Verificar visualmente cada superficie en un vault de prueba, en vista lectura y live preview.

- [ ] Commit como `feat: estilizar superficies de la app`.

## Tarea 6: Resaltado de sintaxis monocromo

**Archivos:**
- Modificar: `theme/theme.css`.

**Contrato:** Colores de CodeMirror (`cm-*`) en monocromo: comentarios y puntuación en gris atenuado, texto base en `#e8e8e8`; keywords en gris claro con peso, strings y números con los colores semánticos (info/success). Sin acento cromático.

- [ ] Definir los colores de tokens de CodeMirror (`cm-comment`, `cm-string`, `cm-number`, `cm-keyword`, `cm-variable`, etc.) con el esquema monocromo.
- [ ] Verificar bloques de código (fences) legibles en live preview y modo lectura.

- [ ] Commit como `feat: resaltado de sintaxis monocromo`.

## Tarea 7: Adaptar el theme a mobile

**Archivos:**
- Modificar: `theme/theme.css`.

**Contrato:** Bajo `.is-mobile` / `body.is-phone`: conservar la paleta; ajustar toolbar inferior, safe areas y objetivos táctiles para que nada quede ilegible ni superpuesto.

- [ ] Añadir reglas específicas de mobile manteniendo los colores ya definidos.
- [ ] Verificar en mobile (iOS/Android) editor, sidebar y modales.

- [ ] Commit como `feat: adaptar el theme a mobile`.

## Tarea 8: Verificación final y preparación de publicación

**Archivos:**
- Modificar: `theme/README.md`, `theme/screenshots/screenshot.png`, `theme/manifest.json` si hace falta.

- [ ] Ejecutar `node theme/scripts/check-theme.mjs` y confirmar salida `0`.
- [ ] Revisar contraste AA del texto normal y atenuado; ajustar opacidades si algún nivel no cumple.
- [ ] Generar capturas 16:9 reales (`512×288` thumbnail + capturas completas de editor, sidebar y móvil) con obsidian-cli; sustituir el placeholder.
- [ ] Confirmar en modo claro que el theme cae al tema base sin verse roto.
- [ ] Completar `README.md` (instalación, descripción, nota dark-only) y verificar `manifest.json`.

- [ ] Commit como `docs: verificar el theme y preparar publicación`.

## Verificación final

Ejecutar desde la raíz del proyecto:

```powershell
node theme/scripts/check-theme.mjs
git status --short
```

Esperado: el script sale con código `0` y solo quedan en el árbol de trabajo los cambios intencionales del theme en `theme/`.
