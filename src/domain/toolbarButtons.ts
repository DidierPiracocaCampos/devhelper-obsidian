/**
 * Pure parser for `type: toolbar-button` notes (botones configurables de la
 * barra). No `obsidian` imports; never throws.
 */

import yaml from "js-yaml";
import { sliceFrontmatter } from "./frontmatter";
import type { DashboardIssue, NoteSnapshot } from "./types";

export const DEFAULT_BUTTON_ICON = "square-terminal";

export const DEFAULT_BUTTON_TEMPLATE = `---
type: toolbar-button
label: Nuevo botón
icon: square-terminal
order: 100
enabled: true
---
<!--
Este botón ejecuta el bloque js de abajo (acción directa).
Para convertirlo en un menú, añade encabezados "## Opción" y, bajo cada uno,
su propio bloque js: cada encabezado pasa a ser una opción del menú.
-->

\`\`\`js
ctx.notice("Hola desde " + ctx.button.label);
\`\`\`
`;

export interface ToolbarButtonOption {
  label: string;
  code: string;
}

export interface ToolbarButtonRecord {
  path: string;
  label: string;
  icon: string;
  order: number;
  enabled: boolean;
  action:
    | { kind: "direct"; code: string }
    | { kind: "menu"; options: ToolbarButtonOption[] };
}

export type ParsedToolbarButton =
  | { kind: "ignored" }
  | { kind: "button"; button: ToolbarButtonRecord; issues: DashboardIssue[] }
  | { kind: "issue"; issue: DashboardIssue };

interface CodeBlock {
  lang: string;
  startLine: number;
  code: string;
}

interface Heading {
  line: number;
  text: string;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^\n]*)$/;

function scanBody(body: string): { blocks: CodeBlock[]; headings: Heading[] } {
  const lines = body.split("\n");
  const blocks: CodeBlock[] = [];
  const headings: Heading[] = [];
  let open: { fence: string; lang: string; startLine: number; lines: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open) {
      const t = line.trim();
      if (
        t.length >= open.fence.length &&
        t[0] === open.fence[0] &&
        t === t[0].repeat(t.length)
      ) {
        blocks.push({ lang: open.lang, startLine: open.startLine, code: open.lines.join("\n") });
        open = null;
      } else {
        open.lines.push(line);
      }
      continue;
    }
    const m = FENCE_OPEN.exec(line);
    if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
      const lang = (m[2].trim().split(/\s+/)[0] ?? "").toLowerCase();
      open = { fence: m[1], lang, startLine: i, lines: [] };
      continue;
    }
    const h = /^## +(.*)$/.exec(line);
    if (h) headings.push({ line: i, text: h[1].trim() });
  }
  // Unclosed fence at EOF is discarded.
  return { blocks, headings };
}

const isJs = (b: CodeBlock): boolean => b.lang === "js" || b.lang === "javascript";

export function parseToolbarButton(note: NoteSnapshot): ParsedToolbarButton {
  const text = note.content.replace(/\r\n/g, "\n");
  const sliced = sliceFrontmatter(text);
  if (sliced.kind !== "ok") return { kind: "ignored" };

  let fm: unknown;
  try {
    fm = yaml.load(sliced.yaml);
  } catch {
    return { kind: "ignored" };
  }
  if (!fm || typeof fm !== "object" || Array.isArray(fm)) return { kind: "ignored" };
  const props = fm as Record<string, unknown>;
  if (props.type !== "toolbar-button") return { kind: "ignored" };

  const fail = (message: string): ParsedToolbarButton => ({
    kind: "issue",
    issue: { path: note.path, message },
  });

  const label = typeof props.label === "string" ? props.label.trim() : "";
  if (!label) return fail("Falta «label» en el botón");

  const icon =
    typeof props.icon === "string" && props.icon.trim() ? props.icon.trim() : DEFAULT_BUTTON_ICON;
  const order =
    typeof props.order === "number" && Number.isFinite(props.order)
      ? props.order
      : Number.MAX_SAFE_INTEGER;
  const enabled = typeof props.enabled === "boolean" ? props.enabled : true;

  const { blocks, headings } = scanBody(sliced.body);
  const jsBlocks = blocks.filter(isJs);
  const make = (action: ToolbarButtonRecord["action"]): ToolbarButtonRecord => ({
    path: note.path,
    label,
    icon,
    order,
    enabled,
    action,
  });

  if (headings.length === 0) {
    if (jsBlocks.length === 0) {
      return fail(`El botón «${label}» no tiene bloque de código js`);
    }
    return {
      kind: "button",
      button: make({ kind: "direct", code: jsBlocks[0].code }),
      issues: [],
    };
  }

  const options: ToolbarButtonOption[] = [];
  const issues: DashboardIssue[] = [];
  headings.forEach((h, idx) => {
    const end = idx + 1 < headings.length ? headings[idx + 1].line : Infinity;
    const block = jsBlocks.find((b) => b.startLine > h.line && b.startLine < end);
    if (block) options.push({ label: h.text, code: block.code });
    else issues.push({ path: note.path, message: `La opción «${h.text}» no tiene bloque de código js` });
  });

  if (options.length === 0) {
    return fail(`El botón «${label}» no tiene opciones con bloque de código js`);
  }
  return { kind: "button", button: make({ kind: "menu", options }), issues };
}

export function sortToolbarButtons(buttons: ToolbarButtonRecord[]): ToolbarButtonRecord[] {
  return [...buttons].sort((a, b) => {
    if (a.order !== b.order) return a.order < b.order ? -1 : 1;
    const la = a.label.toLowerCase();
    const lb = b.label.toLowerCase();
    if (la !== lb) return la < lb ? -1 : 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}
