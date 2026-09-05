import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePiMessageTermination,
  terminationFromAssistantMessage,
  terminationFromDiagnostics,
} from "../src/messages/termination";

test("parses the versioned termination diagnostic from the latest matching entry", () => {
  const termination = terminationFromDiagnostics([
    {
      type: "workbench.message-termination.v1",
      timestamp: 1,
      details: { schemaVersion: 1, kind: "completed", stopReason: "stop" },
    },
    {
      type: "provider_transport_failure",
      timestamp: 2,
      error: { message: "socket closed" },
    },
    {
      type: "workbench.message-termination.v1",
      timestamp: 3,
      details: {
        schemaVersion: 1,
        kind: "network-error",
        stopReason: "error",
        rawStopReason: "failed",
        errorMessage: "socket closed",
      },
    },
  ]);

  assert.deepEqual(termination, {
    schemaVersion: 1,
    kind: "network-error",
    stopReason: "error",
    rawStopReason: "failed",
    errorMessage: "socket closed",
  });
});

test("rejects unknown termination schema versions and kinds", () => {
  assert.equal(
    parsePiMessageTermination({ schemaVersion: 2, kind: "completed", stopReason: "stop" }),
    undefined,
  );
  assert.equal(
    parsePiMessageTermination({ schemaVersion: 1, kind: "timeout", stopReason: "error" }),
    undefined,
  );
});

test("preserves native interruption reasons when Workbench diagnostics are missing", () => {
  for (const stopReason of ["aborted", "length"]) {
    assert.deepEqual(
      terminationFromAssistantMessage({ stopReason, errorMessage: "Request aborted" }),
      { schemaVersion: 1, kind: stopReason, stopReason, errorMessage: "Request aborted" },
    );
  }
  assert.equal(
    terminationFromAssistantMessage({ stopReason: "error", errorMessage: "Request aborted" }),
    undefined,
  );
  assert.equal(terminationFromAssistantMessage({ stopReason: "stop" }), undefined);
  assert.equal(
    terminationFromAssistantMessage({
      stopReason: "aborted",
      diagnostics: [
        {
          type: "workbench.message-termination.v1",
          timestamp: 1,
          details: { schemaVersion: 1, kind: "cancelled", stopReason: "aborted" },
        },
      ],
    })?.kind,
    "cancelled",
  );
});
