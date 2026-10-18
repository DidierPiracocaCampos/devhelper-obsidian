import { App, FuzzySuggestModal } from "obsidian";
import type { ProjectRecord } from "../domain/types";

/**
 * Result the picker hands back to the dashboard view:
 *
 *  - `{ kind: "create" }`                 → the user picked the
 *                                            synthetic "Crear proyecto nuevo…"
 *                                            entry.
 *  - `{ kind: "project", project }`       → the user picked an existing
 *                                            (non-favorite) project from the
 *                                            fuzzy list.
 *
 * The "create" branch is intentionally folded into the same union
 * instead of being a separate signal so the callback is a single
 * exhaustive switch on `kind`.
 */
export type ProjectPickerResult =
  | { kind: "create" }
  | { kind: "project"; project: ProjectRecord };

type ProjectPickerItem =
  | { kind: "create" }
  | { kind: "project"; project: ProjectRecord };

/**
 * Fuzzy picker used by the dashboard to add a project to the
 * favorites row. The list of `projects` passed in is expected to be
 * pre-filtered to non-favorites (the view owns that filtering) and
 * already sorted with the same comparator used for the chip row so
 * the picker matches the dashboard ordering.
 */
export class ProjectPickerModal extends FuzzySuggestModal<ProjectPickerItem> {
  private readonly projects: ProjectRecord[];
  private readonly onChoose: (result: ProjectPickerResult) => void;

  constructor(
    app: App,
    projects: ProjectRecord[],
    onChoose: (result: ProjectPickerResult) => void,
  ) {
    super(app);
    this.projects = projects;
    this.onChoose = onChoose;
    // Inherited from `SuggestModal`/`Modal`. Sets the placeholder of
    // the fuzzy search input; matches the brief's spec verbatim.
    this.setPlaceholder("Buscar proyecto…");
  }

  getItems(): ProjectPickerItem[] {
    const createItem: ProjectPickerItem = { kind: "create" };
    const projectItems: ProjectPickerItem[] = this.projects.map((p) => ({
      kind: "project",
      project: p,
    }));
    return [createItem, ...projectItems];
  }

  getItemText(item: ProjectPickerItem): string {
    if (item.kind === "create") {
      return "Crear proyecto nuevo…";
    }
    return item.project.title;
  }

  onChooseItem(item: ProjectPickerItem): void {
    if (item.kind === "create") {
      this.onChoose({ kind: "create" });
      return;
    }
    this.onChoose({ kind: "project", project: item.project });
  }
}