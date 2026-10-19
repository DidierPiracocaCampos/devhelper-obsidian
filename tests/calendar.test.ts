import { describe, it, expect } from "vitest";
import { formatMonthLabel, getMonthGrid } from "../src/domain/calendar";

describe("getMonthGrid", () => {
  it("octubre 2026: 6x7 = 42 celdas, primera celda lunes 2026-09-28", () => {
    const grid = getMonthGrid(2026, 10);
    expect(grid.flat().length).toBe(42);
    expect(grid).toHaveLength(6);
    expect(grid[0]).toHaveLength(7);

    // Lunes 28 de septiembre abre la rejilla (fuera de mes).
    expect(grid[0][0].isoDate).toBe("2026-09-28");
    expect(grid[0][0].day).toBe(28);
    expect(grid[0][0].inMonth).toBe(false);

    // 1 de octubre de 2026 es jueves → cuarta celda de la primera fila.
    expect(grid[0][3].isoDate).toBe("2026-10-01");
    expect(grid[0][3].day).toBe(1);
    expect(grid[0][3].inMonth).toBe(true);

    expect(grid[1][0].isoDate).toBe("2026-10-05");
    // La rejilla siempre son 6 filas: la última celda es domingo 2026-11-08.
    expect(grid[5][6].isoDate).toBe("2026-11-08");
  });

  it("marca exactamente una celda como hoy cuando se inyecta today", () => {
    const grid = getMonthGrid(2026, 10, new Date(2026, 9, 15));
    const todays = grid.flat().filter((c) => c.isToday);
    expect(todays).toHaveLength(1);
    expect(todays[0].isoDate).toBe("2026-10-15");
  });

  it("sin celdas de hoy cuando today cae fuera del mes mostrado", () => {
    const grid = getMonthGrid(2026, 10, new Date(2026, 5, 15));
    expect(grid.flat().some((c) => c.isToday)).toBe(false);
  });

  it("febrero 2028 (bisiesto) trae 29 días y mantiene 6 filas", () => {
    const grid = getMonthGrid(2028, 2, new Date(2000, 0, 1));
    const inMonth = grid.flat().filter((c) => c.inMonth);
    expect(grid.flat().length).toBe(42);
    expect(inMonth).toHaveLength(29);
    expect(inMonth[0].isoDate).toBe("2028-02-01");
    expect(inMonth[28].isoDate).toBe("2028-02-29");

    // 1 de febrero de 2028 es martes → lunes 31 de enero abre la rejilla.
    expect(grid[0][0].isoDate).toBe("2028-01-31");
    expect(grid[0][1].isoDate).toBe("2028-02-01");
    expect(grid.flat().some((c) => c.isToday)).toBe(false);
  });

  it("cruza el año sin marcar enero de 2027 como inMonth (diciembre 2026)", () => {
    const grid = getMonthGrid(2026, 12, new Date(2000, 0, 1));
    const inMonth = grid.flat().filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth[0].isoDate).toBe("2026-12-01");
    expect(inMonth[30].isoDate).toBe("2026-12-31");

    // 1 de diciembre de 2026 es martes → lunes 30 de noviembre abre la rejilla.
    expect(grid[0][0].isoDate).toBe("2026-11-30");
    expect(grid[0][0].inMonth).toBe(false);
    // La última celda cae en enero de 2027 y tampoco pertenece al mes.
    expect(grid[5][6].isoDate).toBe("2027-01-10");
    expect(grid[5][6].inMonth).toBe(false);
  });
});

describe("formatMonthLabel", () => {
  it("devuelve el mes en español con mayúscula inicial (igual que weekStrip)", () => {
    expect(formatMonthLabel(2026, 10)).toBe("Octubre");
    expect(formatMonthLabel(2028, 2)).toBe("Febrero");
    expect(formatMonthLabel(2026, 1)).toBe("Enero");
    expect(formatMonthLabel(2026, 12)).toBe("Diciembre");
  });
});
