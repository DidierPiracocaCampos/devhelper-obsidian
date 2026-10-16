import { Plugin } from "obsidian";

/**
 * DevHelper Dashboard - Obsidian plugin entry point.
 *
 * The full plugin lifecycle (settings, view, ribbon, commands) is wired
 * in later tasks. This scaffold only exercises the Plugin base class and
 * the data-loading API so the build and typecheck succeed.
 */
export default class DevHelperDashboardPlugin extends Plugin {
  async onload(): Promise<void> {
    // Exercise data loading so the data.json plumbing is validated
    // by the bundle, even though settings are not yet implemented.
    await Promise.resolve(this.loadData());
    console.log(`${this.manifest.name} v${this.manifest.version} loaded`);
  }

  onunload(): void {
    // Nothing to clean up yet.
  }
}
