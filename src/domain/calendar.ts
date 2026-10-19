/**
 * Dominio puro del calendario mensual (plan
 * `2026-10-19-calendario-mensual`). Sin imports de Obsidian: solo tipos
 * de `./types`, determinismo total y texto derivado de `Intl` en
 * español.
 *
 * Tres piezas reutilizadas por `CalendarView`, por el lateral del
 * dashboard y por los tests:
 *
 *  - `getMonthGrid(year, month1_12, today?)` → rejilla fija 6×7 de
 *    lunes a domingo con `isoDate`, `inMonth` e `isToday`.
 *  - `expandOccurrences(events, year, month)` → expansión VIRTUAL de
 *    rangos inclusivos y recurrencias a un `Map<isoDate, ocurrencias>`
 *    limitado al mes pedido: nunca se materializan notas. Recurrencia
 *    sin `recurrenceEnd` topa a 6 meses desde `date`; un evento no se
 *    duplica dos veces en el mismo día aunque los bloques se solapen.
 *  - `presentCalendar(data, year, month)` → `{ monthLabel, grid, byDate,
 *    counts }` con orden determinista por día: `allDay primero → time →
 *    title case-insensitive → path`.
 *
 * Ninguna función lanza: fechas corruptas se ignoran (el parser ya las
 * convierte en `DashboardIssue` en español).
 */

import type {
  CalendarEventRecord,
  CalendarKind,
  CalendarRecurrence,
  DashboardData,
} from "./types";

/**
 * Una celda de la rejilla mensual. `isoDate` es `YYYY-MM-DD` en fecha
 * local; `inMonth` la distingue de los días de relleno de los meses
 * vecinos; `isToday` se calcula contra `today` (hoy por defecto).
 */
export interface MonthCell {
  isoDate: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
}

/**
 * Un evento materializado en un día concreto del mes. `event.date` (y
 * `endDate`) conservan la fecha original de la nota;
 * `occurrenceDate` es el día del que cuelga la entrada en el `Map`
 * (p. ej. la 2ª vuelta de un `weekly` o cada día de un rango).
 */
export interface CalendarOccurrence {
  event: CalendarEventRecord;
  occurrenceDate: string;
}

/**
 * Resultado de `presentCalendar`: la rejilla a pintar, las ocurrencias
 * agrupadas por día (solo días del mes con eventos) y el total de
 * ocurrencias del mes por tipo (leyenda / empty state).
 */
