import assert from "node:assert/strict";
import test from "node:test";

import { observeResizeHandle } from "../../src/resize/observe-resize-handle";

test("updates drag limits and ARIA from delivered sizes without more layout reads", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  let callback!: ResizeObserverCallback;
  let disconnected = false;
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(next: ResizeObserverCallback) {
        callback = next;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "ResizeObserver", previous);
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
  });
  let reads = 0;
  let writes = 0;
  const parent = {
    getBoundingClientRect: () => {
      reads++;
      return { width: 1200 };
    },
  };
  const panel = {
    parentElement: parent,
    getBoundingClientRect: () => {
      reads++;
      return { width: 600 };
    },
  };
  const attributes = new Map<string, string>();
  const handle = {
    getAttribute: (name: string) => attributes.get(name),
    setAttribute: (name: string, value: string) => {
      writes++;
      attributes.set(name, value);
    },
  };
  const geometry = { width: 0, maximum: 0 };
  const stop = observeResizeHandle(
    panel as unknown as HTMLElement,
    handle as unknown as HTMLElement,
    geometry,
    (width) => Math.max(0, width - 340),
  );
  assert.deepEqual(geometry, { width: 600, maximum: 860 });
  for (let width = 600; width <= 800; width++) {
    callback(
      [
        { target: panel, borderBoxSize: [{ inlineSize: width }] },
        { target: parent, contentRect: { width: 1300 } },
      ] as unknown as ResizeObserverEntry[],
      {} as ResizeObserver,
    );
  }
  assert.equal(reads, 2, "only the initial measurement reads layout");
  assert.deepEqual(geometry, { width: 800, maximum: 960 });
  assert.equal(attributes.get("aria-valuenow"), "800");
  assert.equal(attributes.get("aria-valuemax"), "960");
  const previousWrites = writes;
  callback(
    [{ target: panel, contentRect: { width: 800.1 } }] as unknown as ResizeObserverEntry[],
    {} as ResizeObserver,
  );
  assert.equal(writes, previousWrites, "unchanged rounded values do not mutate the DOM");
  stop();
  assert.equal(disconnected, true);
});
