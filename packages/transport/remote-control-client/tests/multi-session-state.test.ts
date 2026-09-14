import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import type { RemoteSessionSummaryV1 } from "@workbench/remote-control-contracts/protocol";

import { createRemoteSessionManagementState } from "../src/session-management.ts";

function summary(
  index: number,
  overrides: Partial<RemoteSessionSummaryV1> = {},
): RemoteSessionSummaryV1 {
  return {
    sessionId: `session-${index.toString().padStart(3, "0")}`,
    title: `Session ${index}`,
    updatedAt: new Date(Date.UTC(2026, 8, 13, 20, 0, index % 60)).toISOString(),
    pinned: false,
    archived: false,
    attention: index % 3 === 0 ? "unread" : "none",
    runState: index % 2 === 0 ? "running" : "idle",
    entityRevision: `revision-${index}`,
    ...overrides,
  };
}

const time = {
  issuedAt: "2026-09-13T20:00:00.000Z",
  expiresAt: "2026-09-13T20:02:00.000Z",
};

test("sorts and switches 200 summaries while isolating draft/read/unread/run state", () => {
  const state = createRemoteSessionManagementState({ machineId: "machine-1" });
  const catalog = Array.from({ length: 200 }, (_, index) => summary(index));
  catalog[150] = summary(150, {
    pinned: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const startedAt = performance.now();
  state.replaceCatalog(catalog);
  state.open("session-001");
  state.setDraft("session-001", "first draft");
  state.setReadMarker("session-001", "cursor-11");
  state.open("session-002");
  state.setDraft("session-002", "second draft");
  const elapsed = performance.now() - startedAt;

  const snapshot = state.snapshot();
  assert.equal(snapshot.items.length, 200);
  assert.equal(snapshot.items[0]?.sessionId, "session-150");
  assert.equal(snapshot.activeSessionId, "session-002");
  assert.deepEqual(snapshot.localBySession["session-001"], {
    draft: "first draft",
    readMarker: "cursor-11",
    unread: false,
    runState: "idle",
  });
  assert.deepEqual(snapshot.localBySession["session-002"], {
    draft: "second draft",
    unread: false,
    runState: "running",
  });
  assert.ok(elapsed < 1_000, `200-session reducer took ${elapsed} ms`);
});

test("preserves local drafts across authoritative snapshots and reconciles mutations", () => {
  const state = createRemoteSessionManagementState({ machineId: "machine-1" });
  state.replaceCatalog([summary(1), summary(2)]);
  state.setDraft("session-001", "never overwrite this draft");

  const rename = state.prepareRename({
    ...time,
    operationId: "operation-rename",
    sessionId: "session-001",
    title: "Phone title",
  });
  assert.equal(rename.request.command.type, "session.rename");
  assert.equal(
    rename.request.command.type === "session.rename"
      ? rename.request.command.expectedEntityRevision
      : undefined,
    "revision-1",
  );
  state.applyOperationResult({
    type: "operation.result",
    operationId: "operation-rename",
    state: "accepted",
  });
  assert.equal(state.snapshot().operations[0]?.status, "accepted");
  state.applyOperationResult({
    type: "operation.result",
    operationId: "operation-rename",
    state: "rejected",
    code: "entity_revision_conflict",
  });
  assert.deepEqual(state.snapshot().conflict, {
    sessionId: "session-001",
    operationId: "operation-rename",
  });

  state.replaceCatalog([
    summary(1, {
      title: "Desktop authoritative title",
      attention: "input-needed",
      runState: "waiting-for-input",
      entityRevision: "revision-desktop",
    }),
    summary(2),
  ]);
  assert.equal(
    state.snapshot().items.find(({ sessionId }) => sessionId === "session-001")?.title,
    "Desktop authoritative title",
  );
  assert.deepEqual(state.snapshot().localBySession["session-001"], {
    draft: "never overwrite this draft",
    unread: true,
    runState: "waiting-for-input",
  });
  assert.deepEqual(state.snapshot().operations, []);
});

test("builds the closed create, rename, pin, and archive operation set", () => {
  const state = createRemoteSessionManagementState({ machineId: "machine-1" });
  state.replaceCatalog([summary(1)]);

  const operations = [
    state.prepareCreate({
      ...time,
      operationId: "operation-create",
      workspaceId: "workspace-1",
      title: "Created",
    }),
    state.prepareRename({
      ...time,
      operationId: "operation-rename",
      sessionId: "session-001",
      title: "Renamed",
    }),
    state.prepareSetPinned({
      ...time,
      operationId: "operation-pin",
      sessionId: "session-001",
      pinned: true,
    }),
    state.prepareArchive({
      ...time,
      operationId: "operation-archive",
      sessionId: "session-001",
    }),
  ];
  assert.deepEqual(
    operations.map(({ request }) => request.command.type),
    ["session.create", "session.rename", "session.setPinned", "session.setArchived"],
  );
  assert.equal(
    JSON.stringify(operations).includes("delete") ||
      JSON.stringify(operations).includes("unarchive") ||
      JSON.stringify(operations).includes("path"),
    false,
  );
});
