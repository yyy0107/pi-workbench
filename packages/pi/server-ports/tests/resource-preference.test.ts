import assert from "node:assert/strict";
import test from "node:test";
import { readBuiltinResourceEnabled } from "../src/resource-preference";
test("preserves enabled defaults and explicit disabled preferences", async () => {
  assert.equal(await readBuiltinResourceEnabled({}, "contextTraceExtensionEnabled"), true);
  const keys: string[] = [];
  assert.equal(
    await readBuiltinResourceEnabled(
      {
        readBuiltinResourceEnabled: async (key) => {
          keys.push(key);
          return false;
        },
      },
      "contextTraceExtensionEnabled",
    ),
    false,
  );
  assert.deepEqual(keys, ["contextTraceExtensionEnabled"]);
});
test("retains the enabled fallback and diagnostic when the settings reader fails", async (t) => {
  const errors: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => errors.push(args));
  assert.equal(
    await readBuiltinResourceEnabled(
      {
        readBuiltinResourceEnabled: async () => {
          throw new Error("read failed");
        },
      },
      "contextTraceExtensionEnabled",
    ),
    true,
  );
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]?.[0]), /contextTraceExtensionEnabled/);
});
