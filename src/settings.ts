/**
 * Plugin settings and folder-path normalization helpers.
 *
 * This module is intentionally framework-free (no Obsidian imports) so the
 * normalization rules can be unit-tested under Vitest without a DOM.
 */

export interface PluginSettings {
  projectsFolder: string;
  templatesFolder: string;
  credentialLockTimeoutMinutes: number;
  credSaltB64?: string;
  credVerifier?: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  projectsFolder: "Projects",
  templatesFolder: "Projects/_templates",
  credentialLockTimeoutMinutes: 15,
};

/**
 * Normalize a user-supplied folder path into a vault-relative path.
 *
 * Rules:
 * - `undefined`, empty, or whitespace-only input returns `fallback`.
 * - Surrounding whitespace and `/` characters are trimmed.
 * - Backslashes are converted to forward slashes.
 * - Runs of `/` are collapsed to a single `/`.
 * - Absolute paths (starting with `/` or matching a Windows drive letter such
 *   as `C:`) return `fallback`.
 * - Paths whose segments include `..` (parent traversal) return `fallback`.
 *
 * @param path The user-supplied path.
 * @param fallback The safe default to return when the input is unusable.
 */
export function normalizeVaultFolderPath(path: string, fallback: string): string {
  if (path === undefined || path === null) return fallback;
  if (typeof path !== "string") return fallback;

  const stripped = path.trim();
  if (stripped.length === 0) return fallback;

  const slashed = stripped.replace(/\\/g, "/");
  const deduped = slashed.replace(/\/+/g, "/");

  // Reject absolute paths BEFORE we trim the leading `/`, otherwise an
  // input like "/etc/Projects" would silently become "etc/Projects".
  if (isAbsolute(deduped)) return fallback;

  const trimmed = deduped.replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed.length === 0) return fallback;
  if (hasParentTraversal(trimmed)) return fallback;

  return trimmed;
}

/**
 * Merge persisted settings over the defaults without losing fields the
 * settings tab does not edit.
 *
 * The tab only exposes the two folder paths and the lock timeout, but
 * `data.json` also carries the credential key material (`credSaltB64` /
 * `credVerifier`). A naive `{...defaults, folders}` merge would drop the
 * key material, and the next `saveData` would wipe it from disk
 * (locking the user out of every credential). Spreading `stored` first
 * keeps timeout + key material; only the folder paths are re-normalized.
 */
export function mergePluginSettings(
  defaults: PluginSettings,
  stored: Partial<PluginSettings> | undefined,
): PluginSettings {
  return {
    ...defaults,
    ...stored,
    projectsFolder: normalizeVaultFolderPath(
      stored?.projectsFolder ?? defaults.projectsFolder,
      defaults.projectsFolder,
    ),
    templatesFolder: normalizeVaultFolderPath(
      stored?.templatesFolder ?? defaults.templatesFolder,
      defaults.templatesFolder,
    ),
  };
}

function splitSegments(value: string): string[] {
  return value.split("/");
}

function isAbsolute(value: string): boolean {
  // POSIX absolute path.
  if (value.startsWith("/")) return true;
  // Windows drive letter, e.g. "C:foo", "C:/foo", "C:\foo".
  if (/^[A-Za-z]:/.test(value)) return true;
  return false;
}

function hasParentTraversal(value: string): boolean {
  const segments = splitSegments(value);
  return segments.some((segment) => segment === "..");
}