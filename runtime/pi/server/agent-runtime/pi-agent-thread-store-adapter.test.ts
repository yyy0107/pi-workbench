import assert from "node:assert/strict";
import test from "node:test";

import type { PiSessionSummary } from "@/runtime/pi/contracts/pi";
import { AgentThreadStoreError } from "@/runtime/server/agent-thread-store-port";

import {
  createPiAgentThreadStoreAdapter,
  type PiAgentThreadStoreDependencies,
} from "./pi-agent-thread-store-adapter";

function summary(overrides: Partial<PiSessionSummary> = {}): PiSessionSummary {
  return {
    id: "session-1",
    cwd: "/workspace",
    workspace: { id: "workspace-1", name: "Workspace", cwd: "/workspace" },
    name: "Thread title",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-02T00:00:00.000Z",
    messageCount: 2,
    firstMessage: "Inspect the repository",
    transient: false,
    running: true,
    waitingForUserInput: true,
    runTiming: { startedAt: 1_000, elapsedMs: 250 },
    automationOrigin: {
      version: 1,
      origin: "automation",
      automationId: "automation-1",
      automationName: "Morning briefing",
      source: "schedule",
      triggeredAt: 1_777_000_000_000,
    },
    ...overrides,
  };
}

function harness(overrides: Partial<PiAgentThreadStoreDependencies> = {}) {
  const calls: Array<{ name: string; value: unknown }> = [];
  const dependencies: PiAgentThreadStoreDependencies = {
    listSessions: async () => ({ sessions: [summary()], runningSessionIds: ["session-1"] }),
    listSessionSearchText: async () => [
      { sessionId: "session-1", allMessagesText: "complete searchable text" },
    ],
    createSession: async (cwd, sessionId) => {
      calls.push({ name: "create", value: { cwd, sessionId } });
      return { id: sessionId ?? "session-created" };
    },
    renameSession: async (sessionId, title) => {
      calls.push({ name: "rename", value: { sessionId, title } });
      return 12;
    },
    forkSession: async (sessionId, atSeq) => {
      calls.push({ name: "fork", value: { sessionId, atSeq } });
      return { id: "session-forked" };
    },
    deleteSession: async (sessionId) => {
      calls.push({ name: "delete", value: { sessionId } });
    },
    ...overrides,
  };
  return { adapter: createPiAgentThreadStoreAdapter(dependencies), calls };
}

test("projects the Pi session catalog and search index to neutral thread records", async () => {
  const { adapter } = harness();

  assert.deepEqual(await adapter.list(), [
    {
      threadId: "session-1",
      rootPath: "/workspace",
      title: "Thread title",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      messageCount: 2,
      firstMessage: "Inspect the repository",
      transient: false,
      running: true,
      waitingForUserInput: true,
      runTiming: { startedAt: 1_000, elapsedMs: 250 },
      automationOrigin: {
        version: 1,
        origin: "automation",
        automationId: "automation-1",
        automationName: "Morning briefing",
        source: "schedule",
        triggeredAt: 1_777_000_000_000,
      },
    },
  ]);
  assert.deepEqual(await adapter.listSearchDocuments(), [
    { threadId: "session-1", text: "complete searchable text" },
  ]);
  assert.deepEqual(adapter.capabilities, { requestedThreadId: true, preset: false });
});

test("maps lifecycle operations to the existing Pi session registry", async () => {
  const { adapter, calls } = harness();

  assert.deepEqual(await adapter.create({ rootPath: "/workspace", requestedThreadId: "chosen" }), {
    threadId: "chosen",
  });
  assert.deepEqual(await adapter.rename({ threadId: "chosen", title: "Renamed" }), {
    revision: 12,
  });
  assert.deepEqual(await adapter.fork({ threadId: "chosen", atEventRevision: 8 }), {
    threadId: "session-forked",
  });
  await adapter.delete({ threadId: "chosen" });

  assert.deepEqual(calls, [
    { name: "create", value: { cwd: "/workspace", sessionId: "chosen" } },
    { name: "rename", value: { sessionId: "chosen", title: "Renamed" } },
    { name: "fork", value: { sessionId: "chosen", atSeq: 8 } },
    { name: "delete", value: { sessionId: "chosen" } },
  ]);
});

test("normalizes Pi repository failures without exposing Pi error codes", async () => {
  const cases = [
    ["pi_session_not_found", "thread-not-found"],
    ["pi_session_conflict", "thread-id-conflict"],
    ["pi_workspace_not_found", "invalid-root"],
    ["pi_session_busy", "busy"],
    ["pi_fork_unavailable", "fork-unavailable"],
    ["unexpected", "internal"],
  ] as const;

  for (const [piCode, expected] of cases) {
    const { adapter } = harness({
      deleteSession: async () => {
        throw Object.assign(new Error(piCode), {
          code: piCode,
          existingCwd: "/existing",
        });
      },
    });
    await assert.rejects(adapter.delete({ threadId: "session-1" }), (error: unknown) => {
      assert.ok(error instanceof AgentThreadStoreError);
      assert.equal(error.code, expected);
      assert.equal(
        error.details.existingRootPath,
        expected === "thread-id-conflict" ? "/existing" : undefined,
      );
      return true;
    });
  }
});

test("rejects an unsupported Pi preset before creating a session", async () => {
  const { adapter, calls } = harness();

  await assert.rejects(
    adapter.create({ rootPath: "/workspace", preset: "reviewer" }),
    (error: unknown) => {
      assert.ok(error instanceof AgentThreadStoreError);
      assert.equal(error.code, "unsupported");
      return true;
    },
  );
  assert.deepEqual(calls, []);
});
