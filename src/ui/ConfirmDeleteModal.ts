import { App, Modal } from "obsidian";

export interface ConfirmDeleteOptions {
  /** Nombre de la tarea que se muestra en la pregunta. */
  taskTitle: string;
  /** Se ejecuta al pulsar «Mover a la papelera». Puede ser asíncrono. */
  onConfirm: () => void | Promise<void>;
}

/**
 * Confirmación en español antes de mandar una tarea a la papelera.
 * El borrado es recuperable (papelera de Obsidian), pero se pide
 * confirmación explícita porque la acción saca la nota del dashboard.
 */
export class ConfirmDeleteModal extends Modal {
  private readonly options: ConfirmDeleteOptions;

  constructor(app: App, options: ConfirmDeleteOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("devhelper-form");
    contentEl.createEl("h3", { text: "Mover a la papelera" });
    contentEl.createEl("p", {
      text: `¿Mover «${this.options.taskTitle}» a la papelera? Se puede recuperar desde la papelera de Obsidian.`,
    });
    const actions = contentEl.createEl("div", {
      cls: "devhelper-form-actions",
    });
    const cancel = actions.createEl("button", {
      cls: "devhelper-button",
      text: "Cancelar",
    });
    cancel.addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", {
      cls: "devhelper-button",
      text: "Mover a la papelera",
    });
    confirm.addEventListener("click", () => {
      void (async () => {
        await this.options.onConfirm();
        this.close();
      })();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
