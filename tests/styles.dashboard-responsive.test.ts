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

  test("pantallas altas conservan el reparto 2fr/1fr", () => {
    const tall = onlyAtRule(dashboard, /^@media \(min-height: 900px\)$/);
    const inner = onlyAtRule(
      tall,
      /^@container devhelper-dashboard \(min-width: 641px\)$/,
    );
    expect(decls(ruleBody(inner, ".devhelper-dashboard-root"))).toContain(
      "grid-template-rows: auto 2fr 1fr auto",
    );
  });
});


