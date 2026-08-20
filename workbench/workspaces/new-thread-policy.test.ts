import assert from "node:assert/strict";
import test from "node:test";

import {
  conversationThreadIdFromPathname,
  preferredNewThreadWorkspaceId,
  resolvePendingThreadPromotionId,
  resolvePromotedThreadRouteId,
  resolveSidebarThreadWorkspaceId,
  shouldProjectNewThreadRoute,
} from "./new-thread-policy";

test("conversation routes derive their thread id from the browser pathname", () => {
  assert.equal(conversationThreadIdFromPathname("/c/thread-a"), "thread-a");
  assert.equal(conversationThreadIdFromPathname("/c/thread%20a/"), "thread a");
  assert.equal(conversationThreadIdFromPathname("/c/new"), undefined);
  assert.equal(conversationThreadIdFromPathname("/"), undefined);
  assert.equal(conversationThreadIdFromPathname("/c/%E0%A4%A"), undefined);
});

test("new conversations prefer the active workspace and fall back to the first workspace", () => {
  assert.equal(
    preferredNewThreadWorkspaceId("workspace-b", ["workspace-a", "workspace-b"]),
    "workspace-b",
  );
  assert.equal(
    preferredNewThreadWorkspaceId("stale", ["workspace-a", "workspace-b"]),
    "workspace-a",
  );
  assert.equal(preferredNewThreadWorkspaceId(undefined, []), undefined);
});

test("sidebar threads keep their workspace while a draft is becoming persistent", () => {
  assert.equal(
    resolveSidebarThreadWorkspaceId({
      customWorkspaceId: "workspace-server",
      managedWorkspaceId: "workspace-draft",
      isMainThread: true,
      draftWorkspaceId: "workspace-ui",
    }),
    "workspace-server",
  );
  assert.equal(
    resolveSidebarThreadWorkspaceId({
      customWorkspaceId: undefined,
      managedWorkspaceId: "workspace-draft",
      isMainThread: false,
      draftWorkspaceId: undefined,
    }),
    "workspace-draft",
  );
  assert.equal(
    resolveSidebarThreadWorkspaceId({
      customWorkspaceId: undefined,
      managedWorkspaceId: undefined,
      isMainThread: true,
      draftWorkspaceId: "workspace-ui",
    }),
    "workspace-ui",
  );
  assert.equal(
    resolveSidebarThreadWorkspaceId({
      customWorkspaceId: undefined,
      managedWorkspaceId: undefined,
      isMainThread: false,
      draftWorkspaceId: "workspace-ui",
    }),
    undefined,
  );
});

test("an explicit new-thread selection outranks the previously synchronized route", () => {
  assert.equal(
    shouldProjectNewThreadRoute({
      routeThreadId: "thread-a",
      syncedRouteThreadId: "thread-a",
      isNewThread: true,
    }),
    true,
  );
  assert.equal(
    shouldProjectNewThreadRoute({
      routeThreadId: "thread-a",
      syncedRouteThreadId: null,
      isNewThread: true,
    }),
    false,
    "the initial /c/:id load must still select its routed thread",
  );
  assert.equal(
    shouldProjectNewThreadRoute({
      routeThreadId: undefined,
      syncedRouteThreadId: "thread-a",
      isNewThread: true,
    }),
    false,
    "the root route already represents the new-thread view",
  );
});

test("a promoted draft routes once its first message and durable id are both available", () => {
  assert.equal(
    resolvePromotedThreadRouteId({
      mainThreadId: "local-thread",
      newThreadId: undefined,
      status: "regular",
      remoteId: undefined,
      externalId: undefined,
      hasMessages: true,
    }),
    undefined,
    "a local runtime id must not create an intermediate address-bar entry",
  );
  assert.equal(
    resolvePromotedThreadRouteId({
      mainThreadId: "local-thread",
      newThreadId: undefined,
      status: "regular",
      remoteId: "remote-thread",
      externalId: "remote-thread",
      hasMessages: true,
    }),
    "remote-thread",
  );
  assert.equal(
    resolvePromotedThreadRouteId({
      mainThreadId: "local-thread",
      newThreadId: "local-thread",
      status: "new",
      remoteId: undefined,
      externalId: undefined,
      hasMessages: false,
    }),
    undefined,
  );
  assert.equal(
    resolvePromotedThreadRouteId({
      mainThreadId: "local-thread",
      newThreadId: undefined,
      status: "regular",
      remoteId: "remote-thread",
      externalId: "remote-thread",
      hasMessages: false,
    }),
    undefined,
    "remote initialization alone must not navigate before onNew starts",
  );
});

test("thread-list reload stays deferred from remote initialization until onNew starts", () => {
  const localThreadId = resolvePendingThreadPromotionId({
    pendingThreadId: undefined,
    mainThreadId: "local-thread",
    status: "regular",
    remoteId: undefined,
    hasMessages: false,
  });
  assert.equal(localThreadId, "local-thread");

  assert.equal(
    resolvePendingThreadPromotionId({
      pendingThreadId: localThreadId,
      mainThreadId: "local-thread",
      status: "regular",
      remoteId: "remote-thread",
      hasMessages: false,
    }),
    "local-thread",
    "receiving the remote id is not proof that onNew has started",
  );
  assert.equal(
    resolvePendingThreadPromotionId({
      pendingThreadId: localThreadId,
      mainThreadId: "local-thread",
      status: "regular",
      remoteId: "remote-thread",
      hasMessages: true,
    }),
    undefined,
    "the first optimistic message makes a reload safe",
  );
  assert.equal(
    resolvePendingThreadPromotionId({
      pendingThreadId: undefined,
      mainThreadId: "persisted-empty-thread",
      status: "regular",
      remoteId: "persisted-empty-thread",
      hasMessages: false,
    }),
    undefined,
    "an existing empty remote thread must not defer reloads forever",
  );
});
