import { Plugin, PluginSettingTab, Setting } from "obsidian";
import type { PluginSettings } from "../settings";
import { mergePluginSettings, normalizeVaultFolderPath } from "../settings";
import type { CredentialSession } from "../data/CredentialSession";

/**
 * Settings tab that exposes the vault folder paths the plugin reads
 * Markdown from. Persistence is delegated to the plugin's `loadData` /
 * `saveData` cycle, so `data.json` never stores project or task records.
 * Credential key material (`credSaltB64` / `credVerifier`) is never shown
 * nor edited here — only preserved through `mergePluginSettings`.
 */
export class SettingsTab extends PluginSettingTab {
  private readonly plugin: Plugin;
  private readonly defaults: PluginSettings;

  constructor(plugin: Plugin, defaults: PluginSettings) {
    super(plugin.app, plugin);
    this.plugin = plugin;
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
  }

  private readSettings(): PluginSettings {
    // The main plugin declares a `settings` field on itself; cast to read it.
    // `mergePluginSettings` keeps the credential timeout + key material
    // that this tab never edits, so a later `saveData` cannot wipe them.
    const pluginWithSettings = this.plugin as Plugin & {
      settings?: PluginSettings;
    };
    return mergePluginSettings(this.defaults, pluginWithSettings.settings);
  }

  private async writeSettings(settings: PluginSettings): Promise<void> {
    await this.plugin.saveData(settings);
    const pluginWithSettings = this.plugin as Plugin & {
      settings?: PluginSettings;
      credentialSession?: CredentialSession;
    };
    pluginWithSettings.settings = settings;
    // A timeout change applies to the running session immediately;
    // key material itself is never touched here.
    pluginWithSettings.credentialSession?.setTimeoutMinutes(
      settings.credentialLockTimeoutMinutes,
    );
  }
}