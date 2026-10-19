import { describe, it, expect } from "vitest";
import { expandOccurrences, presentCalendar } from "../src/domain/calendar";
import type {
  CalendarEventRecord,
  CalendarKind,
  CalendarRecurrence,
  DashboardData,
} from "../src/domain/types";

function makeEvent(init: {
  path: string;
  title?: string;
  kind?: CalendarKind;
  date: string;
  endDate?: string;
  time?: string;
  allDay?: boolean;
  recurrence?: CalendarRecurrence;
  recurrenceEnd?: string;
}): CalendarEventRecord {
  return {
    path: init.path,
    title: init.title ?? "Evento",
    kind: init.kind ?? "evento",
    date: init.date,
    endDate: init.endDate,
    time: init.time,
    allDay: init.allDay ?? true,
    recurrence: init.recurrence ?? "none",
    recurrenceEnd: init.recurrenceEnd,
    status: "open",
    properties: {},
  };
}

function makeData(events: CalendarEventRecord[]): DashboardData {
  return {
    projects: [],
    tasks: [],
    notes: [],
    credentials: [],
    files: [],
    issues: [],
    calendarEvents: events,
  };
}

describe("expandOccurrences", () => {
  it("un rango genera una entrada por cada día inclusivo del mes", () => {
    // Rango 2026-11-04..2026-11-06 expande 3 días.
    const rango = makeEvent({
      path: "Calendario/Vacaciones.md",
      title: "Vacaciones",
      date: "2026-11-04",
      endDate: "2026-11-06",
    });
    const map = expandOccurrences([rango], 2026, 11);
    expect(map.get("2026-11-05")?.length).toBe(1);
    expect(map.get("2026-11-04")?.[0].occurrenceDate).toBe("2026-11-04");
    expect(map.get("2026-11-06")?.[0].occurrenceDate).toBe("2026-11-06");
    expect(map.has("2026-11-03")).toBe(false);
    expect(map.has("2026-11-07")).toBe(false);
  });

  it("un evento puntual fuera del mes pedido no aparece", () => {
    const e = makeEvent({ path: "Calendario/Navidad.md", date: "2026-12-25" });
    expect(expandOccurrences([e], 2026, 11).size).toBe(0);
  });

  it("daily corta en recurrenceEnd (incluido)", () => {
    const e = makeEvent({
      path: "Calendario/Recordatorio.md",
      date: "2026-11-04",
      recurrence: "daily",
      recurrenceEnd: "2026-11-06",
    });
    expect([...expandOccurrences([e], 2026, 11).keys()].sort()).toEqual([
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
    ]);
  });

  it("weekly emite cada 7 días y recurrenceEnd corta la serie", () => {
    const e = makeEvent({
      path: "Calendario/Standup.md",
      date: "2026-11-04",
      recurrence: "weekly",
      recurrenceEnd: "2026-11-18",
    });
    expect([...expandOccurrences([e], 2026, 11).keys()].sort()).toEqual([
      "2026-11-04",
      "2026-11-11",
      "2026-11-18",
    ]);
  });

  it("weekly sin recurrenceEnd corta a 6 meses desde date", () => {
    const e = makeEvent({
      path: "Calendario/Semanal.md",
      date: "2026-11-04",
      recurrence: "weekly",
    });
    // Noviembre: las 4 ocurrencias del mes.
    expect([...expandOccurrences([e], 2026, 11).keys()].sort()).toEqual([
      "2026-11-04",
      "2026-11-11",
      "2026-11-18",
      "2026-11-25",
    ]);
    // Última ocurrencia dentro del tope (2026-11-04 + 6 meses = 2027-05-04).
    expect(expandOccurrences([e], 2027, 4).get("2027-04-28")).toBeDefined();
    expect(expandOccurrences([e], 2027, 5).size).toBe(0);
    expect(expandOccurrences([e], 2027, 6).size).toBe(0);
  });

  it("daily sin recurrenceEnd corta exactamente 6 meses después (tope inclusivo)", () => {
    const e = makeEvent({
      path: "Calendario/Diario.md",
      date: "2026-11-04",
      recurrence: "daily",
    });
    const mayo = expandOccurrences([e], 2027, 5);
    expect([...mayo.keys()].sort()).toEqual([
      "2027-05-01",
      "2027-05-02",
      "2027-05-03",
      "2027-05-04",
    ]);
    expect(expandOccurrences([e], 2027, 6).size).toBe(0);
  });

  it("monthly repite el mismo día y omite los meses sin ese día (31 de enero)", () => {
    const e = makeEvent({
      path: "Calendario/FinDeMes.md",
      date: "2026-01-31",
      recurrence: "monthly",
    });
    expect(expandOccurrences([e], 2026, 1).get("2026-01-31")).toBeDefined();
    // Febrero no tiene día 31: se omite, no se desplaza al día 28.
    expect(expandOccurrences([e], 2026, 2).size).toBe(0);
    expect(expandOccurrences([e], 2026, 3).get("2026-03-31")).toBeDefined();
    expect(expandOccurrences([e], 2026, 4).size).toBe(0);
    expect(expandOccurrences([e], 2026, 7).get("2026-07-31")).toBeDefined();
    // Tope 6 meses (2026-07-31): agosto ya queda fuera.
    expect(expandOccurrences([e], 2026, 8).size).toBe(0);
  });

  it("yearly repite mismo mes/día cuando recurrenceEnd lo permite", () => {
    const e = makeEvent({
      path: "Calendario/Aniversario.md",
      date: "2026-03-15",
      recurrence: "yearly",
      recurrenceEnd: "2028-12-31",
    });
    expect(expandOccurrences([e], 2026, 3).get("2026-03-15")).toBeDefined();
    expect(expandOccurrences([e], 2027, 3).get("2027-03-15")).toBeDefined();
    expect(expandOccurrences([e], 2028, 3).get("2028-03-15")).toBeDefined();
    expect(expandOccurrences([e], 2027, 4).size).toBe(0);
  });

  it("yearly sin recurrenceEnd solo llega a los 6 meses", () => {
    const e = makeEvent({
      path: "Calendario/Anual.md",
      date: "2026-03-15",
      recurrence: "yearly",
    });
    expect(expandOccurrences([e], 2026, 3).get("2026-03-15")).toBeDefined();
    expect(expandOccurrences([e], 2027, 3).size).toBe(0);
  });

  it("combina rango con recurrencia: cada bloque se repite completo", () => {
    const e = makeEvent({
      path: "Calendario/Vacaciones.md",
      date: "2026-11-04",
      endDate: "2026-11-06",
      recurrence: "weekly",
      recurrenceEnd: "2026-11-20",
    });
    expect([...expandOccurrences([e], 2026, 11).keys()].sort()).toEqual([
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
    ]);
  });

  it("los bloques solapados no duplican el mismo evento en un día", () => {
    const e = makeEvent({
      path: "Calendario/Camino.md",
      date: "2026-11-04",
      endDate: "2026-11-06",
      recurrence: "daily",
      recurrenceEnd: "2026-11-05",
    });
    const map = expandOccurrences([e], 2026, 11);
    expect(map.get("2026-11-05")).toHaveLength(1);
    expect(map.get("2026-11-06")).toHaveLength(1);
    expect(map.get("2026-11-07")).toHaveLength(1);
  });

  it("un endDate anterior a date no lanza: se trata como día puntual", () => {
    const e = makeEvent({
      path: "Calendario/Roto.md",
      date: "2026-11-06",
      endDate: "2026-11-04",
    });
    const map = expandOccurrences([e], 2026, 11);
    expect([...map.keys()]).toEqual(["2026-11-06"]);
  });

  it("ordena cada día: allDay primero → hora → título insensible a mayúsculas → path", () => {
    const events = [
      makeEvent({ path: "Calendario/zeta.md", title: "Zeta", date: "2026-11-04", time: "22:00", allDay: false }),
      makeEvent({ path: "Calendario/beta.md", title: "Beta", date: "2026-11-04", time: "09:00", allDay: false }),
      makeEvent({ path: "Calendario/alfa-bis.md", title: "alfa", date: "2026-11-04", time: "09:00", allDay: false }),
      makeEvent({ path: "Calendario/comida.md", title: "Comida", date: "2026-11-04", time: "13:00", allDay: false }),
      makeEvent({ path: "Calendario/todo-el-dia.md", title: "Todo el día", date: "2026-11-04" }),
    ];
    const list = expandOccurrences(events, 2026, 11).get("2026-11-04");
    expect(list?.map((o) => o.event.title)).toEqual([
      "Todo el día",
      "alfa",
      "Beta",
      "Comida",
      "Zeta",
    ]);
  });

  it("desempata por path cuando coinciden hora y título", () => {
    const events = [
      makeEvent({ path: "Calendario/b-cita.md", title: "Cita", date: "2026-11-04", time: "10:00", allDay: false }),
      makeEvent({ path: "Calendario/a-cita.md", title: "CITA", date: "2026-11-04", time: "10:00", allDay: false }),
    ];
    const list = expandOccurrences(events, 2026, 11).get("2026-11-04");
    expect(list?.map((o) => o.event.path)).toEqual([
      "Calendario/a-cita.md",
      "Calendario/b-cita.md",
    ]);
  });
});

