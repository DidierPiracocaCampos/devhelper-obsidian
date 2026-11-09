import yaml from "js-yaml";
import type { VaultAdapter, VaultNoteRef } from "../../src/data/VaultAdapter";

export interface FakeVaultState {
  files: Map<string, string>;
  folders: Set<string>;
}

function refOf(path: string): VaultNoteRef {
  return { path, basename: path.slice(path.lastIndexOf("/") + 1) };
}

function addAncestors(folders: Set<string>, path: string): void {
  let current = "";
  for (const seg of path.split("/")) {
    current = current.length === 0 ? seg : `${current}/${seg}`;
    folders.add(current);
  }
}

/** Fake VaultAdapter en memoria; processFrontMatter usa js-yaml y preserva el cuerpo. */
export function createFakeVault(): FakeVaultState & VaultAdapter {
  const files = new Map<string, string>();
  const folders = new Set<string>();

  const adapter: VaultAdapter = {
    listMarkdownFiles(folderPath) {
      const prefix = `${folderPath}/`;
      const refs: VaultNoteRef[] = [];
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue;
        if (path.slice(prefix.length).includes("/")) continue;
        refs.push(refOf(path));
      }
      return refs.sort((a, b) => a.path.localeCompare(b.path));
    },
    listFiles() {
      return [];
    },
    async read(note) {
      const content = files.get(note.path);
      if (content === undefined) throw new Error(`Fake vault: file not found: ${note.path}`);
      return content;
    },
    async createFolder(path) {
      addAncestors(folders, path);
    },
    async createMarkdown(path, content) {
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (dir.length > 0) addAncestors(folders, dir);
      files.set(path, content);
      return refOf(path);
    },
    async createBinary() {
      throw new Error("Fake vault: createBinary not implemented");
    },
    async rename(note, newPath) {
      const content = files.get(note.path);
      if (content === undefined) throw new Error(`Fake vault: missing file: ${note.path}`);
      files.delete(note.path);
      files.set(newPath, content);
      return refOf(newPath);
    },
    async processFrontMatter(note, update) {
      const content = files.get(note.path);
      if (content === undefined) throw new Error(`Fake vault: missing file: ${note.path}`);
      const normalized = content.replace(/\r\n/g, "\n");
      const match = /^---\n([\s\S]*?)\n---(\n[\s\S]*)?$/.exec(normalized);
      const fm = match
        ? ((yaml.load(match[1]) as Record<string, unknown> | null) ?? {})
        : {};
      const body = match ? (match[2] ?? "") : normalized;
      update(fm);
      files.set(note.path, `---\n${yaml.dump(fm).trimEnd()}\n---${body}`);
    },
    resolveLink() {
      return null;
    },
    listSubfolders(folderPath) {
      const out: string[] = [];
      for (const path of folders) {
        const i = path.lastIndexOf("/");
        const parent = i >= 0 ? path.slice(0, i) : "";
        if (parent !== folderPath) continue;
        if (path.slice(i + 1).startsWith(".")) continue;
        out.push(path);
      }
      return out.sort();
    },
    exists(path) {
      return files.has(path) || folders.has(path);
    },
    async renameFolder() {
      throw new Error("Fake vault: renameFolder not implemented");
    },
    async trash(note) {
      if (!files.delete(note.path)) throw new Error(`Fake vault: missing file: ${note.path}`);
    },
  };

  return { files, folders, ...adapter };
}
