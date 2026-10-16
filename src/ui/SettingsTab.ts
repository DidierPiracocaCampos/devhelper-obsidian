import { Plugin, PluginSettingTab, Setting } from "obsidian";
import type { PluginSettings } from "../settings";
import { normalizeVaultFolderPath } from "../settings";

/**
 * Settings tab that exposes the two vault folder paths the plugin reads
 * Markdown from. Persistence is delegated to the plugin's `loadData` /
 * `saveData` cycle, so `data.json` never stores project or task records.
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
      .setName("Tasks folder")
      .setDesc("Vault-relative folder that stores task Markdown notes.")
      .addText((text) => {
        text.setValue(settings.tasksFolder).onChange(async (value) => {
          settings.tasksFolder = normalizeVaultFolderPath(
            value,
            this.defaults.tasksFolder,
          );
          await this.writeSettings(settings);
        });
      });
  }

  private readSettings(): PluginSettings {
    // The main plugin declares a `settings` field on itself; cast to read it.
    const pluginWithSettings = this.plugin as Plugin & {
      settings?: PluginSettings;
    };
    if (!pluginWithSettings.settings) {
      return {
        projectsFolder: this.defaults.projectsFolder,
        tasksFolder: this.defaults.tasksFolder,
      };
    }
    return {
      projectsFolder: normalizeVaultFolderPath(
        pluginWithSettings.settings.projectsFolder,
        this.defaults.projectsFolder,
      ),
      tasksFolder: normalizeVaultFolderPath(
        pluginWithSettings.settings.tasksFolder,
        this.defaults.tasksFolder,
      ),
    };
  }

  private async writeSettings(settings: PluginSettings): Promise<void> {
    await this.plugin.saveData(settings);
    const pluginWithSettings = this.plugin as Plugin & {
      settings?: PluginSettings;
    };
    pluginWithSettings.settings = settings;
  }
}