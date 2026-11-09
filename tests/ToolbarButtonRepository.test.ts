import { describe, it, expect } from "vitest";
import { ToolbarButtonRepository } from "../src/data/ToolbarButtonRepository";
import { DEFAULT_SETTINGS, type PluginSettings } from "../src/settings";
import { DEFAULT_BUTTON_TEMPLATE } from "../src/domain/toolbarButtons";
import { sanitizeFilename } from "../src/data/ProjectTaskRepository";
import { createFakeVault } from "./helpers/fakeVault";

const TEMPLATE_PATH = "Plantillas/boton.md";

function button(label: string, order: number, enabled = true): string {
  return `---\ntype: toolbar-button\nlabel: ${label}\nicon: zap\norder: ${order}\nenabled: ${enabled}\n---\n\n\`\`\`js\nctx.notice("x");\n\`\`\`\n`;
}

function setup(settings: PluginSettings = DEFAULT_SETTINGS) {
  const vault = createFakeVault();
  let current = settings;
  const repo = new ToolbarButtonRepository(vault, () => current);
  return {
    vault,
    repo,
    setSettings: (s: PluginSettings) => {
      current = s;
    },
  };
}

describe("ToolbarButtonRepository", () => {
  it("load() on empty vault creates folder and template", async () => {
    const { vault, repo } = setup();
    const data = await repo.load();
    expect(data.buttons).toEqual([]);
    expect(vault.folders.has("Botones")).toBe(true);
    expect(vault.files.get(TEMPLATE_PATH)).toBe(DEFAULT_BUTTON_TEMPLATE);
  });

  it("concurrent first-run loads both resolve", async () => {
    const { vault } = setup();
    const inner = vault.createMarkdown.bind(vault);
    vault.createMarkdown = async (path, content) => {
      await Promise.resolve();
      if (vault.files.has(path)) throw new Error("File already exists.");
      return inner(path, content);
    };
    const repo = new ToolbarButtonRepository(vault, () => DEFAULT_SETTINGS);
    await expect(Promise.all([repo.load(), repo.load()])).resolves.toHaveLength(2);
    expect(vault.files.get(TEMPLATE_PATH)).toBe(DEFAULT_BUTTON_TEMPLATE);
  });

  it("does not overwrite a user-edited template", async () => {
    const { vault, repo } = setup();
    await repo.load();
    vault.files.set(TEMPLATE_PATH, "editada");
    await repo.load();
    expect(vault.files.get(TEMPLATE_PATH)).toBe("editada");
  });

  it("returns sorted buttons, one issue, ignores other types", async () => {
    const { vault, repo } = setup();
    vault.files.set("Botones/B.md", button("B", 20));
    vault.files.set("Botones/A.md", button("A", 10));
    vault.files.set("Botones/Mal.md", "---\ntype: toolbar-button\n---\n");
    vault.files.set("Botones/N.md", "---\ntype: note\n---\n");
    const data = await repo.load();
    expect(data.buttons.map((b) => b.label)).toEqual(["A", "B"]);
    expect(data.issues).toHaveLength(1);
    expect(data.issues[0].path).toBe("Botones/Mal.md");
  });

  it("includes disabled buttons", async () => {
    const { vault, repo } = setup();
    vault.files.set("Botones/A.md", button("A", 1, false));
    const data = await repo.load();
    expect(data.buttons).toHaveLength(1);
    expect(data.buttons[0].enabled).toBe(false);
  });

  it("does not read subfolders", async () => {
    const { vault, repo } = setup();
    vault.files.set("Botones/sub/X.md", button("X", 1));
    const data = await repo.load();
    expect(data.buttons).toEqual([]);
  });

  it("createButton uses vault template, sets label, disambiguates", async () => {
    const { vault, repo } = setup();
    vault.files.set(TEMPLATE_PATH, button("Plantilla", 5) + "cuerpo propio\n");
    const title = "Deploy: prod?";
    const name = sanitizeFilename(title);
    const p1 = await repo.createButton(title);
    expect(p1).toBe(`Botones/${name}.md`);
    const content = vault.files.get(p1) as string;
    expect(content).toContain("cuerpo propio");
    expect(content).toContain("order: 5");
    const p2 = await repo.createButton(title);
    expect(p2).toBe(`Botones/${name} 2.md`);
    const data = await repo.load();
    expect(data.buttons.map((b) => b.label)).toEqual([title, title]);
  });

  it("createButton falls back to DEFAULT_BUTTON_TEMPLATE", async () => {
    const { vault, repo } = setup();
    const p = await repo.createButton("Mi botón");
    expect(p).toBe("Botones/Mi botón.md");
    expect(vault.files.get(p)).toContain("ctx.notice");
    const data = await repo.load();
    expect(data.buttons.map((b) => b.label)).toEqual(["Mi botón"]);
  });

  it("setButtonEnabled changes only enabled", async () => {
    const { vault, repo } = setup();
    vault.files.set("Botones/A.md", button("A", 1));
    await repo.setButtonEnabled("Botones/A.md", false);
    const content = vault.files.get("Botones/A.md") as string;
    expect(content).toContain("enabled: false");
    expect(content).toContain("icon: zap");
    expect(content).toContain('ctx.notice("x");');
  });

  it("setButtonEnabled rejects on missing path", async () => {
    const { repo } = setup();
    await expect(repo.setButtonEnabled("Botones/Z.md", true)).rejects.toThrow(
      "No existe el botón «Botones/Z.md»",
    );
  });

  it("reads live settings", async () => {
    const { vault, repo, setSettings } = setup();
    vault.files.set("Otros/O.md", button("O", 1));
    await repo.load();
    setSettings({ ...DEFAULT_SETTINGS, buttonsFolder: "Otros" });
    const data = await repo.load();
    expect(data.buttons.map((b) => b.label)).toEqual(["O"]);
  });
});