describe("presentCalendar", () => {
  it("combina grid, byDate ordenado, counts por tipo y monthLabel", () => {
    const data = makeData([
      makeEvent({ path: "Calendario/Fiesta.md", title: "Fiesta", date: "2026-11-04", kind: "evento" }),
      makeEvent({ path: "Calendario/Otra fiesta.md", title: "Otra fiesta", date: "2026-11-20", kind: "evento" }),
      makeEvent({
        path: "Calendario/Reunion.md",
        title: "Reunión",
        date: "2026-11-04",
        kind: "reunion",
        time: "10:30",
        allDay: false,
      }),
    ]);
    const p = presentCalendar(data, 2026, 11);
    expect(p.monthLabel).toBe("Noviembre");
    expect(p.grid.flat()).toHaveLength(42);
    // allDay primero dentro del mismo día.
    expect(p.byDate.get("2026-11-04")?.map((o) => o.event.title)).toEqual([
      "Fiesta",
      "Reunión",
    ]);
    expect(p.byDate.get("2026-11-20")?.[0].occurrenceDate).toBe("2026-11-20");
    expect(p.counts).toEqual({
      evento: 2,
      reunion: 1,
      fecha_limite: 0,
      aviso: 0,
    });
  });

  it("counts agrega las ocurrencias del mes (recurrencia incluida)", () => {
    const data = makeData([
      makeEvent({
        path: "Calendario/Semanal.md",
        date: "2026-11-04",
        recurrence: "weekly",
      }),
    ]);
    const p = presentCalendar(data, 2026, 11);
    expect(p.counts.evento).toBe(4); // 4, 11, 18 y 25 de noviembre
  });

  it("sin calendarEvents (campo aún ausente) no lanza y devuelve vacío", () => {
    const data: DashboardData = {
      projects: [],
      tasks: [],
      notes: [],
      credentials: [],
      files: [],
      issues: [],
    };
    const p = presentCalendar(data, 2026, 11);
    expect(p.grid.flat()).toHaveLength(42);
    expect(p.byDate.size).toBe(0);
    expect(p.counts).toEqual({
      evento: 0,
      reunion: 0,
      fecha_limite: 0,
      aviso: 0,
    });
    expect(p.monthLabel).toBe("Noviembre");
  });
});
