# Diseño: credenciales cifradas con contraseña maestra global

## Objetivo

La sección "Contraseña" del dashboard deja de ser un placeholder inerte:
permite crear, ver, editar, borrar y copiar credenciales por proyecto,
cifradas en reposo bajo una única contraseña maestra global. El vault puede
sincronizarse o compartirse sin exponer secretos en texto plano.

Decisiones acordadas con el usuario antes del diseño: una maestra para todos
los proyectos, desbloqueo con timeout que se renueva con cada uso, olvido sin
recuperación (pérdida total, hay que empezar de cero) y CRUD completo como
MVP (crear, ver, editar, borrar, copiar).

## Alcance

### Incluye

- Formato `enc:v1:…` para los campos sensibles dentro de `Credenciales.md`
  (el Markdown sigue siendo la única fuente de verdad).
- Módulo puro de criptografía (`src/domain/credentialsCrypto.ts`) con
  WebCrypto (AES-GCM + PBKDF2), sin dependencias nuevas.
- Sesión de clave en memoria del plugin (nunca en disco) con timeout
  configurable y bloqueo manual.
- Primera creación de la maestra, desbloqueo, verificación y restablecimiento.
- Mutaciones del repositorio: `createCredential`, `updateCredential`,
  `deleteCredential`, todas atómicas vía `processFrontMatter`.
- UI completa de la sección "Contraseña": estados sin-maestra / bloqueado /
  desbloqueado, `CredentialFormModal`, copiar al portapapeles, cuenta atrás,
  botón de bloqueo y banner de migración del plano actual.
- Migración en un clic de las entradas actuales en texto plano a cifradas.
- Tests nuevos (`credentialsCrypto`, parser con `enc:`, CRUD del repositorio)
  y actualización de `AGENTS.md` (la regla "data.json solo carpetas" se
  amplía: también guarda salt, verificador y timeout — ninguno es secreto;
  la clave derivada jamás se persiste).

### Excluye

- Cambio de contraseña maestra (re-cifrar todo el vault): queda en roadmap.
- Cifrado del nombre `service` (queda en claro para listar con el candado
  puesto) y de `Archivos/`.
- Integración con el llavero del SO o biometría.
- Límite de intentos o retardo ante maestra incorrecta (el vault local ya
  implica acceso al dispositivo; el cifrado protege sincronización y
  compartición, no el dispositivo abierto).
- Borrado de proyectos (sigue fuera de alcance como hasta ahora).

## Formato de almacenamiento

`Credenciales.md` conserva su forma (`type: credentials` + lista
`credentials`). Cambia solo el valor de los campos sensibles:

```yaml
---
type: credentials
credentials:
  - service: Hosting
    user: "enc:v1:7f3a…:9c2e…"
    password: "enc:v1:41bd…:ff90…"
    url: "enc:v1:…:…"
    notes: cuenta principal
---
```

Reglas:

- `service` **siempre en claro** (permite listar y buscar sin desbloquear).
- `user` y `password` **siempre cifrados** en entradas nuevas.
- `url` y `notes`: se cifran si tienen contenido; vacío ausente se deja vacío.
- Campos extra del usuario: si su valor empieza por `enc:v1:` se trata como
  cifrado; si no, se preserva tal cual sin tocarlo.
- Blob: `enc:v1:<base64-iv-12-bytes>:<base64-ciphertext>`. Versión `v1`
  explícita para poder rotar el formato en el futuro.
- KDF: PBKDF2-SHA256, 210 000 iteraciones, salt aleatorio de 16 bytes,
  **uno por vault** (no por entrada). AES-GCM 256 con IV aleatorio de 12
  bytes por campo.
- `data.json` guarda tres claves nuevas: `credSaltB64` (salt global en
  base64, no secreto), `credVerifier` (cifrado AES-GCM del literal
  `devhelper-ok` con IV aleatorio; desbloquear = descifrar y comparar) y
  `credentialLockTimeoutMinutes` (defecto `15`).

## Módulo de criptografía

Nuevo `src/domain/credentialsCrypto.ts`, puro y sin imports de Obsidian
(testeable con el WebCrypto de Node):

```ts
export const ENCRYPTED_PREFIX = "enc:v1:";
export function isEncryptedValue(v: unknown): boolean;
export async function createSaltB64(): Promise<string>;
export async function deriveKey(password: string, saltB64: string): Promise<CryptoKey>;
export async function encryptField(key: CryptoKey, plain: string): Promise<string>;
export async function decryptField(key: CryptoKey, blob: string): Promise<string>; // lanza si falla
export async function createVerifier(key: CryptoKey): Promise<string>;
export async function checkVerifier(key: CryptoKey, verifier: string): Promise<boolean>;
export function decryptEntryForDisplay(entry: CredentialEntry, key: CryptoKey | null): CredentialDisplay;
```

`decryptEntryForDisplay` devuelve los campos descifrados cuando hay clave y
`null` en cada campo sensible cuando no la hay; nunca lanza (un blob corrupto
marca la entrada como `corrupt: true` en vez de tumbar el panel).

## Sesión de clave

La sesión vive en la instancia del plugin (`main.ts`), en memoria:

- `unlock(password)`: deriva con el salt guardado, comprueba el verificador;
  si falla, error `"Contraseña incorrecta."` sin pista adicional.
- Estado: `{ key: CryptoKey | null, expiresAt: number }`. Cada operación con
  credenciales (`touch()`) renueva `expiresAt = ahora + timeout`.
- Al expirar el timer o con "Bloquear ahora": la clave se pone a `null`
  (la `CryptoKey` no es exportable; basta con soltar la referencia) y la vista
  se refresca al estado bloqueado.
