# Diseño: Rediseño de layout del Dashboard DevHelper

## Objetivo

Rediseñar la vista del plugin **DevHelper Dashboard** para que se parezca visualmente al
producto "DevHelper" de referencia (captura compartida): fondo oscuro, paneles claros de
esquinas redondeadas, tarjetas de tarea oscuras, columnas con secciones y controles
circulares flotantes. El objetivo de esta iteración es **solo el layout**: cada sección se
monta con su silueta visual, aunque la mayoría no tendrá datos ni lógica todavía.

La funcionalidad existente de **proyectos y tareas** (selección, creación, edición y cambio
de estado `open`/`done`) se conserva íntegra; únicamente cambia su presentación.

## Contexto y estado actual

- La V1 (8 commits, `0df6689` → `e4102dc`) ya entrega: vista propia, carpetas
  `Projects/` y `Tasks/`, creación/edición de proyectos y tareas, toggle de estado, issues
  visibles y sincronización bidireccional con el vault.
- `styles.css` ya mapea la paleta de Obsidian: `--background-primary` = canvas oscuro,
  `--background-secondary` = paneles claros, `--background-primary-alt` = tarjetas oscuras.
  Este mapeo **se conserva y se extiende**; no se reemplaza el theme.
- `DashboardView.ts` es la vista `ItemView` que posee el DOM bajo `contentEl`, el proyecto
  seleccionado (en memoria) y orquesta los modales. El render actual es lineal
  (header → sección de proyecto → issues) y se va a reorganizar en secciones.

## Alcance

### Incluye

- Reorganizar el render de `DashboardView.ts` en métodos `render*` por sección.
- Nuevo layout en dos columnas (escritorio) que colapsa a una columna en paneles estrechos.
- Secciones placeholder (silueta visual, sin datos ni lógica):
  - **Calendario semanal** (mes actual, semana Lun–Dom con hoy marcado, «No hay eventos
    este día»).
  - **Archivos** (vacío).
  - **Contraseña** (vacío).
  - **Buscador** decorativo «Pregunta sobre tu workspace… Ctrl+K».
  - **Rail de iconos** (filtro, código, ajustes, salir).
- Chips de proyecto (seleccionado claro, resto oscuros) con menú «···» (Editar / Abrir nota).
- Tarjetas de tarea con subtítulo placeholder, lápiz (editar) y círculo de estado clicable.
- Icono de **papelera deshabilitado** (decorativo) en tarjetas de tarea y secciones.
- Función pura `weekStrip` en `src/domain/` para calcular la semana actual (testeable).
- Actualizar `styles.css` y el contrato de layout de su cabecera.
- Actualizar `AGENTS.md` (regla de borrado matizada + descripción de la vista).

### Excluye

- Borrado real de proyectos/tareas/archivos/contraseñas. **Solo se añade el icono de
  papelera deshabilitado**; no se crean métodos `delete*` ni confirmaciones.
- Panel de imagen/nebulosa (descartado explícitamente por el usuario).
- Lógica de calendario (eventos), de archivos, de contraseñas o de búsqueda/IA. Son
  placeholders.
- Property `description` en las notas de tarea. El subtítulo se pinta con placeholder
  ahora; la property se añadirá en una iteración futura (ver Roadmap).
- Cambios en `src/domain/types.ts`, `parseNote.ts` o `ProjectTaskRepository.ts`. La capa de
  dominio y datos queda intacta.

## Layout objetivo

Escritorio (dos columnas, `display: grid`):

```
┌─────────────────────────────────────────────────────────────┐
│ Proyectos   [chip DevHelper ···] [chip SPOT ···]            │
│                                   [filtro] [+] [buscador …]  │
├──────────────────────────────┬──────────────────────────────┤
│ Tareas (panel claro)         │ [rail: filtro código ⚙ salir] │
│  ┌─────────────────────────┐ │  Julio  ‹ Hoy ›  [+]         │
│  │ tarjeta oscura ··· ✏️ ○ │ │  L M X J V S D  (hoy marcado) │
│  │ tarjeta oscura ··· ✏️ ● │ │  «No hay eventos este día»   │
│  └─────────────────────────┘ │                              │
│               [filtro] [+]   │                              │
├──────────────────────────────┴──────────────────────────────┤
│ Archivos        │ Contraseña                                │
│  «No hay archivos» │ «Sin contraseñas»                      │
│        [filtro] [+] │        [filtro] [+]                   │
├─────────────────────────────────────────────────────────────┤
│ (issues — solo si hay notas con problemas)                  │
└─────────────────────────────────────────────────────────────┘
```

- **Fila superior:** título «Proyectos» + chips a la izquierda; a la derecha botón filtro
  (inerte), botón **+** grande (= *Nuevo proyecto*) y el buscador decorativo.
- **Columna izquierda:** panel claro «Tareas» con tarjetas oscuras; FABs circulares
  filtro (inerte) y **+** (= *Nueva tarea*) en su borde derecho.
- **Columna derecha:** rail vertical de 4 iconos redondos inertes + tarjeta calendario.
- **Fila inferior:** «Archivos» y «Contraseña» lado a lado, vacías.
- **Issues:** se conserva a ancho completo abajo, solo si existen.
- **Responsive:** por debajo de ~640px la grilla colapsa a una columna y el rail se
  oculta; se mantiene la media query de 320px para paneles muy estrechos.

## Mapeo funcionalidad existente → nuevo look

