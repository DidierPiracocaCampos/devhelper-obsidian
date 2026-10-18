# Archivos y proyecto General Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activar la sección Archivos (listar, añadir desde el sistema, filtrar por nombre, abrir, borrar) por proyecto y en Todos vía el proyecto sombra `Projects/General/`.

**Architecture:** General como proyecto real con `isGeneral:true`, sembrado en `load()` y oculto de chips/picker; `files` fluye en `DashboardData` y el presenter lo acota por selección; el adapter gana `listFiles` + `createBinary`.

**Tech Stack:** TypeScript, Obsidian API (`vault.createBinary`, `TFolder`, `openLinkText`, `vault.trash`), Vitest, esbuild.

**Spec:** `docs/superpowers/specs/2026-10-18-archivos-y-proyecto-general-design.md`

## Global Constraints

- Todo el texto UI en español.
- Las notas Markdown son la única fuente de verdad; `data.json` solo guarda carpetas configurables.
- Mutaciones de frontmatter solo vía `processFrontMatter`; binarios nunca pasan por ahí.
- Preservar props de usuario y cuerpo al editar notas.
- Sanitización `sanitizeFilename`: `\ / : * ? " < > |` y `#` → `-`, colapsar `-`, trim `./espacios`, vacío → `Untitled`, colisión → ` 2`, ` 3`…
- Borrado solo a la papelera tras confirmación; no hay borrado de proyectos/carpetas.
- Después de cada tarea: `npm run typecheck`, `npm test`, `npm run build` en verde.

## Review Focus

