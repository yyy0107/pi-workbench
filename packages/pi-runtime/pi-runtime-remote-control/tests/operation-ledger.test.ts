import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import type {
  RemoteOperationRequestV1,
  RemoteOperationResultV1,
} from "@workbench/remote-control-contracts/protocol";

import { openSqliteRemoteOperationLedger } from "../src/sqlite-ledger.ts";

const now = new Date("2030-09-13T20:00:00.000Z");

function request(operationId: string, text = "Hello"): RemoteOperationRequestV1 {
  return {
    type: "operation.request",
    operationId,
    issuedAt: "2030-09-13T19:59:00.000Z",
    expiresAt: "2030-09-13T20:01:00.000Z",
    command: { type: "session.send", sessionId: "session-1", text },
  };
}

function succeeded(operationId: string): RemoteOperationResultV1 {
  return {
    type: "operation.result",
    operationId,
    state: "succeeded",
    value: {
      type: "message-accepted",
      sessionId: "session-1",
      messageId: `message-${operationId}`,
    },
  };
}

async function temporaryLedger(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-remote-ledger-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "operations.sqlite");
  const open = () =>
    openSqliteRemoteOperationLedger({
      filename,
      machineId: "machine-1",
      clock: { now: () => now },
    });
  return { filename, open };
}

test("survives crash cuts before/after intent, after the domain effect, and after result", async (t) => {
  const fixture = await temporaryLedger(t);

  let ledger = await fixture.open();
  assert.equal(await ledger.get({ deviceId: "device-1", operationId: "before-intent" }), undefined);
  ledger.close();

  ledger = await fixture.open();
  const accepted = await ledger.begin({
    deviceId: "device-1",
    request: request("after-intent"),
    domainIdentity: { type: "message", sessionId: "session-1", messageId: "message-stable" },
  });
  assert.equal(accepted.kind, "created");
  ledger.close();

  ledger = await fixture.open();
  assert.equal(
    (await ledger.get({ deviceId: "device-1", operationId: "after-intent" }))?.state,
    "accepted",
  );
  const domainMessages = new Set(["message-stable"]);
  const reconciled = await ledger.reconcileIncomplete(async (record) => {
    if (
      record.domainIdentity?.type === "message" &&
      domainMessages.has(record.domainIdentity.messageId)
    ) {
      return succeeded(record.operationId);
    }
    return undefined;
  });
  assert.equal(reconciled, 1);
  ledger.close();

  ledger = await fixture.open();
  const replay = await ledger.begin({
    deviceId: "device-1",
    request: request("after-intent"),
    domainIdentity: { type: "message", sessionId: "session-1", messageId: "message-stable" },
  });
  assert.equal(replay.kind, "replay");
  assert.deepEqual(replay.record.result, succeeded("after-intent"));

  await ledger.begin({ deviceId: "device-1", request: request("after-result") });
  await ledger.finish({
    deviceId: "device-1",
    operationId: "after-result",
    result: succeeded("after-result"),
  });
  ledger.close();
  ledger = await fixture.open();
  assert.deepEqual(
    (await ledger.get({ deviceId: "device-1", operationId: "after-result" }))?.result,
    succeeded("after-result"),
  );
  ledger.close();

  assert.equal((await stat(fixture.filename)).mode & 0o777, 0o600);
  assert.equal((await readFile(fixture.filename)).includes(Buffer.from("Hello")), false);
});

test("replays the same canonical command and conflicts on the same ID with a new digest", async (t) => {
  const fixture = await temporaryLedger(t);
  const ledger = await fixture.open();
  const first = await ledger.begin({ deviceId: "device-1", request: request("operation-1") });
  assert.equal(first.kind, "created");
  const replay = await ledger.begin({ deviceId: "device-1", request: request("operation-1") });
  assert.equal(replay.kind, "replay");
  const conflict = await ledger.begin({
    deviceId: "device-1",
    request: request("operation-1", "Different text"),
  });
  assert.equal(conflict.kind, "conflict");
  assert.equal(conflict.code, "operation_id_conflict");
  assert.equal(
    (await ledger.get({ deviceId: "device-1", operationId: "operation-1" }))?.commandDigest,
    first.record.commandDigest,
  );
  ledger.close();
});

test("retains incomplete entries while pruning completed entries by seven days and 10,000", async (t) => {
  const fixture = await temporaryLedger(t);
  let clockValue = new Date("2030-09-01T00:00:00.000Z");
  const ledger = await openSqliteRemoteOperationLedger({
    filename: fixture.filename,
    machineId: "machine-1",
    clock: { now: () => clockValue },
  });
  await ledger.begin({ deviceId: "device-1", request: request("incomplete") });
  for (let index = 0; index < 10_002; index += 1) {
    const operationId = `completed-${index}`;
    await ledger.begin({ deviceId: "device-1", request: request(operationId) });
    await ledger.finish({
      deviceId: "device-1",
      operationId,
      result: succeeded(operationId),
    });
  }
  clockValue = new Date("2030-09-13T20:00:00.000Z");
  const pruned = await ledger.prune();
  assert.ok(pruned >= 2);
  assert.equal(
    (await ledger.get({ deviceId: "device-1", operationId: "incomplete" }))?.state,
    "accepted",
  );
  assert.ok((await ledger.listCompleted()).length <= 10_000);
  assert.equal(await ledger.get({ deviceId: "device-1", operationId: "completed-0" }), undefined);
  ledger.close();
});
