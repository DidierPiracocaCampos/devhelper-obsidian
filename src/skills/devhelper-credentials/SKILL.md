---
name: devhelper-credentials
description: Listar, contar y razonar sobre credenciales cifradas (`type: credentials`) en este vault. La IA nunca escribe secretos en claro cuando hay maestra fijada: delega al plugin. Usa cuando el usuario pida consultar o crear credenciales.
---

# devhelper-credentials

## Cuándo me invocan

- «Lista las credenciales del proyecto X» (sólo `service`).
- «¿Hay credenciales en claro?» (comprobar `needsMigration`).
- «Migra las credenciales del proyecto X» (delegar al plugin).

## Modelo de datos

- Ruta: `<projectsFolder>/<proyecto>/Credenciales.md`.
- Props mínimas:

  ```yaml
  ---
  type: credentials
  credentials: []
  ---
  ```

- `service` siempre en claro (clave de búsqueda).
- `user`, `password`, `url`, `notes` siempre cifrados con prefijo `enc:v1:<iv-b64>:<cipher-b64>` cuando hay maestra.
- Entradas heredadas en claro se marcan con `needsMigration: true` a nivel de nota.

## Detección de maestra

Antes de **cualquier** operación de escritura:

```bash
obsidian eval 'JSON.stringify({
  salt: !!app.plugins.plugins["devhelper-dashboard"].settings.credSaltB64,
  verifier: !!app.plugins.plugins["devhelper-dashboard"].settings.credVerifier
})'
```

- `salt && verifier === true` → **maestra activa**. La IA **NO** puede crear/editar credenciales. Devolver:

  > El vault tiene maestra fijada. Para crear o editar credenciales, desbloquéala desde el dashboard y usa el modal del plugin. Yo puedo seguir listando `service`.

- `salt && verifier === false` → **sin maestra**. Si el usuario pide crear la primera credencial, instruirle a fijar la maestra desde el dashboard primero. La IA sólo asiste con la lista `service` hasta entonces.

## Receta: listar `service` por proyecto

```bash
obsidian read path="<projectsFolder>/<proyecto>/Credenciales.md"
```

Devolver sólo los valores `service:` (líneas que estén dentro de `credentials:`).
No devolver valores `user`, `password`, `url` ni `notes`, estén en claro o cifrados.

## Receta: contar entradas en claro

```bash
obsidian read path="<projectsFolder>/<proyecto>/Credenciales.md" | Select-String "service:|user:|password:"
```

Contar entradas cuya `user:` o `password:` **no** empiece por `enc:v1:`. Si el contador > 0, hay migración pendiente.

## Receta: migración a cifrado

**Delegar al plugin.** Indicar al usuario:

> Hay N credenciales en claro. Púlsa el botón «Migrar al cifrado» del dashboard para que el plugin las cifre en un solo paso.

Si la IA intenta generar `enc:v1:` a mano, **fallará el descifrado**.

## Lo que NO debe hacer

- **Nunca** escribir `user:`, `password:`, `url:` o `notes:` en claro si hay maestra.
- **Nunca** generar `enc:v1:` a mano: el plugin cifra con su clave maestra en memoria y la IA no la tiene.
- **Nunca** borrar una credencial desde la IA: pedir al usuario que la elimine desde el dashboard.
- **Nunca** devolver valores de `user` o `password`, estén cifrados o no.

## Errores comunes

- Crear credencial en claro bajo maestra → la nota parsea pero queda marcada como `needsMigration` y los secretos quedan expuestos.
- Confundir `[[Projects/General/Credenciales]]` con la credencial del usuario normal: `devhelper-general` describe cuándo General aloja credenciales compartidas.

## Ejemplos YAML

Válido:

```yaml
---
type: credentials
credentials:
  - service: Hosting
    user: "enc:v1:<iv>:<cipher>"
    password: "enc:v1:<iv>:<cipher>"
    url: "enc:v1:<iv>:<cipher>"
---
```

Válido con migración pendiente (`needsMigration` la marca el plugin al parsear
entradas en claro; la IA no la escribe):

```yaml
---
type: credentials
needsMigration: true
credentials:
  - service: Hosting
    user: admin
    password: "enc:v1:<iv>:<cipher>"
---
```
