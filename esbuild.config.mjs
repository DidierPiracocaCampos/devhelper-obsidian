import esbuild from "esbuild";
import process from "process";

const prod = process.argv.includes("--production");

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

if (prod) {
  await esbuild.build(buildOptions);
  // The build output directory is the project root, which already
  // contains manifest.json, so no extra copy step is needed.
  console.log("Production build complete: main.js");
} else {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("esbuild watching for changes...");
}
