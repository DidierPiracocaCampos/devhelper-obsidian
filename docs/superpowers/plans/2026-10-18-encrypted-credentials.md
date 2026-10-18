# Encrypted Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Credenciales por proyecto cifradas en reposo bajo una maestra global, con CRUD completo en la sección "Contraseña".

**Architecture:** Un módulo puro de criptografía (WebCrypto AES-GCM + PBKDF2, sin dependencias) + una sesión en memoria con timeout en el plugin + tres mutaciones atómicas en el repositorio + la sección "Contraseña" real con sus cuatro estados. El parser acepta blobs `enc:v1:` sin descifrar; descifrar para mostrar es trabajo de la vista.

**Tech Stack:** TypeScript, WebCrypto (`crypto.subtle`, disponible en Obsidian/Electron y en Node ≥ 18 para Vitest), Obsidian Plugin API, esbuild, Vitest, `js-yaml`.

**Spec:** `docs/superpowers/specs/2026-10-18-encrypted-credentials-design.md`

## Global Constraints

- Las notas Markdown son la única fuente de verdad; la clave derivada vive solo en memoria, nunca en disco.
- Toda mutación de credenciales es atómica vía `processFrontMatter`; prohibido leer y reescribir archivos completos; cuerpo y props del usuario se preservan.
- `service` siempre en claro; `user`/`password` siempre cifrados en entradas nuevas; `url`/`notes` se cifran si tienen contenido.
- Blob: `enc:v1:<base64-iv-12-bytes>:<base64-ciphertext>`; KDF PBKDF2-SHA256 210 000 iteraciones, salt global de 16 bytes en base64.
- Todo el texto nuevo de UI, issues y errores en español.
- Los tests no usan mocks: crypto real sobre el `VaultAdapter` falso en memoria.
- Tras cada tarea: `npm run typecheck` y `npm test` en verde antes del commit.

## Review Focus

- Maestra incorrecta: `unlock()` rechaza con `"Contraseña incorrecta."` y no deja clave a medio derivar → test `wrongPasswordLeavesSessionLocked()` (Tarea 4).
- Blob corrupto o truncado en una entrada: esa entrada se marca corrupta y el resto del panel se renderiza → test `corruptBlobMarksEntryWithoutThrowing()` (Tarea 2) + parser lo trata como issue sin tumbar la nota (Tarea 3).
- La sesión expira entre abrir el modal de edición y guardar: el texto del modal se conserva y guardar pide desbloquear de nuevo en vez de perder datos → test `expiredSessionThrowsUnlockFirstOnSave()` a nivel repositorio con clave `null` (Tarea 5).
- Edición externa cambia el `service` mientras el modal está abierto: `updateCredential` detecta el conflicto por posición + `service` y lanza en vez de sobrescribir la entrada equivocada → test `updateCredentialDetectsServiceMismatch()` (Tarea 5).
- `data.json` con `credSaltB64` pero sin `credVerifier` (o viceversa): la vista muestra "configuración incompleta" y obliga a restablecer antes de operar → test `incompleteStoredConfigForcesReset()` (Tarea 4).

---

## Mapa de archivos

- `src/settings.ts`, `src/ui/SettingsTab.ts`, `tests/settings.test.ts`: `credentialLockTimeoutMinutes` (defecto `15`) + internos `credSaltB64?`, `credVerifier?`.
- `src/domain/credentialsCrypto.ts` *(nuevo)*, `tests/credentialsCrypto.test.ts` *(nuevo)*: constantes, base64, KDF, cifrado por campo, verificador, `decryptEntryForDisplay`.
- `src/domain/types.ts`: `CredentialsRecord` gana `needsMigration: boolean`; nuevo `CredentialDisplay`.
- `src/domain/parseNote.ts`, `tests/parseNote.test.ts`: `user`/`password` aceptan blob `enc:v1:` bien formado; el claro heredado sigue válido.
- `src/data/CredentialSession.ts` *(nuevo)*: clave en memoria, timeout con timer, `unlock`/`lock`/`touch`.
- `src/data/ProjectTaskRepository.ts`, `tests/ProjectTaskRepository.test.ts`: `createCredential`, `updateCredential`, `deleteCredential`, `migratePlaintextCredentials`; `load()` calcula `needsMigration`.
- `src/ui/CredentialFormModal.ts` *(nuevo)*: modal crear/editar con mostrar/ocultar.
- `src/ui/DashboardView.ts`, `styles.css`: sección "Contraseña" real (4 estados), copiar, badge de cuenta atrás, bloqueo manual, banner de migración.
- `src/main.ts`: la instancia del plugin posee la `CredentialSession` y la pasa a la vista.
- `docs/superpowers/specs/2026-10-18-encrypted-credentials-design.md`: ya existe, no se toca.
- `AGENTS.md`: ampliar la regla de `data.json` (salt + verificador + timeout).
- `D:\proyects\devhelper-test-vault\`: verificación manual + `npm run update:test-vault` (no se commitea).

## Tarea 1: Ajustes (timeout + material de clave)

**Files:**
- Modify: `src/settings.ts`
- Modify: `src/ui/SettingsTab.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `PluginSettings` con `credentialLockTimeoutMinutes: number; credSaltB64?: string; credVerifier?: string`. `DEFAULT_SETTINGS` con `credentialLockTimeoutMinutes: 15` y sin salt ni verificador.

