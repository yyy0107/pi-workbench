import assert from "node:assert/strict";
import test from "node:test";

import {
  shellBuiltinExtensions,
  shellCoreExtensions,
  shellExtensionGroups,
  shellFileExtensions,
  shellSettingsExtensions,
  shellWorkspaceExtensions,
} from "./builtin-extensions";

const SHELL_CORE_EXTENSION_IDS = Object.freeze([
  "workbench.brand",
  "workbench.workspace-sidebar",
  "workbench.appearance",
  "workbench.locale-selector",
  "workbench.message-presentation",
  "workbench.message-actions",
  "workbench.user-message-index",
  "workbench.message-queue",
  "workbench.todo-panel",
  "workbench.archived-chats",
]);
const SHELL_SETTINGS_EXTENSION_IDS = Object.freeze(["workbench.settings"]);
const SHELL_WORKSPACE_EXTENSION_IDS = Object.freeze([
  "workbench.workspace-explorer",
  "workbench.workspace-review",
  "workbench.workspace-browser",
  "workbench.workspace-artifact",
  "workbench.terminal",
  "workbench.workspace-directory-picker",
  "workbench.git-branch",
]);
const SHELL_FILE_EXTENSION_IDS = Object.freeze(["workbench.workspace-file"]);

test("Shell extension groups preserve immutable semantic activation order", () => {
  assert.equal(Object.isFrozen(shellCoreExtensions), true);
  assert.equal(Object.isFrozen(shellSettingsExtensions), true);
  assert.equal(Object.isFrozen(shellWorkspaceExtensions), true);
  assert.equal(Object.isFrozen(shellFileExtensions), true);
  assert.equal(Object.isFrozen(shellExtensionGroups), true);
  assert.equal(Object.isFrozen(shellExtensionGroups.core), true);
  assert.equal(Object.isFrozen(shellExtensionGroups.settings), true);
  assert.equal(Object.isFrozen(shellExtensionGroups.workspace), true);
  assert.equal(Object.isFrozen(shellExtensionGroups.files), true);
  assert.equal(Object.isFrozen(shellBuiltinExtensions), true);

  assert.deepEqual(
    shellCoreExtensions.map((extension) => extension.id),
    SHELL_CORE_EXTENSION_IDS,
  );
  assert.deepEqual(
    shellSettingsExtensions.map((extension) => extension.id),
    SHELL_SETTINGS_EXTENSION_IDS,
  );
  assert.deepEqual(
    shellWorkspaceExtensions.map((extension) => extension.id),
    SHELL_WORKSPACE_EXTENSION_IDS,
  );
  assert.deepEqual(
    shellFileExtensions.map((extension) => extension.id),
    SHELL_FILE_EXTENSION_IDS,
  );
  assert.deepEqual(
    shellBuiltinExtensions.map((extension) => extension.id),
    [
      ...SHELL_CORE_EXTENSION_IDS,
      ...SHELL_SETTINGS_EXTENSION_IDS,
      ...SHELL_WORKSPACE_EXTENSION_IDS,
      "workbench.interactive-requests",
      "workbench.side-chat",
      "workbench.image-understanding",
      "workbench.automations",
      "workbench.model-selector",
      "workbench.token-usage",
      ...SHELL_FILE_EXTENSION_IDS,
    ],
  );
});
