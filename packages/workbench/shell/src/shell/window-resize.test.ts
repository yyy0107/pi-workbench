import assert from "node:assert/strict";
import test from "node:test";

import { observeWindowResize } from "./window-resize";

test("window resizing stays immediate until it settles and leaves panel drag state intact", () => {
  const listeners = new Map<string, () => void>();
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const shell = {
    dataset: { resizing: "true" } as Record<string, string>,
    ownerDocument: {
      defaultView: {
        addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
        removeEventListener: (name: string) => listeners.delete(name),
        setTimeout: (callback: () => void) => {
          timers.set(++nextTimer, callback);
          return nextTimer;
        },
        clearTimeout: (id: number) => timers.delete(id),
      },
    },
  };

  const disconnect = observeWindowResize(shell as unknown as HTMLElement);
  assert.equal(shell.dataset.windowResizing, undefined);
  listeners.get("resize")?.();
  assert.equal(shell.dataset.windowResizing, "true");
  listeners.get("resize")?.();
  assert.equal(timers.size, 1, "each resize extends the same settling period");
  for (const [id, callback] of timers) {
    timers.delete(id);
    callback();
  }
  assert.equal(shell.dataset.windowResizing, undefined);
  assert.equal(shell.dataset.resizing, "true");

  listeners.get("resize")?.();
  disconnect();
  assert.equal(listeners.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(shell.dataset.windowResizing, undefined);
  assert.equal(shell.dataset.resizing, "true");
});
