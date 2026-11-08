// eslint.config.mjs — reproduce las reglas de la revisión automática de
// community.obsidian.md (eslint-plugin-obsidianmd, config recomendada).
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  globalIgnores([
    "node_modules",
    "dist",
    "main.js",
    "esbuild.config.mjs",
    "vitest.config.mjs",
    "scripts",
    "skills",
    "src/skills",
    "tests",
    ".worktrees",
    ".agents",
    "docs",
  ]),
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
  },
  {
    // El escáner de community.obsidian.md trata estos dos como avisos
    // (no-base-to-string ni siquiera lo reporta): se quedan visibles
    // sin romper `npm run lint`.
    files: ["**/*.ts"],
    rules: { "@typescript-eslint/no-base-to-string": "warn" },
  },
  {
    files: ["package.json"],
    rules: { "depend/ban-dependencies": "warn" },
  },
]);
