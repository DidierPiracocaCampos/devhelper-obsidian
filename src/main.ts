import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, type PluginSettings } from "./settings";
import { SettingsTab } from "./ui/SettingsTab";
import { ProjectTaskRepository } from "./data/ProjectTaskRepository";
import { ObsidianVaultAdapter } from "./data/ObsidianVaultAdapter";
import {
  DashboardView,
  VIEW_TYPE_DEVHELPER_DASHBOARD,
} from "./ui/DashboardView";

/**
 * DevHelper Dashboard - Obsidian plugin entry point.
 *
 * Lifecycle:
 *  1. Merge persisted settings over the defaults.
 *  2. Build the vault adapter and the repository once the settings are
 *     available.
 *  3. Register the settings tab, the dashboard view, the command and
 *     the ribbon button.
 *  4. On unload, let Obsidian dispose of registered views/commands
 *     automatically.
 */
export default class DevHelperDashboardPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  repository!: ProjectTaskRepository;

  async onload(): Promise<void> {
    this.settings = mergeSettings(DEFAULT_SETTINGS, await this.loadData());

    const adapter = new ObsidianVaultAdapter(this.app);
    this.repository = new ProjectTaskRepository(adapter, this.settings);

    this.addSettingTab(new SettingsTab(this, DEFAULT_SETTINGS));

    this.registerView(
      VIEW_TYPE_DEVHELPER_DASHBOARD,
      (leaf) =>
        new DashboardView(leaf, this.app, this.repository, this.settings!),
    );

    this.addCommand({
      id: "open-dashboard",
      name: "Abrir el dashboard de proyectos y tareas",
      callback: () => this.activateDashboardView(),
    });

    this.addRibbonIcon(
      "layout-dashboard",
      "Abrir dashboard DevHelper",
      () => this.activateDashboardView(),
    );

    console.log(`${this.manifest.name} v${this.manifest.version} loaded`);
  }

  onunload(): void {
    // Nothing to clean up explicitly: Obsidian tears down registered
    // views, commands and ribbon icons when the plugin unloads.
  }

  /**
   * Open (or focus) the dashboard view in a new tab in the main
   * workspace leaf. The brief is explicit about the leaf strategy: a
   * tab leaf means the dashboard never replaces the user's current
   * note in the editor pane.
   */
  async activateDashboardView(): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: VIEW_TYPE_DEVHELPER_DASHBOARD,
      active: true,
    });
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