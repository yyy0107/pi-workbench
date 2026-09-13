import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PANEL_LOCATIONS, WORKBENCH_SLOTS } from "../src/api";

test("exposes panels only in left and bottom locations", () => {
  assert.deepEqual(PANEL_LOCATIONS, ["left", "bottom"]);
  assert.equal(
    WORKBENCH_SLOTS.some((slot) => slot.startsWith("panel.right")),
    false,
  );
});

test("does not expose the removed component-extension catalog API", async () => {
  const extensionApi = await readFile(new URL("../src/api/extension.ts", import.meta.url), "utf8");

  assert.doesNotMatch(extensionApi, /ComponentExtension|component-extension/u);
});
