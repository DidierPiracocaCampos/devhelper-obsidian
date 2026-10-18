# Unificar main: Archivos + Credenciales cifradas + Notas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar todo en `main`: Archivos por proyecto con General sombra + Contraseña cifrada con maestra global, sin perder Notas.

**Architecture:** Partir de `main` (9ba4d90, con Notas). Portar `feat/archivos-general` (31fe113, base 614ab38) adaptado a Notas + portar `b30800c` (ya basado en main) + dirty `resolveVisibleCredentialsRecord`. `files` y `credentials` fluyen en `DashboardData`; presenter acota ambos por selección; adapter gana `listFiles` + `createBinary`.

**Tech Stack:** TypeScript, Obsidian API (`vault.createBinary`, `TFolder`, `openLinkText`, `vault.trash`, `fileManager`), WebCrypto AES-GCM-256 + PBKDF2-SHA256 210k, Vitest sin mocks, esbuild.

**Spec:** `docs/superpowers/specs/2026-10-18-archivos-y-proyecto-general-design.md` + `docs/superpowers/specs/2026-10-18-encrypted-credentials-design.md` + planes `docs/superpowers/plans/2026-10-18-archivos-y-proyecto-general.md` + `docs/superpowers/plans/2026-10-18-encrypted-credentials.md`

## Global Constraints

- Todo el texto UI/issues/errores en español.
- Las notas Markdown son la única fuente de verdad; `data.json` solo guarda `projectsFolder`, `templatesFolder`, `credentialLockTimeoutMinutes` (defecto 15), `credSaltB64?`, `credVerifier?`.
- Una mutación = un solo cambio atómico vía `processFrontMatter`; binarios nunca pasan por frontmatter; cuerpo y props de usuario se preservan.
- Sanitización `sanitizeFilename`: `\ / : * ? " < > |` y `#` → `-`; colapsar `-`; trim `./espacios`; vacío → `Untitled`; colisión → ` 2`, ` 3`…
- Borrado solo a papelera tras confirmación explícita; no hay borrado de proyectos/carpetas.
- `service` siempre en claro; `user`/`password` cifrados en entradas nuevas; `url`/`notes` se cifran si non-empty. Blob `enc:v1:<iv-b64-12B>:<cipher-b64>`.
- Clave derivada solo en memoria (`CredentialSession`), nunca en disco.
- Después de cada tarea: `cmd /c "npm run typecheck"`, `cmd /c "npm test"`, `cmd /c "npm run build"` en verde.

## Review Focus

