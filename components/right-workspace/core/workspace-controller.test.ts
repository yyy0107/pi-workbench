import assert from "node:assert/strict";
import test from "node:test";

import { PanelsTopLeftIcon } from "lucide-react";

import { WorkspaceSurfaceRegistryImpl } from "@/platform/extensions";
import {
  DefaultRightWorkspaceController,
  RIGHT_WORKSPACE_STORAGE_KEY,
  type WorkspaceStorage,
} from "./workspace-controller";
import { createRightWorkspaceStore } from "./workspace-store";

class MemoryStorage implements WorkspaceStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const context = {
  applicationId: "app",
  threadId: "thread-1",
  worktreeId: "worktree-1",
  projectId: "project-1",
  rootPath: "/workspace",
};

function createRegistry() {
  const registry = new WorkspaceSurfaceRegistryImpl();
  registry.register({
    kind: "file",
    icon: PanelsTopLeftIcon,
    cachePolicy: "keep-alive",
    getResourceKey: (params, value) => `file:${value.worktreeId}:${String(params.absolutePath)}`,
    getDefaultScope: (_params, value) => ({
      type: "worktree",
      key: value.worktreeId ?? value.applicationId,
    }),
    render: () => null,
  });
  registry.register({
    kind: "artifact",
    icon: PanelsTopLeftIcon,
    cachePolicy: "keep-alive",
    getResourceKey: (params, value) => `artifact:${value.threadId}:${String(params.artifactId)}`,
    getDefaultScope: (_params, value) => ({
      type: "thread",
      key: value.threadId ?? value.applicationId,
    }),
    render: () => null,
  });
  registry.register({
    kind: "explorer",
    icon: PanelsTopLeftIcon,
    cachePolicy: "keep-alive",
    getResourceKey: (params, value) =>
      `explorer:${value.worktreeId}:${encodeURIComponent(String(params.rootPath))}`,
    getDefaultScope: (_params, value) => ({
      type: "worktree",
      key: value.worktreeId ?? value.applicationId,
    }),
    render: () => null,
  });
  return registry;
}

test("opening a surface requires an active extension contribution", () => {
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, new WorkspaceSurfaceRegistryImpl());

  assert.throws(
    () =>
      controller.open({
        kind: "missing",
        title: "Missing",
        params: {},
        context,
      }),
    /is not registered/,
  );
  assert.deepEqual(store.getState().surfaceOrder, []);
});

test("reveal deduplicates a file resource and closing the workspace preserves it", () => {
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, createRegistry());
  const request = {
    kind: "file" as const,
    title: "app.ts",
    params: { absolutePath: "/workspace/app.ts" },
    context,
    status: "ready" as const,
  };

  const first = controller.reveal(request);
  const second = controller.reveal({ ...request, title: "renamed label" });

  assert.equal(second, first);
  assert.deepEqual(store.getState().surfaceOrder, [first]);
  assert.equal(store.getState().surfaces[first]?.title, "renamed label");
  assert.equal(store.getState().open, true);

  controller.setWorkspaceOpen(false);
  assert.equal(store.getState().open, false);
  assert.ok(store.getState().surfaces[first]);
  assert.equal(store.getState().activeSurfaceId, first);
});

test("closing an active surface restores history from the same scope", () => {
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, createRegistry());
  const first = controller.open({
    kind: "artifact",
    title: "First",
    params: { artifactId: "first" },
    context,
  });
  const second = controller.open({
    kind: "artifact",
    title: "Second",
    params: { artifactId: "second" },
    context,
  });
  controller.open({
    kind: "artifact",
    title: "Other thread",
    params: { artifactId: "other" },
    context: { ...context, threadId: "thread-2" },
  });
  controller.focus(second);

  controller.close(second);

  assert.equal(store.getState().activeSurfaceId, first);
});

test("serializable tab metadata survives while its extension is unavailable", () => {
  const storage = new MemoryStorage();
  const firstStore = createRightWorkspaceStore();
  const firstController = new DefaultRightWorkspaceController(firstStore, createRegistry());
  firstController.hydrate(storage);
  const surfaceId = firstController.reveal({
    kind: "explorer",
    title: "Explorer",
    params: { rootPath: "/workspace" },
    context,
    status: "ready",
  });
  firstController.setWidth(612);
  firstController.setWorkspaceOpen(false);

  assert.ok(storage.values.get(RIGHT_WORKSPACE_STORAGE_KEY));

  const restoredStore = createRightWorkspaceStore();
  const restoredController = new DefaultRightWorkspaceController(
    restoredStore,
    new WorkspaceSurfaceRegistryImpl(),
  );
  restoredController.hydrate(storage);

  assert.equal(restoredStore.getState().hydrated, true);
  assert.equal(restoredStore.getState().width, 612);
  assert.equal(restoredStore.getState().open, false);
  assert.equal(restoredStore.getState().activeSurfaceId, surfaceId);
  assert.equal(
    restoredStore.getState().surfaces[surfaceId]?.resourceKey,
    "explorer:worktree-1:%2Fworkspace",
  );
});
