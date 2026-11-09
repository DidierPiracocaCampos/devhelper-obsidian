/**
 * Umbral compartido con las container queries de `styles.css`
 * (`@container devhelper-… (max-width: 640px)`): por debajo, la vista se
 * comporta como en un teléfono. Sin imports de Obsidian para poder testearlo.
 */
export const COMPACT_MAX_WIDTH = 640;

/** `true` si el ancho (px) de la hoja es compacto. 0 = oculta/sin layout. */
export function isCompactWidth(width: number): boolean {
  return width > 0 && width <= COMPACT_MAX_WIDTH;
}
