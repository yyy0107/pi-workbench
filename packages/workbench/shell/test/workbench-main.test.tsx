import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";

import { WorkbenchMain } from "@workbench/shell/layout";

test("WorkbenchMain is a pure main frame that passes children through", () => {
  const child = createElement("div", { id: "root-main-view" });
  const frame = WorkbenchMain({ children: child });

  assert.equal(frame.type, "main");
  assert.equal(frame.props["data-workbench-surface"], "main");
  assert.equal(frame.props.children, child);
  assert.equal(frame.props.className, "bg-background min-h-0 min-w-0 flex-1 overflow-hidden");
});
