import assert from "node:assert/strict";
import test from "node:test";

import type { SessionContextTraceEventSummary } from "@/workbench/runtime-contributions/pi/protocol/rpc";

import { projectContextTraceTurns } from "./context-trace-tree";

function event(
  seq: number,
  kind: SessionContextTraceEventSummary["kind"],
  coordinates: Partial<SessionContextTraceEventSummary> = {},
): SessionContextTraceEventSummary {
  return {
    schemaVersion: 1,
    traceId: `activation:${seq}`,
    sessionId: "session",
    activationId: "activation",
    seq,
    time: seq * 100,
    kind,
    detailBytes: 1,
    truncated: false,
    redacted: false,
    roundId: "round-1",
    ...coordinates,
  };
}

test("projects one user round with multiple Pi turns into one Turn with monotonic Model Steps", () => {
  const usage = { input: 100, output: 20, cacheRead: 40, cacheWrite: 5, totalTokens: 165 };
  const turns = projectContextTraceTurns([
    event(0, "round-start"),
    event(1, "prompt-composition"),
    event(2, "run-start", { runId: "run-1", runIndex: 0 }),
    event(3, "turn-start", { runId: "run-1", turnId: "pi-turn-1", turnIndex: 0 }),
    event(4, "context-snapshot", { turnId: "pi-turn-1" }),
    event(5, "provider-request", { turnId: "pi-turn-1", requestId: "request-1" }),
    event(6, "model-output", {
      turnId: "pi-turn-1",
      usage,
      model: { provider: "openai", model: "gpt-5.6" },
      thinkingLevel: "high",
    }),
    event(7, "tool-execution-start", {
      turnId: "pi-turn-1",
      toolCallId: "call-1",
      toolName: "bash",
    }),
    event(8, "tool-execution-end", {
      turnId: "pi-turn-1",
      toolCallId: "call-1",
      toolName: "bash",
    }),
    event(9, "turn-end", { turnId: "pi-turn-1", usage }),
    event(10, "turn-start", { runId: "run-1", turnId: "pi-turn-2", turnIndex: 1 }),
    event(11, "context-snapshot", { turnId: "pi-turn-2" }),
    event(12, "provider-request", { turnId: "pi-turn-2", requestId: "request-2" }),
    event(13, "model-output", { turnId: "pi-turn-2", usage }),
    event(14, "turn-end", { turnId: "pi-turn-2", usage }),
    event(15, "run-end", { runId: "run-1" }),
    event(16, "retry", { runId: "run-1", agentAttempt: 1 }),
    event(17, "run-start", { runId: "run-2", runIndex: 1 }),
    event(18, "turn-start", { runId: "run-2", turnId: "pi-turn-3", turnIndex: 0 }),
    event(19, "context-snapshot", { turnId: "pi-turn-3" }),
    event(20, "model-output", { turnId: "pi-turn-3", usage }),
    event(21, "turn-end", { turnId: "pi-turn-3", usage }),
    event(22, "round-settled"),
  ]);

  assert.equal(turns.length, 1);
  assert.deepEqual(
    turns[0]?.steps.map((step) => [step.index, step.turnId]),
    [
      [1, "pi-turn-1"],
      [2, "pi-turn-2"],
      [3, "pi-turn-3"],
    ],
  );
  assert.equal(turns[0]?.steps[0]?.duration, 100);
  assert.equal(turns[0]?.steps[0]?.toolExecutions[0]?.duration, 100);
  assert.equal(turns[0]?.steps[0]?.model?.model, "gpt-5.6");
  assert.equal(turns[0]?.steps[0]?.thinkingLevel, "high");
  assert.equal(turns[0]?.finalOutput?.traceId, "activation:20");
  assert.deepEqual(
    turns[0]?.items.map((item) => item.type),
    ["model-step", "model-step", "system-event", "model-step"],
  );
});

test("falls back to turn-end for journals captured before model-output existed", () => {
  const usage = { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12 };
  const turn = projectContextTraceTurns([
    event(0, "round-start"),
    event(1, "turn-start", { turnId: "old-turn" }),
    event(2, "context-snapshot", { turnId: "old-turn" }),
    event(3, "turn-end", { turnId: "old-turn", usage }),
    event(4, "round-settled"),
  ])[0];

  assert.equal(turn?.steps[0]?.output?.kind, "turn-end");
  assert.deepEqual(turn?.steps[0]?.usage, usage);
});

test("pairs compaction lifecycle boundaries into one detailed trace item", () => {
  const turn = projectContextTraceTurns([
    event(0, "round-start"),
    event(1, "compaction", {
      compaction: { phase: "start", reason: "threshold" },
    }),
    event(2, "compaction", {
      compaction: {
        phase: "end",
        reason: "threshold",
        tokensBefore: 97_000,
        estimatedTokensAfter: 24_000,
        firstKeptEntryId: "entry-42",
        summarizedMessageCount: 18,
        turnPrefixMessageCount: 2,
        aborted: false,
        willRetry: false,
      },
    }),
    event(3, "round-settled"),
  ])[0];

  assert.equal(turn?.items.length, 1);
  const item = turn?.items[0];
  assert.equal(item?.type, "compaction");
  if (item?.type !== "compaction") assert.fail("Missing projected compaction");
  assert.equal(item.start?.traceId, "activation:1");
  assert.equal(item.end?.traceId, "activation:2");
  assert.equal(item.end?.compaction?.estimatedTokensAfter, 24_000);
});