```ts
// settings.ts
export interface PluginSettings {
  projectsFolder: string;
  templatesFolder: string;
  credentialLockTimeoutMinutes: number;
  credSaltB64?: string;
  credVerifier?: string;
}
```

- [ ] **Step 1: Write the failing test.** En `tests/settings.test.ts` añadir `defaultsCredentialTimeoutTo15()` (espera `DEFAULT_SETTINGS.credentialLockTimeoutMinutes === 15` y `credSaltB64`/`credVerifier` `undefined`) y `normalizeVaultFolderPath` intacto.
- [ ] **Step 2: Run test to verify it fails.** Run: `npm test -- tests/settings.test.ts`. Expected: FAIL en el nuevo test.
- [ ] **Step 3: Implement.** Añadir los tres campos a `PluginSettings` y el default `15` a `DEFAULT_SETTINGS` en `src/settings.ts`. En `SettingsTab.ts` añadir campo numérico «Bloqueo de credenciales (minutos)» que persiste vía `plugin.saveData()`.
- [ ] **Step 4: Run tests.** Run: `npm test -- tests/settings.test.ts` y `npm run typecheck`. Expected: PASS, typecheck limpio.
- [ ] **Step 5: Commit.** `git add src/settings.ts src/ui/SettingsTab.ts tests/settings.test.ts; git commit -m "feat: ajustes de timeout y material de clave de credenciales"`

## Tarea 2: Módulo puro de criptografía

**Files:**
- Create: `src/domain/credentialsCrypto.ts`
- Test: `tests/credentialsCrypto.test.ts`

**Interfaces:**
- Consumes: `CredentialEntry` de `src/domain/types.ts` (solo como tipo).
- Produces (nombres exactos que usan Tareas 4–6):

```ts
export const ENCRYPTED_PREFIX = "enc:v1:";
export const VERIFIER_PLAINTEXT = "devhelper-ok";
export function isEncryptedValue(v: unknown): boolean;
export function toBase64(bytes: Uint8Array): string;
export function fromBase64(s: string): Uint8Array;
export async function createSaltB64(): Promise<string>;           // 16 bytes aleatorios
export async function deriveKey(password: string, saltB64: string): Promise<CryptoKey>; // PBKDF2-SHA256 210k → AES-GCM 256
export async function encryptField(key: CryptoKey, plain: string): Promise<string>;     // enc:v1:iv:cipher
export async function decryptField(key: CryptoKey, blob: string): Promise<string>;      // lanza Error("No se pudo descifrar…") si falla
export async function createVerifier(key: CryptoKey): Promise<string>;
export async function checkVerifier(key: CryptoKey, verifier: string): Promise<boolean>;
export interface CredentialDisplay { service: string; user: string | null; password: string | null; url: string | null; notes: string | null; corrupt: boolean; }
export async function decryptEntryForDisplay(entry: CredentialEntry, key: CryptoKey | null): Promise<CredentialDisplay>; // nunca lanza
```

`decryptEntryForDisplay` con `key === null` devuelve todo `null` y `corrupt: false`; con clave, descifra cada blob y en claro devuelve el valor tal cual; cualquier fallo de descifrado → `corrupt: true` (resto de campos lo mejor posible, nunca lanza).

