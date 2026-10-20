#!/usr/bin/env node
/**
 * Actualiza el vault de pruebas con la última build del plugin.
 *
 *  1. Ejecuta la build de producción (`node esbuild.config.mjs --production`).
 *  2. Copia `main.js`, `manifest.json`, `styles.css` y la carpeta
 *     `skills/` (recursiva) a `<vault>/.obsidian/plugins/devhelper-dashboard/`.
 *  3. Recarga el plugin con el CLI de Obsidian (si está disponible).
 *
 * Uso:
 *   node scripts/update-test-vault.mjs [ruta-al-vault]
 *   npm run update:test-vault -- [ruta-al-vault]
 *
 * La ruta por defecto es `D:\proyects\devhelper-test-vault` o el valor de
 * la variable de entorno `DEVHELPER_TEST_VAULT`.
 */
import { execSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, statSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testVault =
  process.argv[2] ??
  process.env.DEVHELPER_TEST_VAULT ??
  "D:\\proyects\\devhelper-test-vault";
const pluginDir = resolve(
  testVault,
  ".obsidian/plugins/devhelper-dashboard",
);

const FILES = ["main.js", "manifest.json", "styles.css"];

console.log(`[update-test-vault] build de producción en ${repoRoot}…`);
execSync("node esbuild.config.mjs --production", {
  cwd: repoRoot,
  stdio: "inherit",
});

console.log(`[update-test-vault] copiando a ${pluginDir}…`);
mkdirSync(pluginDir, { recursive: true });
for (const file of FILES) {
  copyFileSync(resolve(repoRoot, file), resolve(pluginDir, file));
  console.log(`[update-test-vault]   ${file} OK`);
}

const skillsRepo = resolve(repoRoot, "skills");
const skillsTest = resolve(pluginDir, "skills");
if (existsSync(skillsRepo) && statSync(skillsRepo).isDirectory()) {
  mkdirSync(skillsTest, { recursive: true });
  cpSync(skillsRepo, skillsTest, { recursive: true });
  console.log("[update-test-vault]   skills/ OK");
}

try {
  console.log("[update-test-vault] recargando plugin devhelper-dashboard…");
  execSync("obsidian plugin:reload id=devhelper-dashboard", {
    stdio: "inherit",
  });
} catch {
  console.warn(
    "[update-test-vault] no se pudo recargar el plugin (¿Obsidian cerrado?). " +
      "Recárgalo a mano: Settings → Community plugins → DevHelper Dashboard.",
  );
}

console.log("[update-test-vault] listo.");
