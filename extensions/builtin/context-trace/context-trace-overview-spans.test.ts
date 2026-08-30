import assert from "node:assert/strict";
import test from "node:test";

import type { SessionContextTraceEventSummary } from "@/workbench/runtime-contributions/pi/protocol/rpc";

import { projectContextTraceOverviewSpans } from "./context-trace-overview-spans";

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

test("fills each round continuously from input through model and tool phases", () => {
  const spans = projectContextTraceOverviewSpans(
    [
      event(0, "round-start"),
      event(1, "prompt-composition"),
      event(2, "run-start"),
      event(3, "turn-start", { turnId: "turn-1" }),
      event(4, "context-snapshot", { turnId: "turn-1" }),
      event(5, "provider-request", { turnId: "turn-1", requestId: "request-1" }),
      event(6, "model-output", { turnId: "turn-1" }),
      event(7, "tool-execution-start", {
        turnId: "turn-1",
        toolCallId: "tool-1",
        toolName: "read",
      }),
      event(8, "tool-execution-end", {
        turnId: "turn-1",
        toolCallId: "tool-1",
        toolName: "read",
      }),
      event(9, "turn-end", { turnId: "turn-1" }),
      event(10, "turn-start", { turnId: "turn-2" }),
      event(11, "context-snapshot", { turnId: "turn-2" }),
      event(12, "provider-request", { turnId: "turn-2", requestId: "request-2" }),
      event(13, "model-output", { turnId: "turn-2" }),
      event(14, "round-settled"),
    ],
    1_400,
  );

  assert.deepEqual(
    spans.map(({ event: spanEvent, start, end, lane, duration }) => [
      spanEvent.kind,
      start,
      end,
      lane,
      duration,
    ]),
    [
      ["prompt-composition", 0, 400, 0, undefined],
      ["context-snapshot", 400, 500, 0, undefined],
      ["provider-request", 500, 700, 1, 100],
      ["tool-execution-start", 700, 1_100, 2, 100],
      ["context-snapshot", 1_100, 1_200, 0, undefined],
      ["provider-request", 1_200, 1_400, 1, 100],
    ],
  );
  spans.slice(1).forEach((span, index) => assert.equal(spans[index]?.end, span.start));
});

test("ends completed phases at round boundaries instead of filling idle time", () => {
  const spans = projectContextTraceOverviewSpans(
    [
      event(0, "round-start"),
      event(1, "prompt-composition"),
      event(2, "provider-request", { turnId: "turn-1", requestId: "request-1" }),
      event(3, "round-settled"),
      event(10, "round-start", { roundId: "round-2" }),
      event(11, "prompt-composition", { roundId: "round-2" }),
      event(12, "provider-request", {
        roundId: "round-2",
        turnId: "turn-2",
        requestId: "request-2",
      }),
      event(13, "round-settled", { roundId: "round-2" }),
    ],
    1_300,
  );

  assert.deepEqual(
    spans.map(({ event: spanEvent, start, end }) => [
      spanEvent.roundId,
      spanEvent.kind,
      start,
      end,
    ]),
    [
      ["round-1", "prompt-composition", 0, 200],
      ["round-1", "provider-request", 200, 300],
      ["round-2", "prompt-composition", 1_000, 1_200],
      ["round-2", "provider-request", 1_200, 1_300],
    ],
  );
});
