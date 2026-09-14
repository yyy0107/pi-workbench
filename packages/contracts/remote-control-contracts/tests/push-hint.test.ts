import assert from "node:assert/strict";
import test from "node:test";

import { remoteUtf8ByteLength } from "../src/codecs.ts";
import { parseRemotePushHintV1 } from "../src/legacy-codecs.ts";

test("accepts only a generic opaque notification hint", () => {
  for (const hint of [
    {
      version: 1,
      hintId: "hint-complete-1",
      machineId: "machine-1",
      sessionId: "session-1",
      kind: "state-changed",
    },
    {
      version: 1,
      hintId: "hint-input-1",
      machineId: "machine-1",
      sessionId: "session-2",
      kind: "attention",
    },
  ] as const) {
    assert.deepEqual(parseRemotePushHintV1(hint), hint);
    assert.ok(remoteUtf8ByteLength(JSON.stringify(hint)) <= 4 * 1024);
  }
});

test("rejects notification content, errors, paths, tools, credentials, and large payloads", () => {
  const base = {
    version: 1,
    hintId: "hint-1",
    machineId: "machine-1",
    sessionId: "session-1",
    kind: "attention",
  } as const;
  for (const extension of [
    { title: "Private session title" },
    { body: "Generated answer" },
    { code: "console.log('secret')" },
    { path: "/Users/alice/private" },
    { tool: { name: "read", result: "secret" } },
    { error: { message: "provider failure" } },
    { answer: "ordinary response" },
    { token: "ExponentPushToken[secret]" },
    { key: "private-key" },
    { ciphertext: "A".repeat(4 * 1024) },
  ]) {
    assert.equal(parseRemotePushHintV1({ ...base, ...extension }), undefined);
  }
  assert.equal(parseRemotePushHintV1({ ...base, hintId: "x".repeat(4 * 1024) }), undefined);
});
