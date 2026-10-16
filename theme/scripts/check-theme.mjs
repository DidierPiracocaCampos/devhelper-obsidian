import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const themeDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const requiredVariables = [
  /\-\-background-primary\s*:\s*#171717/,
  /\-\-background-secondary\s*:\s*#20201e/,
  /\-\-text-normal\s*:\s*#e8e8e8/,
  /\-\-text-muted\b/,
  /\-\-text-faint\b/,
  /\-\-background-modifier-border\s*:\s*#363633/,
  /\-\-interactive-accent\s*:\s*#e8e8e8/,
  /\-\-text-on-accent\s*:\s*#171717/,
  /\-\-color-green\s*:\s*oklch\(55%\s+0\.22\s+145\)/,
  /\-\-color-blue\s*:\s*oklch\(70%\s+0\.2\s+265\)/,
  /\-\-color-orange\s*:\s*oklch\(88%\s+0\.18\s+85\)/,
  /\-\-color-red\s*:\s*oklch\(70%\s+0\.25\s+25\)/,
];

function fail(message) {
  failures.push(message);
}

function checkManifest() {
  const path = join(themeDir, "manifest.json");
  if (!existsSync(path)) {
    fail("manifest.json no existe");
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`manifest.json no es JSON válido: ${error.message}`);
    return;
  }
  for (const field of ["name", "version", "minAppVersion", "author"]) {
    const value = manifest[field];
    if (typeof value !== "string" || value.trim() === "") {
      fail(`manifest.json: el campo "${field}" falta o está vacío`);
    }
  }
}

function checkThemeCss() {
  const path = join(themeDir, "theme.css");
  if (!existsSync(path)) {
    fail("theme.css no existe");
    return;
  }
  const css = readFileSync(path, "utf8");
  const forbidden = [
    { token: "!important", label: "!important" },
    { token: /url\(\s*["']?\s*(?:https?:)?\/\//i, label: "remote url()" },
    { token: "@import", label: "@import" },
  ];
  for (const { token, label } of forbidden) {
    if (typeof token === "string" ? css.includes(token) : token.test(css)) {
      fail(`theme.css contiene prohibido: ${label}`);
    }
  }
  for (const pattern of requiredVariables) {
    if (!pattern.test(css)) {
      fail(`theme.css no coincide con el patrón requerido: ${pattern}`);
    }
  }
}

function checkScreenshot() {
  const path = join(themeDir, "screenshots", "screenshot.png");
  if (!existsSync(path)) {
    fail("screenshots/screenshot.png no existe");
  }
}

checkManifest();
checkThemeCss();
checkScreenshot();

if (failures.length > 0) {
  console.error("check-theme: FALLOS");
  for (const message of failures) {
    console.error(`  - ${message}`);
  }
  process.exit(1);
}

console.log("check-theme: OK");
process.exit(0);
