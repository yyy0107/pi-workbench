import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkspaceStore, workspaceHostEvent } from "../../src/resource-composition/workspace-store";
import type { HostStreamPayload } from "@workbench/pi-rpc-contracts/stream";

test("catalog adapter publishes once after local observers and suppresses disposed notifications", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-catalog-events-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "project");
  await mkdir(directory);
  const order: string[] = [];
  const events: HostStreamPayload[] = [];
  const store = new WorkspaceStore({
    stateFile: path.join(root, "state.json"),
    publishHost(event) {
      order.push("host");
      events.push(event);
      throw new Error("transport unavailable after commit");
    },
  });
  store.subscribe(() => {
    order.push("local");
  });
  store.subscribe(() => {
    throw new Error("observer failed");
  });
  const { workspace } = await store.create({ path: directory });
  assert.deepEqual(order, ["local", "host", "local", "host"]);
  assert.deepEqual(events, [
    { type: "host/workspace-changed", workspace },
    { type: "host/workspace-order-changed", workspaceIds: [workspace.workspaceId] },
  ]);
  assert.equal((await store.list()).items[0]?.workspaceId, workspace.workspaceId);
  await store.attachSession(workspace.workspaceId, "session-1");
  const beforeArchive = events.length;
  await store.archiveSession({ sessionId: "session-1" });
  assert.equal(events.length, beforeArchive + 1);
  assert.deepEqual(events.at(-1), {
    type: "host/session-archive-changed",
    sessionId: "session-1",
    archived: true,
    workspace: (await store.list()).items[0],
  });
  const beforeDispose = events.length;
  store.dispose();
  store.dispose();
  store.subscribe(() => {
    throw new Error("disposed observer should never attach");
  });
  await store.rename({ workspaceId: workspace.workspaceId, title: "Saved after detach" });
  assert.equal(events.length, beforeDispose);
  assert.equal((await store.list()).items[0]?.title, "Saved after detach");
});

test("catalog event adapter preserves the remaining wire shapes", () => {
  assert.deepEqual(workspaceHostEvent({ type: "workspace-removed", workspaceId: "w" }), {
    type: "host/workspace-removed",
    workspaceId: "w",
  });
  assert.deepEqual(workspaceHostEvent({ type: "workspace-order-changed", workspaceIds: ["w"] }), {
    type: "host/workspace-order-changed",
    workspaceIds: ["w"],
  });
  assert.deepEqual(
    workspaceHostEvent({ type: "workspace-pinned-changed", workspaceId: "w", pinned: true }),
    { type: "host/workspace-pinned-changed", workspaceId: "w", pinned: true },
  );
  assert.deepEqual(
    workspaceHostEvent({ type: "session-pinned-changed", sessionId: "s", pinned: false }),
    { type: "host/session-pinned-changed", sessionId: "s", pinned: false },
  );
});
