import assert from "node:assert/strict";
import test from "node:test";

import { createPanelStore } from "./panel-store";

test("panel store installations own isolated mutable state", () => {
  const first = createPanelStore();
  const second = createPanelStore();

  first.getState().open("terminal", "bottom");
  first.getState().setSize("bottom", 320);

  assert.deepEqual(first.getState().openedPanelIds, ["terminal"]);
  assert.equal(first.getState().sizeByLocation.bottom, 320);
  assert.deepEqual(second.getState().openedPanelIds, []);
  assert.equal(second.getState().sizeByLocation.bottom, undefined);
});
