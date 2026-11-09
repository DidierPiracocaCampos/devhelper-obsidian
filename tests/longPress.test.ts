import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { attachLongPress } from "../src/ui/longPress";

type Point = { clientX: number; clientY: number };

function touchEvent(type: string, touches: Point[]): Event {
  const evt = new Event(type, { cancelable: true });
  Object.defineProperty(evt, "touches", { value: touches });
  return evt;
}

function cancelable(type: string): Event {
  return new Event(type, { cancelable: true });
}

describe("attachLongPress", () => {
  let target: EventTarget;
  let onLongPress: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    target = new EventTarget();
    onLongPress = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("dispara tras 500ms con un dedo quieto", () => {
    attachLongPress(target, onLongPress);
    target.dispatchEvent(touchEvent("touchstart", [{ clientX: 100, clientY: 200 }]));
    vi.advanceTimersByTime(499);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledWith({ x: 100, y: 200 });
  });

  test("cancela si el dedo se mueve más de 10px", () => {
    attachLongPress(target, onLongPress);
    target.dispatchEvent(touchEvent("touchstart", [{ clientX: 100, clientY: 200 }]));
    target.dispatchEvent(touchEvent("touchmove", [{ clientX: 100, clientY: 215 }]));
    vi.advanceTimersByTime(600);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  test("tolera un movimiento de hasta 10px", () => {
    attachLongPress(target, onLongPress);
    target.dispatchEvent(touchEvent("touchstart", [{ clientX: 100, clientY: 200 }]));
    target.dispatchEvent(touchEvent("touchmove", [{ clientX: 106, clientY: 206 }]));
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  test("cancela al levantar el dedo antes de tiempo", () => {
    attachLongPress(target, onLongPress);
    target.dispatchEvent(touchEvent("touchstart", [{ clientX: 100, clientY: 200 }]));
    vi.advanceTimersByTime(300);
    target.dispatchEvent(touchEvent("touchend", []));
    vi.advanceTimersByTime(600);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  test("ignora dos dedos", () => {
    attachLongPress(target, onLongPress);
    target.dispatchEvent(
      touchEvent("touchstart", [
        { clientX: 100, clientY: 200 },
        { clientX: 150, clientY: 220 },
      ]),
    );
    vi.advanceTimersByTime(600);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  test("traga el click y el contextmenu que siguen a la pulsación larga", () => {
    attachLongPress(target, onLongPress);
    const later = vi.fn();
    target.addEventListener("click", later);
    target.addEventListener("contextmenu", later);

    target.dispatchEvent(touchEvent("touchstart", [{ clientX: 100, clientY: 200 }]));
    vi.advanceTimersByTime(500);

    const menu = cancelable("contextmenu");
    target.dispatchEvent(menu);
    const click = cancelable("click");
    target.dispatchEvent(click);
    expect(menu.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(later).not.toHaveBeenCalled();

    vi.advanceTimersByTime(800);
    const lateClick = cancelable("click");
    target.dispatchEvent(lateClick);
    expect(lateClick.defaultPrevented).toBe(false);
    expect(later).toHaveBeenCalledTimes(1);
  });

  test("sin pulsación larga no traga nada", () => {
    attachLongPress(target, onLongPress);
    const later = vi.fn();
    target.addEventListener("click", later);
    target.dispatchEvent(touchEvent("touchstart", [{ clientX: 100, clientY: 200 }]));
    target.dispatchEvent(touchEvent("touchend", []));
    target.dispatchEvent(cancelable("click"));
    expect(later).toHaveBeenCalledTimes(1);
  });

  test("el detach limpia", () => {
    const detach = attachLongPress(target, onLongPress);
    target.dispatchEvent(touchEvent("touchstart", [{ clientX: 100, clientY: 200 }]));
    vi.advanceTimersByTime(200);
    detach();
    vi.advanceTimersByTime(600);
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