- Traversal en nombre de archivo (`../`, `/`, `\`) debe sanitizarse y nunca escapar de `Archivos/` → test en Task 2 `addFileSanitizesTraversal`.
- Duplicado `foto.png` existente debe crear `foto 2.png`, nunca sobrescribir → test en Task 2 `addFileDisambiguatesWithCounter`.
- `General/` borrado a mano debe re-sembrarse en siguiente `load()` sin duplicar y Todos sigue mostrando sus files → test en Task 2 `seedsGeneralWhenMissing`.
- Blob `enc:v1:truncado` debe marcar entrada corrupta sin tumbar nota → test en Task 3 `reportsMalformedEncryptedBlob`.
- Sesión expirada entre abrir modal y guardar debe pedir desbloqueo sin perder texto → repositorio lanza `Desbloquea las credenciales primero.` con key null → test en Task 3 `requiresUnlockedKey`.

---

### Task 1: Tipos + contrato Vault

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/data/VaultAdapter.ts`
- Modify: `src/data/ObsidianVaultAdapter.ts`
- Test: `tests/presentDashboard.test.ts` (solo tipos, sin lógica nueva)

**Interfaces:**
- Consumes: nada nuevo.
- Produces:
  - `interface FileRecord { path: string; name: string; extension: string; projectPath: string }`
  - `DashboardData { projects: ProjectRecord[]; tasks: TaskRecord[]; notes: NoteRecord[]; credentials: CredentialsRecord[]; files: FileRecord[]; issues: DashboardIssue[] }`
  - `ProjectRecord.isGeneral?: boolean`
  - `CredentialsRecord { path: string; entries: CredentialEntry[]; entryIssues?: DashboardIssue[]; projectPath: string; needsMigration: boolean }`
  - `VaultAdapter.listFiles(folderPath: string): VaultNoteRef[]`
  - `VaultAdapter.createBinary(path: string, data: ArrayBuffer): Promise<VaultNoteRef>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/presentDashboard.test.ts — añade a suite files
it("acota files de General en modo all", () => {
  const pres = presentDashboard(dataConGeneralYFiles, { kind: "all" });
  expect(pres.files.every((f) => f.projectPath === GENERAL_HUB)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /c "npm test -- tests/presentDashboard.test.ts"`
Expected: FAIL con `Property 'files' does not exist` / `FileRecord not defined`

- [ ] **Step 3: Implement tipos en `src/domain/types.ts` + métodos en `src/data/VaultAdapter.ts` + `src/data/ObsidianVaultAdapter.ts:40-70`**

Portar de `feat/archivos-general`: `FileRecord`, `DashboardData.files`, `isGeneral?`. De `b30800c`: `needsMigration: boolean`. En adapter: `listFiles` (via `getAbstractFileByPath` + `TFolder.children`, filtra `TFile`, excluye `name.startsWith(".")`, sort por `path`) + `createBinary` (via `app.vault.createBinary`, assert `TFile`). Mantener `NoteRecord`/`notes` de main.

- [ ] **Step 4: Run tests to verify types compile**

Run: `cmd /c "npm run typecheck"`
Expected: PASS (tests de files seguirán fallando hasta Task 4, es esperado)

- [ ] **Step 5: Commit**

```bash
git add src/domain/types.ts src/data/VaultAdapter.ts src/data/ObsidianVaultAdapter.ts tests/presentDashboard.test.ts
git commit -m "feat: contrato unificado FileRecord y binarios en vault"
```

### Task 2: Repository load + Archivos (General, addFile, deleteFile)

**Files:**
- Modify: `src/data/ProjectTaskRepository.ts:99-264,650-888`
- Test: `tests/ProjectTaskRepository.test.ts`

**Interfaces:**
- Consumes: `FileRecord`, `listFiles`, `createBinary` de Task 1.
- Produces:
  - `export const GENERAL_FOLDER = "General"`
  - `export function splitFileName(name: string): { stem: string; ext: string }`
  - `async addFile(projectPath: string, fileName: string, data: ArrayBuffer): Promise<string>`
  - `async deleteFile(path: string): Promise<void>`
  - `load(): Promise<DashboardData>` con `notes` + `files` + `needsMigration` + `ensureGeneralProject()`

- [ ] **Step 1: Write the failing test**

```ts
it("siembra General y lista Archivos por proyecto", async () => {
  const data = await repo.load();
  expect(data.projects.some((p) => p.isGeneral)).toBe(true);
  expect(data.files.every((f) => f.projectPath.endsWith(".md"))).toBe(true);
});
it("addFile desambigua foto.png a foto 2.png", async () => {
  await repo.addFile(PROJ, "foto.png", buf);
  const second = await repo.addFile(PROJ, "foto.png", buf);
  expect(second).toContain("foto 2.png");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /c "npm test -- tests/ProjectTaskRepository.test.ts"`
Expected: FAIL `addFile is not a function` / `isGeneral missing`

- [ ] **Step 3: Implement en `src/data/ProjectTaskRepository.ts`**

Base main (con `notes:NoteRecord[]`, escaneo `<F>/Tareas/` + `<F>/Notas/`, `createNote/renameNote/reassignNote/deleteNote`). Añadir de archivos-general: `ensureGeneralProject()` (crea `General/`, `Tareas/`, `Archivos/`, hub desde plantilla `project` + `Credenciales.md`, nunca sobrescribe), `uniqueFilePath()` (desambigua ` 2` antes de ext), `extensionOf/splitFileName`, `addFile/deleteFile`, paso 6 en `load()` lista `Archivos/` por proyecto. Marcar `hubParsed.project.isGeneral` cuando `path === GeneralHub`. Mantener `needsMigration` de Task 3 si ya existe, o dejar `false` temporal.

- [ ] **Step 4: Run tests**

Run: `cmd /c "npm test -- tests/ProjectTaskRepository.test.ts"`
Expected: PASS archivos; credenciales cifradas pueden fallar hasta Task 3

- [ ] **Step 5: Commit**

```bash
git add src/data/ProjectTaskRepository.ts tests/ProjectTaskRepository.test.ts
git commit -m "feat: General sombra y Archivos en repositorio con Notas"
```

### Task 3: Cripto + CRUD credenciales + parser

**Files:**
- Create: `src/domain/credentialsCrypto.ts` (de b30800c, 216 líneas)
- Create: `src/data/CredentialSession.ts` (de b30800c, 108 líneas)
- Modify: `src/domain/parseNote.ts`
- Modify: `src/data/ProjectTaskRepository.ts` (solo bloque credenciales)
- Modify: `src/domain/types.ts` (solo `CredentialDisplay` si falta)
- Test: `tests/credentialsCrypto.test.ts`, `tests/CredentialSession.test.ts`, `tests/parseNote.test.ts`

**Interfaces:**
- Consumes: `CredentialsRecord.needsMigration` de Task 1.
- Produces:
  - `ENCRYPTED_PREFIX = "enc:v1:"`, `isEncryptedValue(v)`, `deriveKey(password,saltB64)`, `encryptField/decryptField`, `createSaltB64/createVerifier/checkVerifier`, `decryptEntryForDisplay(entry,key)`
  - `class CredentialSession { isUnlocked(); getKey(); msUntilLock(); touch(); lock(); setTimeoutMinutes(m); setOnExpire(cb); unlock(pw,salt,verifier) }`
  - `interface CredentialInput { service: string; user: string; password: string; url?: string; notes?: string }`
  - `createCredential(projectPath,input,key)`, `updateCredential(projectPath,index,expectedService,input,key)`, `deleteCredential(projectPath,index,key)`, `migratePlaintextCredentials(projectPath,key): Promise<number>`

- [ ] **Step 1: Write the failing test (copiar de b30800c)**

```ts
it("createCredential cifra user/password", async () => {
  await repo.createCredential(PROJ, { service: "H", user: "u", password: "s3cret" }, key);
  const raw = await fake.read({ path: credPath, basename: "Credenciales.md" });
  expect(raw).toContain("enc:v1:");
  expect(raw).not.toContain("s3cret");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /c "npm test -- tests/credentialsCrypto.test.ts tests/CredentialSession.test.ts"`
Expected: FAIL `Cannot find module`

- [ ] **Step 3: Implement copiando archivos de b30800c sin cambios + parser `isWellFormedBlob` + `validateCredentialEntry` que acepta blob bien formado y marca `enc:v1:truncado` como entryIssue**

Preservar extras en `updateCredential` (`{...preserved,...entry}`). `load()` calcula `needsMigration`.

- [ ] **Step 4: Run tests**

Run: `cmd /c "npm test -- tests/credentialsCrypto.test.ts tests/CredentialSession.test.ts tests/parseNote.test.ts tests/ProjectTaskRepository.test.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/credentialsCrypto.ts src/data/CredentialSession.ts src/domain/parseNote.ts src/data/ProjectTaskRepository.ts tests/
git commit -m "feat: credenciales cifradas con sesion y migracion"
```

### Task 4: Presenter unificado (notes + files + General)

**Files:**
- Modify: `src/domain/presentDashboard.ts`
- Test: `tests/presentDashboard.test.ts`

**Interfaces:**
- Consumes: `FileRecord`, `isGeneral`, `notes` de Tasks 1-2.
- Produces:
  - `DashboardPresentation { selection; selectedProject; showAll; tasks: TaskRecord[]; notes: NoteRecord[]; files: FileRecord[]; issues: DashboardIssue[] }`
  - `resolveVisibleCredentialsRecord(data,selection): { projectPath: string; record: CredentialsRecord | null } | null`

- [ ] **Step 1: Write the failing test**

```ts
it("en proyecto solo devuelve sus tasks, notes y files", () => {
  const pres = presentDashboard(fullData, { kind: "project", path: PROJ_A });
  expect(pres.tasks.every((t) => t.projectPath === PROJ_A)).toBe(true);
  expect(pres.notes.every((n) => n.projectPath === PROJ_A)).toBe(true);
  expect(pres.files.every((f) => f.projectPath === PROJ_A)).toBe(true);
});
it("Todos muestra files de General y credentials de General", () => {
  expect(presentDashboard(fullData, { kind: "all" }).files.every((f) => f.projectPath === GENERAL_HUB)).toBe(true);
  expect(resolveVisibleCredentialsRecord(fullData, { kind: "all" })?.projectPath).toBe(GENERAL_HUB);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /c "npm test -- tests/presentDashboard.test.ts"`
Expected: FAIL `files` vacío / `resolveVisibleCredentialsRecord not defined`

- [ ] **Step 3: Implement en `src/domain/presentDashboard.ts`**

Mantener `compareProjects/compareTasks/compareNotes` de main. Añadir de archivos-general: `compareFiles`, `generalFiles()`, rama `files` en los 4 retornos (`showAll`→generalFiles, proyecto→filtrado por `match.path`, fallback→generalFiles, sin proyectos→`[]`; selección directa de General→fallback all). Añadir de dirty encrypted: `resolveVisibleCredentialsRecord` + `basenameOf` (General por folder basename o title case-insensitive). Nunca lanza.

- [ ] **Step 4: Run tests**

Run: `cmd /c "npm test -- tests/presentDashboard.test.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/presentDashboard.ts tests/presentDashboard.test.ts
git commit -m "feat: presenter acota tasks, notes y files con General"
```

### Task 5: DashboardView (Tareas y notas + Archivos vivo + Contraseña viva)

**Files:**
- Modify: `src/ui/DashboardView.ts`
- Create: `src/ui/CredentialFormModal.ts` (de b30800c)
- Modify: `src/ui/ConfirmDeleteModal.ts` (redacción neutra)
- Modify: `src/ui/SettingsTab.ts`, `src/settings.ts`, `src/main.ts`
- Modify: `styles.css`
- Test: manual + `npm test` (sin tests nuevos UI)

**Interfaces:**
- Consumes: presenter de Task 4, `CredentialSession`, `CredentialDeps`.
- Produces: `renderBottomSections(data,decrypted)` con `renderFilesSection` + `renderCredentialsSection`; `CredentialFormModal/MasterPasswordModal/ConfirmModal`.

- [ ] **Step 1: Write the failing check (sin test UI, verificación estática)**

```bash
grep -q "renderFilesSection" src/ui/DashboardView.ts && grep -q "renderCredentialsSection" src/ui/DashboardView.ts
```

Expected antes: FAIL (master solo tiene `renderBottomSections` placeholder con `addButton.disabled = true`)

- [ ] **Step 2: Implement**

Top: mantener de main `Tareas y notas`, `taskKindFilter/taskStatusFilter/taskQuery`, `renderNoteCard`, `openCreateNote/openDeleteNote`, `NoteFormModal`. Bottom: portar `renderFilesSection/renderFileFilters/applyFileQueryFilter/renderFileCard/fileScopePath/openAddFiles(input file multiple→arrayBuffer→addFile)/openDeleteFile/openFile/revealInExplorer` de archivos-general (oculta General de `openAddFavorite` con `!p.isGeneral`). Portar sección Contraseña de b30800c (4 estados, `decryptVisibleCredentials`, `revealedCredentials:Set`, copiar, migrar, `CredentialDeps`). `main.ts`: crea `CredentialSession`, `setOnExpire(refresh)`, pasa deps a vista, `lock()` en `onunload`. `SettingsTab`: timeout minutos. `styles.css`: bloques files + credentials. `ConfirmDeleteModal`: texto neutro recuperable.

- [ ] **Step 3: Run verification**

Run: `cmd /c "npm run typecheck"`, `cmd /c "npm test"`, `cmd /c "npm run build"`
Expected: 3 PASS, sin `addButton.disabled = true` incondicional

- [ ] **Step 4: Commit**

```bash
git add src/ui/ src/settings.ts src/main.ts styles.css
git commit -m "feat: panel Archivos vivo y Contrasena cifrada con Notas"
```

### Task 6: Cierre en main + vault

**Files:**
- Modify: `AGENTS.md`, `manifest.json` si version bump
- Test: `tests/` completa + vault manual

- [ ] **Step 1: Verificar ramas integradas**

Run: `cmd /c "git log --oneline -8"` debe mostrar Tasks 1-5 sobre `9ba4d90`; `cmd /c "git diff --name-only feat/archivos-general"` solo debe mostrar divergencias Notas ya resueltas; `cmd /c "git diff --name-only b30800c"` vacío salvo dirty ya integrado.

- [ ] **Step 2: Suite completa + build**

Run: `cmd /c "npm run typecheck"`, `cmd /c "npm test"`, `cmd /c "npm run build"`
Expected: typecheck limpio, ~130+ tests verde, `main.js` emite

- [ ] **Step 3: Actualizar vault y verificación manual**

Run: `cmd /c "npm run update:test-vault"`
Expected: copia `main.js/manifest.json/styles.css` al vault; abrir Obsidian → dashboard muestra proyectos `General`+`spot`, Archivos `+` habilitado, Contraseña pide crear maestra, Tareas y notas con filtro.

- [ ] **Step 4: Commit final**

```bash
git add AGENTS.md manifest.json
git commit -m "docs: AGENTS con Archivos y credenciales en main"
```
