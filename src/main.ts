import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, type PluginSettings } from "./settings";
import { SettingsTab } from "./ui/SettingsTab";

/**
 * DevHelper Dashboard - Obsidian plugin entry point.
 *
 * The settings tab exposes the two folder paths the dashboard reads
 * Markdown from. Views, commands, ribbon buttons, and the vault event
 * wiring are added in later tasks.
 */
export default class DevHelperDashboardPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    this.settings = mergeSettings(DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new SettingsTab(this, DEFAULT_SETTINGS));
    console.log(`${this.manifest.name} v${this.manifest.version} loaded`);
  }

  onunload(): void {
    // Nothing to clean up yet.
  }
}

/**
 * Merge persisted plugin data over the defaults. Unknown keys in the
 * persisted blob are ignored so a future schema can extend defaults
 * without losing the user's existing values.
 */
function mergeSettings(
  defaults: PluginSettings,
  persisted: unknown,
): PluginSettings {
  if (!persisted || typeof persisted !== "object") return { ...defaults };
  const candidate = persisted as Partial<PluginSettings>;
  return {
    projectsFolder:
      typeof candidate.projectsFolder === "string"
        ? candidate.projectsFolder
        : defaults.projectsFolder,
    tasksFolder:
      typeof candidate.tasksFolder === "string"
        ? candidate.tasksFolder
        : defaults.tasksFolder,
  };
}