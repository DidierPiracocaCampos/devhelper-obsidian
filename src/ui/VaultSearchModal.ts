import { App, FuzzySuggestModal, TFile } from "obsidian";

/**
 * Búsqueda difusa en todo el vault, abierta desde la caja de búsqueda
 * del dashboard. Mismo patrón de interacción que `ProjectPickerModal`:
 * escribir filtra, Enter/clic abre la nota elegida.
 */
export class VaultSearchModal extends FuzzySuggestModal<TFile> {
  private readonly onChoose: (file: TFile) => void;

  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Buscar en el vault…");
    this.emptyStateText = "Sin resultados.";
  }

  getItems(): TFile[] {
    return this.app.vault
      .getMarkdownFiles()
      .sort((a, b) => a.basename.localeCompare(b.basename, "es"));
  }

  getItemText(item: TFile): string {
    return item.path.replace(/\.md$/, "");
  }

  onChooseItem(item: TFile): void {
    this.onChoose(item);
  }
}
