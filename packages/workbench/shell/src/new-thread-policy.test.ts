import assert from "node:assert/strict";
import test from "node:test";

import {
  preferredNewThreadWorkspaceId,
  resolvePromotedThreadRouteId,
  resolveSidebarThreadWorkspaceId,
  shouldCloseRightWorkspaceForNewThread,
  shouldProjectNewThreadRoute,
} from "./new-thread-policy";

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
      managedWorkspaceId: "workspace-draft",
      isMainThread: true,
      draftWorkspaceId: "workspace-ui",
    }),
    "workspace-draft",
  );
  assert.equal(
    resolveSidebarThreadWorkspaceId({
      managedWorkspaceId: "workspace-draft",
      isMainThread: false,
      draftWorkspaceId: undefined,
    }),
    "workspace-draft",
  );
  assert.equal(
    resolveSidebarThreadWorkspaceId({
      managedWorkspaceId: undefined,
      isMainThread: true,
      draftWorkspaceId: "workspace-ui",
    }),
    "workspace-ui",
  );
  assert.equal(
    resolveSidebarThreadWorkspaceId({
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
      isNewThread: false,
      threadId: undefined,
      hasMessages: true,
    }),
    undefined,
    "a local runtime id must not create an intermediate address-bar entry",
  );
  assert.equal(
    resolvePromotedThreadRouteId({
      isNewThread: false,
      threadId: "remote-thread",
      hasMessages: true,
    }),
    "remote-thread",
  );
  assert.equal(
    resolvePromotedThreadRouteId({
      isNewThread: true,
      threadId: undefined,
      hasMessages: false,
    }),
    undefined,
  );
  assert.equal(
    resolvePromotedThreadRouteId({
      isNewThread: false,
      threadId: "remote-thread",
      hasMessages: false,
    }),
    undefined,
    "remote initialization alone must not navigate before onNew starts",
  );
});
