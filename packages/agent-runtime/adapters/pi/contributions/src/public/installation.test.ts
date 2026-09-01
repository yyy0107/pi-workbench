import assert from "node:assert/strict";
import test from "node:test";

import { piAgentRuntimeExtensionGroups, piAgentRuntimeExtensions } from "./installation";

const groupIds = (group: readonly { id: string }[]) => group.map(({ id }) => id);

test("keeps Pi extension groups deeply frozen with their app-composition ordering", () => {
  assert.equal(Object.isFrozen(piAgentRuntimeExtensionGroups), true);
  for (const group of Object.values(piAgentRuntimeExtensionGroups)) {
    assert.equal(Object.isFrozen(group), true);
  }
  assert.equal(Object.isFrozen(piAgentRuntimeExtensions), true);

  assert.deepEqual(groupIds(piAgentRuntimeExtensionGroups.workspace), [
    "workbench.workspace-explorer",
    "workbench.workspace-review",
  ]);
  assert.deepEqual(groupIds(piAgentRuntimeExtensionGroups.terminal), ["workbench.terminal"]);
  assert.deepEqual(groupIds(piAgentRuntimeExtensionGroups.setup), [
    "workbench.workspace-directory-picker",
    "workbench.git-branch",
  ]);
  assert.deepEqual(groupIds(piAgentRuntimeExtensionGroups.runtime), [
    "workbench.agent-configuration",
    "workbench.interactive-requests",
    "workbench.side-chat",
    "workbench.setting-model-config",
    "workbench.image-understanding",
    "workbench.skills",
    "workbench.pi-extensions",
    "workbench.toolbox",
    "workbench.automations",
    "workbench.model-selector",
    "workbench.connection-status",
    "workbench.context-trace",
    "workbench.external-session-import",
    "workbench.token-usage",
    "workbench.workspace-file",
  ]);
  assert.deepEqual(groupIds(piAgentRuntimeExtensions), [
    ...groupIds(piAgentRuntimeExtensionGroups.workspace),
    ...groupIds(piAgentRuntimeExtensionGroups.terminal),
    ...groupIds(piAgentRuntimeExtensionGroups.setup),
    ...groupIds(piAgentRuntimeExtensionGroups.runtime),
  ]);
  assert.throws(() => {
    (piAgentRuntimeExtensionGroups.runtime as unknown as { push(extension: unknown): void }).push(
      {},
    );
  }, /not extensible/);
});
