import { App, Modal, Setting } from "obsidian";

/**
 * Payload returned by `ProjectFormModal.onSubmit`. The path is only
 * populated when the modal is editing an existing project; create flows
 * leave it undefined so the repository is free to choose a unique name.
 */
export interface ProjectFormPayload {
  title: string;
  path?: string;
}

/**
 * Modal that prompts for a project title. Two modes:
 *
 *  - `mode: "create"` - title-only, used by the "+ Nuevo proyecto"
 *    button.
 *  - `mode: "edit"`   - title + path of the project being renamed.
 *
 * The modal intentionally knows nothing about the repository; it just
 * surfaces the resulting payload through `onSubmit` so the caller can
 * drive `createProject` / `renameProject`. Validation is local:
 * non-empty title required.
 */
export class ProjectFormModal extends Modal {
  private readonly mode: "create" | "edit";
  private readonly initial: ProjectFormPayload;
  private readonly onSubmit: (payload: ProjectFormPayload) => void;

  private titleInput!: HTMLInputElement;
  private errorEl!: HTMLElement;

  constructor(
    app: App,
    options: {
      mode: "create" | "edit";
      initial?: ProjectFormPayload;
      onSubmit: (payload: ProjectFormPayload) => void;
    },
  ) {
    super(app);
    this.mode = options.mode;
    this.initial = options.initial ?? { title: "" };
    this.onSubmit = options.onSubmit;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.setText(
      this.mode === "create" ? "Nuevo proyecto" : "Editar proyecto",
    );

    const form = contentEl.createEl("div", { cls: "devhelper-form" });

    const titleField = new Setting(form)
      .setName("Título")
      .setDesc(
        this.mode === "create"
          ? "Nombre visible del proyecto nuevo."
          : "Nuevo nombre del proyecto.",
      )
      .addText((text) => {
        text.setPlaceholder("Mi proyecto").setValue(this.initial.title);
        this.titleInput = text.inputEl;
      });
    titleField.setClass("devhelper-form-row");

    this.errorEl = form.createEl("p", {
      cls: "devhelper-form-error",
      attr: { role: "alert" },
    });
    this.errorEl.hide();

    const buttonRow = form.createEl("div", { cls: "devhelper-form-actions" });
    new Setting(buttonRow)
      .addButton((btn) =>
        btn.setButtonText("Cancelar").onClick(() => this.close()),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Guardar")
          .setCta()
          .onClick(() => this.submit()),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private submit(): void {
    const title = this.titleInput.value.trim();
    if (title.length === 0) {
      this.showError("El título es obligatorio.");
      return;
    }
    this.hideError();
    const payload: ProjectFormPayload = {
      title,
      ...(this.initial.path !== undefined
        ? { path: this.initial.path }
        : {}),
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