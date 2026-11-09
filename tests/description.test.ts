import { describe, it, expect } from "vitest";
import { extractDescription } from "../src/domain/description";
import { parseProjectTaskNote } from "../src/domain/parseNote";
import type { NoteSnapshot } from "../src/domain/types";

/**
 * Tests de la descripción que muestran las tarjetas de tarea y nota:
 * prop `description` del frontmatter y, si falta, primer párrafo del
 * cuerpo limpio de Markdown.
 */

describe("extractDescription", () => {
  it("usa la prop description cuando es una cadena no vacía", () => {
    expect(
      extractDescription({ description: "  Revisar login  " }, "Cuerpo"),
    ).toBe("Revisar login");
  });

  it("cae al cuerpo si description está vacía, es null o no es texto", () => {
    expect(extractDescription({ description: "" }, "Del cuerpo")).toBe(
      "Del cuerpo",
    );
    expect(extractDescription({ description: null }, "Del cuerpo")).toBe(
      "Del cuerpo",
    );
    expect(extractDescription({ description: 42 }, "Del cuerpo")).toBe(
      "Del cuerpo",
    );
  });

  it("devuelve undefined si no hay prop ni cuerpo útil", () => {
    expect(extractDescription({}, "")).toBeUndefined();
    expect(extractDescription({}, "\n\n  \n")).toBeUndefined();
  });

  it("toma el primer párrafo y une sus líneas", () => {
    const body = "\nPrimera línea\nsegunda línea\n\nOtro párrafo\n";
    expect(extractDescription({}, body)).toBe("Primera línea segunda línea");
  });

  it("salta encabezados, embeds, reglas, comentarios y bloques de código", () => {
    const body = [
      "## Tareas",
      "",
      "![[Tareas.base]]",
      "",
      "---",
      "%% oculto %%",
      "<!-- comentario -->",
      "```js",
      "console.log(1)",
      "```",
      "",
      "Texto real",
    ].join("\n");
    expect(extractDescription({}, body)).toBe("Texto real");
  });

  it("limpia marcadores de lista, checkboxes, citas, énfasis y enlaces", () => {
    expect(extractDescription({}, "- [ ] **Hacer** el `deploy`")).toBe(
      "Hacer el deploy",
    );
    expect(extractDescription({}, "> Ver [[Notas/Spec|la spec]] y [docs](https://x.y)")).toBe(
      "Ver la spec y docs",
    );
    expect(extractDescription({}, "1. Paso [[Otra nota]] _ya_")).toBe(
      "Paso Otra nota ya",
    );
  });

  it("recorta textos largos con elipsis", () => {
    const long = "a".repeat(400);
    const result = extractDescription({}, long);
    expect(result).toBeDefined();
    expect(result!.length).toBeLessThanOrEqual(200);
    expect(result!.endsWith("…")).toBe(true);
  });
});

describe("parseProjectTaskNote · description", () => {
  const resolve = () => "Projects/Demo/Demo.md";
  const snap = (content: string): NoteSnapshot => ({
    path: "Projects/Demo/Tarea.md",
    basename: "Tarea.md",
    content,
  });

  it("expone description en tareas desde la prop", () => {
    const parsed = parseProjectTaskNote(
      snap(
        [
          "---",
          "type: task",
          'project: "[[Demo]]"',
          "status: open",
          "created: 2026-11-09",
          "due:",
          "priority: medium",
          "description: Arreglar el login",
          "---",
          "Cuerpo ignorado",
        ].join("\n"),
      ),
      resolve,
    );
    expect(parsed.kind).toBe("task");
    if (parsed.kind !== "task") return;
    expect(parsed.task.description).toBe("Arreglar el login");
  });

  it("expone description en notas desde el cuerpo (CRLF incluido)", () => {
    const parsed = parseProjectTaskNote(
      snap(
        [
          "---",
          "type: note",
          'project: "[[Demo]]"',
          "created: 2026-11-09",
          "---",
          "# Título",
          "Apuntes de la reunión",
        ].join("\r\n"),
      ),
      resolve,
    );
    expect(parsed.kind).toBe("note");
    if (parsed.kind !== "note") return;
    expect(parsed.note.description).toBe("Apuntes de la reunión");
  });

  it("deja description undefined cuando la nota está vacía", () => {
    const parsed = parseProjectTaskNote(
      snap(
        ["---", "type: note", 'project: "[[Demo]]"', "created: 2026-11-09", "---", ""].join("\n"),
      ),
      resolve,
    );
    if (parsed.kind !== "note") throw new Error(parsed.kind);
    expect(parsed.note.description).toBeUndefined();
  });
});
