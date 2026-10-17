import { describe, it, expect } from "vitest";
import { getWeekStrip } from "../src/domain/weekStrip";

describe("getWeekStrip", () => {
  it("devuelve 7 días empezando en lunes (semana ISO) con hoy marcado", () => {
    // 17 de octubre de 2026 es sábado; su lunes es el 12.
    const strip = getWeekStrip(new Date(2026, 9, 17));
    expect(strip.days).toHaveLength(7);
    expect(strip.days.map((d) => d.day)).toEqual([
      12, 13, 14, 15, 16, 17, 18,
    ]);
    expect(strip.days.map((d) => d.weekday)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(strip.days.find((d) => d.isToday)?.day).toBe(17);
  });

  it("marca exactamente un día como hoy", () => {
    const strip = getWeekStrip(new Date(2026, 9, 17));
    expect(strip.days.filter((d) => d.isToday)).toHaveLength(1);
  });

  it("mantiene los días correctos cuando la semana cruza dos meses", () => {
    // 1 de octubre de 2026 es jueves; su lunes es el 28 de septiembre.
    const strip = getWeekStrip(new Date(2026, 9, 1));
    expect(strip.days[0]!.day).toBe(28);
    expect(strip.days[0]!.weekday).toBe(0);
    expect(strip.days[3]!.day).toBe(1);
    expect(strip.days[3]!.isToday).toBe(true);
  });

  it("deriva monthLabel del mes de today, con la primera letra en mayúscula", () => {
    expect(getWeekStrip(new Date(2026, 9, 17)).monthLabel).toBe("Octubre");
    expect(getWeekStrip(new Date(2026, 9, 1)).monthLabel).toBe("Octubre");
  });
});
