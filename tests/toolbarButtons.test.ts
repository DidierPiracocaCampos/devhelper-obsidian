import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUTTON_ICON,
  DEFAULT_BUTTON_TEMPLATE,
  parseToolbarButton,
  sortToolbarButtons,
  type ToolbarButtonRecord,
} from "../src/domain/toolbarButtons";

function note(content: string, path = "Botones/B.md") {
  const basename = path.split("/").pop()!.replace(/\.md$/, "");
  return { path, basename, content };
}

const FM = "---\ntype: toolbar-button\nlabel: Despliegue\n---\n";

function expectButton(r: ReturnType<typeof parseToolbarButton>) {
  if (r.kind !== "button") throw new Error("esperaba button, fue " + r.kind);
  return r;
}

describe("parseToolbarButton", () => {
  it("acción directa con un bloque js", () => {
    const r = expectButton(
      parseToolbarButton(note(FM + "Texto\n\n```js\nctx.notice('hi');\n```\n")),
    );
    expect(r.button.action).toEqual({ kind: "direct", code: "ctx.notice('hi');" });
    expect(r.issues).toEqual([]);
    expect(r.button.path).toBe("Botones/B.md");
    expect(r.button.label).toBe("Despliegue");
  });

  const MENU =
    FM +
    "## Build\n```js\nbuild();\n```\n\n## Abrir changelog\n```js\nopen();\n```\n";

  it("menú con dos opciones en orden", () => {
    const r = expectButton(parseToolbarButton(note(MENU)));
    expect(r.button.action).toEqual({
      kind: "menu",
      options: [
        { label: "Build", code: "build();" },
        { label: "Abrir changelog", code: "open();" },
      ],
    });
  });

  it("CRLF produce lo mismo que LF", () => {
    const a = parseToolbarButton(note(MENU));
    const b = parseToolbarButton(note(MENU.replace(/\n/g, "\r\n")));
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).not.toContain("\r");
  });

  it("opción sin bloque genera aviso y se omite", () => {
    const r = expectButton(
      parseToolbarButton(
        note(FM + "## A\n```js\na();\n```\n## Vacía\ntexto\n## C\n```js\nc();\n```\n"),
      ),
    );
    expect(r.button.action.kind).toBe("menu");
    if (r.button.action.kind === "menu") expect(r.button.action.options).toHaveLength(2);
    expect(r.issues).toEqual([
      {
        path: "Botones/B.md",
        message: "La opción «Vacía» no tiene bloque de código js",
      },
    ]);
  });

  it("menú sin opciones válidas es issue", () => {
    const r = parseToolbarButton(note(FM + "## Vacía\nnada\n"));
    expect(r.kind).toBe("issue");
  });

  it("sin label o label en blanco es issue", () => {
    for (const fm of ["---\ntype: toolbar-button\n---\n", '---\ntype: toolbar-button\nlabel: "  "\n---\n']) {
      const r = parseToolbarButton(note(fm + "```js\nx();\n```\n"));
      expect(r).toEqual({
        kind: "issue",
        issue: { path: "Botones/B.md", message: "Falta «label» en el botón" },
      });
    }
  });

  it("sin bloque js es issue", () => {
    const r = parseToolbarButton(note(FM + "solo texto\n"));
    expect(r).toEqual({
      kind: "issue",
      issue: {
        path: "Botones/B.md",
        message: "El botón «Despliegue» no tiene bloque de código js",
      },
    });
  });

  it("sólo bloque python es issue", () => {
    const r = parseToolbarButton(note(FM + "```python\nprint(1)\n```\n"));
    expect(r.kind).toBe("issue");
    if (r.kind === "issue") expect(r.issue.message).toContain("no tiene bloque de código js");
  });

  it("ignored: otro type, sin portada, YAML roto", () => {
    expect(parseToolbarButton(note("---\ntype: task\n---\n```js\nx\n```"))).toEqual({ kind: "ignored" });
    expect(parseToolbarButton(note("hola\n```js\nx\n```"))).toEqual({ kind: "ignored" });
    expect(parseToolbarButton(note("---\ntype: [unclosed\n  : : :\n---\n"))).toEqual({ kind: "ignored" });
  });

  it("defaults de icon/order/enabled", () => {
    const r = expectButton(parseToolbarButton(note(FM + "```js\nx();\n```\n")));
    expect(r.button.icon).toBe(DEFAULT_BUTTON_ICON);
    expect(DEFAULT_BUTTON_ICON).toBe("square-terminal");
    expect(r.button.order).toBe(Number.MAX_SAFE_INTEGER);
    expect(r.button.enabled).toBe(true);
  });

  it("respeta enabled false, icon y order; order inválido usa default", () => {
    const body = "```js\nx();\n```\n";
    const a = expectButton(
      parseToolbarButton(note("---\ntype: toolbar-button\nlabel: X\nicon: rocket\norder: 5\nenabled: false\n---\n" + body)),
    );
    expect(a.button).toMatchObject({ icon: "rocket", order: 5, enabled: false });
    const b = expectButton(
      parseToolbarButton(note('---\ntype: toolbar-button\nlabel: X\norder: "x"\n---\n' + body)),
    );
    expect(b.button.order).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("acepta ~~~javascript y ```JS", () => {
    const a = expectButton(parseToolbarButton(note(FM + "~~~javascript\na();\n~~~\n")));
    expect(a.button.action).toEqual({ kind: "direct", code: "a();" });
    const b = expectButton(parseToolbarButton(note(FM + "```JS\nb();\n```\n")));
    expect(b.button.action).toEqual({ kind: "direct", code: "b();" });
  });

  it("## dentro de un bloque js no crea opciones", () => {
    const r = expectButton(parseToolbarButton(note(FM + "```js\n## dentro\nx();\n```\n")));
    expect(r.button.action).toEqual({ kind: "direct", code: "## dentro\nx();" });
  });

  it("valla sin cerrar se descarta", () => {
    const r = parseToolbarButton(note(FM + "```js\nx();\n"));
    expect(r.kind).toBe("issue");
    if (r.kind === "issue") expect(r.issue.message).toBe("El botón «Despliegue» no tiene bloque de código js");
  });

  it("DEFAULT_BUTTON_TEMPLATE es un botón directo válido", () => {
    const r = expectButton(parseToolbarButton(note(DEFAULT_BUTTON_TEMPLATE)));
    expect(r.button.label).toBe("Nuevo botón");
    expect(r.button.icon).toBe("square-terminal");
    expect(r.button.order).toBe(100);
    expect(r.button.enabled).toBe(true);
    expect(r.button.action.kind).toBe("direct");
    expect(r.issues).toEqual([]);
  });
});

describe("sortToolbarButtons", () => {
  const mk = (path: string, label: string, order: number): ToolbarButtonRecord => ({
    path, label, order, icon: "x", enabled: true, action: { kind: "direct", code: "" },
  });

  it("ordena por order, label case-insensitive y path sin mutar", () => {
    const input = [mk("p3", "B", 2), mk("p2", "b", 1), mk("p1", "a", 2), mk("p0", "a", 2)];
    const copy = [...input];
    const out = sortToolbarButtons(input);
    expect(out.map((b) => b.path)).toEqual(["p2", "p0", "p1", "p3"]);
    expect(input).toEqual(copy);
    expect(out).not.toBe(input);
  });
});
