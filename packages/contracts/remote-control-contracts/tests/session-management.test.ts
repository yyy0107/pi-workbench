import assert from "node:assert/strict";
import test from "node:test";

import { parseRemoteOperationRequestV1 } from "../src/codecs.ts";

const base = {
  type: "operation.request",
  issuedAt: "2026-09-13T20:00:00.000Z",
  expiresAt: "2026-09-13T20:02:00.000Z",
} as const;

test("accepts only the closed create and set-to-value session-management surface", () => {
  const commands = [
    { type: "session.create", workspaceId: "workspace-known", title: "Mobile work" },
    {
      type: "session.rename",
      sessionId: "session-1",
      title: "Renamed",
      expectedEntityRevision: "revision-1",
    },
    {
      type: "session.setPinned",
      sessionId: "session-1",
      pinned: false,
      expectedEntityRevision: "revision-2",
    },
    {
      type: "session.setArchived",
      sessionId: "session-1",
      archived: true,
      expectedEntityRevision: "revision-3",
    },
  ] as const;

  for (const [index, command] of commands.entries()) {
    assert.deepEqual(
      parseRemoteOperationRequestV1({
        ...base,
        operationId: `operation-${index}`,
        command,
      }),
      { ...base, operationId: `operation-${index}`, command },
    );
  }
});

test("enforces UTF-8 title bytes and entity revision identifiers", () => {
  assert.ok(
    parseRemoteOperationRequestV1({
      ...base,
      operationId: "operation-title-boundary",
      command: { type: "session.rename", sessionId: "session-1", title: "界".repeat(170) },
    }),
  );
  assert.equal(
    parseRemoteOperationRequestV1({
      ...base,
      operationId: "operation-title-too-large",
      command: { type: "session.rename", sessionId: "session-1", title: "界".repeat(171) },
    }),
    undefined,
  );
  assert.equal(
    parseRemoteOperationRequestV1({
      ...base,
      operationId: "operation-bad-revision",
      command: {
        type: "session.setPinned",
        sessionId: "session-1",
        pinned: true,
        expectedEntityRevision: "revision with spaces",
      },
    }),
    undefined,
  );
});

test("rejects restore, delete, toggle, cwd, path, and URI-shaped extensions", () => {
  for (const command of [
    { type: "session.setArchived", sessionId: "session-1", archived: false },
    { type: "session.unarchive", sessionId: "session-1" },
    { type: "session.delete", sessionId: "session-1" },
    { type: "session.togglePinned", sessionId: "session-1" },
    { type: "session.create", cwd: "/Users/alice/secret" },
    { type: "session.create", path: "C:\\private" },
    { type: "session.create", uri: "file:///private/work" },
  ]) {
    assert.equal(
      parseRemoteOperationRequestV1({
        ...base,
        operationId: "operation-forbidden",
        command,
      }),
      undefined,
    );
  }
});
