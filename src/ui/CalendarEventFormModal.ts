import { App, Modal, Setting } from "obsidian";
import type {
  CalendarEventRecord,
  CalendarKind,
  CalendarRecurrence,
  ProjectRecord,
} from "../domain/types";

/**
 * Payload produced by `CalendarEventFormModal`.
 *
 * - `title` is only meaningful in create mode (the repo cannot rename an
 *   event note; editing the title is done by opening the note).
 * - `endDate`, `time`, `recurrenceEnd` and `projectLink` use `null` to
 *   mean "clear this property" and `undefined` to mean "do not touch it".
 *   The view casts to `Partial<CalendarEventPatch>` because the repo type
 *   only declares `string | undefined` even though it handles `null` at
 *   runtime.
 */
export interface CalendarEventFormPayload {
  title?: string;
  kind: CalendarKind;
  date: string;
  endDate?: string | null;
  time?: string | null;
  allDay: boolean;
  recurrence: CalendarRecurrence;
  recurrenceEnd?: string | null;
  projectLink?: string | null;
}

const KIND_LABELS: Record<CalendarKind, string> = {
  evento: "Evento",
  reunion: "Reunión",
  fecha_limite: "Fecha límite",
  aviso: "Aviso",
};

const RECURRENCE_LABELS: Record<CalendarRecurrence, string> = {
  none: "Ninguna",
  daily: "Diaria",
  weekly: "Semanal",
  monthly: "Mensual",
  yearly: "Anual",
};