- [ ] **Step 1: Write the failing tests.** `roundTripEncryptDecrypt()`, `samePlaintextProducesDifferentBlobs()` (IV aleatorio), `isEncryptedValueDetectsPrefix()`, `wrongKeyFailsCheckVerifier()`, `corruptBlobMarksEntryWithoutThrowing()` (blob truncado → `corrupt: true`, sin throw), `nullKeyReturnsMaskedDisplay()`.
- [ ] **Step 2: Run tests to verify they fail.** Run: `npm test -- tests/credentialsCrypto.test.ts`. Expected: FAIL (módulo no existe; `globalThis.crypto.subtle` debe existir en Node — si Vitest no lo expone, este paso lo revela y se fija con `Object.assign(globalThis, { crypto: webcrypto })` desde `node:crypto` en el propio test).
- [ ] **Step 3: Implement** `src/domain/credentialsCrypto.ts` con las firmas de arriba (AES-GCM 256, IV 12 bytes por campo, PBKDF2-SHA256 210 000 iteraciones).
- [ ] **Step 4: Run tests.** Run: `npm test -- tests/credentialsCrypto.test.ts`, `npm test` y `npm run typecheck`. Expected: todo PASS.
- [ ] **Step 5: Commit.** `git add src/domain/credentialsCrypto.ts tests/credentialsCrypto.test.ts; git commit -m "feat: módulo puro de cifrado de credenciales"`

## Tarea 3: Parser acepta `enc:` y tipos con `needsMigration`

**Files:**
- Modify: `src/domain/types.ts`, `src/domain/parseNote.ts`
- Test: `tests/parseNote.test.ts`

**Interfaces:**
- Consumes: `isEncryptedValue` de la Tarea 2.
- Produces: `CredentialsRecord { path; entries; projectPath; needsMigration: boolean }` y nuevo `CredentialDisplay` (definido en Tarea 2). `parseCredentialsNote` sin cambios de firma.

Reglas del validador: `service` exige texto en claro no vacío (un blob `enc:` en `service` es issue). `user`/`password`: o cadena no vacía en claro (legado, válido) o blob con `isEncryptedValue(v)` y dos segmentos base64 no vacíos; otra cosa es issue de la entrada. `url`/`notes`: cadena, blob válido o ausente.

- [ ] **Step 1: Write the failing tests.** `parsesEncryptedCredentials()` (user/password como `enc:v1:…` válidos, la nota parsea sin issues), `reportsMalformedEncryptedBlob()` (`enc:v1:xxx` de un solo segmento → issue de esa entrada), `reportsEncryptedServiceAsIssue()` y `legacyPlaintextStillParses()` (entrada en claro completa → válida).
- [ ] **Step 2: Run tests to verify they fail.** Run: `npm test -- tests/parseNote.test.ts`. Expected: FAIL en los nuevos.
- [ ] **Step 3: Implement.** Relajar `validateCredentialEntry` según las reglas; añadir `needsMigration: boolean` a `CredentialsRecord` en `types.ts` (el repositorio lo calculará en la Tarea 5; el parser no lo fija).
- [ ] **Step 4: Run tests.** Run: `npm test -- tests/parseNote.test.ts`, `npm test` y `npm run typecheck`. Expected: PASS (los fixtures viejos en claro siguen verdes).
- [ ] **Step 5: Commit.** `git add src/domain/parseNote.ts src/domain/types.ts tests/parseNote.test.ts; git commit -m "feat: parser acepta credenciales cifradas"`

## Tarea 4: Sesión en memoria con timeout

**Files:**
- Create: `src/data/CredentialSession.ts`
- Test: `tests/CredentialSession.test.ts` *(nuevo)*

**Interfaces:**
- Consumes: `deriveKey`, `checkVerifier` de la Tarea 2.
- Produces:

```ts
export class CredentialSession {
  constructor(timeoutMinutes: number);
  isUnlocked(): boolean;
  getKey(): CryptoKey | null;
  msUntilLock(): number;
  setTimeoutMinutes(m: number): void;
  touch(): void;
  lock(): void;
  unlock(password: string, saltB64: string, verifier: string): Promise<void>; // lanza Error("Contraseña incorrecta.")
}
```

Timer con `ReturnType<typeof setTimeout>` (válido en Electron y en Node bajo Vitest). `unlock` deriva y verifica; si `checkVerifier` es falso, lanza y deja la sesión bloqueada. `touch` solo renueva si hay clave. `setTimeoutMinutes` reprograma el timer si hay sesión abierta.

