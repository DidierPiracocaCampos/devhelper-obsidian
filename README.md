# DevHelper Dashboard

Plugin de Obsidian que ofrece un dashboard adaptable de proyectos y tareas
respaldados por notas Markdown. Las notas son la única fuente de verdad:
el plugin no duplica proyectos ni tareas en su almacenamiento.

## Desarrollo

```bash
npm install
npm run dev        # watch con esbuild (sourcemap inline)
npm run build      # build de producción con minificación
npm run typecheck  # tsc --noEmit
npm run test       # vitest run
```

## Instalación en un vault

1. Ejecuta `npm run build`.
2. Copia `main.js`, `manifest.json` y `styles.css` a
   `<vault>/.obsidian/plugins/devhelper-dashboard/`.
3. Activa el plugin `devhelper-dashboard` en Ajustes → Complementos.

En un vault nuevo, el plugin arranca sin carpetas ni notas previas; las
carpetas por defecto `Projects/` y `Tasks/` se crean al primer uso.
