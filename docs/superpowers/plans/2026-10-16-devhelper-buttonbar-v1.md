# Plan de implementación: Botonera de comandos del dashboard DevHelper

> **Para trabajadores agénticos:** SUB-SKILL OBLIGATORIO: Usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan sintaxis de casilla (`- [ ]`) para el seguimiento.

**Objetivo:** Añadir una botonera dentro del dashboard DevHelper que ejecuta comandos de Obsidian (de cualquier plugin), configurada en un fichero JSON editable a mano o por la IA.

**Arquitectura:** Una capa de dominio pura parsea y valida el JSON (`parseButtonBar`) y resuelve los comandos contra un `CommandRegistry` (`presentButtonBar`). Un `ButtonBarRepository` lee el fichero vía el adaptador de vault existente; `ButtonBarView` lo renderiza dentro del `DashboardView`. Los comandos se ejecutan con `app.commands.executeCommandById`.

**Stack tecnológico:** TypeScript, Obsidian Plugin API, Vitest; reutiliza `VaultAdapter` y el patrón de `issues` del dashboard.

**Spec:** `docs/superpowers/specs/2026-10-16-devhelper-buttonbar-design.md`

## Restricciones globales

- Los botones ejecutan **IDs de comando de Obsidian** (`plugin:comando`), de cualquier plugin; DevHelper **no ejecuta código arbitrario**.
- El fichero JSON es la fuente de verdad (ruta configurable, por defecto `DevHelper/buttons.json`); no se duplica en `data.json`.
- Dos tipos explícitos: `command` (un comando) y `popover` (grupo con `items`).
- Validación: `version` = `1`; `id` único y no vacío; `label` no vacío; `icon` opcional (nombre Lucide); `command` no vacío en botones simples; `items` no vacío en popovers.
- Errores como `issues` (`{ path, message }`), sin lanzar ni romper el dashboard.
- Hot reload al cambiar el fichero, reusando los eventos debounced del vault ya existentes.
- Todo el texto UI en español; iconos Lucide vía `setIcon`.

## Foco de revisión

- JSON inválido o truncado: el parser devuelve un `issue` y botonera vacía; el dashboard sigue operativo.
- Comando inexistente (plugin desactivado/desinstalado): el botón/item se marca deshabilitado y genera un `issue`.
- `id` duplicado: se conserva el primero y se emite un `issue`.
- `buttonBarFile` inseguro (absoluto, `..`, barras invertidas): se normaliza a una ruta relativa segura o al fallback.
- Fichero ausente: botonera vacía sin error.
- Edición externa del fichero (a mano o por IA): el refresco la recoge sin reiniciar Obsidian.

---

## Mapa de archivos

- `src/domain/types.ts` — añade `ButtonDefinition`, `ButtonItem`, `ButtonBarConfig`, `ButtonBarIssue`, `ParsedButtonBar`, `PresentedButton*`, `PresentedButtonBar`.
- `src/domain/parseButtonBar.ts` — `parseButtonBarConfig(json, path): ParsedButtonBar` (nunca lanza).
- `src/domain/presentButtonBar.ts` — `presentButtonBar(parsed, registry): PresentedButtonBar`.
- `src/data/CommandRegistry.ts` / `src/data/ObsidianCommandRegistry.ts` — interfaz pura e impl sobre `app.commands`.
- `src/data/ButtonBarRepository.ts` — `load(): Promise<ParsedButtonBar>` vía `VaultAdapter`.
- `src/ui/ButtonBarView.ts` — render de botones/popovers e `issues`.
- `src/ui/CommandsModal.ts` — listado de comandos (`id`, `name`, plugin) con copia.
- `src/settings.ts` / `src/ui/SettingsTab.ts` — `buttonBarFile` + normalización de ruta de fichero.
- `src/main.ts` / `src/ui/DashboardView.ts` — cableado, hot reload y registro del comando del modal.
- `tests/parseButtonBar.test.ts`, `tests/presentButtonBar.test.ts`, `tests/ButtonBarRepository.test.ts`.

## Tarea 1: Tipos y parser de la configuración

**Archivos:**
- Modificar: `src/domain/types.ts`
- Crear: `src/domain/parseButtonBar.ts`, `tests/parseButtonBar.test.ts`

**Interfaces:**
- Produce: `CommandButtonDefinition = { type: "command"; id: string; label: string; icon?: string; command: string }`, `PopoverButtonDefinition = { type: "popover"; id: string; label: string; icon?: string; items: ButtonItem[] }`, `ButtonItem = { label: string; icon?: string; command: string }`, `ButtonDefinition = CommandButtonDefinition | PopoverButtonDefinition`, `ButtonBarIssue = { path: string; message: string }`, `ParsedButtonBar = { buttons: ButtonDefinition[]; issues: ButtonBarIssue[] }`, y `parseButtonBarConfig(json: string, path: string): ParsedButtonBar`.

