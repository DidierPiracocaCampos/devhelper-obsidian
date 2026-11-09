import { describe, expect, test } from "vitest";
import {
  atRuleBodies,
  decls,
  onlyAtRule,
  readStyles,
  ruleBody,
  splitSections,
  stripComments,
} from "./helpers/cssBlocks";

const raw = readStyles();
const css = stripComments(raw);
const { dashboard } = splitSections(raw);

const C640 = /^@container devhelper-dashboard \(max-width: 640px\)$/;
const C380 = /^@container devhelper-dashboard \(max-width: 380px\)$/;

describe("dashboard: base de container queries", () => {
  test("declara la hoja del dashboard como contenedor", () => {
    const body = ruleBody(
      css,
      '.workspace-leaf-content[data-type="devhelper-dashboard"]',
    );
    expect(decls(body)).toContain("container: devhelper-dashboard / inline-size");
  });

  test("usa container queries y no @media de ancho", () => {
    expect(atRuleBodies(dashboard, /^@media[^{]*\((max|min)-width/)).toHaveLength(0);
  });

  test("compacto apila en columna", () => {
    const body = onlyAtRule(dashboard, C640);
    expect(decls(ruleBody(body, ".devhelper-dashboard-root"))).toContain(
      "flex-direction: column",
    );
  });

  test("mínimo apila la tarjeta", () => {
    const body = onlyAtRule(dashboard, C380);
    expect(decls(ruleBody(body, ".devhelper-task-card"))).toContain(
      "flex-direction: column",
    );
  });

  test("pantallas altas (>900px) conservan el reparto 2fr/1fr", () => {
    const tall = onlyAtRule(dashboard, /^@media \(min-height: 900px\)$/);
    const inner = onlyAtRule(
      tall,
      /^@container devhelper-dashboard \(min-width: 901px\)$/,
    );
    expect(decls(ruleBody(inner, ".devhelper-dashboard-root"))).toContain(
      "grid-template-rows: auto 2fr 1fr auto",
    );
  });
});


const C900 = /^@container devhelper-dashboard \(max-width: 900px\)$/;

describe("dashboard: escalón medio (≤900px)", () => {
  test("medio: tareas + rail, calendario debajo", () => {
    const body = onlyAtRule(dashboard, C900);
    expect(decls(ruleBody(body, ".devhelper-dashboard-root"))).toContain(
      "grid-template-columns: 1fr auto",
    );
    expect(decls(ruleBody(body, ".devhelper-side-column"))).toContain(
      "grid-column: 1 / -1",
    );
  });

  test("medio: el mini-calendario reparte los días", () => {
    const body = onlyAtRule(dashboard, C900);
    expect(
      decls(ruleBody(body, ".devhelper-calendar .devhelper-calendar-day")),
    ).toContain("flex: 1 1 0");
    expect(decls(ruleBody(body, ".devhelper-calendar-weekdays span"))).toContain(
      "flex: 1 1 0",
    );
  });

  test("el buscador nunca supera su contenedor", () => {
    expect(decls(ruleBody(dashboard, ".devhelper-search-wrap"))).toContain(
      "max-width: 100%",
    );
  });
});
