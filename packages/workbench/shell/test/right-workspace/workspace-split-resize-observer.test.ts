import assert from "node:assert/strict";
import test from "node:test";

import { resolveWorkspaceSplitLayout } from "../../src/right-workspace/workspace-split-layout";
import { observeWorkspaceSplitResize } from "../../src/right-workspace/workspace-split-resize-observer";

test("pane placement debounces drag bursts, updates during continuous movement and flushes on release", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const globals = ["window", "ResizeObserver", "MutationObserver"] as const;
  const originals = globals.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const notifications: (() => void)[] = [];
  const frames = new Map<number, () => void>();
  let nextFrame = 0;
  let disconnected = 0;
  class Observer {
    constructor(callback: () => void) {
      notifications.push(callback);
    }
    observe() {}
    disconnect() {
      disconnected += 1;
    }
  }
  Object.assign(globalThis, {
    ResizeObserver: Observer,
    MutationObserver: Observer,
    window: {
      setTimeout,
      clearTimeout,
      requestAnimationFrame(callback: () => void) {
        frames.set(++nextFrame, callback);
        return nextFrame;
      },
      cancelAnimationFrame: (frame: number) => frames.delete(frame),
    },
  });
  t.after(() => {
    globals.forEach((name, index) => {
      const original = originals[index];
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    });
  });
  const paint = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback());
  };
  const workspace = { dataset: {} as Record<string, string> };
  let width = 900;
  const measured: number[] = [];
  const element = {
    closest: () => workspace,
    getBoundingClientRect: () => ({ width }),
  } as unknown as HTMLElement;
  const stop = observeWorkspaceSplitResize(element, (nextWidth) => measured.push(nextWidth));
  paint();
  assert.deepEqual(measured, [900]);

  workspace.dataset.resizing = "true";
  width = 700;
  notifications[0]();
  t.mock.timers.tick(40);
  width = 600;
  notifications[0]();
  t.mock.timers.tick(79);
  paint();
  assert.deepEqual(measured, [900], "short bursts wait for the debounce interval");
  t.mock.timers.tick(1);
  paint();
  assert.deepEqual(measured, [900, 600]);

  for (let move = 0; move < 16; move += 1) {
    width = 430 - move;
    notifications[0]();
    t.mock.timers.tick(10);
    paint();
  }
  assert.deepEqual(measured, [900, 600, 415], "sustained dragging cannot starve updates");
  assert.equal(resolveWorkspaceSplitLayout(measured.at(-1)!, 320, true).mode, "stacked");
  assert.equal(workspace.dataset.resizing, "true", "placement changes before pointer release");

  width = 720;
  notifications[0]();
  delete workspace.dataset.resizing;
  notifications[1]();
  paint();
  assert.equal(measured.at(-1), 720);
  assert.equal(resolveWorkspaceSplitLayout(measured.at(-1)!, 320, true).mode, "horizontal");
  t.mock.timers.tick(500);
  paint();
  assert.equal(measured.length, 4, "release cancels the delayed measurement");

  workspace.dataset.resizing = "true";
  notifications[0]();
  stop();
  t.mock.timers.tick(500);
  paint();
  assert.equal(measured.length, 4, "unmount cancels pending measurements");
  assert.equal(disconnected, 2);
});