- [ ] **Step 1: Write the failing tests.** `unlockWithCorrectPasswordOpensSession()`, `wrongPasswordLeavesSessionLocked()` (lanza `"Contraseña incorrecta."`, `isUnlocked() === false`), `lockClearsKey()`, `touchRenewsExpiry()`, `incompleteStoredConfigForcesReset()` (verifier de otro salt → unlock falla), y `expiryRelocksSession()` con timeout de `1/60000` de minuto aprox. o manipulando el timer con `vi.useFakeTimers()`.
- [ ] **Step 2: Run tests to verify they fail.** Run: `npm test -- tests/CredentialSession.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/data/CredentialSession.ts` con las firmas de arriba.
- [ ] **Step 4: Run tests.** Run: `npm test -- tests/CredentialSession.test.ts`, `npm test` y `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/data/CredentialSession.ts tests/CredentialSession.test.ts; git commit -m "feat: sesión en memoria de la clave maestra con timeout"`

## Tarea 5: Mutaciones del repositorio

**Files:**
- Modify: `src/data/ProjectTaskRepository.ts`
- Test: `tests/ProjectTaskRepository.test.ts`

**Interfaces:**
- Consumes: `encryptField`, `isEncryptedValue` (Tarea 2); `CredentialSession` solo la usa la vista, no el repositorio.
- Produces:

```ts
export interface CredentialInput { service: string; user: string; password: string; url?: string; notes?: string; }
async createCredential(projectPath: string, input: CredentialInput, key: CryptoKey | null): Promise<void>;
async updateCredential(projectPath: string, index: number, expectedService: string, input: CredentialInput, key: CryptoKey | null): Promise<void>;
async deleteCredential(projectPath: string, index: number): Promise<void>;
async migratePlaintextCredentials(projectPath: string, key: CryptoKey | null): Promise<number>;
```

Guardas comunes: `key === null` → `Error("Desbloquea las credenciales primero.")`. `service` vacío tras trim → `Error("El servicio no puede estar vacío.")`. Todo cambio vía `processFrontMatter` sobre la lista `credentials` de la `Credenciales.md` del proyecto (carpeta = directorio padre de `projectPath`); `service` en claro, `user`/`password` cifrados, `url`/`notes` cifrados si no vacíos. `updateCredential` lanza `Error("La credencial cambió mientras la editabas.")` si `entries[index]?.service !== expectedService`. `deleteCredential` elimina por índice (la confirmación la pone la UI). `migratePlaintextCredentials` cifra in situ cada campo sensible en claro y devuelve el nº de entradas migradas. `load()` fija `needsMigration: true` cuando alguna entrada tiene `password` en claro.

- [ ] **Step 1: Write the failing tests.** `createCredentialStoresEncryptedFields()` (password guardado empieza por `enc:v1:`, `service` en claro, cuerpo preservado), `createCredentialRequiresUnlockedKey()` (= `expiredSessionThrowsUnlockFirstOnSave()`: clave `null` → lanza `"Desbloquea las credenciales primero."`), `updateCredentialReplacesEntry()`, `updateCredentialDetectsServiceMismatch()`, `deleteCredentialRemovesEntry()`, `migratePlaintextCredentialsEncryptsLegacy()` (devuelve count, campos extra preservados).
- [ ] **Step 2: Run tests to verify they fail.** Run: `npm test -- tests/ProjectTaskRepository.test.ts`. Expected: FAIL en los nuevos.
- [ ] **Step 3: Implement** las cuatro mutaciones + `needsMigration` en `load()`, reutilizando `folderOf`/`processFrontMatter` existentes.
- [ ] **Step 4: Run tests.** Run: `npm test -- tests/ProjectTaskRepository.test.ts`, `npm test` y `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/data/ProjectTaskRepository.ts tests/ProjectTaskRepository.test.ts; git commit -m "feat: CRUD cifrado de credenciales en el repositorio"`

## Tarea 6: UI de la sección "Contraseña"

**Files:**
- Create: `src/ui/CredentialFormModal.ts`
- Modify: `src/ui/DashboardView.ts`, `src/ui/SettingsTab.ts` (ya tocado en Tarea 1 solo si falta el campo), `src/main.ts`, `styles.css`

