import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalResizeObserver } from "./terminal-resize-observer";

test("terminal fitting waits for resize previews to finish and pauses while hidden", () => {
  const globals = [
    "ResizeObserver",
    "MutationObserver",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ] as const;
  const originals = globals.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const notifications: (() => void)[] = [];
  const frames = new Map<number, () => void>();
  let nextFrame = 0;
  class Observer {
    constructor(callback: () => void) {
      notifications.push(callback);
    }
    observe() {}
    disconnect() {}
  }
  Object.assign(globalThis, {
    ResizeObserver: Observer,
    MutationObserver: Observer,
    requestAnimationFrame(callback: () => void) {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (frame: number) => frames.delete(frame),
  });
  const paint = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback());
  };
  const shell = { dataset: {} as Record<string, string> };
  const workspace = { dataset: {} as Record<string, string> };
  const container = {
    closest: (selector: string) => (selector === "[data-workbench-shell]" ? shell : workspace),
  } as unknown as HTMLElement;
  let width = 360;
  const fitted: number[] = [];
  const observer = createTerminalResizeObserver(container, () => fitted.push(width));

  try {
    observer.observe();
    paint();
    assert.deepEqual(fitted, [360]);

    for (const [owner, attribute] of [
      [shell, "resizing"],
      [workspace, "resizing"],
      [shell, "windowResizing"],
    ] as const) {
      const previousFits = fitted.length;
      owner.dataset[attribute] = "true";
      for (let move = 0; move < 20; move += 1) {
        width += 1;
        notifications[0]();
        paint();
      }
      assert.equal(fitted.length, previousFits, "dragging must not reflow terminal rows");
      delete owner.dataset[attribute];
      // Releasing the pointer need not change the container size again.
      notifications[1]();
      observer.schedule();
      assert.equal(frames.size, 1);
      paint();
      assert.equal(fitted.length, previousFits + 1);
      assert.equal(fitted.at(-1), width);
    }

    const previousFits = fitted.length;
    observer.schedule();
    observer.disconnect();
    assert.equal(frames.size, 0, "hiding cancels pending fits");
    notifications.forEach((notify) => notify());
    paint();
    assert.equal(fitted.length, previousFits);

    width = 720;
    observer.observe();
    paint();
    assert.equal(fitted.at(-1), 720, "revealing catches up to the current size");
  } finally {
    observer.disconnect();
    globals.forEach((name, index) => {
      const original = originals[index];
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});
