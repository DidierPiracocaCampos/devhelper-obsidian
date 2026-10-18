import { App, Modal, Notice, Setting } from "obsidian";
import type { CredentialInput } from "../data/ProjectTaskRepository";

/**
 * Payload returned by `CredentialFormModal.onSubmit`.
 */
export interface CredentialFormPayload extends CredentialInput {}

/**
 * Modal that prompts for one credential entry.
 *
 *  - `mode: "create"` — every field starts empty.
 *  - `mode: "edit"`   — fields are pre-filled from `initial` (already
 *    decrypted by the caller; the modal never sees blobs).
 *
 * The modal never talks to the repository directly. `onSubmit` may be
 * async: the modal stays open with the typed text intact until it
 * resolves, and a rejection keeps it open showing the error message.
 * Validation: non-empty `service`, non-empty `user` and non-empty
 * `password`.
 */
export class CredentialFormModal extends Modal {
  private readonly mode: "create" | "edit";
  private readonly initial: CredentialInput;
  private readonly onSubmit: (payload: CredentialFormPayload) => void | Promise<void>;

  private serviceInput!: HTMLInputElement;
  private userInput!: HTMLInputElement;
  private passwordInput!: HTMLInputElement;
  private urlInput!: HTMLInputElement;
  private notesInput!: HTMLInputElement;
  private errorEl!: HTMLElement;

