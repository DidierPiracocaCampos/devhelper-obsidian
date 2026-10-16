# Diseño: Theme "DevHelper" para Obsidian

## Objetivo

Crear un theme de Obsidian completo, solo oscuro, que replique la identidad visual de DevHelper (la app web) para que el vault se vea consistente con el producto. Está pensado para publicarse en la tienda de temas de la comunidad.

## Alcance de la V1

### Incluye

- Theme completo: retematiza toda la app (editor, sidebars, modales, ajustes, paleta de comandos, búsqueda, etc.).
- Solo oscuro (dark only): no hay modo claro, igual que DevHelper.
- Desktop y mobile (iOS/Android), vía `.is-mobile` / `body.is-phone`.
- CSS puro: un `theme.css` que sobrescribe variables de Obsidian. Sin build, sin dependencias.
- Fuentes por defecto de Obsidian (no se incrusta Roboto).
- Publicable: assets locales, sin `!important`, sin llamadas de red.

### Excluye

- Modo claro.
- Incrustar Roboto o Material Symbols (los assets remotos están prohibidos en la tienda; los iconos de Obsidian no se reemplazan desde un theme).
- Integración con el plugin Style Settings u otra personalización.
- Tooling de build (SCSS, etc.).

## Identidad visual

Paleta monocroma cálida tomada de DevHelper (`src/styles.css` del proyecto web en `D:\proyects\DevHelper`):

| Token DevHelper | Valor | Rol |
|---|---|---|
| `base-100` | `#171717` | Fondo / lienzo |
| `base-200` | `#20201e` | Superficies elevadas (cards, inputs, sidebar) |
| `base-300` | `#363633` | Bordes y separadores |
| `base-content` | `#e8e8e8` | Texto principal |
| — | `#0d0d0d` | Negro profundo (fin del gradiente "frost") |
| `primary` | `#e8e8e8` | Acción principal (gris claro sobre fondo oscuro) |
| `success` | `oklch(55% 0.22 145)` | Estado éxito |
| `info` | `oklch(70% 0.2 265)` | Estado informativo |
| `warning` | `oklch(88% 0.18 85)` | Estado advertencia |
| `error` | `oklch(70% 0.25 25)` | Estado error |

No hay acento cromático: el "primary" es el gris claro. El color solo aparece en los estados semánticos.

Jerarquía de texto por opacidad de `#e8e8e8`: principal (1.0), secundario (0.7), atenuado (0.5), deshabilitado (0.3).

Forma y textura:

- Esquinas redondeadas asimétricas: tarjetas, modales y botones muy redondeados (`~1rem`); inputs con redondeo sutil (`~0.25rem`).
- Plano: sin sombras profundas; solo una sombra suave en tarjetas.
- Ruido sutil: overlay SVG (data-URI local) al `0.035` de opacidad.
- Gradiente "frost" `#20201e → #171717 → #0d0d0d` aplicado a superficies de cabecera, no de forma decorativa general.

## Mapeo a variables de Obsidian

| Variable de Obsidian | Valor |
|---|---|
| `--background-primary` | `#171717` |
| `--background-secondary` | `#20201e` |
| `--background-modifier-border` | `#363633` |
| `--text-normal` | `#e8e8e8` |
| `--text-muted` | `#e8e8e8` al 0.7 |
| `--text-faint` | `#e8e8e8` al 0.5 |
| `--interactive-accent` | `#e8e8e8` |
| `--text-on-accent` | `#171717` |
| `--color-green` | `oklch(55% 0.22 145)` |
| `--color-blue` | `oklch(70% 0.2 265)` |
| `--color-orange` | `oklch(88% 0.18 85)` |
| `--color-red` | `oklch(70% 0.25 25)` |

Las variables de color van bajo `.theme-dark`; las de interfaz general bajo `body`.

## Decisiones de diseño

1. **Enlaces y acentos en monocromo.** DevHelper no tiene acento cromático, así que enlaces y elementos seleccionados se distinguen por peso, subrayado o fondo claro (`#e8e8e8`), no por color. Obsidian usa morado/azul por defecto; aquí queda neutro.
2. **Resaltado de sintaxis monocromo.** DevHelper no tiene editor de código, así que no hay esquema oficial que replicar. El theme define un esquema monocromo derivado de la paleta (grises; los colores semánticos solo para strings, números y keywords).
3. **Iconos sin cambios.** Obsidian usa su propio set (Lucide); un theme no los reemplaza. Se mantienen y heredan el color del texto.
4. **Solo oscuro.** El theme se cataloga como "dark only"; en modo claro el usuario ve el tema base de Obsidian.

## Arquitectura y estructura

- El theme se desarrolla en el directorio `theme/` de este repositorio; para publicarlo en la tienda se moverá a un repositorio propio (requisito de la comunidad).
- Archivos: `manifest.json`, `theme.css`, `screenshots/`, `LICENSE` y `README.md` en `theme/`.
- El CSS sobrescribe variables de Obsidian con selectores de baja especificidad, sin `!important` y sin assets remotos.
- Mobile se adapta con `.is-mobile` / `body.is-phone` manteniendo la paleta.

## Fallos y validación

- Contraste WCAG AA para texto normal y grande.
- Sin assets remotos (nada de `url(http...)` ni `@import`).
- Sin `!important`.
- `manifest.json` completo y válido.

## Criterios de aceptación

1. El theme se instala en un vault y retematiza editor, sidebars, modales y ajustes con la paleta DevHelper.
2. Funciona en desktop y en mobile.
3. El texto normal cumple contraste AA (`#e8e8e8` sobre `#171717` ≈ 14:1).
4. No hay assets remotos ni declaraciones `!important`.
5. `manifest.json` está completo y existe la captura 16:9 para la galería.
6. En modo claro cae al tema base (catalogado dark only).

## Verificación

Instalar en un vault de prueba (desktop y mobile); revisar cada superficie; comprobar contraste; ejecutar el script de chequeo (manifest válido, sin `!important`, sin assets remotos, variables de paleta presentes, captura existente); generar capturas 16:9 (`512×288` thumbnail + capturas completas).