function todayIso(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Modal de creación/edición de eventos de calendario.
 *
 * En edición no se ofrece cambiar el título: renombrar un evento implica
 * cambiar el nombre de archivo, y eso no está soportado por
 * `updateCalendarEvent`. El usuario puede renombrar abriendo la nota.
 */
export class CalendarEventFormModal extends Modal {
  private readonly mode: "create" | "edit";
  private readonly initial: CalendarEventFormPayload;
  private readonly projects: ProjectRecord[];
  private readonly onSubmit: (payload: CalendarEventFormPayload) => void;

  private titleInput!: HTMLInputElement;
  private kindSelect!: HTMLSelectElement;
  private dateInput!: HTMLInputElement;
  private multiDayCheckbox!: HTMLInputElement;
  private endDateInput!: HTMLInputElement;
  private allDayCheckbox!: HTMLInputElement;
  private timeInput!: HTMLInputElement;
  private recurrenceSelect!: HTMLSelectElement;
  private recurrenceEndInput!: HTMLInputElement;
  private projectSelect!: HTMLSelectElement;
  private errorEl!: HTMLElement;

  constructor(
    app: App,
    options: {
      mode: "create" | "edit";
      initial?: CalendarEventFormPayload;
      projects: ProjectRecord[];
      onSubmit: (payload: CalendarEventFormPayload) => void;
    },
  ) {
    super(app);
    this.mode = options.mode;
    // Filtramos General: los eventos globales no tienen proyecto; el resto
    // puede vincularse a cualquier proyecto no-sombra.
    this.projects = options.projects.filter((p) => !p.isGeneral);
    this.onSubmit = options.onSubmit;
    this.initial = options.initial ?? {
      kind: "evento",
      date: todayIso(),
      allDay: true,
      recurrence: "none",
    };
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();

    if (this.mode === "create") {
      titleEl.setText("Nuevo evento");
    } else {
      // Mostramos el título en la cabecera del modal porque no hay campo.
      titleEl.setText(`Editar evento: ${this.initial.title ?? ""}`);
    }

    const form = contentEl.createEl("div", { cls: "devhelper-form" });

    if (this.mode === "create") {
      new Setting(form)
        .setName("Título")
        .setDesc("Título visible del evento.")
        .addText((text) => {
          text.setPlaceholder("Mi evento").setValue(this.initial.title ?? "");
          this.titleInput = text.inputEl;
        })
        .setClass("devhelper-form-row");
    }

    new Setting(form)
      .setName("Tipo")
      .setDesc("Tipo de evento.")
      .addDropdown((dropdown) => {
        const kinds: CalendarKind[] = [
          "evento",
          "reunion",
          "fecha_limite",
          "aviso",
        ];
        for (const kind of kinds) {
          dropdown.addOption(kind, KIND_LABELS[kind]);
        }
        dropdown.setValue(this.initial.kind);
        this.kindSelect = dropdown.selectEl;
      })
      .setClass("devhelper-form-row");

    new Setting(form)
      .setName("Fecha")
      .setDesc("Fecha de inicio.")
      .addText((text) => {
        text.inputEl.type = "date";
        text.setValue(this.initial.date);
        this.dateInput = text.inputEl;
      })
      .setClass("devhelper-form-row");

    // Fila: checkbox "varios días" + fecha fin.
    const multiDayRow = form.createEl("div", {
      cls: "devhelper-form-row devhelper-form-inline",
    });
    const multiDayLabel = multiDayRow.createEl("label", {
      cls: "devhelper-checkbox-label",
    });
    this.multiDayCheckbox = multiDayLabel.createEl("input", {
      type: "checkbox",
    });
    multiDayLabel.appendText(" Varios días");

    new Setting(multiDayRow)
      .setName("Fecha fin")
      .addText((text) => {
        text.inputEl.type = "date";
        text.setValue(this.initial.endDate ?? "");
        this.endDateInput = text.inputEl;
      })
      .setClass("devhelper-form-row");

    const hasEndDate =
      this.initial.endDate !== undefined && this.initial.endDate !== null;
    this.multiDayCheckbox.checked = hasEndDate;
    this.endDateInput.disabled = !hasEndDate;
    this.multiDayCheckbox.addEventListener("change", () => {
      this.endDateInput.disabled = !this.multiDayCheckbox.checked;
      if (!this.multiDayCheckbox.checked) {
        this.endDateInput.value = "";
      }
    });

    // Fila: checkbox "todo el día" + hora.
    const allDayRow = form.createEl("div", {
      cls: "devhelper-form-row devhelper-form-inline",
    });
    const allDayLabel = allDayRow.createEl("label", {
      cls: "devhelper-checkbox-label",
    });
    this.allDayCheckbox = allDayLabel.createEl("input", { type: "checkbox" });
    allDayLabel.appendText(" Todo el día");

    new Setting(allDayRow)
      .setName("Hora")
      .addText((text) => {
        text.inputEl.type = "time";
        text.setValue(this.initial.time ?? "");
        this.timeInput = text.inputEl;
      })
      .setClass("devhelper-form-row");

    this.allDayCheckbox.checked = this.initial.allDay;
    this.timeInput.disabled = this.initial.allDay;
    this.allDayCheckbox.addEventListener("change", () => {
      this.timeInput.disabled = this.allDayCheckbox.checked;
      if (this.allDayCheckbox.checked) {
        this.timeInput.value = "";
      }
    });

    new Setting(form)
      .setName("Recurrencia")
      .addDropdown((dropdown) => {
        const recurrences: CalendarRecurrence[] = [
          "none",
          "daily",
          "weekly",
          "monthly",
          "yearly",
        ];
        for (const r of recurrences) {
          dropdown.addOption(r, RECURRENCE_LABELS[r]);
        }
        dropdown.setValue(this.initial.recurrence);
        this.recurrenceSelect = dropdown.selectEl;
      })
      .setClass("devhelper-form-row");

    new Setting(form)
      .setName("Fin de recurrencia")
      .setDesc("Opcional.")
      .addText((text) => {
        text.inputEl.type = "date";
        text.setValue(this.initial.recurrenceEnd ?? "");
        this.recurrenceEndInput = text.inputEl;
      })
      .setClass("devhelper-form-row");

    new Setting(form)
      .setName("Proyecto")
      .setDesc("Opcional. Sin proyecto el evento es global.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "— Ninguno (global) —");
        for (const project of this.projects) {
          dropdown.addOption(project.path, project.title);
        }
        dropdown.setValue(this.initial.projectLink ?? "");
        this.projectSelect = dropdown.selectEl;
      })
      .setClass("devhelper-form-row");

    this.errorEl = form.createEl("p", {
      cls: "devhelper-form-error",
      attr: { role: "alert" },
    });
    this.errorEl.hide();

    const buttonRow = form.createEl("div", { cls: "devhelper-form-actions" });
    new Setting(buttonRow)
      .addButton((btn) => btn.setButtonText("Cancelar").onClick(() => this.close()))
      .addButton((btn) =>
        btn.setButtonText("Guardar").setCta().onClick(() => this.submit()),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private submit(): void {
    if (this.mode === "create") {
      const title = this.titleInput.value.trim();
      if (title.length === 0) {
        this.showError("El título es obligatorio.");
        return;
      }
      this.initial.title = title;
    }

    const kind = this.kindSelect.value as CalendarKind;

    const date = this.dateInput.value;
    if (!isValidIsoDate(date)) {
      this.showError("Selecciona una fecha de inicio válida.");
      return;
    }

    let endDate: string | null | undefined = undefined;
    if (this.multiDayCheckbox.checked) {
      const end = this.endDateInput.value;
      if (!isValidIsoDate(end)) {
        this.showError("Selecciona una fecha de fin válida.");
        return;
      }
      if (end < date) {
        this.showError("La fecha de fin no puede ser anterior a la de inicio.");
        return;
      }
      endDate = end;
    } else {
      endDate = null;
    }

    const allDay = this.allDayCheckbox.checked;
    let time: string | null | undefined = undefined;
    if (!allDay) {
      const t = this.timeInput.value;
      if (!isValidTime(t)) {
        this.showError("Introduce una hora válida (HH:mm).");
        return;
      }
      time = t;
    } else {
      time = null;
    }

    const recurrence = this.recurrenceSelect.value as CalendarRecurrence;

    let recurrenceEnd: string | null | undefined = undefined;
    const re = this.recurrenceEndInput.value;
    if (re.length > 0) {
      if (!isValidIsoDate(re)) {
        this.showError("La fecha de fin de recurrencia no es válida.");
        return;
      }
      if (re < date) {
        this.showError(
          "La fin de recurrencia no puede ser anterior a la fecha de inicio.",
        );
        return;
      }
      recurrenceEnd = re;
    } else {
      recurrenceEnd = null;
    }

    const projectLink = this.projectSelect.value || null;

    this.hideError();

    const payload: CalendarEventFormPayload = {
      ...(this.mode === "create" && this.initial.title !== undefined
        ? { title: this.initial.title }
        : {}),
      kind,
      date,
      endDate,
      time,
      allDay,
      recurrence,
      recurrenceEnd,
      projectLink,
    };

    this.onSubmit(payload);
    this.close();
  }

  private showError(message: string): void {
    this.errorEl.setText(message);
    this.errorEl.show();
  }

  private hideError(): void {
    this.errorEl.setText("");
    this.errorEl.hide();
  }
}

/**
 * Build the initial payload for editing an existing calendar event.
 * Exported so the view can feed it straight into the modal.
 */
export function calendarEventToFormPayload(
  event: CalendarEventRecord,
): CalendarEventFormPayload {
  return {
    title: event.title,
    kind: event.kind,
    date: event.date,
    endDate: event.endDate ?? null,
    time: event.time ?? null,
    allDay: event.allDay,
    recurrence: event.recurrence,
    recurrenceEnd: event.recurrenceEnd ?? null,
    projectLink: event.projectPath ?? null,
  };
}
