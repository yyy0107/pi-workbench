import assert from "node:assert/strict";
import test from "node:test";

import type {
  ExtensionContext,
  LocalizableText,
  WorkspaceSurfaceDefinition,
  WorkspaceSurfaceRegistry,
} from "@workbench/extension-sdk";
import { ExtensionManager, WorkspaceSurfaceRegistryImpl } from "@workbench/extension-sdk/internal";
import {
  DefaultRightWorkspaceController as ShellRightWorkspaceController,
  RightWorkspaceControllerDisposedError,
  type LocalizableTextValidator,
  type RightWorkspacePersistencePort,
} from "../../src/right-workspace/workspace-controller";
import {
  MIN_RIGHT_WORKSPACE_WIDTH,
  createRightWorkspaceStore,
  selectActiveSurface,
  selectContextSurfaces,
  type RightWorkspaceStoreApi,
} from "@workbench/shell/right-workspace";

class MemoryPersistence implements RightWorkspacePersistencePort {
  value: string | null = null;
  readonly writes: string[] = [];

  async read(): Promise<string | null> {
    return this.value;
  }

  async write(value: string): Promise<void> {
    this.value = value;
    this.writes.push(value);
  }
}

async function flushPersistence(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

const FixtureIcon = (() => null) as unknown as WorkspaceSurfaceDefinition["icon"];

const validateFixtureText: LocalizableTextValidator = (
  candidate: unknown,
): candidate is LocalizableText =>
  typeof candidate === "string" ||
  (typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    Object.keys(candidate).every((key) => key === "key" || key === "values") &&
    "key" in candidate &&
    typeof candidate.key === "string" &&
    candidate.key.startsWith("fixture."));

function createController(
  store: RightWorkspaceStoreApi,
  registry = createRegistry(),
  persistence?: RightWorkspacePersistencePort,
) {
  return new ShellRightWorkspaceController(store, registry, {
    validateLocalizableText: validateFixtureText,
    ...(persistence ? { persistence } : {}),
  });
}

class DefaultRightWorkspaceController extends ShellRightWorkspaceController {
  constructor(
    store: RightWorkspaceStoreApi,
    registry: WorkspaceSurfaceRegistry,
    persistence?: RightWorkspacePersistencePort,
  ) {
    super(store, registry, {
      validateLocalizableText: validateFixtureText,
      ...(persistence ? { persistence } : {}),
    });
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
  icon: FixtureIcon,
  cachePolicy: "keep-alive" as const,
  getResourceKey: (params: Record<string, unknown>, value: typeof context) =>
    `file:${value.worktreeId}:${String(params.absolutePath)}`,
  getDefaultScope: (_params: Record<string, unknown>, value: typeof context) => ({
    type: "worktree" as const,
    key: value.worktreeId ?? value.applicationId,
  }),
  render: () => null,
};

const limitedFileDefinition = {
  ...fileDefinition,
  tabPolicy: {
    maxTabs: 2,
    replacement: "most-recent" as const,
  },
};

const explorerDefinition = {
  kind: "explorer",
  icon: FixtureIcon,
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

const artifactDefinition = {
  kind: "artifact",
  icon: FixtureIcon,
  cachePolicy: "keep-alive" as const,
  getResourceKey: (params: Record<string, unknown>, value: typeof context) =>
    `artifact:${value.threadId}:${String(params.artifactId)}`,
  getDefaultScope: (_params: Record<string, unknown>, value: typeof context) => ({
    type: "thread" as const,
    key: value.threadId ?? value.applicationId,
  }),
  render: () => null,
};

function createRegistry() {
  const registry = new WorkspaceSurfaceRegistryImpl();
  registry.register(fileDefinition);
  registry.register(artifactDefinition);
  registry.register(explorerDefinition);
  registry.register({
    kind: "terminal",
    icon: FixtureIcon,
    cachePolicy: "keep-alive",
    allowDuplicateResources: true,
    getResourceKey: (params) => `terminal:${String(params.sessionId)}`,
    render: () => null,
  });
  return registry;
}

function createLimitedFileRegistry() {
  const registry = new WorkspaceSurfaceRegistryImpl();
  registry.register(limitedFileDefinition);
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

test("a tab policy replaces the most recently used clean file when the limit is reached", () => {
  const store = createRightWorkspaceStore();
  const controller = createController(store, createLimitedFileRegistry());
  const openFile = (name: string) =>
    controller.open({
      kind: "file",
      title: name,
      params: { absolutePath: `/workspace/${name}` },
      context,
    });

  const first = openFile("one.ts");
  const second = openFile("two.ts");
  const third = openFile("three.ts");

  assert.deepEqual(store.getState().surfaceOrder, [first, third]);
  assert.equal(store.getState().surfaces[second], undefined);
  assert.equal(store.getState().activeSurfaceId, third);

  controller.closeAll();
  const dirty = openFile("dirty.ts");
  controller.update(dirty, { dirty: true });
  const clean = openFile("clean.ts");
  const fourth = openFile("four.ts");
  assert.deepEqual(
    store
      .getState()
      .surfaceOrder.map((surfaceId) => store.getState().surfaces[surfaceId]?.params.absolutePath),
    ["/workspace/dirty.ts", "/workspace/four.ts"],
  );
  assert.equal(store.getState().surfaces[clean], undefined);
  assert.equal(store.getState().surfaces[fourth]?.title, "four.ts");
});

test("closing and reopening the workspace remembers its last width", () => {
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, createRegistry());

  controller.setWidth(612);
  controller.setWorkspaceOpen(false);
  controller.setWorkspaceOpen(true);
  assert.equal(store.getState().open, true);
  assert.equal(store.getState().width, 612);
});

test("resetting the workspace layout restores the new-conversation defaults", () => {
  const store = createRightWorkspaceStore();
  const controller = new DefaultRightWorkspaceController(store, createRegistry());

  const surfaceId = controller.open({
    kind: "file",
    title: "app.ts",
    params: { absolutePath: "/workspace/app.ts" },
    context,
  });
  controller.setWidth(612);
  controller.setMaximized(true);
  controller.resetLayout();

  assert.equal(store.getState().open, false);
  assert.equal(store.getState().width, MIN_RIGHT_WORKSPACE_WIDTH);
  assert.equal(store.getState().maximized, false);
  assert.ok(store.getState().surfaces[surfaceId]);
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

test("thread promotion atomically rekeys resources and keeps the live draft instance on collision", async () => {
  const persistence = new MemoryPersistence();
  const store = createRightWorkspaceStore();
  const controller = createController(store, createRegistry(), persistence);
  await controller.initialize();
  const draftContext = { ...context, threadId: "draft-thread" };
  const remoteContext = { ...context, threadId: "remote-thread" };
  const promoted = controller.open({
    kind: "artifact",
    title: "Live draft",
    params: { artifactId: "shared", draftMarker: "preserve-me" },
    context: draftContext,
    status: "ready",
    dirty: true,
    pinned: true,
  });
  const otherPromoted = controller.open({
    kind: "artifact",
    title: "Other draft resource",
    params: { artifactId: "other" },
    context: draftContext,
  });
  const auxiliary = controller.open({
    kind: "explorer",
    title: "Explorer",
    params: { rootPath: "/workspace" },
    context: draftContext,
  });
  const destinationDuplicate = controller.open({
    kind: "artifact",
    title: "Persisted remote duplicate",
    params: { artifactId: "shared", destinationMarker: "remove-me" },
    context: remoteContext,
  });
  const promotedBefore = store.getState().surfaces[promoted];
  assert.ok(promotedBefore);
  assert.equal(store.getState().activeSurfaceId, destinationDuplicate);
  assert.equal(store.getState().activeAuxiliarySurfaceId, auxiliary);
  await flushPersistence();
  persistence.writes.length = 0;

  let storeCommits = 0;
  const unsubscribe = store.subscribe(() => {
    storeCommits += 1;
  });
  controller.promoteThreadScope("draft-thread", remoteContext);
  unsubscribe();
  await flushPersistence();

  const promotedAfter = store.getState().surfaces[promoted];
  assert.deepEqual(promotedAfter, {
    ...promotedBefore,
    resourceKey: "artifact:remote-thread:shared",
    scope: { type: "thread", key: "remote-thread" },
  });
  assert.equal(promotedAfter?.dirty, true);
  assert.equal(promotedAfter?.pinned, true);
  assert.deepEqual(promotedAfter?.params, {
    artifactId: "shared",
    draftMarker: "preserve-me",
  });
  assert.equal(
    store.getState().surfaces[otherPromoted]?.resourceKey,
    "artifact:remote-thread:other",
  );
  assert.equal(store.getState().surfaces[destinationDuplicate], undefined);
  assert.deepEqual(store.getState().surfaceOrder, [promoted, otherPromoted, auxiliary]);
  assert.deepEqual(store.getState().navigationHistory, [otherPromoted, auxiliary, promoted]);
  assert.equal(store.getState().activeSurfaceId, promoted);
  assert.equal(store.getState().activeAuxiliarySurfaceId, auxiliary);
  assert.ok(
    store
      .getState()
      .navigationHistory.every((surfaceId) => Boolean(store.getState().surfaces[surfaceId])),
  );
  assert.equal(new Set(store.getState().navigationHistory).size, 3);
  assert.equal(storeCommits, 1);
  assert.equal(persistence.writes.length, 1);

  const revealed = controller.reveal({
    kind: "artifact",
    title: "Remote reveal",
    params: { artifactId: "shared" },
    context: remoteContext,
  });
  assert.equal(revealed, promoted);
  assert.equal(
    store.getState().surfaceOrder.filter((surfaceId) => {
      const surface = store.getState().surfaces[surfaceId];
      return (
        surface?.kind === "artifact" && surface.resourceKey === "artifact:remote-thread:shared"
      );
    }).length,
    1,
  );
});

test("thread promotion preserves an unavailable contribution's opaque resource identity", () => {
  const registry = new WorkspaceSurfaceRegistryImpl();
  const registration = registry.register(artifactDefinition);
  const store = createRightWorkspaceStore();
  const controller = createController(store, registry);
  const draftContext = { ...context, threadId: "draft-thread" };
  const surfaceId = controller.open({
    kind: "artifact",
    title: "Unavailable artifact",
    params: { artifactId: "shared" },
    context: draftContext,
  });
  const opaqueResourceKey = store.getState().surfaces[surfaceId]?.resourceKey;
  registration.dispose();

  controller.promoteThreadScope("draft-thread", { ...context, threadId: "remote-thread" });

  assert.equal(store.getState().surfaces[surfaceId]?.scope.type, "thread");
  assert.equal(store.getState().surfaces[surfaceId]?.scope.key, "remote-thread");
  assert.equal(store.getState().surfaces[surfaceId]?.resourceKey, opaqueResourceKey);
  assert.deepEqual(store.getState().surfaceOrder, [surfaceId]);
});

test("thread promotion validates its context identity and no-matches are mutation-free", () => {
  const store = createRightWorkspaceStore();
  const controller = createController(store);
  let storeCommits = 0;
  const unsubscribe = store.subscribe(() => {
    storeCommits += 1;
  });

  assert.throws(
    () => controller.promoteThreadScope("draft-thread", { ...context, threadId: undefined }),
    /nextContext\.threadId/,
  );
  controller.promoteThreadScope("missing-thread", { ...context, threadId: "remote-thread" });
  controller.promoteThreadScope("remote-thread", { ...context, threadId: "remote-thread" });

  unsubscribe();
  assert.equal(storeCommits, 0);
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

test("context-aware close follows visible neighbors across scopes and preserves other panes", () => {
  const store = createRightWorkspaceStore();
  const controller = createController(store);
  const left = controller.open({
    kind: "terminal",
    title: "Application terminal",
    params: { sessionId: "terminal" },
    context,
  });
  const active = controller.open({
    kind: "artifact",
    title: "Thread artifact",
    params: { artifactId: "active" },
    context,
  });
  const hidden = controller.open({
    kind: "artifact",
    title: "Other thread",
    params: { artifactId: "hidden" },
    context: { ...context, threadId: "thread-2" },
  });
  const explorer = controller.open({
    kind: "explorer",
    title: "Explorer",
    params: { rootPath: "/workspace" },
    context,
  });
  const hiddenExplorer = controller.open({
    kind: "explorer",
    title: "Other worktree explorer",
    params: { rootPath: "/other" },
    context: { ...context, worktreeId: "worktree-2" },
  });
  const right = controller.open({
    kind: "file",
    title: "Worktree file",
    params: { absolutePath: "/workspace/app.ts" },
    context,
  });
  controller.focus(explorer);
  // The visible active tab may be resolved from history while the raw ID belongs to another scope.
  controller.focus(active);
  controller.focus(hidden);
  assert.equal(selectActiveSurface(store.getState(), context)?.id, active);

  controller.close(active, context);
  assert.equal(store.getState().activeSurfaceId, right);
  assert.equal(store.getState().activeAuxiliarySurfaceId, explorer);
  assert.equal(store.getState().open, true);
  assert.ok(store.getState().surfaces[hidden]);

  controller.close(right, context);
  assert.equal(store.getState().activeSurfaceId, left);
  assert.equal(store.getState().open, true);

  controller.close(hidden, context);
  assert.equal(store.getState().activeSurfaceId, left);

  controller.close(left, context);
  assert.equal(store.getState().activeSurfaceId, null);
  assert.equal(store.getState().activeAuxiliarySurfaceId, explorer);
  assert.equal(store.getState().open, true);

  controller.close(explorer, context);
  assert.equal(store.getState().activeAuxiliarySurfaceId, null);
  assert.equal(store.getState().open, false);
  assert.deepEqual(store.getState().surfaceOrder, [hiddenExplorer]);
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

test("serializable placement metadata survives while its extension is unavailable", async () => {
  const persistence = new MemoryPersistence();
  const firstStore = createRightWorkspaceStore();
  const firstController = createController(firstStore, createRegistry(), persistence);
  await firstController.initialize();
  const surfaceId = firstController.reveal({
    kind: "explorer",
    title: "Explorer",
    params: { rootPath: "/workspace" },
    context,
    status: "ready",
  });
  firstController.setWidth(612);
  firstController.setWorkspaceOpen(false);
  await flushPersistence();

  assert.ok(persistence.value);

  const restoredStore = createRightWorkspaceStore();
  const restoredController = createController(
    restoredStore,
    new WorkspaceSurfaceRegistryImpl(),
    persistence,
  );
  await restoredController.initialize();

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

test("the injected text validator admits catalog values and rejects unknown descriptors", async () => {
  const persistence = new MemoryPersistence();
  persistence.value = JSON.stringify({
    open: true,
    width: 640,
    activeSurfaceId: "valid",
    surfaceOrder: ["valid", "unknown"],
    surfaces: [
      {
        id: "valid",
        kind: "file",
        placement: "primary",
        title: { key: "fixture.title" },
        resourceKey: "valid",
        scope: { type: "application", key: "app" },
        params: {},
        status: "error",
        statusMessage: { key: "fixture.error" },
        createdAt: 1,
        lastActiveAt: 1,
      },
      {
        id: "unknown",
        kind: "file",
        placement: "primary",
        title: { key: "product.unknown" },
        resourceKey: "unknown",
        scope: { type: "application", key: "app" },
        params: {},
        status: "ready",
        createdAt: 1,
        lastActiveAt: 1,
      },
    ],
  });
  const store = createRightWorkspaceStore();
  await createController(store, createRegistry(), persistence).initialize();

  assert.deepEqual(store.getState().surfaceOrder, ["valid"]);
  assert.deepEqual(store.getState().surfaces.valid?.title, { key: "fixture.title" });
  assert.deepEqual(store.getState().surfaces.valid?.statusMessage, { key: "fixture.error" });
  assert.equal(store.getState().surfaces.unknown, undefined);
});

test("hydration does not replace a live surface opened while preference loading is pending", async () => {
  let resolveRead!: (value: string | null) => void;
  const writes: string[] = [];
  const persistence: RightWorkspacePersistencePort = {
    read: () => new Promise((resolve) => (resolveRead = resolve)),
    async write(serialized) {
      writes.push(serialized);
    },
  };
  const startupStore = createRightWorkspaceStore();
  const startupController = createController(startupStore, createRegistry(), persistence);
  const initialization = startupController.initialize();
  const liveSurfaceId = startupController.open({
    kind: "file",
    title: "live.ts",
    params: { absolutePath: "/workspace/live.ts" },
    context,
  });
  resolveRead(
    JSON.stringify({
      open: true,
      width: 640,
      activeSurfaceId: "persisted",
      surfaceOrder: ["persisted"],
      surfaces: [
        {
          id: "persisted",
          kind: "file",
          placement: "primary",
          title: "persisted.ts",
          resourceKey: "persisted",
          scope: { type: "application", key: "app" },
          params: {},
          status: "ready",
          createdAt: 1,
          lastActiveAt: 1,
        },
      ],
    }),
  );
  await initialization;

  assert.ok(startupStore.getState().surfaces[liveSurfaceId]);
  assert.equal(startupStore.getState().surfaces.persisted, undefined);
  assert.deepEqual(startupStore.getState().surfaceOrder, [liveSurfaceId]);
  assert.equal(startupStore.getState().hydrated, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0]!).surfaceOrder, [liveSurfaceId]);
});

test("hydration arbitration preserves startup reveal, update, and close mutations", async () => {
  const persistedSerialized = JSON.stringify({
    open: true,
    width: 640,
    activeSurfaceId: "persisted",
    surfaceOrder: ["persisted"],
    surfaces: [
      {
        id: "persisted",
        kind: "file",
        placement: "primary",
        title: "persisted.ts",
        resourceKey: "persisted",
        scope: { type: "application", key: "app" },
        params: {},
        status: "ready",
        createdAt: 1,
        lastActiveAt: 1,
      },
    ],
  });
  const createPersistence = () => {
    const persistence = new MemoryPersistence();
    persistence.value = persistedSerialized;
    return persistence;
  };

  const revealStore = createRightWorkspaceStore();
  const revealController = createController(revealStore, createRegistry(), createPersistence());
  const revealedId = revealController.open({
    kind: "file",
    title: "live.ts",
    params: { absolutePath: "/workspace/live.ts" },
    context,
  });
  revealController.reveal({
    kind: "file",
    title: "revealed.ts",
    params: { absolutePath: "/workspace/live.ts" },
    context,
  });
  await revealController.initialize();
  assert.equal(revealStore.getState().surfaces[revealedId]?.title, "revealed.ts");
  assert.deepEqual(revealStore.getState().surfaceOrder, [revealedId]);

  const updateStore = createRightWorkspaceStore();
  const updateController = createController(updateStore, createRegistry(), createPersistence());
  const updatedId = updateController.open({
    kind: "file",
    title: "before.ts",
    params: { absolutePath: "/workspace/before.ts" },
    context,
  });
  updateController.update(updatedId, { title: "after.ts", dirty: true });
  await updateController.initialize();
  assert.equal(updateStore.getState().surfaces[updatedId]?.title, "after.ts");
  assert.equal(updateStore.getState().surfaces[updatedId]?.dirty, true);

  const closeStore = createRightWorkspaceStore();
  const closeController = createController(closeStore, createRegistry(), createPersistence());
  const closedId = closeController.open({
    kind: "file",
    title: "closed.ts",
    params: { absolutePath: "/workspace/closed.ts" },
    context,
  });
  closeController.close(closedId);
  await closeController.initialize();
  assert.deepEqual(closeStore.getState().surfaceOrder, []);
  assert.deepEqual(closeStore.getState().surfaces, {});
  assert.equal(closeStore.getState().hydrated, true);
});

test("session-only surfaces do not restore disconnected tabs after reload", async () => {
  const persistence = new MemoryPersistence();
  const registry = createRegistry();
  registry.register({
    kind: "browser",
    icon: FixtureIcon,
    cachePolicy: "keep-alive",
    persistence: "session",
    getResourceKey: (params) => `browser:${String(params.sessionId)}`,
    render: () => null,
  });
  const store = createRightWorkspaceStore();
  const controller = createController(store, registry, persistence);
  await controller.initialize();
  controller.open({
    kind: "browser",
    title: "Browser",
    params: { sessionId: "memory-only" },
    context,
  });
  await flushPersistence();

  assert.ok(persistence.value);
  assert.deepEqual(JSON.parse(persistence.value).surfaces, []);
  assert.equal(JSON.parse(persistence.value).open, false);

  const restoredStore = createRightWorkspaceStore();
  await createController(restoredStore, registry, persistence).initialize();
  assert.deepEqual(restoredStore.getState().surfaceOrder, []);
  assert.equal(restoredStore.getState().open, false);
});

test("legacy hydration reconciles an existing resource to its registered placement", async () => {
  const persistence = new MemoryPersistence();
  const surfaceId = "explorer:legacy";
  persistence.value = JSON.stringify({
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
  });
  const registry = new WorkspaceSurfaceRegistryImpl();
  const store = createRightWorkspaceStore();
  const controller = createController(store, registry, persistence);
  await controller.initialize();

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

test("auxiliary width and visibility are normalized and persisted", async () => {
  const persistence = new MemoryPersistence();
  const store = createRightWorkspaceStore();
  const controller = createController(store, createRegistry(), persistence);
  await controller.initialize();

  controller.setAuxiliaryWidth(120);
  assert.equal(store.getState().auxiliaryWidth, 220);
  controller.setAuxiliaryWidth(486);
  controller.setAuxiliaryOpen(false);
  await flushPersistence();

  const restoredStore = createRightWorkspaceStore();
  await createController(restoredStore, createRegistry(), persistence).initialize();
  assert.equal(restoredStore.getState().auxiliaryWidth, 486);
  assert.equal(restoredStore.getState().auxiliaryOpen, false);

  persistence.value = JSON.stringify({ open: true, width: 640, surfaceOrder: [], surfaces: [] });
  const legacyStore = createRightWorkspaceStore();
  await createController(legacyStore, createRegistry(), persistence).initialize();
  assert.equal(legacyStore.getState().auxiliaryOpen, true);
});

test("persisted schema rejects malformed surfaces and normalizes ids, order, and active panes", async () => {
  const persistence = new MemoryPersistence();
  const validPrimary = {
    id: "primary",
    kind: "file",
    placement: "primary",
    title: "Primary",
    resourceKey: "primary",
    scope: { type: "application", key: "app" },
    params: {},
    status: "ready",
    createdAt: 1,
    lastActiveAt: 1,
  };
  const validAuxiliary = {
    ...validPrimary,
    id: "auxiliary",
    placement: "auxiliary",
    title: "Auxiliary",
    resourceKey: "auxiliary",
  };
  persistence.value = JSON.stringify({
    open: true,
    width: 640,
    activeSurfaceId: "auxiliary",
    activeAuxiliarySurfaceId: "primary",
    surfaceOrder: ["auxiliary", "auxiliary", "missing", "primary"],
    surfaces: [
      validPrimary,
      validAuxiliary,
      { ...validPrimary, title: "Duplicate" },
      { ...validPrimary, id: "", resourceKey: "empty" },
      { ...validPrimary, id: "missing-status", status: undefined },
      { ...validPrimary, id: "dirty", dirty: "yes" },
      { ...validPrimary, id: "pinned", pinned: 1 },
      { ...validPrimary, id: "created", createdAt: null },
      { ...validPrimary, id: "active", lastActiveAt: "now" },
      { ...validPrimary, id: "status", status: "unknown" },
    ],
  });
  const store = createRightWorkspaceStore();
  await createController(store, createRegistry(), persistence).initialize();

  assert.deepEqual(store.getState().surfaceOrder, ["auxiliary", "primary"]);
  assert.deepEqual(Object.keys(store.getState().surfaces).sort(), ["auxiliary", "primary"]);
  assert.equal(store.getState().surfaces.primary?.title, "Primary");
  assert.equal(store.getState().activeSurfaceId, "primary");
  assert.equal(store.getState().activeAuxiliarySurfaceId, "auxiliary");
});

test("persisted schema rejects non-finite timestamps", async () => {
  const persistence = new MemoryPersistence();
  persistence.value = `{
    "open": true,
    "surfaceOrder": ["infinite"],
    "surfaces": [{
      "id": "infinite",
      "kind": "file",
      "placement": "primary",
      "title": "Infinite",
      "resourceKey": "infinite",
      "scope": { "type": "application", "key": "app" },
      "params": {},
      "status": "ready",
      "createdAt": 1e999,
      "lastActiveAt": 1
    }]
  }`;
  const store = createRightWorkspaceStore();
  await createController(store, createRegistry(), persistence).initialize();

  assert.deepEqual(store.getState().surfaceOrder, []);
  assert.deepEqual(store.getState().surfaces, {});
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

test("initialize is memoized, writes only after hydration, and keeps ordered writes alive after failure", async () => {
  const serializedWrites: string[] = [];
  let reads = 0;
  let writeCalls = 0;
  const persistence: RightWorkspacePersistencePort = {
    async read() {
      reads += 1;
      return null;
    },
    async write(serialized) {
      writeCalls += 1;
      serializedWrites.push(serialized);
      if (writeCalls === 2) throw new Error("transient write failure");
    },
  };
  const store = createRightWorkspaceStore();
  const controller = createController(store, createRegistry(), persistence);

  controller.setWidth(480);
  assert.equal(serializedWrites.length, 0);
  const firstInitialization = controller.initialize();
  const secondInitialization = controller.initialize();
  assert.equal(firstInitialization, secondInitialization);
  await firstInitialization;
  assert.equal(reads, 1);
  assert.deepEqual(
    serializedWrites.map((value) => JSON.parse(value).width),
    [480],
  );

  controller.setWidth(520);
  controller.setWidth(560);
  await flushPersistence();
  assert.deepEqual(
    serializedWrites.map((value) => JSON.parse(value).width),
    [480, 520, 560],
  );
  assert.equal(store.getState().width, 560);
});

test("an unknown remote read keeps persistence closed for the installation", async () => {
  const writes: string[] = [];
  const persistence: RightWorkspacePersistencePort = {
    async read() {
      throw new Error("settings unavailable");
    },
    async write(serialized) {
      writes.push(serialized);
    },
  };
  const store = createRightWorkspaceStore();
  const controller = createController(store, createRegistry(), persistence);

  await controller.initialize();
  assert.equal(store.getState().hydrated, true);
  assert.equal(writes.length, 0);

  controller.setWidth(540);
  await flushPersistence();
  assert.equal(store.getState().width, 540);
  assert.equal(writes.length, 0);
});

test("an unknown non-empty persisted schema is not normalized over", async () => {
  const writes: string[] = [];
  const persistence: RightWorkspacePersistencePort = {
    async read() {
      return JSON.stringify({ schemaVersion: 2, panes: [{ id: "future" }] });
    },
    async write(serialized) {
      writes.push(serialized);
    },
  };
  const store = createRightWorkspaceStore();
  const controller = createController(store, createRegistry(), persistence);

  await controller.initialize();
  assert.equal(store.getState().hydrated, true);
  assert.equal(writes.length, 0);

  controller.setWidth(540);
  await flushPersistence();
  assert.equal(store.getState().width, 540);
  assert.equal(writes.length, 0);
});

test("dispose invalidates late hydration and every stale mutator fails fast", async () => {
  let resolveRead!: (value: string | null) => void;
  const writes: string[] = [];
  const persistence: RightWorkspacePersistencePort = {
    read: () => new Promise((resolve) => (resolveRead = resolve)),
    async write(serialized) {
      writes.push(serialized);
    },
  };
  const store = createRightWorkspaceStore();
  const controller = createController(store, createRegistry(), persistence);
  const initialization = controller.initialize();
  const beforeDispose = store.getState();

  controller.dispose();
  controller.dispose();
  resolveRead(null);
  await initialization;
  assert.equal(store.getState(), beforeDispose);
  assert.equal(writes.length, 0);

  const staleMutations: Array<() => unknown> = [
    () =>
      controller.open({
        kind: "file",
        title: "stale",
        params: { absolutePath: "/workspace/stale" },
        context,
      }),
    () =>
      controller.reveal({
        kind: "file",
        title: "stale",
        params: { absolutePath: "/workspace/stale" },
        context,
      }),
    () => controller.focus("missing"),
    () => controller.reorder("missing", "other", "before"),
    () => controller.close("missing"),
    () => controller.closeToRight("missing", context),
    () => controller.closeOthers("missing", context),
    () => controller.closeAll(),
    () => controller.update("missing", { title: "stale" }),
    () => controller.promoteThreadScope("draft-thread", context),
    () => controller.resetLayout(),
    () => controller.setWorkspaceOpen(true),
    () => controller.setWidth(Number.NaN),
    () => controller.setAuxiliaryOpen(false),
    () => controller.setAuxiliaryWidth(Number.NaN),
    () => controller.setMaximized(true),
    () => controller.restore({ type: "application", key: "app" }),
    () => controller.restoreContext(context),
    () => controller.initialize(),
  ];
  for (const mutate of staleMutations) {
    assert.throws(mutate, RightWorkspaceControllerDisposedError);
  }
  assert.equal(store.getState(), beforeDispose);
  assert.equal(writes.length, 0);
});

test("dispose lets an in-flight write settle but drops queued writes", async () => {
  let releaseInFlight!: () => void;
  const widths: number[] = [];
  let writeCalls = 0;
  const persistence: RightWorkspacePersistencePort = {
    async read() {
      return null;
    },
    async write(serialized) {
      writeCalls += 1;
      widths.push(JSON.parse(serialized).width);
      if (writeCalls === 2) {
        await new Promise<void>((resolve) => (releaseInFlight = resolve));
      }
    },
  };
  const controller = createController(createRightWorkspaceStore(), createRegistry(), persistence);
  await controller.initialize();

  controller.setWidth(500);
  controller.setWidth(600);
  await Promise.resolve();
  assert.deepEqual(widths, [360, 500]);

  controller.dispose();
  releaseInFlight();
  await flushPersistence();
  assert.deepEqual(widths, [360, 500]);
});
