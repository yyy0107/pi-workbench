import assert from "node:assert/strict";
import test from "node:test";

import { PanelsTopLeftIcon } from "lucide-react";

import { type ExtensionContext } from "@/platform/extensions";
import { ExtensionManager, WorkspaceSurfaceRegistryImpl } from "@/platform/extensions/internal";
import {
  DefaultRightWorkspaceController,
  RIGHT_WORKSPACE_STORAGE_KEY,
  type WorkspaceStorage,
} from "./workspace-controller";
import { selectActiveSurface, selectContextSurfaces } from "./workspace-selectors";
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

const fileDefinition = {
  kind: "file",
  icon: PanelsTopLeftIcon,
  cachePolicy: "keep-alive" as const,
  getResourceKey: (params: Record<string, unknown>, value: typeof context) =>
    `file:${value.worktreeId}:${String(params.absolutePath)}`,
  getDefaultScope: (_params: Record<string, unknown>, value: typeof context) => ({
    type: "worktree" as const,
    key: value.worktreeId ?? value.applicationId,
  }),
  render: () => null,
};

const explorerDefinition = {
  kind: "explorer",
  icon: PanelsTopLeftIcon,
  cachePolicy: "keep-alive" as const,
  defaultPlacement: "auxiliary" as const,
  getResourceKey: (params: Record<string, unknown>, value: typeof context) =>
    `explorer:${value.worktreeId}:${encodeURIComponent(String(params.rootPath))}`,
  getDefaultScope: (_params: Record<string, unknown>, value: typeof context) => ({
    type: "worktree" as const,
    key: value.worktreeId ?? value.applicationId,
  }),
  render: () => null,
};

function createRegistry() {
  const registry = new WorkspaceSurfaceRegistryImpl();
  registry.register(fileDefinition);
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
  registry.register(explorerDefinition);
  registry.register({
    kind: "terminal",
    icon: PanelsTopLeftIcon,
    cachePolicy: "keep-alive",
    allowDuplicateResources: true,
    getResourceKey: (params) => `terminal:${String(params.sessionId)}`,
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

test("conversation content is isolated while workspace width stays shared", () => {
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, createRegistry());
  const firstContext = context;
  const secondContext = { ...context, threadId: "thread-2" };
  const first = controller.open({
    kind: "artifact",
    title: "First conversation",
    params: { artifactId: "first" },
    context: firstContext,
  });
  const laterInFirstConversation = controller.open({
    kind: "artifact",
    title: "Later in first conversation",
    params: { artifactId: "later" },
    context: firstContext,
  });
  controller.focus(first);
  controller.setWidth(612);
  const second = controller.open({
    kind: "artifact",
    title: "Second conversation",
    params: { artifactId: "first" },
    context: secondContext,
    policy: "background",
  });

  assert.notEqual(first, second);
  assert.deepEqual(
    selectContextSurfaces(store.getState(), firstContext).map((surface) => surface.id),
    [first, laterInFirstConversation],
  );
  assert.deepEqual(
    selectContextSurfaces(store.getState(), secondContext).map((surface) => surface.id),
    [second],
  );
  assert.equal(selectActiveSurface(store.getState(), firstContext)?.id, first);
  assert.equal(selectActiveSurface(store.getState(), secondContext)?.id, second);
  assert.equal(store.getState().width, 612);

  controller.setWidth(744);
  controller.restoreContext(firstContext);
  assert.equal(store.getState().activeSurfaceId, first);
  assert.equal(store.getState().width, 744);

  controller.restoreContext(secondContext);
  assert.equal(store.getState().activeSurfaceId, second);
  assert.equal(store.getState().width, 744);
});

test("closing an active surface selects the adjacent right tab before falling back left", () => {
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
  const third = controller.open({
    kind: "artifact",
    title: "Third",
    params: { artifactId: "third" },
    context,
  });
  controller.focus(second);

  controller.close(second);
  assert.equal(store.getState().activeSurfaceId, third);

  controller.close(third);
  assert.equal(store.getState().activeSurfaceId, first);
});

test("primary and auxiliary surfaces activate independently", () => {
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, createRegistry());
  const file = controller.open({
    kind: "file",
    title: "app.ts",
    params: { absolutePath: "/workspace/app.ts" },
    context,
  });
  const explorer = controller.open({
    kind: "explorer",
    title: "Explorer",
    params: { rootPath: "/workspace" },
    context,
  });

  assert.equal(store.getState().surfaces[file]?.placement, "primary");
  assert.equal(store.getState().surfaces[explorer]?.placement, "auxiliary");
  assert.equal(store.getState().activeSurfaceId, file);
  assert.equal(store.getState().activeAuxiliarySurfaceId, explorer);

  controller.close(file);
  assert.equal(store.getState().activeSurfaceId, null);
  assert.equal(store.getState().activeAuxiliarySurfaceId, explorer);
  assert.equal(store.getState().open, true);
});

test("focus, close fallback, and closeOthers stay within one placement", () => {
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, createRegistry());
  const firstFile = controller.open({
    kind: "file",
    title: "one.ts",
    params: { absolutePath: "/workspace/one.ts" },
    context,
  });
  const secondFile = controller.open({
    kind: "file",
    title: "two.ts",
    params: { absolutePath: "/workspace/two.ts" },
    context,
  });
  const firstExplorer = controller.open({
    kind: "explorer",
    title: "Explorer one",
    params: { rootPath: "/workspace" },
    context,
  });
  const secondExplorer = controller.open({
    kind: "explorer",
    title: "Explorer two",
    params: { rootPath: "/workspace/packages" },
    context,
  });

  controller.focus(firstExplorer);
  assert.equal(store.getState().activeSurfaceId, secondFile);
  assert.equal(store.getState().activeAuxiliarySurfaceId, firstExplorer);

  controller.close(firstExplorer);
  assert.equal(store.getState().activeSurfaceId, secondFile);
  assert.equal(store.getState().activeAuxiliarySurfaceId, secondExplorer);

  controller.closeOthers(firstFile);
  assert.deepEqual(store.getState().surfaceOrder, [firstFile, secondExplorer]);
  assert.equal(store.getState().activeSurfaceId, firstFile);
  assert.equal(store.getState().activeAuxiliarySurfaceId, secondExplorer);
});

