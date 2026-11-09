import { Notice, Plugin, PluginSettingTab, Setting, setIcon } from "obsidian";
import type { PluginSettings } from "../settings";
import { applySettingsEdit, mergePluginSettings, normalizeVaultFolderPath } from "../settings";
import type { CredentialSession } from "../data/CredentialSession";
import type { ToolbarButtonRepository } from "../data/ToolbarButtonRepository";

/**
 * Settings tab that exposes the vault folder paths the plugin reads
 * Markdown from. Persistence is delegated to the plugin's `loadData` /
 * `saveData` cycle, so `data.json` never stores project or task records.
 * Credential key material (`credSaltB64` / `credVerifier`) is never shown
 * nor edited here — only preserved through `mergePluginSettings`.
 */
/**
 * Lo que la pestaña necesita del plugin. Es una interfaz propia (y no
 * `Plugin`) porque `Plugin.settings` solo existe desde Obsidian 1.13 y el
 * plugin declara `minAppVersion` 1.9.0.
 */
export interface SettingsHost {
  settings: PluginSettings;
  credentialSession?: CredentialSession;
  saveData(data: unknown): Promise<void>;
  buttonRepository: ToolbarButtonRepository;
  openNote(path: string): void;
  refreshViews(): void;
}

export class SettingsTab extends PluginSettingTab {
  private readonly host: SettingsHost;
  private readonly defaults: PluginSettings;

  constructor(plugin: Plugin, host: SettingsHost, defaults: PluginSettings) {
    super(plugin.app, plugin);
    this.host = host;
    this.defaults = defaults;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const settings = this.readSettings();

    new Setting(containerEl)
      .setName("Projects folder")
      .setDesc("Vault-relative folder that stores project Markdown notes.")
      .addText((text) => {
        text.setValue(settings.projectsFolder).onChange(async (value) => {
          settings.projectsFolder = normalizeVaultFolderPath(
            value,
            this.defaults.projectsFolder,
          );
          await this.writeSettings(settings);
        });
      });

    new Setting(containerEl)
      .setName("Carpeta de plantillas")
      .setDesc(
        "Carpeta del vault donde se siembran las plantillas. Por defecto «Plantillas».",
      )
      .addText((text) => {
        text.setValue(settings.templatesFolder).onChange(async (value) => {
          settings.templatesFolder = normalizeVaultFolderPath(
            value,
            this.defaults.templatesFolder,
          );
          await this.writeSettings(settings);
        });
      });

    new Setting(containerEl)
      .setName("Carpeta de calendario")
      .setDesc(
        "Carpeta del vault donde se guardan los eventos del calendario. Por defecto «Calendario».",
      )
      .addText((text) => {
        text.setValue(settings.calendarFolder).onChange(async (value) => {
          settings.calendarFolder = normalizeVaultFolderPath(
            value,
            this.defaults.calendarFolder,
          );
          await this.writeSettings(settings);
        });
      });

    new Setting(containerEl)
      .setName("Carpeta de plantillas de calendario")
      .setDesc(
        "Carpeta del vault donde se siembran las plantillas de eventos. Por defecto «Plantillas/Calendario».",
      )
      .addText((text) => {
        text.setValue(settings.calendarTemplatesFolder).onChange(async (value) => {
          settings.calendarTemplatesFolder = normalizeVaultFolderPath(
            value,
            this.defaults.calendarTemplatesFolder,
          );
          await this.writeSettings(settings);
        });
      });

    new Setting(containerEl)
      .setName("Bloqueo de credenciales (minutos)")
      .setDesc(
        "Minutos sin usar las credenciales antes de volver a pedir la contraseña maestra.",
      )
      .addText((text) => {
        text.setValue(String(settings.credentialLockTimeoutMinutes)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          settings.credentialLockTimeoutMinutes =
            Number.isFinite(parsed) && parsed > 0
              ? parsed
              : this.defaults.credentialLockTimeoutMinutes;
          await this.writeSettings(settings);
        });
      });

