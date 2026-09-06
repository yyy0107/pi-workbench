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

  assert.deepEqual(groupIds(piAgentRuntimeExtensions), [
    "workbench.agent-configuration",
    "workbench.setting-model-config",
    "workbench.pi.settings-action",
    "workbench.toolbox",
    "workbench.connection-status",
    "workbench.context-trace",
    "workbench.external-session-import",
    "workbench.about",
  ]);
  assert.deepEqual(groupIds(piAgentRuntimeExtensions), [
    ...Object.values(piAgentRuntimeExtensionGroups).flatMap(groupIds),
  ]);
  assert.throws(() => {
    (
      piAgentRuntimeExtensionGroups.configuration as unknown as { push(extension: unknown): void }
    ).push({});
  }, /not extensible/);
});
