/**
 * Función pura `weekStrip`: calcula la semana ISO (lunes–domingo) que contiene
 * a `today` y el nombre del mes en español, para la tarjeta de calendario del
 * dashboard. Sin imports de Obsidian (capa de dominio pura y determinista).
 */

export interface WeekDay {
  /** Día del mes (1-31). */
  day: number;
  /** 0 = lunes … 6 = domingo (ISO). */
  weekday: number;
  /** true si coincide con el día de hoy. */
  isToday: boolean;
}

export interface WeekStrip {
  /** Nombre del mes en español (ej. "Octubre"). */
  monthLabel: string;
  /**
   * Año de la semana, como texto (ej. "2026"). Se expone aparte del mes para
   * que la UI pueda componer «Mes Año» sin releer el `Date`.
   */
  year: string;
  days: WeekDay[];
}

export function getWeekStrip(today: Date): WeekStrip {
  // Lunes de la semana ISO que contiene a `today` (fecha local).
  const monday = new Date(today);
  const offset = (today.getDay() + 6) % 7;
  monday.setDate(today.getDate() - offset);

  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    days.push({
      day: date.getDate(),
      weekday: i,
      isToday:
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate(),
    });
  }

  const monthName = new Intl.DateTimeFormat("es-ES", { month: "long" }).format(
    today
  );
  const monthLabel = monthName.charAt(0).toUpperCase() + monthName.slice(1);

  return { monthLabel, year: String(today.getFullYear()), days };
}
