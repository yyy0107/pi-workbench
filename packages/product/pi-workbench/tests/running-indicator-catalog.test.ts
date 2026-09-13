import assert from "node:assert/strict";
import test from "node:test";
import { createRunningIndicatorCatalog } from "@workbench/shell-context/running-indicator";
import { piRunningIndicatorDefinitions } from "@workbench/pi-ui-extensions/installation";
import {
  DEFAULT_RUNNING_INDICATOR_STYLE_ID,
  shellRunningIndicatorDefinitions,
} from "../src/running-indicator-defaults";

test("the assembled catalog preserves every historical style and its fallback", () => {
  assert.deepEqual(
    shellRunningIndicatorDefinitions.map(({ id }) => id),
    [
      "working",
      "searching",
      "solving",
      "listening",
      "connecting",
      "weaving",
      "composing",
      "breathing",
      "shaping",
    ],
  );
  const catalog = createRunningIndicatorCatalog({
    defaultStyleId: DEFAULT_RUNNING_INDICATOR_STYLE_ID,
    definitions: [...shellRunningIndicatorDefinitions, ...piRunningIndicatorDefinitions],
  });
  for (const definition of piRunningIndicatorDefinitions)
    assert.equal(catalog.resolve(definition.id).id, definition.id);
  assert.equal(catalog.resolve("retired-style").id, "connecting");
});
