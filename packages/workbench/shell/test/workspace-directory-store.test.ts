import assert from "node:assert/strict";
import test from "node:test";

import type { WorkbenchSettingsPort } from "@workbench/shell/settings";
import { createWorkspaceDirectoryStoreInstallation } from "@workbench/shell/workspace-directory-store";

test("restores and persists expanded sidebar workspaces", async () => {
  const updates: unknown[] = [];
  const settings: WorkbenchSettingsPort = {
    async load() {
      return { sidebarExpandedWorkspaceIds: ["workspace-a", "workspace-b"] };
    },
    async update(patch) {
      updates.push(patch);
    },
  };
  const installation = createWorkspaceDirectoryStoreInstallation(settings);

  installation.port.actions.reconcileDirectoryIds(
    ["workspace-a", "workspace-b", "workspace-c"],
    ["workspace-b", "workspace-c"],
  );
  await installation.hydrate();
  assert.deepEqual(installation.store.getState().collapsedDirectoryIds, ["workspace-c"]);

  installation.port.actions.setDirectoryCollapsed("workspace-b", true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, [{ sidebarExpandedWorkspaceIds: ["workspace-a"] }]);
});
