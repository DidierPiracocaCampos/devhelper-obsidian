import esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "process";

const prod = process.argv.includes("--production");

const repoRoot = resolve(process.cwd());
const skillsSource = resolve(repoRoot, "src/skills");
const skillsOutput = resolve(repoRoot, "skills");

/**
 * External modules that must NOT be bundled.
 * Obsidian, Electron, and CodeMirror are provided by the host application.
 * esbuild requires each entry to be a string; we enumerate the common
 * CodeMirror / Lezer packages so the bundler leaves them alone.
 */
const externalModules = [
  "obsidian",
  "electron",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr"
];

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  platform: "node",
  target: "es2020",
  sourcemap: prod ? false : "inline",
  minify: prod,
  treeShaking: true,
  external: externalModules,
  logLevel: "info"
};

/**
 * Copies the source folder `src/skills/` to the release path `skills/`
 * so the bundle ships the AI-skills material next to `main.js`. On prod
 * we re-copy on every build (cheap, deterministic). In dev we copy once
 * at startup so as not to slow the watch; re-copy manually by running
 * `node esbuild.config.mjs --production`.
 */
function copySkills() {
  if (!existsSync(skillsSource)) return;
  mkdirSync(skillsOutput, { recursive: true });
  cpSync(skillsSource, skillsOutput, { recursive: true });
}

if (prod) {
  await esbuild.build(buildOptions);
  copySkills();
  // The build output directory is the project root, which already
  // contains manifest.json, so no extra copy step is needed.
  console.log("Production build complete: main.js + skills/");
} else {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  copySkills();
  console.log("esbuild watching for changes...");
}