- Nombre con traversal (`../`, `/`, `\`) — debe sanitizarse, nunca escapar de `Archivos/`.
- Duplicado exacto (`foto.png` existe) — debe crear `foto 2.png`, nunca sobrescribir.
- Extensión en mayúsculas (`FOTO.PNG`) — el filtro `foto` debe coincidir (case-insensitive).
- `Projects/General/` borrado a mano — el siguiente `load()` lo re-siembra sin duplicar ni romper Todos.
- `General.md` con frontmatter roto — debe salir como issue, no tumbar el dashboard.
- Fichero de 0 bytes o muy grande — copiar tal cual; si Obsidian falla, `Notice` en español sin romper la vista.

---

### Task 1: Datos puros + presenter acotado

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/presentDashboard.ts`
- Test: `tests/presentDashboard.test.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces:
  - `interface FileRecord { path: string; name: string; extension: string; projectPath: string }`
  - `DashboardData.files: FileRecord[]`
  - `ProjectRecord.isGeneral?: boolean`
  - `DashboardPresentation.files: FileRecord[]`

- [ ] **Step 1: Write the failing test**

```ts
it("oculta General de la seleccion directa y acota files por ambito", () => {
  const pres = presentDashboard(dataConGeneralYFiles, { kind: "all" });
  expect(pres.files.every((f) => f.projectPath === GENERAL_HUB)).toBe(true);
});
it("en modo proyecto solo devuelve sus files", () => {
  const pres = presentDashboard(dataConGeneralYFiles, { kind: "project", path: PROJ_A });
  expect(pres.files.map((f) => f.projectPath)).toEqual([PROJ_A]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/presentDashboard.test.ts`
Expected: FAIL (`files` / `isGeneral` no existen).

- [ ] **Step 3: Implement `FileRecord`, `files`, `isGeneral` en `src/domain/types.ts` y acotación en `src/domain/presentDashboard.ts`**

Reglas: en `showAll`, `files` = solo `projectPath` del proyecto con `isGeneral:true`
(orden `name` asc case-insensitive, desempate `path`); en modo proyecto,
`files` del `match.path` (si el `match` es General por path directo, fallback a `all`).
`compareProjects/compareTasks` sin cambios.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/presentDashboard.test.ts`
Expected: PASS. Luego `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/domain/types.ts src/domain/presentDashboard.ts tests/presentDashboard.test.ts
git commit -m "feat: FileRecord y presenter acotado con proyecto General"
```

### Task 2: Contrato vault para binarios

**Files:**
- Modify: `src/data/VaultAdapter.ts`
- Modify: `src/data/ObsidianVaultAdapter.ts`
- Test: `tests/ProjectTaskRepository.test.ts` (extender el falso con store binario)

**Interfaces:**
- Consumes: `VaultNoteRef` existente (`{ path, basename }`).
- Produces:
  - `listFiles(folderPath: string): VaultNoteRef[]`
  - `createBinary(path: string, data: ArrayBuffer): Promise<VaultNoteRef>`
  - `trash()` reutilizado para ficheros (sin cambio de firma).

- [ ] **Step 1: Write the failing test (falso en memoria)**

```ts
it("lista no-markdown y crea binarios sin sobrescribir", async () => {
  await fake.createBinary("Projects/A/Archivos/foto.png", buf(3));
  expect(fake.listFiles("Projects/A/Archivos").map((r) => r.path))
    .toEqual(["Projects/A/Archivos/foto.png"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/ProjectTaskRepository.test.ts`
Expected: FAIL (`createBinary`/`listFiles` no existen en el falso).

- [ ] **Step 3: Implement `listFiles` + `createBinary` en `src/data/VaultAdapter.ts` (firma), `src/data/ObsidianVaultAdapter.ts` (`TFolder.children` filtrando `TFile`, no recursivo, ordenado; `vault.createBinary`) y en el falso del test (map `path -> ArrayBuffer|string`, `listFiles` no recursivo)**

Sin tocar `listMarkdownFiles`, `read`, `processFrontMatter`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -- tests/ProjectTaskRepository.test.ts`
Expected: PASS. Luego `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/data/VaultAdapter.ts src/data/ObsidianVaultAdapter.ts tests/ProjectTaskRepository.test.ts
git commit -m "feat: contrato vault listFiles y createBinary"
```

### Task 3: Repositorio — siembra General, escaneo y addFile

**Files:**
- Modify: `src/data/ProjectTaskRepository.ts`
- Test: `tests/ProjectTaskRepository.test.ts`

**Interfaces:**
- Consumes: `listFiles`, `createBinary` de Task 2; `FileRecord`, `isGeneral` de Task 1.
- Produces:
  - `GENERAL_FOLDER = "General"`, hub `${projectsFolder}/General/General.md`
  - `addFile(projectPath: string, fileName: string, data: ArrayBuffer): Promise<string>`
  - `deleteFile(path: string): Promise<void>` (manda a papelera vía `adapter.trash`; la vista nunca toca el adapter)
  - `splitFileName(name: string): { stem: string; ext: string }` (exportado para tests)
  - `uniqueFilePath(folder: string, fileName: string, ignorePath?: string): Promise<string>`

- [ ] **Step 1: Write the failing tests**

```ts
it("siembra General en el primer load y lo marca isGeneral", async () => {
  const data = await repo.load();
  expect(data.projects.find((p) => p.isGeneral)?.path).toBe("Projects/General/General.md");
});
it("addFile preserva extension y desambigua", async () => {
  await repo.addFile("Projects/A/A.md", "foto.png", buf(1));
  const second = await repo.addFile("Projects/A/A.md", "foto.png", buf(1));
  expect(second).toBe("Projects/A/Archivos/foto 2.png");
});
it("sanitiza traversal sin escapar de Archivos", async () => {
  const created = await repo.addFile("Projects/A/A.md", "../evil.png", buf(1));
  expect(created.startsWith("Projects/A/Archivos/")).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/ProjectTaskRepository.test.ts`
Expected: FAIL (`addFile`/`isGeneral`/`files` ausentes).

- [ ] **Step 3: Implement `ensureGeneralProject()`, escaneo `<F>/Archivos/` → `files[]` con `projectPath` del hub, `addFile()` + `deleteFile()` + `uniqueFilePath()` y `splitFileName()` en `src/data/ProjectTaskRepository.ts`**

Detalles: `ensureGeneral` corre tras `seedTemplates()` en cada `load()`; crea
carpeta, hub por plantilla `project`, `Tareas/`, `Archivos/`, `Credenciales.md`
por plantilla `credentials`; nunca sobrescribe. `addFile` sanitiza solo el stem
con `sanitizeFilename` y re-anexa `ext` intacta; ignora `..` y `/`. Escaneo de
archivos ignora subniveles (igual que `listMarkdownFiles`).

- [ ] **Step 4: Run tests + typecheck + build**

Run: `npm test -- tests/ProjectTaskRepository.test.ts`
Expected: PASS (suite completa 36+ nuevos en verde). Luego `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/data/ProjectTaskRepository.ts tests/ProjectTaskRepository.test.ts
git commit -m "feat: siembra General y addFile con desambiguacion"
```

### Task 4: Vista Archivos — lista, filtro, añadir, abrir, borrar

**Files:**
- Modify: `src/ui/DashboardView.ts`
- Modify: `styles.css`
- Test: manual + `npm run build` (sin test unitario de DOM; la lógica ya viene probada en Tasks 1-3)

**Interfaces:**
- Consumes: `presentation.files`, `repository.addFile()`, `repository.deleteFile()`.
- Produces: sección Archivos funcional (sin nueva interfaz pública).

- [ ] **Step 1: Write the manual check script (sin test nuevo)**

Lista de chequeo en el vault de prueba: proyecto con 0/2 archivos, Todos muestra
solo General, filtro `foto` case-insensitive, `+` copia múltiple, clic abre,
papelera pide confirmación y manda a papelera de Obsidian.

- [ ] **Step 2: Implement en `src/ui/DashboardView.ts`**

`renderBottomSections(data, presentation)`; estado `fileQuery=""`,
`showFileFilters=false`; funnel despliega `input "Buscar archivos…"`;
filtrado en memoria sin `refresh` al teclear + fila «Sin resultados»;
`+` habilitado abre `<input type=file multiple>` oculto → `arrayBuffer()` →
`addFile(projectPathEnAmbito)` → `refresh()` con `Notice` en español al fallar;
card con nombre + abrir (`openLinkText`) + papelera (`ConfirmDeleteModal`).
La sección Contraseña queda intacta.

- [ ] **Step 3: Styles en `styles.css`**

Reutilizar `.devhelper-task-filters/-search`; añadir `.devhelper-file-list`
(misma silueta que `.devhelper-task-list`).

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Run: `npm test`
Run: `npm run build`
Expected: todo verde + `main.js` emitido. Luego `npm run update:test-vault` y
recorrido manual de la checklist del Step 1.

- [ ] **Step 5: Commit**

```bash
git add src/ui/DashboardView.ts styles.css
git commit -m "feat: seccion Archivos con filtro y anadir desde sistema"
```
