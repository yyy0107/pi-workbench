import assert from "node:assert/strict";
import test from "node:test";

import { resolveComponentProjectPreviewRegion } from "./component-placement-preview";

test("maps exact Workbench slots to the same project panorama region", () => {
  assert.equal(
    resolveComponentProjectPreviewRegion({ kind: "slot", target: "composer.actions.left" }),
    "composer.actions.left",
  );
  assert.equal(
    resolveComponentProjectPreviewRegion({ kind: "slot", target: "workspace.actions" }),
    "workspace.actions",
  );
});

test("maps message renderers to their precise message scope", () => {
  assert.equal(
    resolveComponentProjectPreviewRegion({
      kind: "message-renderer",
      target: "context.renderers.message",
    }),
    "message.root",
  );

  for (const kind of ["message-part-renderer", "tool-renderer", "data-renderer"] as const) {
    assert.equal(
      resolveComponentProjectPreviewRegion({ kind, target: `context.renderers.${kind}` }),
      "message.content",
    );
  }
});

test("maps full-surface contribution kinds to their Workbench hosts", () => {
  assert.equal(
    resolveComponentProjectPreviewRegion({ kind: "settings-section", target: "appearance" }),
    "settings",
  );
  assert.equal(
    resolveComponentProjectPreviewRegion({ kind: "settings-item", target: "appearance.theme" }),
    "settings",
  );
  assert.equal(
    resolveComponentProjectPreviewRegion({ kind: "main-view", target: "toolbox" }),
    "main-view",
  );
  assert.equal(
    resolveComponentProjectPreviewRegion({ kind: "workspace-surface", target: "terminal" }),
    "workspace.surface",
  );
});

test("maps each explicit panel placement to its project panorama host", () => {
  assert.equal(
    resolveComponentProjectPreviewRegion({ kind: "panel", target: "left" }),
    "panel.left",
  );
  assert.equal(
    resolveComponentProjectPreviewRegion({ kind: "panel", target: "bottom" }),
    "panel.bottom",
  );
  assert.equal(
    resolveComponentProjectPreviewRegion({ kind: "panel", target: "right" }),
    "panel.right",
  );
});
