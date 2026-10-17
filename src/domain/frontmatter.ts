/**
 * Pure frontmatter slicer shared by the parser and the templates module.
 *
 * A Markdown frontmatter block looks like:
 *
 *   ---
 *   type: project
 *   status: active
 *   ---
 *   <body...>
 *
 * The slicer returns one of three discriminated variants:
 *  - `{ kind: "ok", yaml, body }` — frontmatter found, fully closed.
 *    `yaml` is the literal text between the `---` markers (no trailing
 *    newline); `body` is everything after the closing `---\n`,
 *    untouched.
 *  - `{ kind: "missing" }` — the note does not start with `---`.
 *  - `{ kind: "unclosed" }` — an opening `---` was found but no closing
 *    delimiter was present.
 *
 * The module is intentionally framework-free: no `obsidian` imports.
 */

const FRONTMATTER_DELIMITER = "---";

export type SlicedFrontmatter =
  | { kind: "ok"; yaml: string; body: string }
  | { kind: "missing" }
  | { kind: "unclosed" };

/**
 * Slice a Markdown note into its YAML frontmatter and trailing body.
 *
 * CRLF line endings are normalised to LF so the slice is stable on
 * Windows-authored notes. The first `---` must be on the very first
 * line; a `---` in the middle of a document is not frontmatter.
 */
export function sliceFrontmatter(content: string): SlicedFrontmatter {
  // Normalise CRLF to LF for predictable line scanning.
  const text = content.replace(/\r\n/g, "\n");

  // Must start with `---` on the first line.
  if (!text.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    return { kind: "missing" };
  }

  // Scan for the closing `---` line after the first one.
  const lines = text.split("\n");
  // lines[0] is the opening `---`, search from index 1 onwards.
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === FRONTMATTER_DELIMITER) {
      const yamlText = lines.slice(1, i).join("\n");
      // The body starts after the closing `---\n`. Anything past the
      // newline belongs to the body verbatim. The split above leaves
      // an empty trailing element when the file ends with `\n`; that
      // is preserved as-is.
      const afterClose = lines.slice(i + 1).join("\n");
      return { kind: "ok", yaml: yamlText, body: afterClose };
    }
  }

  return { kind: "unclosed" };
}