/**
 * Verifica que el frontmatter YAML de cada skill (en `src/skills/` y en su
 * espejo de release `skills/`) parsea con `js-yaml.load`. Si alguna es
 * inválida (el bug que rompió T3-T10 a mitad del SDD) falla y muestra qué.
 *
 * También exige `name` y `description` como string en cada frontmatter.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { fileURLToPath } from "node:url";
import { test, expect } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const sources = [
  path.join(repoRoot, "src/skills"),
  path.join(repoRoot, "skills"),
];

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(p);
    } else if (entry.name === "SKILL.md") {
      yield p;
    }
  }
}

function readFrontmatter(file) {
  const txt = fs.readFileSync(file, "utf8");
  const m = txt.match(/^---\n([\s\S]+?)\n---/);
  if (!m) throw new Error("NO FRONTMATTER");
  return { yaml: m[1], body: txt.slice(m[0].length) };
}

test("frontmatter YAML es válido en src/skills y skills/", () => {
  const all = {};
  for (const src of sources) {
    for (const file of walk(src)) {
      const rel = path.relative(path.dirname(src), file).replace(/\\/g, "/");
      const { yaml: fm } = readFrontmatter(file);
      let parsed;
      try {
        parsed = yaml.load(fm);
      } catch (e) {
        throw new Error(`YAML inválido en ${rel}: ${e.message}`);
      }
      expect(parsed.name, `name ausente en ${rel}`).toBeTypeOf("string");
      expect(
        parsed.description,
        `description ausente en ${rel}`,
      ).toBeTypeOf("string");
      all[rel] = parsed;
    }
  }
});

test("existen 9 skills (1 núcleo + 8 hijas)", () => {
  const seen = new Set();
  for (const src of sources) {
    for (const file of walk(src)) {
      const rel = path.relative(path.dirname(src), file).replace(/\\/g, "/");
      seen.add(rel);
    }
  }
  expect(seen.size).toBe(9);
});

test("los espejos src/skills y skills son byte-iguales por skill", () => {
  const srcDir = path.join(repoRoot, "src/skills");
  const dstDir = path.join(repoRoot, "skills");
  for (const entry of fs.readdirSync(srcDir)) {
    const srcFile = path.join(srcDir, entry, "SKILL.md");
    const dstFile = path.join(dstDir, entry, "SKILL.md");
    if (fs.existsSync(srcFile) && fs.existsSync(dstFile)) {
      const a = fs.readFileSync(srcFile);
      const b = fs.readFileSync(dstFile);
      expect(
        a.equals(b),
        `${entry}/SKILL.md diverge entre src/skills y skills`,
      ).toBe(true);
    }
  }
});