- [ ] Escribir `tests/parseButtonBar.test.ts` con: `parsesCommandButton()`, `parsesPopoverButton()`, `reportsInvalidJson()`, `reportsMissingType()`, `reportsMissingLabel()`, `reportsMissingCommand()`, `reportsMissingItems()`, `reportsInvalidType()`, `reportsDuplicateIds()`, `returnsEmptyForNoButtons()` y `reportsWrongVersion()`; verificar que cada caso inválido devuelve un `issue` con `path` correcto y botón descartado, y que los válidos conservan `icon` y `items`.
- [ ] Ejecutar `npm test -- tests/parseButtonBar.test.ts` y verificar que FALLA (módulo no implementado).
- [ ] Implementar los tipos en `src/domain/types.ts` y `parseButtonBarConfig` en `src/domain/parseButtonBar.ts` (parseo con `JSON.parse` envuelto en try/catch; validación por botón).
- [ ] Ejecutar `npm test -- tests/parseButtonBar.test.ts` y `npm run typecheck`.

Esperado: los tests pasan; `parseButtonBarConfig` nunca lanza.

- [ ] Commit como `feat: parsear y validar la configuración de la botonera`.

## Tarea 2: Presentación y resolución de comandos

**Archivos:**
- Crear: `src/domain/presentButtonBar.ts`, `src/data/CommandRegistry.ts`, `src/data/ObsidianCommandRegistry.ts`, `tests/presentButtonBar.test.ts`

**Interfaces:**
- Consume: tipos de la Tarea 1.
- Produce: `CommandRegistry = { list(): Array<{ id: string; name: string; pluginId: string }>; has(id: string): boolean; execute(id: string): void }`; `PresentedCommandButton = CommandButtonDefinition & { missing: boolean }`; `PresentedPopoverButton = PopoverButtonDefinition & { missingItems: string[] }`; `PresentedButton = PresentedCommandButton | PresentedPopoverButton`; `PresentedButtonBar = { buttons: PresentedButton[]; issues: ButtonBarIssue[] }`; `presentButtonBar(parsed: ParsedButtonBar, registry: CommandRegistry): PresentedButtonBar`.

- [ ] Escribir `tests/presentButtonBar.test.ts` con un `CommandRegistry` falso: `resolvesAllCommands()`, `flagsMissingCommands()`, `flagsMissingPopupItems()` y `emptyInputEmptyOutput()`.
- [ ] Ejecutar `npm test -- tests/presentButtonBar.test.ts` y verificar que FALLA.
- [ ] Implementar `presentButtonBar` en `src/domain/presentButtonBar.ts` (marca `missing`/`missingItems` con `registry.has`, añade `issues` para comandos inexistentes).
- [ ] Implementar `ObsidianCommandRegistry` en `src/data/ObsidianCommandRegistry.ts` sobre `app.commands` (`list` mapea `Object.values(app.commands.commands)`, `has` comprueba presencia, `execute` llama a `executeCommandById`).
- [ ] Ejecutar `npm test -- tests/presentButtonBar.test.ts` y `npm run typecheck`.

Esperado: los tests pasan.

- [ ] Commit como `feat: resolver comandos de la botonera contra el registro`.

## Tarea 3: Repositorio de la botonera

**Archivos:**
- Crear: `src/data/ButtonBarRepository.ts`, `tests/ButtonBarRepository.test.ts`

**Interfaces:**
- Consume: `VaultAdapter` (método `read`) y `parseButtonBarConfig`.
- Produce: `ButtonBarRepository.load(): Promise<ParsedButtonBar>`.

- [ ] Escribir `tests/ButtonBarRepository.test.ts` con un `VaultAdapter` falso: `returnsEmptyWhenFileMissing()`, `loadsValidConfig()` y `reportsInvalidJson()`.
- [ ] Ejecutar `npm test -- tests/ButtonBarRepository.test.ts` y verificar que FALLA.
- [ ] Implementar `ButtonBarRepository` en `src/data/ButtonBarRepository.ts`: recibe la ruta configurada y el adaptador; si el fichero no existe devuelve `{ buttons: [], issues: [] }`; si existe lo lee y lo pasa por `parseButtonBarConfig`.
- [ ] Ejecutar `npm test -- tests/ButtonBarRepository.test.ts` y `npm run typecheck`.

Esperado: los tests pasan.

- [ ] Commit como `feat: leer la configuración de la botonera desde el vault`.

## Tarea 4: Vista de la botonera e integración en el dashboard

