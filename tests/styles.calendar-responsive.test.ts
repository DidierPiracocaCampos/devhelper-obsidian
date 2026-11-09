import { describe, expect, test } from "vitest";
import {
  atRuleBodies,
  decls,
  onlyAtRule,
  readStyles,
  ruleBody,
  ruleBodyContaining,
  splitSections,
  stripComments,
} from "./helpers/cssBlocks";

const raw = readStyles();
const css = stripComments(raw);
const { calendar } = splitSections(raw);

const C640 = /^@container devhelper-calendar \(max-width: 640px\)$/;
const C480 = /^@container devhelper-calendar \(max-width: 480px\)$/;
const C380 = /^@container devhelper-calendar \(max-width: 380px\)$/;

const in640 = (selector: string) => decls(ruleBody(onlyAtRule(calendar, C640), selector));

describe("calendario: contenedor + rejilla compacta", () => {
  test("declara la hoja del calendario como contenedor", () => {
    const body = ruleBody(css, '.workspace-leaf-content[data-type="devhelper-calendar"]');
    expect(decls(body)).toContain("container: devhelper-calendar / inline-size");
  });

  test("usa container queries y no @media de ancho", () => {
    expect(atRuleBodies(calendar, /^@media[^{]*\((max|min)-width/)).toHaveLength(0);
  });

  test("celdas cuadradas en compacto", () => {
    const cell = in640(".devhelper-calendar-month-card .devhelper-calendar-cell");
    expect(cell).toContain("aspect-ratio: 1");
    expect(cell).toContain("min-height: 0");
    expect(cell).toContain("align-items: center");
    expect(cell).toContain("padding: 4px 0");
    const day = in640(".devhelper-calendar-month-card .devhelper-calendar-cell-day");
    expect(day).toContain("align-self: center");
    expect(day).toContain("margin: 0");
  });

  test("cuatro puntitos caben en la celda compacta", () => {
    const dot = in640(".devhelper-calendar-month-card .devhelper-calendar-dot");
    expect(dot).toContain("width: 5px");
    expect(dot).toContain("height: 5px");
    const dots = in640(".devhelper-calendar-month-card .devhelper-calendar-dots");
    expect(dots).toContain("gap: 2px");
    expect(dots).toContain("flex-wrap: nowrap");
  });

  test("rejilla compacta sin alto mínimo", () => {
    const grid = in640(".devhelper-calendar-month-card .devhelper-calendar-grid");
    expect(grid).toContain("min-height: 0");
    expect(grid).toContain("gap: 4px");
    expect(grid).toContain("grid-template-rows: none");
  });

  test("raíz compacta con safe area", () => {
    expect(in640(".devhelper-calendar-root")).toContain(
      "padding: 8px 8px calc(16px + env(safe-area-inset-bottom))",
    );
  });

  test("tarjeta del mes compacta", () => {
    const card = in640(".devhelper-calendar-month-card");
    expect(card).toContain("padding: 10px 8px 12px");
    expect(card).toContain("border-radius: 16px");
  });
});


describe("calendario: topbar adaptable", () => {
  const in480 = (s: string) => decls(ruleBody(onlyAtRule(calendar, C480), s));
  const in380 = (s: string) => decls(ruleBody(onlyAtRule(calendar, C380), s));

  test("«Nuevo» como icono en ≤480", () => {
    expect(in480(".devhelper-calendar-add .devhelper-calendar-add-label")).toContain(
      "display: none",
    );
    const add = in480(".devhelper-calendar-topbar .devhelper-calendar-add");
    expect(add).toContain("width: 36px");
    expect(add).toContain("padding: 0");
    expect(add).toContain("border-radius: 50%");
  });

  test("la etiqueta del mes no se recorta", () => {
    const label = in480(".devhelper-calendar-month-label");
    expect(label).toContain("white-space: nowrap");
    expect(label).toContain("font-size: 1.05em");
    expect(label).toContain("flex: 0 0 auto");
  });

  test("flechas compactas", () => {
    expect(in480(".devhelper-calendar-topbar .devhelper-calendar-nav")).toContain(
      "gap: 2px",
    );
  });

  test("topbar en dos filas en ≤380", () => {
    expect(in380(".devhelper-calendar-topbar")).toContain("flex-direction: column");
    expect(in380(".devhelper-calendar-topbar .devhelper-calendar-actions")).toContain(
      "justify-content: flex-end",
    );
  });
});

describe("calendario: panel de día compacto", () => {
  test("panel de día compacto", () => {
    const panel = in640(".devhelper-day-panel");
    expect(panel).toContain("padding: 14px 14px");
    expect(panel).toContain("border-radius: 16px");
    expect(in640(".devhelper-day-panel-header h3")).toContain("font-size: 1.1em");
  });

  test("tarjeta de evento con badges que envuelven", () => {
    expect(in640(".devhelper-event-card .devhelper-event-badges")).toContain(
      "flex-wrap: wrap",
    );
  });
});
