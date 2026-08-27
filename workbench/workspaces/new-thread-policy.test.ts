import assert from "node:assert/strict";
import test from "node:test";

import {
  conversationThreadIdFromPathname,
  preferredNewThreadWorkspaceId,
  resolvePromotedThreadRouteId,
  resolveSidebarThreadWorkspaceId,
  shouldCloseRightWorkspaceForNewThread,
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

test("a new conversation closes the hydrated right workspace only once", () => {
  assert.equal(
    shouldCloseRightWorkspaceForNewThread({
      hydrated: false,
      mainThreadId: "draft-thread",
      newThreadId: "draft-thread",
      alreadyHandled: false,
    }),
    false,
    "persisted workspace state must hydrate before applying the new-thread default",
  );
  assert.equal(
    shouldCloseRightWorkspaceForNewThread({
      hydrated: true,
      mainThreadId: undefined,
      newThreadId: undefined,
      alreadyHandled: false,
    }),
    false,
    "missing thread ids are not a new conversation",
  );
  assert.equal(
    shouldCloseRightWorkspaceForNewThread({
      hydrated: true,
      mainThreadId: "existing-thread",
      newThreadId: "draft-thread",
      alreadyHandled: false,
    }),
    false,
    "existing conversations keep their workspace visibility",
  );
  assert.equal(
    shouldCloseRightWorkspaceForNewThread({
      hydrated: true,
      mainThreadId: "draft-thread",
      newThreadId: "draft-thread",
      alreadyHandled: false,
    }),
    true,
  );
  assert.equal(
    shouldCloseRightWorkspaceForNewThread({
      hydrated: true,
      mainThreadId: "draft-thread",
      newThreadId: "draft-thread",
      alreadyHandled: true,
    }),
    false,
    "manually reopening the workspace in the draft must not close it again",
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
