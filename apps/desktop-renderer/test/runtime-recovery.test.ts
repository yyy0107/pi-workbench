import assert from "node:assert/strict";
import test from "node:test";

import { restartDesktopRuntime } from "../src/desktop/runtime-bootstrap";

test("failed Runtime restart preserves the shell; successful retry reloads it", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  let fail = true;
  let reloads = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      workbenchDesktop: {
        lifecycle: {
          async restartRuntime() {
            if (fail) throw new Error("startup failed");
          },
        },
      },
      location: { reload: () => reloads++ },
    },
  });
  await assert.rejects(restartDesktopRuntime(), /startup failed/u);
  assert.equal(reloads, 0);
  fail = false;
  await restartDesktopRuntime();
  assert.equal(reloads, 1);
});