- Si un modal de edición sigue abierto al expirar, conserva su texto; al
  guardar pide desbloquear de nuevo en vez de perder datos.

## Parser y tipos

- `validateCredentialEntry` acepta en `user`/`password` o bien cadena no
  vacía en claro (legado) o bien blob `enc:v1:` bien formado (dos segmentos
  base64). `service` sigue exigiendo texto en claro no vacío.
- Las entradas en claro siguen siendo válidas (no rompen el dashboard) pero
  el repositorio marca el registro con `needsMigration: true` cuando alguna
  entrada tiene `password` sin cifrar, para mostrar el banner de migración.
- `CredentialsRecord` gana `needsMigration: boolean`. `CredentialEntry`
  no cambia de forma (sus valores pueden ser blobs `enc:`).

## Repositorio

Tres mutaciones nuevas, todas con clave desbloqueada obligatoria (si es
`null`, lanzan `Error("Desbloquea las credenciales primero.")`) y todas vía
`processFrontMatter` (nunca leer y reescribir el archivo):

- `createCredential(projectPath, input, key)`: añade la entrada cifrada a la
  lista de `Credenciales.md` del proyecto.
- `updateCredential(projectPath, index, input, key)`: sustituye la entrada
  `index` (identificada por posición + `service`, con confirmación si el
  `service` cambió bajo los pies por edición externa).
- `deleteCredential(projectPath, index)`: elimina la entrada tras la
  confirmación de la UI.
- `migratePlaintextCredentials(projectPath, key)`: cifra in situ cada campo
  sensible en claro del proyecto.

`load()` no cambia de firma: sigue devolviendo las entradas tal como están
guardadas; descifrar para mostrar es trabajo de la vista con
`decryptEntryForDisplay`.

## Interfaz

La sección "Contraseña" pasa de placeholder a cuatro estados:

1. **Sin maestra** (primera vez): "Protege tus contraseñas con una contraseña
   maestra" + botón "Crear contraseña maestra" → modal con doble campo y
   mínimo de 8 caracteres. Al crear: genera salt + verificador, los guarda en
   `data.json` y deja la sesión desbloqueada.
2. **Bloqueado**: lista de `service` por proyecto (solo nombres) + botón
   "Desbloquear" → modal de contraseña. Error genérico si falla.
3. **Desbloqueado**: filas completas con mostrar/ocultar, copiar usuario y
   copiar contraseña (`navigator.clipboard`), crear (`CredentialFormModal` con
   `service/user/password/url/notes`), editar, borrar (con confirmación),
   badge "Desbloqueado · se bloquea en N min" y botón "Bloquear ahora".
4. **Banner de migración**: si `needsMigration`, "Tienes X credenciales sin
   cifrar — Cifrar ahora".

Ajustes: campo numérico "Bloqueo de credenciales (minutos)" ligado a
`credentialLockTimeoutMinutes`. El restablecimiento por olvido vive en la
propia sección (zona de peligro): "Olvidé mi contraseña" → explica la pérdida
total → borra salt + verificador y ofrece borrar los blobs ilegibles para
empezar de cero. Textos siempre en español.

## Fallos y validación

- Maestra incorrecta: `"Contraseña incorrecta."` (sin contar intentos).
- Blob corrupto o truncado: la entrada se muestra como
  `"No se pudo descifrar esta entrada (datos corruptos)."` y no bloquea el
  resto; además genera issue sobre `Credenciales.md` con la ruta.
- Maestra demasiado corta al crear: `"La contraseña debe tener al menos 8 caracteres."`
- Confirmación distinta al crear: `"Las contraseñas no coinciden."`
- Operación sin desbloqueo (condición de carrera): `"Desbloquea las credenciales primero."`
- `data.json` con `credSaltB64` pero sin `credVerifier` (o viceversa):
  estado "configuración incompleta" que obliga a restablecer antes de operar.

## Criterios de aceptación

1. Crear la maestra guarda solo salt + verificador en `data.json` (nada
   sensible) y deja la sesión abierta.
2. Crear una credencial escribe `user/password` como `enc:v1:…` y `service`
   en claro; el cuerpo y las props personalizadas de la nota se preservan.
3. Con la sesión bloqueada solo se ven los nombres de servicio; ningún secreto
   aparece en el DOM.
4. Desbloquear con maestra incorrecta falla con mensaje genérico y sin dejar
   rastro de clave.
5. Pasado el timeout sin uso, la vista vuelve sola al estado bloqueado.
6. Copiar, editar y borrar funcionan desbloqueado; borrar pide confirmación.
7. El banner migra las entradas en plano a cifradas sin duplicar ni perder
   campos extra.
8. Olvidar la maestra + restablecer deja el plugin operativo desde cero.
9. `npm run typecheck`, `npm test` y `npm run build` terminan en verde.

## Verificación

- Suites nuevas/actualizadas: `tests/credentialsCrypto.test.ts` (round-trip,
  verificador ok/ko, blob corrupto, formato), `parseNote` (entradas `enc:`,
  mixtas con `needsMigration`), `ProjectTaskRepository` (CRUD cifrado con
  crypto real sobre el adapter falso en memoria) y ajustes (timeout por
  defecto `15`).
- Manual en el vault de prueba: crear maestra, crear credencial, bloquear,
  comprobar `Credenciales.md` en el explorador (solo `service` legible),
  timeout con cronómetro corto (p. ej. 1 min temporal), migración de una
  entrada escrita a mano en plano, restablecimiento por olvido.

## Roadmap

- Cambio de contraseña maestra (re-cifrar todo con nuevo salt).
- Límite de intentos / retardo progresivo.
- Búsqueda de servicios sin desbloquear (ya posible por `service` en claro).
