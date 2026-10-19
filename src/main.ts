import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, type PluginSettings } from "./settings";
import { SettingsTab } from "./ui/SettingsTab";
import { CredentialSession } from "./data/CredentialSession";
import { ProjectTaskRepository } from "./data/ProjectTaskRepository";
import { ObsidianVaultAdapter } from "./data/ObsidianVaultAdapter";
import {
  DashboardView,
  VIEW_TYPE_DEVHELPER_DASHBOARD,
} from "./ui/DashboardView";
import {
  CalendarView,
  VIEW_TYPE_DEVHELPER_CALENDAR,
} from "./ui/CalendarView";

/**
 * DevHelper Dashboard - Obsidian plugin entry point.
 *
 * Lifecycle:
 *  1. Merge persisted settings over the defaults.
 *  2. Build the vault adapter and the repository once the settings are
 *     available.
 *  3. Register the settings tab, the dashboard view, the command and
 *     the ribbon button.
 *  4. Subscribe to vault and metadata-cache events so external edits
 *     refresh the dashboard view automatically (debounced).
 *  5. On unload, Obsidian tears down every `registerEvent`/`registerView`
 *     subscription we own.
 */
export default class DevHelperDashboardPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  repository!: ProjectTaskRepository;
  /** In-memory master-key session. Never persisted; see `CredentialSession`. */
  credentialSession!: CredentialSession;

  /**
   * Handle for the pending debounced refresh. We use a `number` because
   * `setTimeout` returns an integer in the browser/Electron runtime;
   * storing `null` means "no refresh scheduled".
   */
  private refreshTimer: number | null = null;

  async onload(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<PluginSettings> | undefined,
    );

    const adapter = new ObsidianVaultAdapter(this.app);
    this.repository = new ProjectTaskRepository(adapter, this.settings);

    this.credentialSession = new CredentialSession(
      this.settings.credentialLockTimeoutMinutes,
    );
    // When the timeout fires behind the user's back, every open
    // dashboard falls back to the locked state on its own.
    this.credentialSession.setOnExpire(() => {
      void this.refreshDashboard();
    });

    this.addSettingTab(new SettingsTab(this, DEFAULT_SETTINGS));

    this.registerView(
      VIEW_TYPE_DEVHELPER_DASHBOARD,
      (leaf) =>
        new DashboardView(
          leaf,
          this.repository,
          this.settings!,
          {
            session: this.credentialSession,
            getSaltB64: () => this.settings.credSaltB64,
            getVerifier: () => this.settings.credVerifier,
            saveKeyMaterial: async (saltB64, verifier) => {
              this.settings.credSaltB64 = saltB64;
              this.settings.credVerifier = verifier;
              await this.saveData(this.settings);
            },
            clearKeyMaterial: async () => {
              this.settings.credSaltB64 = undefined;
              this.settings.credVerifier = undefined;
              this.credentialSession.lock();
              await this.saveData(this.settings);
            },
          },
          this.activateCalendarView.bind(this),
        ),
    );

    this.registerView(
      VIEW_TYPE_DEVHELPER_CALENDAR,
      (leaf) => new CalendarView(leaf, this.repository, this.settings!),
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

    this.addCommand({
      id: "open-calendar",
      name: "Abrir calendario",
      callback: () => this.activateCalendarView(),
    });

    this.addRibbonIcon(
      "calendar-days",
      "Abrir calendario",
      () => this.activateCalendarView(),
    );

    // Wire vault + metadata-cache events so external Markdown edits
    // refresh the dashboard without restarting Obsidian. `registerEvent`
    // detaches the listener automatically on `onunload`; we must NOT
    // rely on a manual cleanup.
    const schedule = () => this.scheduleDashboardRefresh();
    this.registerEvent(this.app.vault.on("create", schedule));
    this.registerEvent(this.app.vault.on("modify", schedule));
    this.registerEvent(this.app.vault.on("delete", schedule));
    this.registerEvent(this.app.vault.on("rename", schedule));
    // Metadata-cache changes do NOT fire on rename (see Obsidian docs);
    // the vault 'rename' subscription above covers that case.
    this.registerEvent(this.app.metadataCache.on("changed", schedule));

    console.log(`${this.manifest.name} v${this.manifest.version} loaded`);
  }

  onunload(): void {
    // Nothing to clean up explicitly: Obsidian tears down every
    // `registerEvent`/`registerView` subscription when the plugin
    // unloads. Cancel any pending debounced refresh so it cannot fire
    // against a half-torn-down vault, and drop the master key so its
    // expiry timer cannot fire post-unload.
    this.credentialSession?.lock();
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
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
    // Ask the freshly-mounted view to pull data immediately so the
    // user does not see a loading placeholder on activation.
    const view = leaf.view;
    if (
      view &&
      typeof (view as DashboardView).refresh === "function"
    ) {
      await (view as DashboardView).refresh();
    }
  }

  /**
   * Open (or focus) the calendar view in a new tab. When `isoDate` is
   * provided, the view is navigated to that month/day before refreshing.
   */
  async activateCalendarView(isoDate?: string): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: VIEW_TYPE_DEVHELPER_CALENDAR,
      active: true,
    });
    const view = leaf.view;
    if (view && typeof (view as CalendarView).refresh === "function") {
      if (
        isoDate !== undefined &&
        typeof (view as CalendarView).setSelectedIsoDate === "function"
      ) {
        (view as CalendarView).setSelectedIsoDate(isoDate);
      }
      await (view as CalendarView).refresh();
    }
  }

  /**
   * Schedule a refresh of every open plugin view. Repeated calls within
   * `DEBOUNCE_MS` collapse into a single refresh so a flurry of vault
   * writes produces one re-render rather than one per event.
   */
  private scheduleDashboardRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshAllViews();
    }, DEBOUNCE_MS);
  }

  /**
   * Refresh dashboards and calendar leaves independently. The credential
   * session expiry only refreshes dashboards (no secrets in the calendar).
   */
  private async refreshAllViews(): Promise<void> {
    await Promise.all([this.refreshDashboard(), this.refreshCalendar()]);
  }

  /**
   * Iterate every open dashboard leaf and call `refresh()` on it. Each
   * view loads its own copy of the data so two leaves can show
   * different projects without coordinating state.
   */
  private async refreshDashboard(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(
      VIEW_TYPE_DEVHELPER_DASHBOARD,
    );
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view && typeof (view as DashboardView).refresh === "function") {
        await (view as DashboardView).refresh();
      }
    }
  }

  /**
   * Iterate every open calendar leaf and call `refresh()` on it.
   */
  private async refreshCalendar(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(
      VIEW_TYPE_DEVHELPER_CALENDAR,
    );
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view && typeof (view as CalendarView).refresh === "function") {
        await (view as CalendarView).refresh();
      }
    }
  }
}

/** Time window (in ms) used to coalesce bursty vault events. */
const DEBOUNCE_MS = 250;