  constructor(
    app: App,
    options: {
      mode: "create" | "edit";
      initial?: CredentialInput;
      onSubmit: (payload: CredentialFormPayload) => void | Promise<void>;
    },
  ) {
    super(app);
    this.mode = options.mode;
    this.initial = options.initial ?? {
      service: "",
      user: "",
      password: "",
      url: "",
      notes: "",
    };
    this.onSubmit = options.onSubmit;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.setText(
      this.mode === "create" ? "Nueva credencial" : "Editar credencial",
    );

    const form = contentEl.createEl("div", { cls: "devhelper-form" });

    new Setting(form)
      .setName("Servicio")
      .setDesc("Nombre visible sin cifrar (p. ej. «Hosting»).")
      .addText((text) => {
        text.setPlaceholder("Hosting").setValue(this.initial.service);
        this.serviceInput = text.inputEl;
      });

    new Setting(form)
      .setName("Usuario")
      .setDesc("Se guardará cifrado.")
      .addText((text) => {
        text.setPlaceholder("admin").setValue(this.initial.user);
        this.userInput = text.inputEl;
      });

    new Setting(form)
      .setName("Contraseña")
      .setDesc("Se guardará cifrada.")
      .addText((text) => {
        text.setPlaceholder("••••••••").setValue(this.initial.password);
        text.inputEl.type = "password";
        this.passwordInput = text.inputEl;
      })
      .addToggle((toggle) => {
        toggle.setTooltip("Mostrar contraseña").onChange((visible) => {
          this.passwordInput.type = visible ? "text" : "password";
        });
      });

    new Setting(form)
      .setName("URL")
      .setDesc("Opcional. Se guardará cifrada.")
      .addText((text) => {
        text
          .setPlaceholder("https://…")
          .setValue(this.initial.url ?? "");
        this.urlInput = text.inputEl;
      });

    new Setting(form)
      .setName("Notas")
      .setDesc("Opcional. Se guardará cifrada.")
      .addText((text) => {
        text.setPlaceholder("cuenta principal").setValue(this.initial.notes ?? "");
        this.notesInput = text.inputEl;
      });

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
    const payload: CredentialFormPayload = {
      service: this.serviceInput.value.trim(),
      user: this.userInput.value,
      password: this.passwordInput.value,
      url: this.urlInput.value.trim(),
      notes: this.notesInput.value.trim(),
    };
    if (payload.service.length === 0) {
      this.showError("El servicio no puede estar vacío.");
      return;
    }
    if (payload.user.length === 0) {
      this.showError("El usuario no puede estar vacío.");
      return;
    }
    if (payload.password.length === 0) {
      this.showError("La contraseña no puede estar vacía.");
      return;
    }
    this.hideError();
    // An async `onSubmit` keeps the modal open until the save resolves:
    // a rejection (e.g. the session expired between opening and saving)
    // shows the error with the typed text intact instead of closing.
    void (async () => {
      try {
        await this.onSubmit(payload);
        this.close();
      } catch (err) {
        this.showError(
          err instanceof Error && err.message.length > 0
            ? err.message
            : "No se pudo guardar.",
        );
      }
    })();
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
 * Modal for the global master password.
 *
 *  - `mode: "create"` — asks twice and requires a minimum length; used
 *    the first time, before any salt exists.
 *  - `mode: "unlock"` — asks once; the caller verifies against the stored
 *    verifier and surfaces `"Contraseña incorrecta."` on failure.
 *
 * The modal never persists anything; the caller derives, verifies and
 * stores the key material.
 */
export class MasterPasswordModal extends Modal {
  private readonly mode: "create" | "unlock";
  private readonly onSubmit: (password: string) => void;

  private passwordInput!: HTMLInputElement;
  private confirmInput!: HTMLInputElement | null;
  private errorEl!: HTMLElement;

  constructor(
    app: App,
    options: {
      mode: "create" | "unlock";
      onSubmit: (password: string) => void;
    },
  ) {
    super(app);
    this.mode = options.mode;
    this.onSubmit = options.onSubmit;
    this.confirmInput = null;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.setText(
      this.mode === "create"
        ? "Crear contraseña maestra"
        : "Desbloquear credenciales",
    );

    const form = contentEl.createEl("div", { cls: "devhelper-form" });
    form.createEl("p", {
      text:
        this.mode === "create"
          ? "Protege todas las credenciales con una única contraseña maestra. Si la olvidas, no hay recuperación posible."
          : "Introduce la contraseña maestra para ver y editar las credenciales.",
    });

    new Setting(form)
      .setName("Contraseña maestra")
      .addText((text) => {
        text.setPlaceholder("••••••••");
        text.inputEl.type = "password";
        this.passwordInput = text.inputEl;
      });

    if (this.mode === "create") {
      new Setting(form)
        .setName("Repite la contraseña")
        .addText((text) => {
          text.setPlaceholder("••••••••");
          text.inputEl.type = "password";
          this.confirmInput = text.inputEl;
        });
    }

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
          .setButtonText(this.mode === "create" ? "Crear" : "Desbloquear")
          .setCta()
          .onClick(() => this.submit()),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /**
   * Show a verification failure without closing the modal, so the user
   * can retry without losing the typed password. The caller closes the
   * modal explicitly on success (verification is async).
   */
  showError(message: string): void {
    // `onOpen` always runs before any submit path that reaches here.
    this.errorEl.setText(message);
    this.errorEl.show();
  }

  private submit(): void {
    const password = this.passwordInput.value;
    if (password.length === 0) {
      this.showError("La contraseña no puede estar vacía.");
      return;
    }
    if (this.mode === "create") {
      if (password.length < 8) {
        this.showError("La contraseña debe tener al menos 8 caracteres.");
        return;
      }
      if (this.confirmInput !== null && this.confirmInput.value !== password) {
        this.showError("Las contraseñas no coinciden.");
        return;
      }
    }
    this.errorEl.hide();
    this.onSubmit(password);
  }
}

/**
 * Generic destructive-action confirmation with Spanish copy provided by
 * the caller. Unlike `ConfirmDeleteModal` (whose copy promises the
 * Obsidian trash), this one is honest about irreversible actions.
 */
export class ConfirmModal extends Modal {
  private readonly title: string;
  private readonly message: string;
  private readonly confirmText: string;
  private readonly onConfirm: () => void | Promise<void>;

  constructor(
    app: App,
    options: {
      title: string;
      message: string;
      confirmText: string;
      onConfirm: () => void | Promise<void>;
    },
  ) {
    super(app);
    this.title = options.title;
    this.message = options.message;
    this.confirmText = options.confirmText;
    this.onConfirm = options.onConfirm;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.setText(this.title);

    const form = contentEl.createEl("div", { cls: "devhelper-form" });
    form.createEl("p", { text: this.message });

    const buttonRow = form.createEl("div", { cls: "devhelper-form-actions" });
    new Setting(buttonRow)
      .addButton((btn) =>
        btn.setButtonText("Cancelar").onClick(() => this.close()),
      )
      .addButton((btn) =>
        btn
          .setButtonText(this.confirmText)
          .setCta()
          .onClick(() => {
            void (async () => {
              try {
                await this.onConfirm();
                this.close();
              } catch (err) {
                console.error("DevHelper: confirm action failed", err);
                new Notice("No se pudo completar la acción.");
              }
            })();
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
