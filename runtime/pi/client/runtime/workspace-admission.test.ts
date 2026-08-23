import assert from "node:assert/strict";
import test from "node:test";

import { PiSessionManager } from "./manager";

test("accepts an authoritative create result before workspace reconciliation", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());

  manager.acceptCreatedWorkspace({
    id: "workspace-created",
    name: "Created Workspace",
    cwd: "/workspace/created",
  });

  assert.deepEqual(manager.getWorkspaces(), [
    {
      id: "workspace-created",
      name: "Created Workspace",
      cwd: "/workspace/created",
      pinned: false,
    },
  ]);
});

test("keeps an accepted create result when best-effort reconciliation fails", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    throw new Error("workspace refresh offline");
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  manager.acceptCreatedWorkspace({
    id: "workspace-created",
    name: "Created Workspace",
    cwd: "/workspace/created",
  });

  await assert.rejects(manager.refreshWorkspaceMetadata());

  assert.equal(manager.getWorkspaces()[0]?.id, "workspace-created");
});
