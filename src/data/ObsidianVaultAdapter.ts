/**
 * Concrete vault adapter that talks to the Obsidian runtime.
 *
 * This is the ONLY module under `src/data/` allowed to import from
 * `obsidian`. Every method here maps directly to a single Obsidian
 * API call (or to a small loop over one) so behaviour stays easy to
 * reason about:
 *
 *   listMarkdownFiles   -> vault.getMarkdownFiles() + filter
 *   read                -> vault.cachedRead(file)
 *   createFolder        -> vault.createFolder(...) per missing ancestor
 *   createMarkdown      -> vault.create(path, content)
 *   rename              -> fileManager.renameFile(file, newPath)
 *   processFrontMatter  -> fileManager.processFrontMatter(file, update)
 *   resolveLink         -> metadataCache.getFirstLinkpathDest(...)
 *
 * Notes on non-obvious choices:
 *
 *  - `createFolder` is called once per missing ancestor because
 *    Obsidian's API only creates a single folder level. We walk the
 *    segments top-down and tolerate "already exists" errors so the
 *    method is idempotent.
 *  - `processFrontMatter` re-emits only the frontmatter object passed
 *    to the callback; the body and other sections of the file are
 *    preserved untouched. We deliberately never read+rewrite the file
 *    ourselves so user-defined keys and custom body content survive
 *    a round-trip through the dashboard.
 */

import { App, TFile, TFolder } from "obsidian";
import type { VaultAdapter, VaultNoteRef } from "./VaultAdapter";

export class ObsidianVaultAdapter implements VaultAdapter {
  private readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  listMarkdownFiles(folderPath: string): VaultNoteRef[] {
    const prefix = `${folderPath}/`;
    const refs: VaultNoteRef[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      // Match top-level files only - the dashboard scans each configured
      // folder independently and does not descend into subfolders in v1.
      if (!file.path.startsWith(prefix)) continue;
      if (file.path.slice(prefix.length).includes("/")) continue;
      refs.push({ path: file.path, basename: file.basename + ".md" });
    }
    return refs;
  }

  async read(note: VaultNoteRef): Promise<string> {
    const file = this.requireFile(note);
    return await this.app.vault.cachedRead(file);
  }

  async createFolder(path: string): Promise<void> {
    if (path.length === 0) return;
    const segments = path.split("/");
    let current = "";
    for (const segment of segments) {
      current = current.length === 0 ? segment : `${current}/${segment}`;
      // `vault.createFolder` throws if the folder already exists; we
      // want idempotency so the same adapter can be reused across
      // multiple mutation calls.
      try {
        await this.app.vault.createFolder(current);
      } catch (err) {
        if (!isAlreadyExistsError(err)) {
          throw err;
        }
      }
    }
  }

  async createMarkdown(
    path: string,
    content: string,
  ): Promise<VaultNoteRef> {
    const created = await this.app.vault.create(path, content);
    if (!(created instanceof TFile)) {
      throw new Error(
        `ObsidianVaultAdapter.createMarkdown: ${path} did not produce a TFile`,
      );
    }
    return { path: created.path, basename: created.basename + ".md" };
  }

  async rename(
    note: VaultNoteRef,
    newPath: string,
  ): Promise<VaultNoteRef> {
    const file = this.requireFile(note);
    await this.app.fileManager.renameFile(file, newPath);
    // `renameFile` returns void; look the moved file up by its new path
    // so we can hand a freshly-built ref back to the caller.
    const renamed = this.app.vault.getAbstractFileByPath(newPath);
    if (!renamed || !(renamed instanceof TFile)) {
      throw new Error(
        `ObsidianVaultAdapter.rename: ${note.path} not found at ${newPath} after rename`,
      );
    }
    return { path: renamed.path, basename: renamed.basename + ".md" };
  }

  async processFrontMatter(
    note: VaultNoteRef,
    update: (frontmatter: Record<string, unknown>) => void,
  ): Promise<void> {
    const file = this.requireFile(note);
    await this.app.fileManager.processFrontMatter(file, update);
  }

  resolveLink(linkPath: string, sourcePath: string): VaultNoteRef | null {
    const target = this.app.metadataCache.getFirstLinkpathDest(
      linkPath,
      sourcePath,
    );
    if (!target) return null;
    if (!(target instanceof TFile)) return null;
    return { path: target.path, basename: target.basename + ".md" };
  }

  listSubfolders(folderPath: string): string[] {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!folder || !(folder instanceof TFolder)) return [];
    const out: string[] = [];
    for (const child of folder.children) {
      if (!(child instanceof TFolder)) continue;
      if (child.name.startsWith(".")) continue;
      out.push(child.path);
    }
    return out.sort();
  }

  exists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(path) !== null;
  }

  async renameFolder(folderPath: string, newPath: string): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!folder || !(folder instanceof TFolder)) {
      throw new Error(
        `ObsidianVaultAdapter.renameFolder: source folder not found: ${folderPath}`,
      );
    }
    await this.app.fileManager.renameFile(folder, newPath);
  }

  async trash(note: VaultNoteRef): Promise<void> {
    const file = this.requireFile(note);
    // `system: false` moves the note to Obsidian's own trash, so the
    // delete stays recoverable instead of destroying the file.
    await this.app.vault.trash(file, false);
  }

  /**
   * Look up the abstract file by path and assert it is a `TFile`. The
   * adapter works exclusively with regular Markdown files; any other
   * kind of file would be a programming error here.
   */
  private requireFile(note: VaultNoteRef): TFile {
    const abstract = this.app.vault.getAbstractFileByPath(note.path);
    if (!abstract) {
      throw new Error(
        `ObsidianVaultAdapter: file not found in vault: ${note.path}`,
      );
    }
    if (!(abstract instanceof TFile)) {
      throw new Error(
        `ObsidianVaultAdapter: path is not a Markdown file: ${note.path}`,
      );
    }
    return abstract;
  }
}

function isAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = (err as { message?: unknown }).message;
  if (typeof message !== "string") return false;
  // Obsidian surfaces "Folder already exists" on a wide vault; older
  // builds surface a localized variant. Keep the matcher loose.
  return /already exists/i.test(message);
}