- **Selector de proyecto** (dropdown actual) → **chips/pills**. El chip seleccionado se
  pinta claro; el resto oscuros. Clic en un chip selecciona el proyecto. El botón «···» de
  cada chip abre un menú con *Editar* (renombrar, `ProjectFormModal`) y *Abrir nota*
  (`openNote`).
- **Tarjeta de tarea:**
  - Título (clic = abrir la nota).
  - Subtítulo placeholder muted «Sin descripción» (roadmap: property `description`).
  - Acciones: 🗑 **deshabilitado** (tooltip «Disponible en una versión futura»), ✏️
    *Editar* (`TaskFormModal`), **círculo de estado clicable** = toggle `open`/`done`.
    - `open` → círculo hueco gris.
    - `done` → círculo relleno verde.
    - El círculo rojo del mock no tiene semántica en el modelo actual (solo `open`/`done`)
      y se **omite**.
- **Botones de creación** del header actual → **FABs «+»**: el de la fila superior crea
  proyecto; el del panel Tareas crea tarea.
- **Empty states** en español, idénticos a los actuales («No hay proyectos todavía…»,
  «Este proyecto aún no tiene tareas.», etc.).

## Secciones placeholder (contrato)

Cada sección placeholder cumple:

- Se dibuja con la misma silueta del mock (panel claro, encabezado, FABs filtro/+, etc.).
- Sus controles están **inertes** o **deshabilitados**: no disparan acciones ni mutaciones.
- Su contenido es un estado vacío en español (ej. «No hay archivos», «Sin contraseñas»).
- El buscador es un `<input>` deshabilitado con placeholder «Pregunta sobre tu workspace…»
  y un hint `Ctrl+K` visual (no funcional).
- El rail de iconos son botones redondos inertes con `title` descriptivo.

### Calendario

Se implementa con la función pura `weekStrip` (ver abajo) que devuelve las 7 fechas
Lun–Dom de la semana que contiene a `today` y el nombre del mes en español. La tarjeta
muestra: encabezado con el mes, controles `‹` `Hoy` `›` y `+` (inertes), cabecera de días
`L M X J V S D`, la fila de días con el día actual resaltado y el texto
«No hay eventos este día». No hay modelo de eventos.

## Función pura `weekStrip`

Nuevo módulo `src/domain/weekStrip.ts`, **sin imports de Obsidian** (testeable como el
resto de la capa de dominio):

```ts
export interface WeekDay {
  /** Día del mes (1-31). */
  day: number;
  /** 0 = lunes … 6 = domingo (ISO). */
  weekday: number;
  /** true si coincide con el día de hoy. */
  isToday: boolean;
}

export interface WeekStrip {
  /** Nombre del mes en español (ej. "Octubre"). */
  monthLabel: string;
  days: WeekDay[];
}

export function getWeekStrip(today: Date): WeekStrip;
```

Reglas:

- `today` se interpreta en fecha local.
- `days` empieza en lunes (ISO) y tiene exactamente 7 elementos.
- `isToday` es `true` exactamente para el día que coincide con `today` (mismo año/mes/día).
- `monthLabel` usa `Intl.DateTimeFormat("es-ES", { month: "long" })` (o equivalente
  determinista) sobre `today`, con la primera letra en mayúscula.
- La función es pura y determinista: mismo `today` ⇒ misma salida.

## CSS / theme

- Se conserva el mapeo de paleta actual (canvas oscuro, paneles claros, tarjetas oscuras).
- Se añaden las nuevas clases de layout (grid de dos columnas, FABs circulares, chips,
  rail de iconos, tarjeta de calendario, secciones placeholder).
- Paneles con radio ~16px, tarjetas ~10px, FABs circulares; todo con variables Obsidian.
- Se actualiza el comentario de cabecera de `styles.css` con el nuevo layout contract.
- Iconos: se usan los iconos lucide vía `setIcon()` de Obsidian (`funnel`, `plus`,
  `pencil`, `trash-2`, `code`, `settings`, `log-out`, `search`, `chevron-left`,
  `chevron-right`). **Cero assets nuevos.**

## Archivos tocados

- `src/ui/DashboardView.ts` — reescritura del bloque *Render* (métodos `render*` por
  sección). Se conservan `refresh()`, `setSelectedProjectPath()`, `onOpen()`/`onClose()` y
  los orquestadores de modales (`openCreateProject`, `openEditProject`, `openCreateTask`,
  `openEditTask`, `toggleTaskStatus`, `openNote`).
- `src/domain/weekStrip.ts` — **nuevo**.
- `tests/weekStrip.test.ts` — **nuevo**.
- `styles.css` — ampliación.
- `AGENTS.md` — matiza la regla de borrado y actualiza la descripción de `DashboardView` y
  `styles.css`.

No se tocan `src/domain/types.ts`, `src/domain/parseNote.ts`,
`src/data/ProjectTaskRepository.ts` ni los modales existentes (salvo reuso).

## Verificación

- `npm run typecheck` limpio.
- `npm test` verde: los **47 tests existentes** + los nuevos de `weekStrip` (~4).
- `npm run build` emite `main.js`.
- Prueba manual en el vault de test (`D:\proyects\devhelper-test-vault\`): comprobar
  layout en escritorio y en panel estrecho, chips, creación/edición de proyecto y tarea,
  toggle de estado vía círculo, y que los placeholders se ven pero no hacen nada.

## Roadmap (fuera de esta iteración)

- Property `description` en notas de tarea → alimenta el subtítulo real.
- Borrado real de proyectos y tareas (activa la papelera).
- Eventos del calendario, gestión de archivos y contraseñas cifradas, búsqueda/IA.
- Skills propias del sistema (ya documentadas en el spec de V1).