test("reorder moves tabs within a placement without disturbing auxiliary surfaces", () => {
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, createRegistry());
  const first = controller.open({
    kind: "file",
    title: "one.ts",
    params: { absolutePath: "/workspace/one.ts" },
    context,
  });
  const explorer = controller.open({
    kind: "explorer",
    title: "Explorer",
    params: { rootPath: "/workspace" },
    context,
  });
  const second = controller.open({
    kind: "file",
    title: "two.ts",
    params: { absolutePath: "/workspace/two.ts" },
    context,
  });
  const third = controller.open({
    kind: "file",
    title: "three.ts",
    params: { absolutePath: "/workspace/three.ts" },
    context,
  });

  controller.reorder(third, first, "before");
  assert.deepEqual(store.getState().surfaceOrder, [third, first, explorer, second]);

  controller.reorder(first, explorer, "after");
  assert.deepEqual(store.getState().surfaceOrder, [third, first, explorer, second]);
});

test("closeToRight closes only visible tabs to the right and restores focus to its anchor", () => {
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, createRegistry());
  const first = controller.open({
    kind: "file",
    title: "one.ts",
    params: { absolutePath: "/workspace/one.ts" },
    context,
  });
  const hidden = controller.open({
    kind: "file",
    title: "hidden.ts",
    params: { absolutePath: "/other/hidden.ts" },
    context: { ...context, worktreeId: "worktree-2" },
  });
  const second = controller.open({
    kind: "file",
    title: "two.ts",
    params: { absolutePath: "/workspace/two.ts" },
    context,
  });
  const explorer = controller.open({
    kind: "explorer",
    title: "Explorer",
    params: { rootPath: "/workspace" },
    context,
  });
  const third = controller.open({
    kind: "file",
    title: "three.ts",
    params: { absolutePath: "/workspace/three.ts" },
    context,
  });

  controller.closeToRight(first, context);

  assert.deepEqual(store.getState().surfaceOrder, [first, hidden, explorer]);
  assert.equal(store.getState().surfaces[second], undefined);
  assert.equal(store.getState().surfaces[third], undefined);
  assert.equal(store.getState().activeSurfaceId, first);
  assert.equal(store.getState().activeAuxiliarySurfaceId, explorer);
});

