import assert from "node:assert/strict";
import test from "node:test";

import { ExtensionManager } from "@/platform/extensions";

import { workspaceArtifactExtension } from "./workspace-artifact";
import { workspaceBrowserExtension } from "./workspace-browser";
import { workspaceExplorerExtension } from "./workspace-explorer";
import { workspaceFileExtension } from "./workspace-file";
import { workspaceReviewExtension } from "./workspace-review";

test("the five workspace capabilities are extension contributions", () => {
  const manager = new ExtensionManager();
  const extensions = [
    workspaceReviewExtension,
    workspaceExplorerExtension,
    workspaceFileExtension,
    workspaceBrowserExtension,
    workspaceArtifactExtension,
  ];

  for (const extension of extensions) manager.activate(extension);

  assert.deepEqual(
    manager.workspace
      .getAll()
      .map((definition) => definition.kind)
      .sort(),
    ["artifact", "browser", "explorer", "file", "review"],
  );
  assert.equal(
    manager.workspace.getAll().every((definition) => definition.render),
    true,
  );

  manager.dispose();
  assert.equal(manager.workspace.getAll().length, 0);
});
