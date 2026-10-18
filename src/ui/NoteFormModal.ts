import { App, Modal, Setting } from "obsidian";
import type { ProjectRecord } from "../domain/types";

export interface NoteFormPayload {
  title: string;
  projectPath: string;
  path?: string;
}

export class NoteFormModal extends Modal {
  private readonly mode: "create" | "edit";
  private readonly initial: NoteFormPayload;
  private readonly projects: ProjectRecord[];
  private readonly defaultProjectPath: string | null;
  private readonly onSubmit: (payload: NoteFormPayload) => void;

  private titleInput!: HTMLInputElement;
  private projectSelect!: HTMLSelectElement;
  private errorEl!: HTMLElement;

  constructor(
    app: App,
    options: {
      mode: "create" | "edit";
      initial?: NoteFormPayload;
      projects: ProjectRecord[];
      defaultProjectPath: string | null;
      onSubmit: (payload: NoteFormPayload) => void;
    },
  ) {
    super(app);
    this.mode = options.mode;
    this.projects = options.projects;
    this.defaultProjectPath = options.defaultProjectPath;
    this.onSubmit = options.onSubmit;
    if (options.initial) {
      this.initial = options.initial;
    } else {
      const fallbackProject =
        options.defaultProjectPath ??
        (options.projects.length > 0 ? options.projects[0]!.path : "");
      this.initial = { title: "", projectPath: fallbackProject };
    }
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.setText(this.mode === "create" ? "Nueva nota" : "Editar nota");

    const form = contentEl.createEl("div", { cls: "devhelper-form" });

    new Setting(form)
      .setName("Título")
      .setDesc("Título visible de la nota.")
      .addText((text) => {
        text.setPlaceholder("Mi nota").setValue(this.initial.title);
        this.titleInput = text.inputEl;
      })
      .setClass("devhelper-form-row");

    new Setting(form)
      .setName("Proyecto")
      .setDesc("Proyecto al que pertenece la nota.")
      .addDropdown((dropdown) => {
        for (const project of this.projects) {
          dropdown.addOption(project.path, project.title);
        }
        if (
          this.initial.projectPath !== "" &&
          !this.projects.some(
            (p) => p.path === this.initial.projectPath,
          )
        ) {
          dropdown.addOption(this.initial.projectPath, "(proyecto no disponible)");
        }
        dropdown.setValue(this.initial.projectPath);
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
    const projectPath = this.projectSelect.value;
    if (title.length === 0) {
      this.showError("El título es obligatorio.");
      return;
    }
    if (projectPath.length === 0) {
      this.showError("Selecciona un proyecto.");
      return;
    }
    this.hideError();
    const payload: NoteFormPayload = {
      title,
      projectPath,
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
