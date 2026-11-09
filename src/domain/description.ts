/**
 * Descripción corta que muestran las tarjetas de tarea y nota del
 * dashboard. Puro, sin imports de Obsidian; nunca lanza.
 *
 * Prioridad:
 *  1. Prop `description` del frontmatter (cadena no vacía, recortada).
 *  2. Primer párrafo del cuerpo, saltando encabezados, embeds,
 *     reglas, comentarios y bloques de código, y limpio de Markdown.
 *  3. `undefined` (la vista pinta su texto por defecto).
 */

export const DESCRIPTION_MAX_LENGTH = 200;

export function extractDescription(
  properties: Record<string, unknown>,
  body: string,
): string | undefined {
  const prop = properties["description"];
  if (typeof prop === "string") {
    const trimmed = collapse(prop);
    if (trimmed.length > 0) return truncate(trimmed);
  }
  const paragraph = firstParagraph(body);
  if (paragraph === null) return undefined;
  const cleaned = collapse(stripInline(paragraph));
  return cleaned.length > 0 ? truncate(cleaned) : undefined;
}

function firstParagraph(body: string): string | null {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const collected: string[] = [];
  let fence: string | null = null;
  let inComment = false;

  for (const raw of lines) {
    const line = raw.trim();

    if (fence !== null) {
      if (line.startsWith(fence)) fence = null;
      continue;
    }
    const fenceMatch = /^(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (collected.length > 0) break;
      fence = fenceMatch[1]!;
      continue;
    }

    if (inComment) {
      if (line.includes("%%")) inComment = false;
      continue;
    }
    if (line.startsWith("%%")) {
      const closed = line.length > 2 && line.slice(2).includes("%%");
      if (!closed) inComment = true;
      if (collected.length > 0) break;
      continue;
    }

    const skippable =
      line.length === 0 ||
      /^#{1,6}(\s|$)/.test(line) ||
      /^!\[\[.*\]\]$/.test(line) ||
      /^!\[.*\]\(.*\)$/.test(line) ||
      /^([-*_])(\s*\1){2,}$/.test(line) ||
      /^<!--.*-->$/.test(line) ||
      /^\|.*\|$/.test(line);
    if (skippable) {
      if (collected.length > 0) break;
      continue;
    }

    collected.push(line);
  }

  return collected.length > 0 ? collected.join(" ") : null;
}

function stripInline(text: string): string {
  return (
    text
      // Marcadores de bloque al inicio de cada línea unida.
      .replace(/(^|\s)>\s*/g, "$1")
      .replace(/(^|\s)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/g, "$1")
      // Embeds inline y enlaces.
      .replace(/!\[\[[^\]]*\]\]/g, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
      .replace(/\[\[([^\]]*)\]\]/g, (_m, target: string) =>
        target.split("#")[0].split("/").pop() ?? target,
      )
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Comentarios, HTML y código inline.
      .replace(/%%.*?%%/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/`([^`]*)`/g, "$1")
      // Énfasis / resaltado / tachado.
      .replace(/(\*\*|__|==|~~)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=$|[\s).,;:!?])/g, "$1$2")
  );
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string): string {
  if (text.length <= DESCRIPTION_MAX_LENGTH) return text;
  return `${text.slice(0, DESCRIPTION_MAX_LENGTH - 1).trimEnd()}…`;
}
