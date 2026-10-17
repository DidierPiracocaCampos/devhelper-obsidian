/**
 * Plugin settings and folder-path normalization helpers.
 *
 * This module is intentionally framework-free (no Obsidian imports) so the
 * normalization rules can be unit-tested under Vitest without a DOM.
 */

export interface PluginSettings {
  projectsFolder: string;
  templatesFolder: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  projectsFolder: "Projects",
  templatesFolder: "Projects/_templates",
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