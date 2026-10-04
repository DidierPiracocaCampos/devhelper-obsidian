# Diseño: Dashboard de proyectos y tareas para Obsidian

## Objetivo

Crear la primera versión de un plugin de Obsidian que permita visualizar y gestionar proyectos y tareas desde una vista tipo dashboard. Debe funcionar en un vault nuevo y dejar los archivos Markdown del vault como única fuente de verdad.

El plugin aspira a publicarse en la tienda de Obsidian. La arquitectura inicial debe ser pequeña y compatible con una evolución por versiones, sin incluir prematuramente las funciones futuras.

## Alcance de la V1

### Incluye

- Vista propia del plugin, accesible mediante un comando y un botón de Obsidian.
- Carpetas predeterminadas `Projects/` y `Tasks/`, configurables desde los ajustes.
- Creación de proyectos y tareas enlazadas a un proyecto.
- Visualización de tareas por proyecto y de las tareas pendientes.
- Cambio del estado de una tarea entre `open` y `done`.
- Edición de proyectos y tareas; no se incluirá borrado en esta versión.
- Sincronización en ambas direcciones: cambios hechos en las notas Markdown deben reflejarse en el dashboard, y las ediciones desde el dashboard deben actualizar las notas.
- Errores visibles en el dashboard cuando una nota de las carpetas administradas tenga formato inválido o incumpla el esquema requerido. El aviso debe explicar el problema y permitir abrir la nota para corregirla.

### Excluye

Calendario, manejo de archivos, contraseñas cifradas, funciones de IA o skills para modelos, plantillas de vault y borrado de proyectos/tareas. Estas funciones podrán evaluarse en versiones posteriores.

## Datos y formato Markdown

Las notas Markdown son la fuente de verdad. El plugin no mantendrá una base de datos paralela de proyectos o tareas. Los datos privados del plugin se limitarán a preferencias, como las rutas de las carpetas.

El plugin administrará estas Properties nativas de Obsidian:

- Proyecto: `type: project`.
- Tarea: `type: task`, `project` con un wikilink al proyecto y `status` con valor `open` o `done`.

Las demás Properties y el cuerpo Markdown son propiedad del usuario y deben conservarse al editar. El título mostrado corresponde al nombre de la nota; cambiarlo desde el dashboard renombra el archivo usando las operaciones de Obsidian. El enlace de la tarea y su estado se editan como Properties. Los cambios hechos directamente en las notas se reflejan en la vista.

El plugin solo administra notas encontradas en las carpetas configuradas. Una nota mal formada no debe causar que falle todo el dashboard ni ser descartada silenciosamente: se presenta como error local y se ofrece abrirla.

## Interfaz

La estética toma como referencia el diseño compartido: fondo oscuro, paneles claros de esquinas redondeadas, tarjetas de tareas oscuras y controles visibles. La V1 muestra la selección/lista de proyectos y las tareas del proyecto elegido. La vista debe adaptarse al ancho disponible y usar los colores del tema activo de Obsidian.

La edición se inicia desde un control visible en el dashboard. No habrá controles de borrado. La experiencia debe seguir siendo utilizable en paneles estrechos y en una vista amplia.

## Arquitectura y flujo

- El plugin registra la vista propia, el comando, el botón y una pantalla de ajustes.
- La vista presenta proyectos, tareas, estados y errores, y recibe las acciones del usuario.
- Un servicio de acceso al vault localiza, valida, crea y modifica las notas Markdown.
- La lectura se basa en los archivos del vault y sus Properties. Los cambios del vault actualizan el dashboard.
- Las escrituras deben modificar solo el nombre de archivo o las Properties administradas, sin reemplazar el cuerpo Markdown ni borrar Properties personalizadas.
- Los ajustes de carpetas sí pueden persistirse en la configuración del plugin; proyectos y tareas no.

## Fallos y validación

La validación detectará, como mínimo, YAML/frontmatter inválido, Properties requeridas ausentes o con valores no admitidos y relaciones de proyecto que no puedan resolverse. El dashboard mostrará el nombre/ruta de la nota, el motivo y una acción para abrirla. El resto de proyectos y tareas válidos seguirá disponible.

## Criterios de aceptación

1. El plugin puede instalarse y abrirse en un vault nuevo sin template ni estructura previa.
2. Se pueden crear un proyecto y una tarea enlazada, y sus datos quedan en notas Markdown dentro de las carpetas configuradas.
3. El dashboard refleja el cambio de estado `open`/`done` y agrupa las tareas por proyecto.
4. Un cambio manual en Properties o el renombrado de una nota se refleja en el dashboard sin reiniciar Obsidian.
5. Editar desde el dashboard conserva el cuerpo Markdown y Properties personalizadas.
6. Una nota inválida genera un aviso local con acceso para abrir y corregir la nota; no impide usar el resto del dashboard.
7. La presentación mantiene la dirección visual acordada y se adapta a diferentes anchos y temas de Obsidian.

## Verificación

Probar el flujo en un vault vacío; creación y enlace de notas; edición y cambio de estado; cambios manuales desde Markdown; conservación del contenido y Properties personalizadas; propiedades ausentes o inválidas; relaciones rotas; y vista en anchos estrechos y amplios. Añadir pruebas automatizadas para la validación y las operaciones de lectura/escritura cuando la estructura del plugin lo permita.
