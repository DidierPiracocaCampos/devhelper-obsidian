/**
 * Helpers de test para leer `styles.css` como un árbol mínimo de bloques
 * (`preludio { cuerpo }`) sin dependencias externas. Sólo entiende lo que
 * el CSS del plugin usa: reglas, at-rules anidadas y comentarios.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const CALENDAR_BANNER = "Calendar view (vista mensual)";

interface CssNode {
  prelude: string;
  body: string;
}

/** `styles.css` del repo tal cual (con comentarios). */
export function readStyles(): string {
  return fs.readFileSync(path.join(repoRoot, "styles.css"), "utf8");
}

export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Corta por el banner del calendario; ambas mitades salen sin comentarios. */
export function splitSections(raw: string): { dashboard: string; calendar: string } {
  const idx = raw.indexOf(CALENDAR_BANNER);
  if (idx < 0) throw new Error(`No se encontró el banner «${CALENDAR_BANNER}»`);
  const commentStart = raw.lastIndexOf("/*", idx);
  return {
    dashboard: stripComments(raw.slice(0, commentStart)),
    calendar: stripComments(raw.slice(commentStart)),
  };
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim();
}

function topLevel(css: string): CssNode[] {
  const nodes: CssNode[] = [];
  let start = 0;
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === "{") {
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      nodes.push({ prelude: normalize(css.slice(start, i)), body: css.slice(i + 1, j - 1) });
      i = j;
      start = j;
      continue;
    }
    if (ch === ";" || ch === "}") start = i + 1;
    i++;
  }
  return nodes;
}

function* walk(css: string): Generator<CssNode> {
  for (const node of topLevel(css)) {
    yield node;
    if (node.prelude.startsWith("@")) yield* walk(node.body);
  }
}

/** Cuerpos de todas las at-rules (a cualquier profundidad) cuyo preludio casa. */
export function atRuleBodies(css: string, prelude: RegExp): string[] {
  const out: string[] = [];
  for (const node of walk(css)) {
    if (node.prelude.startsWith("@") && prelude.test(node.prelude)) out.push(node.body);
  }
  return out;
}

/** Cuerpo del primer bloque cuyo selector (normalizado) es exactamente `selector`. */
export function ruleBody(css: string, selector: string): string | null {
  const wanted = normalize(selector);
  for (const node of walk(css)) {
    if (!node.prelude.startsWith("@") && node.prelude === wanted) return node.body;
  }
  return null;
}

/** Cuerpo del primer bloque cuya lista de selectores incluye `selector`. */
export function ruleBodyContaining(css: string, selector: string): string | null {
  const wanted = normalize(selector);
  for (const node of walk(css)) {
    if (node.prelude.startsWith("@")) continue;
    if (node.prelude.split(", ").includes(wanted)) return node.body;
  }
  return null;
}

/** Declaraciones normalizadas `prop: valor` de un cuerpo de regla. */
export function decls(body: string | null): string[] {
  if (body === null) return [];
  return body
    .split(";")
    .map((d) => normalize(d).replace(/\s*:\s*/, ": "))
    .filter((d) => d.length > 0);
}

/** Cuerpo de la única at-rule que casa; falla si hay 0 o más de 1. */
export function onlyAtRule(css: string, prelude: RegExp): string {
  const bodies = atRuleBodies(css, prelude);
  if (bodies.length !== 1) {
    throw new Error(`Se esperaba 1 at-rule ${prelude}, hay ${bodies.length}`);
  }
  return bodies[0];
}
