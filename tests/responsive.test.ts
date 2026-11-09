import { describe, expect, test } from "vitest";
import { COMPACT_MAX_WIDTH, isCompactWidth } from "../src/ui/responsive";

describe("isCompactWidth", () => {
  test("el límite compacto es 640px", () => {
    expect(COMPACT_MAX_WIDTH).toBe(640);
    expect(isCompactWidth(640)).toBe(true);
    expect(isCompactWidth(641)).toBe(false);
  });

  test("un teléfono de 360px es compacto", () => {
    expect(isCompactWidth(360)).toBe(true);
  });

  test("ancho 0 (hoja oculta o sin layout) no es compacto", () => {
    expect(isCompactWidth(0)).toBe(false);
  });
});