    this.renderButtonsSection(containerEl, settings);
  }

  private renderButtonsSection(
    containerEl: HTMLElement,
    settings: PluginSettings,
  ): void {
    new Setting(containerEl).setName("Botones de la barra").setHeading();

    new Setting(containerEl)
      .setName("Carpeta de botones")
      .setDesc("Carpeta del vault con las notas de botón. Por defecto «Botones».")
      .addText((text) => {
        text.setValue(settings.buttonsFolder);
        // Sólo al confirmar (blur/Enter): cada tecla crearía carpetas basura.
        text.inputEl.addEventListener("change", () => {
          void this.run("guardar la carpeta", async () => {
            settings.buttonsFolder = text.getValue();
            await this.writeSettings(settings);
            settings.buttonsFolder = this.host.settings.buttonsFolder;
            text.setValue(settings.buttonsFolder);
            await this.renderButtonList(listEl);
          });
        });
      });

    new Setting(containerEl)
      .setName("Permitir botones con código")
      .setDesc(
        "Ejecuta el JavaScript de las notas de botón con acceso completo al vault y, en escritorio, al sistema. Actívalo sólo si confías en esas notas.",
      )
      .addToggle((toggle) => {
        toggle.setValue(settings.allowButtonScripts).onChange(async (value) => {
          settings.allowButtonScripts = value;
          await this.writeSettings(settings);
        });
      });

    const listEl = containerEl.createDiv({ cls: "devhelper-settings-buttons" });
    void this.renderButtonList(listEl);

    new Setting(containerEl).addButton((button) => {
      button
        .setButtonText("Crear botón")
        .setCta()
        .onClick(() => {
          void this.run("crear el botón", async () => {
            const path = await this.host.buttonRepository.createButton("Nuevo botón");
            this.host.openNote(path);
            await this.renderButtonList(listEl);
          });
        });
    });
  }

  private async renderButtonList(listEl: HTMLElement): Promise<void> {
    let buttons;
    try {
      ({ buttons } = await this.host.buttonRepository.load());
    } catch (error) {
      new Notice(`No se pudo cargar los botones: ${errorMessage(error)}`);
      return;
    }
    listEl.empty();
    if (buttons.length === 0) {
      listEl.createEl("p", {
        text: "No hay botones. Crea uno o pide a tu IA que lo haga (skill devhelper-buttons).",
        cls: "setting-item-description",
      });
      return;
    }
    for (const record of buttons) {
      const setting = new Setting(listEl).setDesc(
        record.action.kind === "menu"
          ? `${record.action.options.length} opciones`
          : "Acción directa",
      );
      const iconEl = setting.nameEl.createSpan({
        cls: "devhelper-settings-button-icon",
      });
      setIcon(iconEl, record.icon);
      setting.nameEl.createSpan({ text: ` ${record.label}` });
      setting.addToggle((toggle) => {
        toggle.setValue(record.enabled).onChange((value) => {
          void this.run("cambiar el botón", async () => {
            await this.host.buttonRepository.setButtonEnabled(record.path, value);
            this.host.refreshViews();
          });
        });
      });
      setting.addButton((button) => {
        button.setButtonText("Abrir").onClick(() => {
          this.host.openNote(record.path);
        });
      });
    }
  }

  private async run(what: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      new Notice(`No se pudo ${what}: ${errorMessage(error)}`);
    }
  }

  private readSettings(): PluginSettings {
    // `mergePluginSettings` keeps the credential timeout + key material
    // that this tab never edits, so a later `saveData` cannot wipe them.
    return mergePluginSettings(this.defaults, this.host.settings);
  }

  private async writeSettings(edited: PluginSettings): Promise<void> {
    // Normaliza (carpeta de botones, booleano estricto) antes de guardar.
    const settings = applySettingsEdit(
      this.defaults,
      this.host.settings,
      edited,
    );
    await this.host.saveData(settings);
    this.host.settings = settings;
    this.host.refreshViews();
    // A timeout change applies to the running session immediately;
    // key material itself is never touched here.
    this.host.credentialSession?.setTimeoutMinutes(
      settings.credentialLockTimeoutMinutes,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
