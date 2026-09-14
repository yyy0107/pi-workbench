import assert from "node:assert/strict";
import test from "node:test";

import { projectRemoteSessionCatalog } from "../src/session-catalog.ts";

test("projects only the closed mobile-safe session and workspace catalog", () => {
  const result = projectRemoteSessionCatalog({
    sessions: [
      {
        sessionId: "session-2",
        title: "Second",
        updatedAt: "2026-09-13T20:01:00.000Z",
        pinned: false,
        archived: false,
        attention: "none",
        runState: "running",
        entityRevision: "revision-2",
        workspaceId: "workspace-1",
        cwd: "/home/user/private-project",
        rootPath: "/home/user/private-project",
        localAccessToken: "sidecar-secret",
        attachment: { path: "/tmp/private.png" },
        tool: { args: { command: "cat ~/.ssh/id_rsa" }, result: "private key" },
      },
      {
        sessionId: "session-1",
        title: "Pinned first",
        updatedAt: "2026-09-13T19:00:00.000Z",
        pinned: true,
        archived: false,
        attention: "input-needed",
        runState: "waiting-for-input",
        entityRevision: "revision-1",
        workspaceId: "workspace-1",
      },
      {
        sessionId: "session-archived",
        title: "Archived",
        updatedAt: "2026-09-13T22:00:00.000Z",
        pinned: true,
        archived: true,
        attention: "none",
        runState: "idle",
        entityRevision: "revision-archived",
      },
      {
        sessionId: "session-unknown",
        title: "Unknown",
        updatedAt: "2026-09-13T22:00:00.000Z",
        pinned: false,
        archived: false,
        attention: "none",
        runState: "arbitrary-host-state",
        entityRevision: "revision-unknown",
      },
    ],
    workspaces: [
      {
        workspaceId: "workspace-1",
        displayName: "Private Project",
        rootPath: "/home/user/private-project",
        cwd: "/home/user/private-project",
      },
    ],
  });

  assert.deepEqual(result.items, [
    {
      sessionId: "session-1",
      workspace: { workspaceId: "workspace-1", displayName: "Private Project" },
      title: "Pinned first",
      updatedAt: "2026-09-13T19:00:00.000Z",
      pinned: true,
      archived: false,
      attention: "input-needed",
      runState: "waiting-for-input",
      entityRevision: "revision-1",
    },
    {
      sessionId: "session-2",
      workspace: { workspaceId: "workspace-1", displayName: "Private Project" },
      title: "Second",
      updatedAt: "2026-09-13T20:01:00.000Z",
      pinned: false,
      archived: false,
      attention: "none",
      runState: "running",
      entityRevision: "revision-2",
    },
  ]);
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "/home/user",
    "sidecar-secret",
    "attachment",
    "cat ~/.ssh",
    "private key",
    "arbitrary-host-state",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("enforces 200-item and 192 KiB aggregate bounds with UTF-8 titles", () => {
  const sessions = Array.from({ length: 230 }, (_, index) => ({
    sessionId: `session-${index.toString().padStart(3, "0")}`,
    title: index === 0 ? "🙂".repeat(129) : `Session ${index}`,
    updatedAt: new Date(Date.UTC(2026, 8, 13, 20, 0, index % 60)).toISOString(),
    pinned: false,
    archived: false,
    attention: "none",
    runState: "idle",
    entityRevision: `revision-${index}`,
  }));

  const result = projectRemoteSessionCatalog({ sessions, workspaces: [] });
  assert.equal(result.items.length, 200);
  assert.equal(
    result.items.some((session) => session.sessionId === "session-000"),
    false,
  );
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).byteLength <= 192 * 1024);
});
