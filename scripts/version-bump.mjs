#!/usr/bin/env node
/**
 * Sincroniza la versión de `package.json` con `manifest.json` y registra
 * la pareja versión → minAppVersion en `versions.json`.
 *
 * Se ejecuta automáticamente con `npm version <patch|minor|major>`
 * (script `version` de package.json), que después hace commit y tag.
 */
import { readFileSync, writeFileSync } from "node:fs";

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
  console.error("[version-bump] ejecútalo con `npm version <patch|minor|major>`");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = manifest.minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");
