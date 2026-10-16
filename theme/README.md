# DevHelper

Theme oscuro monocromo para [Obsidian](https://obsidian.md), diseñado para el
plugin DevHelper Dashboard. Fondo casi negro (`#171717`), texto de alto
contraste (`#e8e8e8`, ratio 14.6:1) y acentos semánticos puntuales: los strings
van en azul y los números en verde, todo lo demás se mantiene en escala de
grises para no distraer. Incluye esquinas redondeadas, sombras suaves,
textura de ruido sutil y adaptación a móvil con safe areas y objetivos
táctiles de 44 px.

> Dark only — no soporta modo claro. Sin el modo oscuro activo, Obsidian usa
> su theme base y este theme no aplica ningún estilo.

## Instalación

### Manual (recomendada mientras no esté en la tienda)

1. Crea la carpeta `<tu-vault>/.obsidian/themes/DevHelper/`.
2. Copia `theme.css` y `manifest.json` de este repo dentro de esa carpeta.
3. En Obsidian ve a **Ajustes → Apariencia → Themes** y elige **DevHelper**.
4. Asegúrate de que el **modo base** está en **Oscuro**.

### Desde la tienda (cuando se publique)

Busca `DevHelper` en **Ajustes → Apariencia → Gestionar → Explorar themes de
la comunidad** e instálalo desde ahí.

## Capturas

- `screenshots/screenshot.png` — miniatura 16:9 (512×288).
- `screenshots/screenshot-editor.png` — editor con sidebar en escritorio.
- `screenshots/screenshot-mobile.png` — vista con emulación móvil a ancho de
  escritorio (1920×1080); la barra inferior móvil es visible y usa los estilos
  del theme. Verificada también a ancho estrecho real (414 px): la toolbar se
  muestra con fondo `--background-secondary` y objetivos de 44 px.

## Compatibilidad

- `minAppVersion: 1.0.0`.
- Sin dependencias, sin `!important`, sin recursos remotos.

## Créditos y licencia

Autor: DevHelper (2026). Licencia MIT.