**Archivos:**
- Crear: `src/ui/ButtonBarView.ts`
- Modificar: `src/ui/DashboardView.ts`, `styles.css`

**Interfaces:**
- Consume: `PresentedButtonBar` y `CommandRegistry.execute`.
- Produce: `ButtonBarView.render(container: HTMLElement, presented: PresentedButtonBar, onExecute: (id: string) => void, onOpenConfig: () => void): void`.

- [ ] Implementar `ButtonBarView` en `src/ui/ButtonBarView.ts`: fila horizontal; botón simple ejecuta su comando vía `onExecute`; popover abre un `Menu` de Obsidian con sus `items`; botones/items con comando inexistente se renderizan deshabilitados; los `issues` se muestran con una acción que llama a `onOpenConfig`.
- [ ] Integrar en `DashboardView.refresh()`: cargar `buttonBar` + `presentButtonBar` y renderizar encima de proyectos/tareas; `onExecute` delega en el `CommandRegistry`, `onOpenConfig` abre el fichero de configuración.
- [ ] Añadir estilos en `styles.css` con variables de Obsidian (fila, botones, popover, deshabilitado, issues).
- [ ] Ejecutar `npm run typecheck` y `npm run build`.

Esperado: el dashboard muestra la botonera; clic simple ejecuta; popover abre menú.

- [ ] Commit como `feat: renderizar la botonera dentro del dashboard`.

## Tarea 5: Ajustes y helper de descubrimiento de comandos

**Archivos:**
- Modificar: `src/settings.ts`, `src/ui/SettingsTab.ts`, `src/main.ts`
- Crear: `src/ui/CommandsModal.ts`

**Interfaces:**
- Produce: `PluginSettings.buttonBarFile: string` (por defecto `"DevHelper/buttons.json"`); `normalizeVaultFilePath(path: string, fallback: string): string` (recorta, `\`→`/`, colapsa `//`, rechaza absolutas y `..` devolviendo `fallback`).

- [ ] Añadir `buttonBarFile` a `PluginSettings` y a `DEFAULT_SETTINGS`; implementar `normalizeVaultFilePath` en `src/settings.ts` con los tests `normalizesFilePath()`, `rejectsAbsoluteFilePath()` y `rejectsParentTraversal()` en `tests/settings.test.ts`.
- [ ] Añadir la entrada de texto de `buttonBarFile` en `SettingsTab`.
- [ ] Implementar `CommandsModal` en `src/ui/CommandsModal.ts`: lista `registry.list()` agrupados por plugin, con clic para copiar el ID al portapapeles; registrar un comando `devhelper-dashboard:list-commands` en `main.ts` que lo abra.
- [ ] Ejecutar `npm test -- tests/settings.test.ts`, `npm run typecheck` y `npm run build`.

Esperado: la ruta se configura y normaliza; el modal lista y copia IDs.

- [ ] Commit como `feat: configurar la ruta de la botonera y listar comandos`.

## Tarea 6: Cableado final y hot reload

**Archivos:**
- Modificar: `src/main.ts`, `src/ui/DashboardView.ts`

- [ ] Instanciar `ObsidianCommandRegistry` y `ButtonBarRepository` en `main.ts` y pasarlos al `DashboardView` junto con la ruta configurada.
- [ ] Garantizar que el refresco debounced existente (`vault.on` + `metadataCache.on`) relee la botonera; no añadir un watcher duplicado.
- [ ] Verificar en el vault de prueba: editar `buttons.json` a mano (o simular edición externa) y comprobar que la botonera se actualiza sin reiniciar.
- [ ] Ejecutar `npm test`, `npm run typecheck` y `npm run build`.

Esperado: cambios externos en el fichero se reflejan al momento.

- [ ] Commit como `feat: recargar la botonera ante cambios del fichero`.

## Tarea 7: Documentar y verificar la V1

**Archivos:**
- Modificar: `README.md`

- [ ] Documentar el esquema JSON, los dos tipos de botón, la ruta configurable y el helper de comandos.
- [ ] En un vault de prueba limpio, verificar: botón simple con comando de DevHelper, de Obsidian y de otro plugin; popover con varios comandos; comando inexistente deshabilitado; JSON inválido con aviso; ids duplicados; edición externa con refresco; y el modal de comandos.
- [ ] Ejecutar `npm test`, `npm run typecheck` y `npm run build`.
- [ ] Commit como `docs: documentar la botonera y su verificación`.

## Verificación final

Ejecutar desde la raíz del proyecto:

```powershell
npm test
npm run typecheck
npm run build
git status --short
```

Esperado: todos los tests pasan, TypeScript no reporta errores, el bundle se construye y solo quedan en el árbol de trabajo los cambios intencionales.
