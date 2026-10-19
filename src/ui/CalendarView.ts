import { ItemView, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import {
  presentCalendar,
  type CalendarOccurrence,
  type CalendarPresentation,
} from "../domain/calendar";
import type {
  CalendarEventRecord,
  CalendarKind,
  DashboardData,
  ProjectRecord,
} from "../domain/types";
import type {
  CalendarEventInput,
  CalendarEventPatch,
  ProjectTaskRepository,
} from "../data/ProjectTaskRepository";
import type { PluginSettings } from "../settings";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import {
  CalendarEventFormModal,
  calendarEventToFormPayload,
  type CalendarEventFormPayload,
} from "./CalendarEventFormModal";

export const VIEW_TYPE_DEVHELPER_CALENDAR = "devhelper-calendar";

const WEEKDAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"];

const KIND_LABELS: Record<CalendarKind, string> = {
  evento: "Evento",
  reunion: "Reunión",
  fecha_limite: "Fecha límite",
  aviso: "Aviso",
};

function todayIso(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDisplayDate(iso: string): string {
  const date = parseIsoDate(iso);
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function isoIsInMonth(iso: string, year: number, month1_12: number): boolean {
  const date = parseIsoDate(iso);
  return (
    date.getFullYear() === year && date.getMonth() === month1_12 - 1
  );
}

/**
 * Vista mensual de calendario para eventos `type: calendar-event`.
 *
 * - Estado en memoria: `year`, `month` (1-12) y `selectedIsoDate`.
 * - `refresh()` recarga el repositorio y repinta.
 * - Click en una celda sólo repinta el panel de día (sin `refresh()`).
 * - Las escrituras siempre pasan por el modal o `ConfirmDeleteModal`;
 *   nunca desde un render path.
 */
export class CalendarView extends ItemView {
  private readonly repository: ProjectTaskRepository;
  private readonly settings: PluginSettings;

  private year: number;
  private month: number; // 1-12
  private selectedIsoDate: string;

  private currentData: DashboardData | null = null;
  private currentPresentation: CalendarPresentation | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    repository: ProjectTaskRepository,
    settings: PluginSettings,
  ) {
    super(leaf);
    this.repository = repository;
    this.settings = settings;

    const today = new Date();
    this.year = today.getFullYear();
    this.month = today.getMonth() + 1;
    this.selectedIsoDate = todayIso();
  }

  getViewType(): string {
    return VIEW_TYPE_DEVHELPER_CALENDAR;
  }

  getDisplayText(): string {
    return "Calendario DevHelper";
  }

  getIcon(): string {
    return "calendar-days";
  }

  async onOpen(): Promise<void> {
    this.renderEmpty();
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /**
   * Recarga datos del repositorio y repinta la vista completa.
   * Llamado al abrir y tras cualquier mutación.
   */
  async refresh(): Promise<void> {
    const data = await this.repository.load();
    const presentation = presentCalendar(data, this.year, this.month);
    this.currentData = data;
    this.currentPresentation = presentation;
    this.render();
  }

  private renderEmpty(): void {
    this.contentEl.empty();
    this.contentEl.addClass("devhelper-calendar-root");
    const panel = this.contentEl.createEl("div", {
      cls: "devhelper-day-panel",
    });
    this.appendEmptyState(panel, "loader-circle", "Cargando calendario…");
  }

  private render(): void {
    const data = this.currentData;
    const presentation = this.currentPresentation;
    if (data === null || presentation === null) return;

    this.contentEl.empty();
    this.contentEl.addClass("devhelper-calendar-root");

    this.renderTopBar(presentation);
    this.renderWeekdays();
    this.renderGrid(presentation, data);
    this.renderDayPanel(presentation, data);
  }

  private renderTopBar(presentation: CalendarPresentation): void {
    const topbar = this.contentEl.createEl("div", {
      cls: "devhelper-calendar-topbar",
    });

    const nav = topbar.createEl("div", {
      cls: "devhelper-calendar-nav",
    });

    const prevBtn = nav.createEl("button", {
      cls: "devhelper-icon-button",
      attr: { type: "button", "aria-label": "Mes anterior", title: "Mes anterior" },
    });
    setIcon(prevBtn, "chevron-left");
    prevBtn.addEventListener("click", () => this.changeMonth(-1));

    const label = nav.createEl("strong", {
      cls: "devhelper-calendar-month-label",
      text: `${presentation.monthLabel} ${this.year}`,
    });

    const todayBtn = nav.createEl("button", {
      cls: "devhelper-calendar-nav-today",
      text: "Hoy",
      attr: { type: "button", title: "Ir a hoy" },
    });
    todayBtn.addEventListener("click", () => this.goToToday());

    const nextBtn = nav.createEl("button", {
      cls: "devhelper-icon-button",
      attr: { type: "button", "aria-label": "Mes siguiente", title: "Mes siguiente" },
    });
    setIcon(nextBtn, "chevron-right");
    nextBtn.addEventListener("click", () => this.changeMonth(1));

    const addBtn = topbar.createEl("button", {
      cls: "devhelper-fab",
      attr: {
        type: "button",
        "aria-label": "Nuevo evento",
        title: "Nuevo evento",
      },
    });
    setIcon(addBtn, "plus");
    addBtn.addEventListener("click", () => this.openCreateEvent());
  }

  private renderWeekdays(): void {
    const row = this.contentEl.createEl("div", {
      cls: "devhelper-calendar-weekdays",
    });
    for (const letter of WEEKDAY_LETTERS) {
      row.createEl("span", { text: letter });
    }
  }

  private renderGrid(
    presentation: CalendarPresentation,
    data: DashboardData,
  ): void {
    const grid = this.contentEl.createEl("div", {
      cls: "devhelper-calendar-grid",
    });

    for (const week of presentation.grid) {
      for (const cell of week) {
        const cellEl = grid.createEl("button", {
          cls: "devhelper-calendar-cell",
          attr: {
            type: "button",
            "aria-label": cell.isoDate,
          },
        });
        if (!cell.inMonth) cellEl.addClass("is-outside-month");
        if (cell.isToday) cellEl.addClass("is-today");
        if (cell.isoDate === this.selectedIsoDate) {
          cellEl.addClass("is-selected");
        }

        cellEl.createEl("span", {
          cls: "devhelper-calendar-cell-day",
          text: String(cell.day),
        });

        const occurrences = presentation.byDate.get(cell.isoDate) ?? [];
        if (occurrences.length > 0) {
          const dots = cellEl.createEl("div", {
            cls: "devhelper-calendar-dots",
          });
          const seenKinds = new Set<CalendarKind>();
          for (const occurrence of occurrences) {
            const kind = occurrence.event.kind;
            if (seenKinds.has(kind)) continue;
            seenKinds.add(kind);
            dots.createEl("span", {
              cls: `devhelper-calendar-dot devhelper-dot--${kind}`,
            });
          }
        }

        cellEl.addEventListener("click", () => {
          this.selectedIsoDate = cell.isoDate;
          this.renderDayPanel(presentation, data);
        });
      }
    }
  }

  /**
   * Panel de día: lista los eventos de `selectedIsoDate`. Se repinta
   * independientemente del grid para no perder el foco ni recargar datos.
   */
  private renderDayPanel(
    presentation: CalendarPresentation,
    data: DashboardData,
  ): void {
    let panel = this.contentEl.querySelector<HTMLElement>(
      ".devhelper-day-panel",
    );
    if (panel === null) {
      panel = this.contentEl.createEl("div", { cls: "devhelper-day-panel" });
    } else {
      panel.empty();
    }

    const header = panel.createEl("div", {
      cls: "devhelper-day-panel-header",
    });
    header.createEl("h3", {
      text: formatDisplayDate(this.selectedIsoDate),
    });

    const addBtn = header.createEl("button", {
      cls: "devhelper-fab",
      attr: {
        type: "button",
        "aria-label": "Añadir aquí",
        title: "Añadir aquí",
      },
    });
    setIcon(addBtn, "plus");
    addBtn.addEventListener("click", () =>
      this.openCreateEvent(this.selectedIsoDate),
    );

    const list = panel.createEl("ul", { cls: "devhelper-task-list" });
    const occurrences = presentation.byDate.get(this.selectedIsoDate) ?? [];

    if (occurrences.length === 0) {
      const emptyItem = list.createEl("li", {
        cls: "devhelper-task-empty",
      });
      this.appendEmptyState(emptyItem, "calendar-x", "No hay eventos este día");
      return;
    }

    const titleByPath = new Map(
      data.projects.map((p) => [p.path, p.title] as const),
    );

    for (const occurrence of occurrences) {
      list.appendChild(
        this.renderEventCard(occurrence.event, titleByPath),
      );
    }
  }

  private renderEventCard(
    event: CalendarEventRecord,
    titleByPath: Map<string, string>,
  ): HTMLElement {
    const card = createEl("li", {
      cls: "devhelper-task-card devhelper-event-card",
    });
    if (event.status === "done") card.addClass("is-done");
    card.dataset["title"] = event.title;

    const main = card.createEl("div", { cls: "devhelper-task-main" });

    const titleRow = main.createEl("div", {
      cls: "devhelper-task-title-row",
    });
    titleRow.createEl("span", {
      cls: "devhelper-event-time",
      text: event.allDay ? "Todo el día" : (event.time ?? "—"),
    });
    const titleEl = titleRow.createEl("h4", {
      cls: "devhelper-task-title",
      text: event.title,
    });
    titleEl.addEventListener("click", () => this.openNote(event.path));

    const badges = main.createEl("div", {
      cls: "devhelper-event-badges",
    });
    badges.createEl("span", {
      cls: `devhelper-event-kind-badge devhelper-event-kind-badge--${event.kind}`,
      text: KIND_LABELS[event.kind],
    });
    if (event.projectPath) {
      badges.createEl("span", {
        cls: "devhelper-task-project-badge",
        text: titleByPath.get(event.projectPath) ?? event.projectPath,
      });
    }

    const actions = card.createEl("div", { cls: "devhelper-task-actions" });

    const editBtn = actions.createEl("button", {
      cls: "devhelper-icon-button devhelper-task-icon",
      attr: { type: "button", "aria-label": "Editar evento", title: "Editar" },
    });
    setIcon(editBtn, "pencil");
    editBtn.addEventListener("click", () => this.openEditEvent(event));

    const deleteBtn = actions.createEl("button", {
      cls: "devhelper-icon-button devhelper-task-icon",
      attr: {
        type: "button",
        "aria-label": "Eliminar evento",
        title: "Mover a la papelera",
      },
    });
    setIcon(deleteBtn, "trash-2");
    deleteBtn.addEventListener("click", () => this.openDeleteEvent(event));

    return card;
  }

  private appendEmptyState(
    parent: HTMLElement,
    icon: string,
    text: string,
  ): HTMLElement {
    const box = parent.createEl("div", { cls: "devhelper-empty-state" });
    const iconEl = box.createEl("span", {
      cls: "devhelper-empty-state-icon",
      attr: { "aria-hidden": "true" },
    });
    setIcon(iconEl, icon);
    box.createEl("p", { cls: "devhelper-empty-state-text", text });
    return box;
  }

  private changeMonth(delta: number): void {
    let nextMonth = this.month + delta;
    let nextYear = this.year;
    if (nextMonth < 1) {
      nextMonth = 12;
      nextYear--;
    } else if (nextMonth > 12) {
      nextMonth = 1;
      nextYear++;
    }
    this.year = nextYear;
    this.month = nextMonth;

    // Si el día seleccionado no pertenece al nuevo mes, caemos al día 1.
    if (!isoIsInMonth(this.selectedIsoDate, this.year, this.month)) {
      this.selectedIsoDate = `${this.year}-${String(this.month).padStart(2, "0")}-01`;
    }

    void this.refresh();
  }

  private goToToday(): void {
    const today = new Date();
    this.year = today.getFullYear();
    this.month = today.getMonth() + 1;
    this.selectedIsoDate = todayIso();
    void this.refresh();
  }

  private openCreateEvent(prefillDate?: string): void {
    const data = this.currentData;
    if (data === null) return;

    const initial: CalendarEventFormPayload = {
      kind: "evento",
      date: prefillDate ?? this.selectedIsoDate,
      allDay: true,
      recurrence: "none",
    };

    const modal = new CalendarEventFormModal(this.app, {
      mode: "create",
      initial,
      projects: data.projects,
      onSubmit: (payload) => void this.handleCreateSubmit(payload),
    });
    modal.open();
  }

  private openEditEvent(event: CalendarEventRecord): void {
    const data = this.currentData;
    if (data === null) return;

    const modal = new CalendarEventFormModal(this.app, {
      mode: "edit",
      initial: calendarEventToFormPayload(event),
      projects: data.projects,
      onSubmit: (payload) => void this.handleEditSubmit(event, payload),
    });
    modal.open();
  }

  private openDeleteEvent(event: CalendarEventRecord): void {
    const modal = new ConfirmDeleteModal(this.app, {
      taskTitle: event.title,
      onConfirm: async () => {
        try {
          await this.repository.deleteCalendarEvent(event.path);
          new Notice("Evento movido a la papelera.");
          await this.refresh();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("DevHelper: failed to delete calendar event", err);
          new Notice(`No se pudo eliminar el evento: ${message}`);
        }
      },
    });
    modal.open();
  }

  private async handleCreateSubmit(payload: CalendarEventFormPayload): Promise<void> {
    if (payload.title === undefined || payload.title.length === 0) {
      new Notice("El título es obligatorio.");
      return;
    }

    const input: CalendarEventInput = {
      title: payload.title,
      kind: payload.kind,
      date: payload.date,
      allDay: payload.allDay,
      recurrence: payload.recurrence,
      status: "open",
    };

    if (payload.endDate) input.endDate = payload.endDate;
    if (payload.time) input.time = payload.time;
    if (payload.recurrenceEnd) input.recurrenceEnd = payload.recurrenceEnd;
    if (payload.projectLink) input.projectLink = payload.projectLink;

    try {
      await this.repository.createCalendarEvent(input);
      new Notice("Evento creado.");
      await this.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("DevHelper: failed to create calendar event", err);
      new Notice(`No se pudo crear el evento: ${message}`);
    }
  }

  private async handleEditSubmit(
    event: CalendarEventRecord,
    payload: CalendarEventFormPayload,
  ): Promise<void> {
    const patch: Partial<CalendarEventPatch> = {
      kind: payload.kind,
      date: payload.date,
      allDay: payload.allDay,
      recurrence: payload.recurrence,
    };
    if (payload.endDate !== undefined) patch.endDate = payload.endDate;
    if (payload.time !== undefined) patch.time = payload.time;
    if (payload.recurrenceEnd !== undefined) {
      patch.recurrenceEnd = payload.recurrenceEnd;
    }
    if (payload.projectLink !== undefined) {
      patch.projectLink = payload.projectLink;
    }

    try {
      await this.repository.updateCalendarEvent(event.path, patch);
      new Notice("Evento actualizado.");
      await this.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("DevHelper: failed to update calendar event", err);
      new Notice(`No se pudo actualizar el evento: ${message}`);
    }
  }

  private openNote(path: string): void {
    void this.app.workspace.openLinkText(path, "");
  }
}
