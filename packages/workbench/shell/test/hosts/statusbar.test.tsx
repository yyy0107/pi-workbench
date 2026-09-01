import assert from "node:assert/strict";
import test from "node:test";

import { WorkbenchStatusbar } from "@workbench/shell/hosts/statusbar";

test("WorkbenchStatusbar composes the exact public statusbar slots", () => {
  const statusbar = WorkbenchStatusbar();
  const children = statusbar.props.children as readonly { props: { name?: string } }[];

  assert.equal(statusbar.type, "footer");
  assert.equal(statusbar.props["data-workbench-surface"], "statusbar");
  assert.deepEqual(
    children.map((child) => child.props.name),
    ["statusbar.left", "statusbar.right"],
  );
});