test("context-aware closeOthers preserves tabs outside the visible workspace context", () => {
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, createRegistry());
  const first = controller.open({
    kind: "file",
    title: "one.ts",
    params: { absolutePath: "/workspace/one.ts" },
    context,
  });
  const hidden = controller.open({
    kind: "file",
    title: "hidden.ts",
    params: { absolutePath: "/other/hidden.ts" },
    context: { ...context, worktreeId: "worktree-2" },
  });
  controller.open({
    kind: "file",
    title: "two.ts",
    params: { absolutePath: "/workspace/two.ts" },
    context,
  });
  const explorer = controller.open({
    kind: "explorer",
    title: "Explorer",
    params: { rootPath: "/workspace" },
    context,
  });

  controller.closeOthers(first, context);

  assert.deepEqual(store.getState().surfaceOrder, [first, hidden, explorer]);
  assert.equal(store.getState().activeSurfaceId, first);
  assert.equal(store.getState().activeAuxiliarySurfaceId, explorer);
});

test("serializable placement metadata survives while its extension is unavailable", () => {
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
  assert.equal(restoredStore.getState().activeSurfaceId, null);
  assert.equal(restoredStore.getState().activeAuxiliarySurfaceId, surfaceId);
  assert.equal(restoredStore.getState().surfaces[surfaceId]?.placement, "auxiliary");
  assert.equal(
    restoredStore.getState().surfaces[surfaceId]?.resourceKey,
    "explorer:worktree-1:%2Fworkspace",
  );
});

test("session-only surfaces do not restore disconnected tabs after reload", () => {
  const storage = new MemoryStorage();
  const registry = createRegistry();
  registry.register({
    kind: "browser",
    icon: PanelsTopLeftIcon,
    cachePolicy: "keep-alive",
    persistence: "session",
    getResourceKey: (params) => `browser:${String(params.sessionId)}`,
    render: () => null,
  });
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, registry);
  controller.hydrate(storage);
  controller.open({
    kind: "browser",
    title: "Browser",
    params: { sessionId: "memory-only" },
    context,
  });

  const serialized = storage.values.get(RIGHT_WORKSPACE_STORAGE_KEY);
  assert.ok(serialized);
  assert.deepEqual(JSON.parse(serialized).surfaces, []);
  assert.equal(JSON.parse(serialized).open, false);

  const restoredStore = createRightWorkspaceStore();
  new DefaultRightWorkspaceController(restoredStore, registry).hydrate(storage);
  assert.deepEqual(restoredStore.getState().surfaceOrder, []);
  assert.equal(restoredStore.getState().open, false);
});

test("legacy hydration reconciles an existing resource to its registered placement", () => {
  const storage = new MemoryStorage();
  const surfaceId = "explorer:legacy";
  storage.values.set(
    RIGHT_WORKSPACE_STORAGE_KEY,
    JSON.stringify({
      open: true,
      width: 640,
      activeSurfaceId: surfaceId,
      surfaceOrder: [surfaceId],
      surfaces: [
        {
          id: surfaceId,
          kind: "explorer",
          title: "Explorer",
          resourceKey: "explorer:worktree-1:%2Fworkspace",
          scope: { type: "worktree", key: "worktree-1" },
          params: { rootPath: "/workspace" },
          status: "ready",
          createdAt: 1,
          lastActiveAt: 1,
        },
      ],
    }),
  );
  const registry = new WorkspaceSurfaceRegistryImpl();
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, registry);
  controller.hydrate(storage);

  assert.equal(store.getState().surfaces[surfaceId]?.placement, "primary");
  registry.register(explorerDefinition);
  const revealed = controller.reveal({
    kind: "explorer",
    title: "Explorer",
    params: { rootPath: "/workspace" },
    context,
    policy: "background",
  });

  assert.equal(revealed, surfaceId);
  assert.equal(store.getState().surfaceOrder.length, 1);
  assert.equal(store.getState().surfaces[surfaceId]?.placement, "auxiliary");
  assert.equal(store.getState().activeSurfaceId, null);
  assert.equal(store.getState().activeAuxiliarySurfaceId, surfaceId);
});

