/**
 * Vault adapter boundary.
 *
 * The interface is intentionally framework-free: no `obsidian` imports. The
 * presentation layer and the repository both depend on this abstract
 * surface, so a fake `VaultAdapter` (see `tests/ProjectTaskRepository.test.ts`)
 * can exercise every read/write path without standing up an Obsidian runtime.
 *
 * `ObsidianVaultAdapter` is the only concrete implementation and is the only
 * file in `src/data/` allowed to import from `obsidian`.
 */

/**
 * Opaque reference to a Markdown note in the vault. The repository never
 * touches `TFile` directly; it always works with the lightweight ref
 * returned by the adapter. `path` is the vault-relative path including
 * the `.md` extension. `basename` is the file name including the
 * extension (e.g. `"Website.md"`).
 */
export interface VaultNoteRef {
  path: string;
  basename: string;
}

/**
 * The set of vault operations the repository needs to scan, create,
 * rename and edit notes. Every method has a single responsibility so a
 * fake implementation is straightforward.
 */
export interface VaultAdapter {
  /**
   * Return the top-level Markdown notes in `folderPath` (non-recursive).
   * The folder is identified by its vault-relative path WITHOUT trailing
   * slash (e.g. `"Projects"`, `"Areas/Web"`).
   */
  listMarkdownFiles(folderPath: string): VaultNoteRef[];

  /**
   * Return the raw Markdown content of a note. Implementations may read
   * from cache as long as the returned content is up-to-date with the
   * last write.
   */
  read(note: VaultNoteRef): Promise<string>;

  /**
   * Ensure `path` (a folder path) and all of its ancestors exist. The
   * Obsidian adapter walks every segment because Obsidian's
   * `vault.createFolder` only creates a single level at a time.
   */
  createFolder(path: string): Promise<void>;

  /**
   * Write a brand-new Markdown file at `path` with the given content.
   * Returns the ref of the new note. The path must NOT exist; the
   * repository sanitizes and disambiguates paths before this call so a
   * collision should be impossible.
   */
  createMarkdown(path: string, content: string): Promise<VaultNoteRef>;

  /**
   * Move an existing note to `newPath`. Returns the ref of the renamed
   * note. Body and other metadata are preserved by the underlying
   * vault/file-manager; this method does not touch frontmatter.
   */
  rename(note: VaultNoteRef, newPath: string): Promise<VaultNoteRef>;

  /**
   * Mutate only the frontmatter of `note`. The callback receives the
   * parsed frontmatter object (modifying it in place is allowed) and
   * the adapter writes the modified object back without disturbing the
   * body or other top-level sections of the file. This is the ONLY
   * mechanism the repository uses to change `project` or `status` so
   * user-defined properties and the body are never touched.
   */
  processFrontMatter(
    note: VaultNoteRef,
    update: (frontmatter: Record<string, unknown>) => void,
  ): Promise<void>;

  /**
   * Resolve a `[[wikilink]]` (the inner text without the brackets)
   * against `sourcePath`. Returns the ref of the resolved file, or
   * `null` when the link cannot be resolved to a Markdown note.
   */
  resolveLink(linkPath: string, sourcePath: string): VaultNoteRef | null;
}
