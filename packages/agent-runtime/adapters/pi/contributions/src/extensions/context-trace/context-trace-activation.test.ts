import assert from "node:assert/strict";
import test from "node:test";

import type { SessionContextTraceActivationSummary } from "@workbench/agent-runtime-pi-protocol/rpc";

import { selectContextTraceActivation } from "./context-trace-activation";

function activation(
  activationId: string,
  startedAt: number,
  eventCount: number,
): SessionContextTraceActivationSummary {
  return {
    schemaVersion: 1,
    sessionId: "session-1",
    activationId,
    startedAt,
    updatedAt: startedAt,
    eventCount,
    persistedBytes: 0,
    active: false,
    complete: true,
  };
}

test("keeps a populated current activation implicit for live updates", () => {
  const selected = selectContextTraceActivation(
    [activation("current", 20, 3), activation("previous", 10, 8)],
    "current",
  );

  assert.equal(selected, undefined);
});

test("falls back to the newest populated activation when current is empty", () => {
  const selected = selectContextTraceActivation(
    [activation("current", 30, 0), activation("older", 10, 4), activation("latest", 20, 8)],
    "current",
  );

  assert.equal(selected, "latest");
});

test("leaves the timeline empty when no activation contains events", () => {
  const selected = selectContextTraceActivation([activation("current", 10, 0)], "current");

  assert.equal(selected, undefined);
});
