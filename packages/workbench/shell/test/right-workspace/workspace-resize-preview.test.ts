import assert from "node:assert/strict";
import test from "node:test";

import { applyRightWorkspaceResizePreview } from "../../src/right-workspace/workspace-resize-preview";

test("right workspace resize preview preserves the visible minimum while collapsing", () => {
  const values = new Map<string, string>();
  const workspaceLayout = {
    style: {
      setProperty(name: string, value: string) {
        values.set(name, value);
      },
    },
  } as unknown as HTMLElement;

  applyRightWorkspaceResizePreview(workspaceLayout, 80);

  assert.deepEqual(Object.fromEntries(values), {
    "--right-workspace-content-width": "360px",
    "--right-workspace-layout-width": "80px",
    "--right-workspace-resize-translate-x": "280px",
  });
});