export interface CalendarPresentation {
  /** Nombre del mes en español con mayúscula inicial (ej. "Octubre"). */
  monthLabel: string;
  grid: MonthCell[][];
  byDate: Map<string, CalendarOccurrence[]>;
  counts: Record<CalendarKind, number>;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM-DD` en fecha local (evita el desfase UTC de `toISOString`). */
function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function isValidIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const parsed = parseIsoDate(iso);
  // Round-trip: descarta valores como "2026-13-40" que `Date` rueda.
  return !Number.isNaN(parsed.getTime()) && toIsoDate(parsed) === iso;
}

function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Suma días como aritmética de calendario (inmune a husos/DST). */
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function diffDays(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** Mismo día del mes `months` después; clamp al último día si no existe. */
function addMonthsClamped(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  const day = Math.min(date.getDate(), lastDay);
  return new Date(target.getFullYear(), target.getMonth(), day);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Nombre del mes en español con la primera letra en mayúscula, igual
 * que `weekStrip.monthLabel`.
 */
export function formatMonthLabel(year: number, month1_12: number): string {
  const monthName = new Intl.DateTimeFormat("es-ES", { month: "long" }).format(
    new Date(year, month1_12 - 1, 1),
  );
  return monthName.charAt(0).toUpperCase() + monthName.slice(1);
}

/**
 * Rejilla fija de 6 filas × 7 columnas (lunes → domingo) que cubre el
 * mes pedido. La primera celda es el lunes de la semana del día 1 (misma
 * fórmula ISO que `weekStrip`), así que siempre hay 42 celdas aunque el
 * mes sea corto.
 */
export function getMonthGrid(
  year: number,
  month1_12: number,
  today: Date = new Date(),
): MonthCell[][] {
  const firstOfMonth = new Date(year, month1_12 - 1, 1);
  const offsetToMonday = (firstOfMonth.getDay() + 6) % 7;
  const cursor = addDays(firstOfMonth, -offsetToMonday);

  const grid: MonthCell[][] = [];
  for (let week = 0; week < 6; week++) {
    const row: MonthCell[] = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      row.push({
        isoDate: toIsoDate(cursor),
        day: cursor.getDate(),
        inMonth:
          cursor.getFullYear() === year &&
          cursor.getMonth() === month1_12 - 1,
        isToday: isSameDay(cursor, today),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Siguiente cursor de recurrencia, o `null` cuando ese día no existe
 * (mensual sin día 31, anual 29-feb en no bisiesto): en ese caso la
 * ocurrencia se OMITE, nunca se desplaza a otro día.
 */
function advanceCursor(
  cursor: Date,
  recurrence: CalendarRecurrence,
  start: Date,
): Date | null {
  switch (recurrence) {
    case "daily":
      return addDays(cursor, 1);
    case "weekly":
      return addDays(cursor, 7);
    case "monthly": {
      const day = start.getDate();
      // 24 meses bastan: como mucho hay que saltar febrero.
      for (let i = 1; i <= 24; i++) {
        const candidate = new Date(
          cursor.getFullYear(),
          cursor.getMonth() + i,
          day,
        );
        if (candidate.getDate() === day) return candidate;
      }
      return null;
    }
    case "yearly": {
      const day = start.getDate();
      const month = start.getMonth();
      // 8 años cubren el peor salto entre bisiestos (4 u 8).
      for (let i = 1; i <= 8; i++) {
        const candidate = new Date(
          cursor.getFullYear() + i,
          month,
          day,
        );
        if (
          candidate.getMonth() === month &&
          candidate.getDate() === day
        ) {
          return candidate;
        }
      }
      return null;
    }
    default:
      return null; // "none": el caller corta tras el primer bloque.
  }
}

/**
 * Días (ISO) en los que `event` ocurre dentro de `[monthStart, monthEnd]`.
 * Bloque = `[cursor .. cursor + (endDate - date)]`; para `recurrence:
 * "none"` el único bloque es el propio evento. Nunca lanza: fechas
 * inválidas se ignoran y un `endDate < date` se trata como día puntual.
 */
function occurrencesInMonth(
  event: CalendarEventRecord,
  monthStart: Date,
  monthEnd: Date,
): string[] {
  if (!isValidIsoDate(event.date)) return [];
  const start = parseIsoDate(event.date);
  const end =
    event.endDate !== undefined && isValidIsoDate(event.endDate)
      ? parseIsoDate(event.endDate)
      : start;
  const durationDays = Math.max(0, diffDays(start, end));

  // Tope de expansión: recurrenceEnd válido o 6 meses desde `date`.
  let limit = addMonthsClamped(start, 6);
  if (
    event.recurrence !== "none" &&
    event.recurrenceEnd !== undefined &&
    isValidIsoDate(event.recurrenceEnd)
  ) {
    const parsedEnd = parseIsoDate(event.recurrenceEnd);
    if (parsedEnd.getTime() >= start.getTime()) limit = parsedEnd;
  }

  const monthStartIso = toIsoDate(monthStart);
  const monthEndIso = toIsoDate(monthEnd);
  const dates = new Set<string>();
  const cursor = new Date(start);
  let iterations = 0;

  // Corte duro anti-bucles con datos corruptos: 100 000 pasos son más de
  // 270 años de `daily`. En la práctica se sale mucho antes vía `limit`
  // o vía el break por `monthEnd`.
  while (cursor.getTime() <= limit.getTime() && iterations < 100_000) {
    iterations++;
    const blockStartIso = toIsoDate(cursor);
    // El bloque empieza ya después del mes consultado: al ser los
    // bloques monótonos crecientes, ningún cursor posterior puede caer
    // dentro del mes.
    if (blockStartIso > monthEndIso) break;
    // Bloque [cursor..cursor+duración] recortado al mes consultado.
    const blockEndIso = toIsoDate(addDays(cursor, durationDays));
    const fromIso =
      blockStartIso > monthStartIso ? blockStartIso : monthStartIso;
    const toIso = blockEndIso < monthEndIso ? blockEndIso : monthEndIso;
    if (fromIso <= toIso) {
      const last = parseIsoDate(toIso);
      for (
        let day = parseIsoDate(fromIso);
        day.getTime() <= last.getTime();
        day = addDays(day, 1)
      ) {
        dates.add(toIsoDate(day));
      }
    }

    if (event.recurrence === "none") break;
    const next = advanceCursor(cursor, event.recurrence, start);
    if (next === null) break;
    cursor.setTime(next.getTime());
  }

  return [...dates];
}

function compareIgnoreCase(a: string, b: string): number {
  const lowerA = a.toLocaleLowerCase();
  const lowerB = b.toLocaleLowerCase();
  if (lowerA < lowerB) return -1;
  if (lowerA > lowerB) return 1;
  return 0;
}

/**
 * Orden determinista dentro de un día: `allDay primero → time → title
 * case-insensitive → path` (regla global del plan). Un evento sin hora
 * y sin `allDay` ordena antes que los que sí traen `time`.
 */
function compareOccurrences(
  a: CalendarOccurrence,
  b: CalendarOccurrence,
): number {
  // Rank 0 = todo el día (primero), 1 = con hora.
  const allDayCmp =
    (a.event.allDay ? 0 : 1) - (b.event.allDay ? 0 : 1);
  if (allDayCmp !== 0) return allDayCmp;

  const timeA = a.event.time ?? "";
  const timeB = b.event.time ?? "";
  if (timeA < timeB) return -1;
  if (timeA > timeB) return 1;

  const titleCmp = compareIgnoreCase(a.event.title, b.event.title);
  if (titleCmp !== 0) return titleCmp;

  if (a.event.path < b.event.path) return -1;
  if (a.event.path > b.event.path) return 1;
  return 0;
}

/**
 * Expansión virtual de eventos al mes `year/month1_12`: cada evento
 * genera bloques `[date .. endDate ?? date]`; con `recurrence: "none"`
 * solo se emite si el bloque cruza el mes, y con el resto se desplaza el
 * cursor (`+1d`, `+7d`, mismo día del mes siguiente, mismo mes/día del
 * año siguiente) hasta `recurrenceEnd ?? date + 6 meses`, emitiendo cada
 * bloque solapado con el mes. La expansión nunca escribe notas.
 *
 * El `Map` solo contiene días del mes pedido que tienen al menos una
 * ocurrencia; cada lista sale ordenada con `compareOccurrences`.
 */
export function expandOccurrences(
  events: CalendarEventRecord[],
  year: number,
  month1_12: number,
): Map<string, CalendarOccurrence[]> {
  const monthStart = new Date(year, month1_12 - 1, 1);
  const monthEnd = new Date(year, month1_12, 0); // último día del mes
  const result = new Map<string, CalendarOccurrence[]>();

  for (const event of events) {
    for (const iso of occurrencesInMonth(event, monthStart, monthEnd)) {
      let list = result.get(iso);
      if (list === undefined) {
        list = [];
        result.set(iso, list);
      }
      // Sin duplicados por evento y día: el Set vive en
      // `occurrencesInMonth` (bloques solapados de rangos recurrentes).
      list.push({ event, occurrenceDate: iso });
    }
  }

  for (const list of result.values()) {
    list.sort(compareOccurrences);
  }
  return result;
}

/**
 * Presentación completa de un mes para la vista: rejilla, ocurrencias
 * por día (ordenadas) y totales del mes por tipo. Pura y total: con
 * `calendarEvents` ausente devuelve rejilla + vacíos, nunca lanza.
 */
export function presentCalendar(
  data: DashboardData,
  year: number,
  month1_12: number,
): CalendarPresentation {
  const grid = getMonthGrid(year, month1_12);
  const byDate = expandOccurrences(
    data.calendarEvents ?? [],
    year,
    month1_12,
  );

  const counts: Record<CalendarKind, number> = {
    evento: 0,
    reunion: 0,
    fecha_limite: 0,
    aviso: 0,
  };
  for (const list of byDate.values()) {
    for (const occurrence of list) {
      counts[occurrence.event.kind] += 1;
    }
  }

  return {
    monthLabel: formatMonthLabel(year, month1_12),
    grid,
    byDate,
    counts,
  };
}
