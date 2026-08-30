import assert from "node:assert/strict";
import test from "node:test";

import { toWorkbenchSettingsJsonObject } from "../src/settings";

test("projects application preferences onto the JSON-safe settings boundary", () => {
  const source = {
    density: "compact",
    nested: { enabled: true },
    omitted: undefined,
  };

  assert.deepEqual(toWorkbenchSettingsJsonObject(source), {
    density: "compact",
    nested: { enabled: true },
  });
});
