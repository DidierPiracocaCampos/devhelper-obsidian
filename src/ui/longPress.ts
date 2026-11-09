/**
 * Pulsación larga táctil como alternativa al clic derecho: iOS no emite
 * `contextmenu` al mantener pulsado, así que sin esto los menús contextuales
 * del plugin son inaccesibles en iPhone/iPad.
 *
 * Sin imports de Obsidian para poder testearlo con un `EventTarget` de Node.
 */

export interface LongPressOptions {
  /** Tiempo con el dedo quieto antes de disparar. */
  delayMs?: number;
  /** Desplazamiento máximo (en cada eje) que aún cuenta como «quieto». */
  moveTolerancePx?: number;
  /**
   * Ventana tras disparar en la que se tragan el `click` (que si no
   * seleccionaría el elemento) y el `contextmenu` (que Android lanza además
   * de la pulsación larga y abriría el menú dos veces).
   */
  suppressMs?: number;
}

interface TouchPointLike {
  clientX: number;
  clientY: number;
}

function touchesOf(evt: Event): ArrayLike<TouchPointLike> {
  return (evt as unknown as { touches?: ArrayLike<TouchPointLike> }).touches ?? [];
}

export function attachLongPress(
  target: EventTarget,
  onLongPress: (point: { x: number; y: number }) => void,
  options: LongPressOptions = {},
): () => void {
  const delayMs = options.delayMs ?? 500;
  const tolerance = options.moveTolerancePx ?? 10;
  const suppressMs = options.suppressMs ?? 800;

  let pending: number | null = null;
  let suppressTimer: number | null = null;
  let suppressing = false;
  let startX = 0;
  let startY = 0;

  const cancel = (): void => {
    if (pending !== null) {
      window.clearTimeout(pending);
      pending = null;
    }
  };

  const onStart = (evt: Event): void => {
    cancel();
    const touches = touchesOf(evt);
    if (touches.length !== 1) return;
    startX = touches[0].clientX;
    startY = touches[0].clientY;
    pending = window.setTimeout(() => {
      pending = null;
      suppressing = true;
      if (suppressTimer !== null) window.clearTimeout(suppressTimer);
      suppressTimer = window.setTimeout(() => {
        suppressing = false;
        suppressTimer = null;
      }, suppressMs);
      onLongPress({ x: startX, y: startY });
    }, delayMs);
  };

  const onMove = (evt: Event): void => {
    if (pending === null) return;
    const touches = touchesOf(evt);
    if (touches.length !== 1) {
      cancel();
      return;
    }
    const dx = Math.abs(touches[0].clientX - startX);
    const dy = Math.abs(touches[0].clientY - startY);
    if (dx > tolerance || dy > tolerance) cancel();
  };

  const swallow = (evt: Event): void => {
    if (!suppressing) return;
    evt.preventDefault();
    evt.stopImmediatePropagation();
  };

  target.addEventListener("touchstart", onStart, { passive: true });
  target.addEventListener("touchmove", onMove, { passive: true });
  target.addEventListener("touchend", cancel);
  target.addEventListener("touchcancel", cancel);
  target.addEventListener("click", swallow, { capture: true });
  target.addEventListener("contextmenu", swallow, { capture: true });

  return () => {
    cancel();
    if (suppressTimer !== null) window.clearTimeout(suppressTimer);
    suppressTimer = null;
    suppressing = false;
    target.removeEventListener("touchstart", onStart);
    target.removeEventListener("touchmove", onMove);
    target.removeEventListener("touchend", cancel);
    target.removeEventListener("touchcancel", cancel);
    target.removeEventListener("click", swallow, { capture: true });
    target.removeEventListener("contextmenu", swallow, { capture: true });
  };
}