**Interfaces:**
- Consumes: `CredentialSession` (Tarea 4, propiedad de la instancia del plugin, pasada a la vista), `decryptEntryForDisplay` (Tarea 2), mutaciones (Tarea 5).
- Produces: cuatro estados de la sección según `credSaltB64`/`credVerifier` + `session.isUnlocked()` + `needsMigration`. Sin tests unitarios (el repo no tiene infra de tests de UI; verificación = typecheck + build + manual en Tarea 7).

`CredentialFormModal`: `obsidian.Modal` con campos servicio, usuario, contraseña (con mostrar/ocultar), url, notas; validación inline en español; `mode: "create" | "edit"` con `defaultValue?: CredentialDisplay` y `onSubmit(input: CredentialInput)`.

Estados en `renderCredentialsSection` (sustituye el placeholder `renderBottomSections` solo para "Contraseña"; "Archivos" queda intacto):
1. Sin `credSaltB64`/`credVerifier`: texto + «Crear contraseña maestra» (doble campo, mínimo 8, `"Las contraseñas no coinciden."`); al crear genera salt + verificador, `saveData()` y desbloquea.
2. Bloqueado: nombres de `service` + «Desbloquear»; error `"Contraseña incorrecta."`.
3. Desbloqueado: filas con mostrar/ocultar, «Copiar usuario», «Copiar contraseña» (`navigator.clipboard` + `Notice("Copiado.")`), crear/editar/borrar (borrar con `ConfirmDeleteModal` existente), badge «Desbloqueado · se bloquea en ~N min» (`msUntilLock()`), «Bloquear ahora».
4. `needsMigration`: banner «Tienes X credenciales sin cifrar — Cifrar ahora» → `migratePlaintextCredentials` + `refresh()`.
- Zona de peligro «Olvidé mi contraseña»: explica pérdida total, borra salt + verificador vía `saveData()` y ofrece vaciar blobs.
- `refresh()` de la vista: tras `load()`, si hay sesión, descifra con `decryptEntryForDisplay` antes de renderizar; si el modal de edición sigue abierto al expirar, conserva su texto y al guardar pide desbloquear.
- `main.ts`: `plugin.credentialSession = new CredentialSession(settings.credentialLockTimeoutMinutes)`; la vista lo recibe por constructor; al expirar, la sesión pide `refresh()` de las hojas abiertas (callback registrado en `main.ts`).
- `styles.css`: estados con variables Obsidian, fila de credencial, badge de cuenta atrás, zona de peligro.

- [ ] **Step 1: Implement** `CredentialFormModal.ts` + reescritura de la sección en `DashboardView.ts` + wiring en `main.ts` + estilos.
- [ ] **Step 2: Verify.** Run: `npm run typecheck` y `npm run build`. Expected: ambos limpios, `main.js` emitido.
- [ ] **Step 3: Commit.** `git add src/ui/CredentialFormModal.ts src/ui/DashboardView.ts src/main.ts styles.css; git commit -m "feat: sección Contraseña con CRUD cifrado"`

## Tarea 7: Verificación integral y vault de prueba

**Files:** Ninguno del repo salvo correcciones y `AGENTS.md`; se actualiza `D:\proyects\devhelper-test-vault\` (no se commitea).

- [ ] **Step 1: Ampliar `AGENTS.md`.** La regla «`data.json` solo guarda las dos carpetas» pasa a incluir `credentialLockTimeoutMinutes` + internos `credSaltB64`/`credVerifier` (ninguno secreto; la clave jamás se persiste). Describir la sección "Contraseña" real en el layout.
- [ ] **Step 2: Run full suite.** Run: `npm run typecheck`, `npm test` y `npm run build`. Expected: 3 en verde.
- [ ] **Step 3: Actualizar el vault de prueba.** Run: `npm run update:test-vault` (build + copia `main.js`, `manifest.json`, `styles.css` y recarga). Recorrer los 9 criterios de aceptación del spec: crear maestra, crear credencial, comprobar en el explorador que solo `service` es legible, maestra incorrecta, timeout con valor corto temporal, copiar/editar/borrar, migración de una entrada en plano escrita a mano, restablecimiento por olvido.
- [ ] **Step 4: Fijar desviaciones.** Cada bug → test que lo reproduce primero, después el fix (con su commit `fix: …`).
- [ ] **Step 5: Commit de cierre.** `git add AGENTS.md; git commit -m "docs: actualizar AGENTS.md con credenciales cifradas"` (solo si hubo cambios; más `fix:` si aplicó el Step 4).
