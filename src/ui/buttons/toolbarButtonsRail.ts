import { Menu, setIcon } from "obsidian";
import {
  DEFAULT_BUTTON_ICON,
  type ToolbarButtonRecord,
} from "../../domain/toolbarButtons";
import { attachLongPress } from "../longPress";
import { runKey, type ButtonRunner } from "./ButtonRunner";

export interface ToolbarButtonsRailOptions {
  runner: ButtonRunner;
  isAllowed(): boolean;
  openNote(path: string): void;
  disable(path: string): Promise<void>;
}

/** ¿Está corriendo el botón (cualquiera de sus opciones si es menú)? */
function isButtonRunning(runner: ButtonRunner, button: ToolbarButtonRecord): boolean {
  if (button.action.kind === "direct") return runner.isRunning(runKey(button, null));
  return button.action.options.some((o) => runner.isRunning(runKey(button, o)));
}

function setRunning(el: HTMLButtonElement, running: boolean): void {
  el.toggleClass("is-running", running);
  el.disabled = running;
}

/**
 * Pinta los botones de usuario (ya filtrados a `enabled` y ordenados) en la
 * barra. Un refresco puede reemplazar el elemento mientras un script corre,
 * así que el estado «corriendo» se recalcula en cada render desde el runner y,
 * al terminar, se limpia el elemento vigente del mismo botón (vía `data-path`).
 */
export function renderToolbarButtons(
  rail: HTMLElement,
  buttons: ToolbarButtonRecord[],
  opts: ToolbarButtonsRailOptions,
): void {
  const allowed = opts.isAllowed();
  for (const button of buttons) {
    const el = rail.createEl("button", {
      cls: "devhelper-icon-button devhelper-user-button",
      attr: {
        "aria-label": button.label,
        title: button.label,
        type: "button",
        "data-path": button.path,
      },
    });
    setIcon(el, button.icon);
    if (el.childElementCount === 0) setIcon(el, DEFAULT_BUTTON_ICON);
    if (button.action.kind === "menu") el.addClass("has-options");
    if (!allowed) el.addClass("is-disabled-script");
    if (isButtonRunning(opts.runner, button)) setRunning(el, true);

    const launch = async (option: Parameters<ButtonRunner["run"]>[1]) => {
      setRunning(el, true);
      try {
        await opts.runner.run(button, option);
      } finally {
        const current = el.isConnected
          ? el
          : findCurrent(el, button.path);
        if (current) setRunning(current, isButtonRunning(opts.runner, button));
        if (current !== el) setRunning(el, false);
      }
    };

    attachLongPress(el, (point) =>
      openButtonMenu(button, opts, (menu) => menu.showAtPosition(point)),
    );

    el.addEventListener("click", () => {
      if (button.action.kind === "direct") {
        void launch(null);
        return;
      }
      const menu = new Menu();
      for (const option of button.action.options) {
        menu.addItem((item) =>
          item.setTitle(option.label).onClick(() => void launch(option)),
        );
      }
      const rect = el.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom });
    });

    el.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      openButtonMenu(button, opts, (menu) => menu.showAtMouseEvent(evt));
    });
  }
}

/** Busca el elemento vivo del botón tras un refresco que reemplazó el DOM. */
function findCurrent(stale: HTMLElement, path: string): HTMLButtonElement | null {
  const doc = stale.ownerDocument;
  for (const candidate of Array.from(
    doc.querySelectorAll<HTMLButtonElement>(".devhelper-user-button"),
  )) {
    if (candidate.dataset.path === path) return candidate;
  }
  return null;
}

/** Menú de clic derecho / pulsación larga: abrir la nota o desactivar. */
function openButtonMenu(
  button: ToolbarButtonRecord,
  opts: ToolbarButtonsRailOptions,
  show: (menu: Menu) => void,
): void {
  const menu = new Menu();
  menu.addItem((item) =>
    item
      .setTitle("Abrir nota del botón")
      .setIcon("file")
      .onClick(() => opts.openNote(button.path)),
  );
  menu.addItem((item) =>
    item
      .setTitle("Desactivar")
      .setIcon("eye-off")
      .onClick(() => void opts.disable(button.path)),
  );
  show(menu);
}