test("auxiliary width is clamped and persisted", () => {
  const storage = new MemoryStorage();
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, createRegistry());
  controller.hydrate(storage);

  controller.setAuxiliaryWidth(120);
  assert.equal(store.getState().auxiliaryWidth, 220);

  controller.setAuxiliaryWidth(486);
  const restoredStore = createRightWorkspaceStore();
  new DefaultRightWorkspaceController(restoredStore, createRegistry()).hydrate(storage);
  assert.equal(restoredStore.getState().auxiliaryWidth, 486);
});

test("auxiliary visibility is hidden persistently and legacy state defaults to visible", () => {
  const storage = new MemoryStorage();
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, createRegistry());
  controller.hydrate(storage);

  controller.setAuxiliaryOpen(false);
  assert.equal(store.getState().auxiliaryOpen, false);

  const restoredStore = createRightWorkspaceStore();
  new DefaultRightWorkspaceController(restoredStore, createRegistry()).hydrate(storage);
  assert.equal(restoredStore.getState().auxiliaryOpen, false);

  storage.values.set(
    RIGHT_WORKSPACE_STORAGE_KEY,
    JSON.stringify({ open: true, width: 640, surfaceOrder: [], surfaces: [] }),
  );
  const legacyStore = createRightWorkspaceStore();
  new DefaultRightWorkspaceController(legacyStore, createRegistry()).hydrate(storage);
  assert.equal(legacyStore.getState().auxiliaryOpen, true);
});

test("background auxiliary reveals preserve a hidden auxiliary pane", () => {
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, createRegistry());
  const request = {
    kind: "explorer" as const,
    title: "Explorer",
    params: { rootPath: "/workspace" },
    context,
  };
  controller.reveal(request);
  controller.setAuxiliaryOpen(false);

  controller.reveal({ ...request, policy: "background" });
  assert.equal(store.getState().auxiliaryOpen, false);

  controller.reveal({
    ...request,
    params: { rootPath: "/workspace/packages" },
    policy: "background",
  });
  assert.equal(store.getState().auxiliaryOpen, false);
});

test("explicit auxiliary focus and open restore a hidden auxiliary pane", () => {
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, createRegistry());
  const request = {
    kind: "explorer" as const,
    title: "Explorer",
    params: { rootPath: "/workspace" },
    context,
  };
  const surfaceId = controller.open(request);

  controller.setAuxiliaryOpen(false);
  controller.focus(surfaceId);
  assert.equal(store.getState().auxiliaryOpen, true);

  controller.setAuxiliaryOpen(false);
  assert.equal(controller.open(request), surfaceId);
  assert.equal(store.getState().auxiliaryOpen, true);
});

test("surface instances survive contribution deactivation and recover on reactivation", () => {
  const manager = new ExtensionManager();
  const extension = {
    id: "workbench.file-fixture",
    name: "File Fixture",
    version: "1.0.0",
    setup: (extensionContext: ExtensionContext) =>
      extensionContext.workspace.register(fileDefinition),
  };
  manager.activate(extension);
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, manager.workspace);
  const request = {
    kind: "file" as const,
    title: "app.ts",
    params: { absolutePath: "/workspace/app.ts" },
    context,
  };
  const surfaceId = controller.reveal(request);

  manager.deactivate(extension.id);
  assert.equal(manager.workspace.get("file"), undefined);
  assert.equal(store.getState().surfaces[surfaceId]?.id, surfaceId);

  manager.activate(extension);
  assert.equal(controller.reveal(request), surfaceId);
  assert.equal(manager.workspace.get("file")?.kind, "file");
});

test("duplicate-enabled surface definitions create independent instances", () => {
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, createRegistry());
  const request = {
    kind: "terminal" as const,
    title: "Terminal",
    params: { sessionId: "session-1" },
    context,
  };

  const first = controller.open(request);
  const second = controller.open(request);

  assert.notEqual(first, second);
  assert.deepEqual(store.getState().surfaceOrder, [first, second]);
});
