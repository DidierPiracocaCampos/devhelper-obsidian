# Diseño: Botonera de comandos del dashboard DevHelper

## Objetivo

Permitir que el usuario final añada una botonera dentro del dashboard DevHelper con botones que ejecutan comandos de Obsidian. Los botones se configuran en un fichero JSON editable a mano o por la IA, y pueden ser simples (un comando) o popovers (menú de varios comandos).

## Alcance de la V1

### Incluye

- Botonera dentro de la vista del dashboard DevHelper, encima de proyectos y tareas.
- Botones que ejecutan comandos de Obsidian de **cualquier plugin** (nativos, de la comunidad o propios del usuario), por su ID (`app.commands`).
- Dos tipos explícitos de botón: `command` (un comando, clic = ejecutar) y `popover` (grupo, clic = abrir menú).
- Configuración en un fichero JSON en el vault, editable a mano o por la IA, recargado automáticamente al cambiar.
- Un helper para descubrir IDs de comandos disponibles (modal con listado y copia).
- Errores visibles como `issues`, sin romper el resto del dashboard.

### Excluye

- Ejecución de código arbitrario dentro del plugin (los scripts del usuario viven en sus propios plugins, no en DevHelper).
- Un selector gráfico completo de comandos (la edición es por fichero; el modal solo lista y copia IDs).
- Integración con skills de IA (ítem 3) y paleta de comandos propia (ítem 4): se diseñan aparte.

## Datos y fichero de configuración

La botonera se define en un fichero JSON dentro del vault, con ruta configurable en ajustes (`buttonBarFile`, por defecto `DevHelper/buttons.json`). El fichero es la fuente de verdad de la botonera; no se duplica en el `data.json` del plugin.

```json
{
  "version": 1,
  "buttons": [
    {
      "type": "command",
      "id": "nueva-tarea",
      "label": "Nueva tarea",
      "icon": "plus",
      "command": "devhelper-dashboard:create-task"
    },
    {
      "type": "popover",
      "id": "mas",
      "label": "Más acciones",
      "icon": "more-horizontal",
      "items": [
        { "label": "Crear proyecto", "icon": "folder-plus", "command": "devhelper-dashboard:create-project" },
        { "label": "Abrir ajustes", "command": "app:open-settings" }
      ]
    }
  ]
}
```

Reglas de validación:

- `version` debe ser `1` (reservado para migraciones).
- Cada botón requiere `type` (`command` | `popover`), `id` (único, no vacío) y `label` (no vacío).
- `icon` es opcional: un nombre de icono Lucide (el set de Obsidian).
- `command` (solo `type: command`) es un ID de comando de Obsidian (`plugin:comando`), no vacío.
- `items` (solo `type: popover`) es una lista no vacía de `{ label, icon?, command }`.
- Un botón con `type` desconocido o campos faltantes se descarta y genera un `issue`, sin romper la botonera.

## Interfaz

- La botonera se renderiza como una fila horizontal en la parte superior del dashboard.
- Botón simple: muestra `icon` (si existe) y `label`; al pulsar ejecuta su comando.
- Popover: muestra `icon` y `label`; al pulsar abre un menú de Obsidian con sus `items`; cada item ejecuta su comando.
- Un comando inexistente (plugin desactivado/desinstalado) deja el botón o item deshabilitado y genera un `issue`.
- Los `issues` de la botonera se muestran igual que los del dashboard (mensaje + acción para abrir el fichero de configuración).

## Arquitectura y flujo

- `src/domain/parseButtonBar.ts` — `parseButtonBarConfig(json: string, path: string): ParsedButtonBar`. Parsea y valida; nunca lanza.
- `src/domain/presentButtonBar.ts` — `presentButtonBar(parsed, registry): PresentedButtonBar`. Resuelve qué comandos existen y produce botones con banderas de "deshabilitado" + issues.
- `src/data/CommandRegistry.ts` / `src/data/ObsidianCommandRegistry.ts` — interfaz pura (`list`, `has`, `execute`) e implementación sobre `app.commands`.
- `src/data/ButtonBarRepository.ts` — lee el fichero configurado vía el adaptador de vault y devuelve `ParsedButtonBar`.
- `src/ui/ButtonBarView.ts` — renderiza `PresentedButtonBar` dentro del dashboard.
- `src/ui/CommandsModal.ts` — lista los comandos de `app.commands` (id, nombre, plugin) y permite copiar el ID.

Flujo:

1. `refresh()` del dashboard lee `ButtonBarRepository.load()` y `presentButtonBar(...)`, y renderiza la botonera.
2. Clic simple → `executeCommandById(id)`. Clic popover → `Menu` con los items.
3. Hot reload: los eventos de vault ya existentes (debounced) disparan el refresh; el fichero se relee solo.

## Fallos y validación

- Fichero ausente → botonera vacía, sin error.
- JSON inválido → un `issue` con el mensaje de parseo; botonera vacía.
- Botón mal formado o `type` inválido → se descarta, `issue` por botón.
- `id` duplicado → `issue`, se conserva el primero.
- Comando inexistente → botón/item deshabilitado + `issue`.

## Criterios de aceptación

1. Se puede definir una botonera en `buttons.json` con un botón simple y un popover, y ambos ejecutan sus comandos.
2. Los comandos pueden ser de cualquier plugin instalado, no solo de DevHelper.
3. Un botón cuyo comando no existe aparece deshabilitado y genera un aviso, sin romper el dashboard.
4. Editar el fichero (a mano o por la IA) se refleja en la botonera sin reiniciar Obsidian.
5. Un JSON inválido o un botón mal formado genera un aviso local y no impide usar el resto del dashboard.
6. El modal de comandos permite descubrir y copiar IDs de comandos.

## Verificación

Probar en un vault de prueba: definir botones simples y popovers con comandos de DevHelper, de Obsidian y de otro plugin instalado; editar el fichero y comprobar el refresco; JSON inválido; comando inexistente; ids duplicados; y el modal de comandos. Añadir pruebas automatizadas para el parser, la presentación y el repositorio.
