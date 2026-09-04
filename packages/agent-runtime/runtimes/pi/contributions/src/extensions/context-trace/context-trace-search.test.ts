import assert from "node:assert/strict";
import test from "node:test";

import type {
  SessionContextTraceCaptureMetadata,
  SessionContextTraceEvent,
} from "@workbench/agent-runtime-pi-protocol/rpc";

import {
  contextTraceEventSearchMatches,
  normalizeContextTraceSearchText,
} from "./context-trace-search";

const capture: SessionContextTraceCaptureMetadata = {
  originalBytes: 1,
  capturedBytes: 1,
  truncated: false,
  redactedPaths: [],
};

const eventBase = {
  schemaVersion: 1,
  sessionId: "session",
  activationId: "activation",
  time: 1,
  detailBytes: 1,
  truncated: false,
  redacted: false,
} as const;

test("finds concrete user and assistant message content and returns matching snippets", () => {
  const contextEvent = {
    ...eventBase,
    traceId: "context",
    seq: 1,
    kind: "context-snapshot",
    detail: {
      type: "context-snapshot",
      messageCount: 2,
      messages: {
        value: [
          { role: "user", content: "Please inspect the deployment failure" },
          { role: "assistant", content: [{ type: "text", text: "The deployment failed" }] },
        ],
        capture,
      },
    },
  } satisfies SessionContextTraceEvent;
  const outputEvent = {
    ...eventBase,
    traceId: "output",
    seq: 2,
    kind: "model-output",
    detail: {
      type: "model-output",
      message: {
        value: {
          role: "assistant",
          content: [{ type: "text", text: "Retrying the deployment now" }],
        },
        capture,
      },
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
    },
  } satisfies SessionContextTraceEvent;
  const query = normalizeContextTraceSearchText("deployment");

  assert.deepEqual(
    contextTraceEventSearchMatches(contextEvent, query).map((match) => match.focusKey),
    ["context-message:0", "context-message:1"],
  );
  assert.deepEqual(
    contextTraceEventSearchMatches(outputEvent, query).map((match) => match.focusKey),
    ["output-block:0:content"],
  );
});
