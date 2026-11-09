import type { VaultAdapter, VaultNoteRef } from "./VaultAdapter";
import { sanitizeFilename } from "./ProjectTaskRepository";
import type { PluginSettings } from "../settings";
import type { DashboardIssue } from "../domain/types";
import {
  DEFAULT_BUTTON_TEMPLATE,
  parseToolbarButton,
  sortToolbarButtons,
  type ToolbarButtonRecord,
} from "../domain/toolbarButtons";

export const BUTTON_TEMPLATE_FILE_NAME = "boton.md";

const MAX_DISAMBIGUATION = 1000;

/**
 * Repositorio de los botones configurables de la barra. Lee los ajustes en
 * vivo en cada operación (`getSettings`) para que cambiar la carpeta surta
 * efecto sin recargar el plugin.
 */
export class ToolbarButtonRepository {
  constructor(
    private readonly adapter: VaultAdapter,
    private readonly getSettings: () => PluginSettings,
  ) {}

  async load(): Promise<{ buttons: ToolbarButtonRecord[]; issues: DashboardIssue[] }> {
    const { buttonsFolder } = this.getSettings();
    await this.adapter.createFolder(buttonsFolder);
    await this.seedTemplate();

    const buttons: ToolbarButtonRecord[] = [];
    const issues: DashboardIssue[] = [];
    for (const ref of this.adapter.listMarkdownFiles(buttonsFolder)) {
      let content: string;
      try {
        content = await this.adapter.read(ref);
      } catch (err) {
        issues.push({
          path: ref.path,
          message: `No se pudo leer la nota: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
      const parsed = parseToolbarButton({
        path: ref.path,
        basename: ref.basename,
        content,
      });
      if (parsed.kind === "button") {
        buttons.push(parsed.button);
        issues.push(...parsed.issues);
      } else if (parsed.kind === "issue") {
        issues.push(parsed.issue);
      }
    }
    return { buttons: sortToolbarButtons(buttons), issues };
  }

  async createButton(title: string): Promise<string> {
    const { buttonsFolder } = this.getSettings();
    await this.adapter.createFolder(buttonsFolder);

    const templatePath = this.templatePath();
    const templateRef: VaultNoteRef = {
      path: templatePath,
      basename: BUTTON_TEMPLATE_FILE_NAME,
    };
    const template = this.adapter.exists(templatePath)
      ? await this.adapter.read(templateRef)
      : DEFAULT_BUTTON_TEMPLATE;

    const stem = sanitizeFilename(title);
    let path = `${buttonsFolder}/${stem}.md`;
    for (let n = 2; this.adapter.exists(path); n++) {
      if (n > MAX_DISAMBIGUATION) {
        throw new Error(`No se pudo encontrar un nombre libre para el botón «${title}».`);
      }
      path = `${buttonsFolder}/${stem} ${n}.md`;
    }

    const ref = await this.adapter.createMarkdown(path, template);
    await this.adapter.processFrontMatter(ref, (fm) => {
      fm.label = title;
    });
    return path;
  }

  async setButtonEnabled(path: string, enabled: boolean): Promise<void> {
    if (!this.adapter.exists(path)) {
      throw new Error(`No existe el botón «${path}»`);
    }
    const ref: VaultNoteRef = {
      path,
      basename: path.slice(path.lastIndexOf("/") + 1),
    };
    await this.adapter.processFrontMatter(ref, (fm) => {
      fm.enabled = enabled;
    });
  }

  private templatePath(): string {
    return `${this.getSettings().templatesFolder}/${BUTTON_TEMPLATE_FILE_NAME}`;
  }

  private async seedTemplate(): Promise<void> {
    const path = this.templatePath();
    if (this.adapter.exists(path)) return;
    await this.adapter.createFolder(this.getSettings().templatesFolder);
    try {
      await this.adapter.createMarkdown(path, DEFAULT_BUTTON_TEMPLATE);
    } catch (error) {
      // Siembra concurrente: otra carga la creó entre el exists y el create.
      if (!this.adapter.exists(path)) throw error;
    }
  }
}
