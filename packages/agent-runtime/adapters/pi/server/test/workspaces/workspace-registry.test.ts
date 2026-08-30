import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { getWorkspaceStore } from "../../src/workspaces/workspace-registry";

test("replaces a stale global workspace store after a server implementation upgrade", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-workspace-registry-"));
  const stateFile = path.join(root, "workspaces.json");
  const previousStateFile = process.env.PI_WORKBENCH_WORKSPACE_STATE_FILE;
  const registry = globalThis as typeof globalThis & {
    __workbenchWorkspaceStore?: unknown;
    __workbenchWorkspaceStateFile?: string;
    __workbenchWorkspaceStoreImplementationVersion?: number;
  };
  const previousStore = registry.__workbenchWorkspaceStore;
  const previousRegistryStateFile = registry.__workbenchWorkspaceStateFile;
  const previousVersion = registry.__workbenchWorkspaceStoreImplementationVersion;
  const staleStore = { list: async () => ({ items: [], archivedSessionIds: [] }) };

  process.env.PI_WORKBENCH_WORKSPACE_STATE_FILE = stateFile;
  registry.__workbenchWorkspaceStore = staleStore;
  registry.__workbenchWorkspaceStateFile = stateFile;
  delete registry.__workbenchWorkspaceStoreImplementationVersion;
  t.after(async () => {
    if (previousStateFile === undefined) delete process.env.PI_WORKBENCH_WORKSPACE_STATE_FILE;
    else process.env.PI_WORKBENCH_WORKSPACE_STATE_FILE = previousStateFile;
    registry.__workbenchWorkspaceStore = previousStore;
    registry.__workbenchWorkspaceStateFile = previousRegistryStateFile;
    registry.__workbenchWorkspaceStoreImplementationVersion = previousVersion;
    await rm(root, { recursive: true, force: true });
  });

  const currentStore = getWorkspaceStore();

  assert.notEqual(currentStore, staleStore);
  assert.equal(typeof currentStore.setPinned, "function");
  assert.equal(typeof currentStore.setSessionPinned, "function");
});
