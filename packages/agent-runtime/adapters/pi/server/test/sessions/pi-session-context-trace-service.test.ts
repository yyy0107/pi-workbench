import assert from "node:assert/strict";
import test from "node:test";

import type {
  SessionContextTraceActivationsValue,
  SessionContextTraceCapabilities,
  SessionContextTraceEvent,
  SessionContextTraceListValue,
  SessionContextTracePromptPartsValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";

import {
  createPiSessionContextTraceService,
  PiSessionContextTraceServiceError,
  type PiSessionContextTraceReader,
  type PiSessionContextTraceServiceDependencies,
} from "../../src/sessions/pi-session-context-trace-service";
import { SessionContextTraceJournalError } from "../../src/sessions/session-context-trace-journal";

const capabilities: SessionContextTraceCapabilities = {
  schemaVersion: 1,
  storage: "bounded-memory",
  durable: false,
  scope: "agent-turn",
  captures: [
    "system-prompt",
    "resource-sources",
    "tools",
    "messages",
    "provider-payload",
    "model-output",
    "tool-execution",
    "token-usage",
    "lifecycle",
  ],
  providerTransportAttempts: "logical-request-only",
  sensitiveValues: "captured",
  maxEvents: 512,
  maxBytes: 16 * 1024 * 1024,
};

const listValue: SessionContextTraceListValue = {
  activationId: "activation-1",
  events: [],
  hasMore: false,
  nextSeq: 0,
  retainedFromSeq: 0,
  capabilities,
  source: "memory",
  integrity: "memory",
};

const activationsValue: SessionContextTraceActivationsValue = {
  activations: [],
  currentActivationId: "activation-1",
  capabilities,
};

const promptPartsValue: SessionContextTracePromptPartsValue = {
  parts: [],
  capabilities,
  source: "disk",
  integrity: "verified",
};

const event: SessionContextTraceEvent = {
  schemaVersion: 1,
  traceId: "activation-1:0",
  sessionId: "session-1",
  activationId: "activation-1",
  seq: 0,
  time: 1,
  kind: "round-start",
  detailBytes: 1,
  truncated: false,
  redacted: false,
  detail: { type: "round-start", trigger: "prompt" },
};

function reader(overrides: Partial<PiSessionContextTraceReader> = {}): PiSessionContextTraceReader {
  return {
    activationId: "activation-1",
    listActivation: async () => listValue,
    activations: async () => activationsValue,
    readAny: async () => event,
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<PiSessionContextTraceServiceDependencies> = {},
): PiSessionContextTraceServiceDependencies {
  const trace = reader();
  return {
    listSessions: async () => ({ sessions: [{ id: "session-1" }] }),
    startSession: async () => {},
    getTrace: () => trace,
    readPromptParts: async () => promptPartsValue,
    ...overrides,
  };
}

test("keeps cold prompt-parts replay independent from live session activation", async () => {
  const calls: string[] = [];
  const service = createPiSessionContextTraceService(
    dependencies({
      listSessions: async () => {
        calls.push("listSessions");
        return { sessions: [] };
      },
      startSession: async () => {
        calls.push("startSession");
      },
      getTrace: () => {
        calls.push("getTrace");
        return undefined;
      },
      readPromptParts: async (sessionId) => {
        calls.push(`readPromptParts:${sessionId}`);
        return promptPartsValue;
      },
    }),
  );

  assert.deepEqual(await service.promptParts({ sessionId: "session-cold" }), promptPartsValue);
  assert.deepEqual(calls, ["readPromptParts:session-cold"]);
});

test("coordinates existing live sessions before delegating trace queries", async () => {
  const calls: unknown[] = [];
  const trace = reader({
    listActivation: async (...args) => {
      calls.push(["listActivation", ...args]);
      return listValue;
    },
    activations: async () => {
      calls.push(["activations"]);
      return activationsValue;
    },
    readAny: async (traceId) => {
      calls.push(["readAny", traceId]);
      return event;
    },
  });
  const service = createPiSessionContextTraceService(
    dependencies({
      listSessions: async () => {
        calls.push(["listSessions"]);
        return { sessions: [{ id: "session-1" }] };
      },
      startSession: async (sessionId) => {
        calls.push(["startSession", sessionId]);
      },
      getTrace: (sessionId) => {
        calls.push(["getTrace", sessionId]);
        return trace;
      },
    }),
  );

  assert.equal(
    await service.list({
      sessionId: "session-1",
      activationId: "activation-history",
      afterSeq: 3,
      limit: 25,
    }),
    listValue,
  );
  assert.equal(await service.activations({ sessionId: "session-1" }), activationsValue);
  assert.deepEqual(await service.read({ sessionId: "session-1", traceId: "activation-1:0" }), {
    event,
  });
  assert.deepEqual(calls, [
    ["listSessions"],
    ["startSession", "session-1"],
    ["getTrace", "session-1"],
    ["listActivation", "activation-history", 3, 25],
    ["listSessions"],
    ["startSession", "session-1"],
    ["getTrace", "session-1"],
    ["activations"],
    ["listSessions"],
    ["startSession", "session-1"],
    ["getTrace", "session-1"],
    ["readAny", "activation-1:0"],
  ]);
});

test("rejects a missing session before starting a Pi host", async () => {
  let starts = 0;
  let traceReads = 0;
  const service = createPiSessionContextTraceService(
    dependencies({
      listSessions: async () => ({ sessions: [] }),
      startSession: async () => {
        starts += 1;
      },
      getTrace: () => {
        traceReads += 1;
        return reader();
      },
    }),
  );

  await assert.rejects(service.list({ sessionId: "missing" }), (error: unknown) => {
    assert.ok(error instanceof PiSessionContextTraceServiceError);
    assert.equal(error.code, "session-not-found");
    assert.equal(error.message, "The session does not exist.");
    assert.deepEqual(error.details, { sessionId: "missing" });
    return true;
  });
  assert.equal(starts, 0);
  assert.equal(traceReads, 0);
});

test("reports an unavailable live trace after the host has started", async () => {
  const service = createPiSessionContextTraceService(
    dependencies({
      getTrace: () => undefined,
    }),
  );

  await assert.rejects(service.activations({ sessionId: "session-1" }), (error: unknown) => {
    assert.ok(error instanceof PiSessionContextTraceServiceError);
    assert.equal(error.code, "context-trace-unavailable");
    assert.deepEqual(error.details, { sessionId: "session-1" });
    return true;
  });
});

test("normalizes journal failures with operation-specific coordinates", async () => {
  const journalFailure = new SessionContextTraceJournalError(
    "context-trace-journal-corrupt",
    "The activation journal is corrupt.",
  );
  const service = createPiSessionContextTraceService(
    dependencies({
      getTrace: () =>
        reader({
          listActivation: async () => {
            throw journalFailure;
          },
        }),
    }),
  );

  await assert.rejects(
    service.list({ sessionId: "session-1", activationId: "activation-history" }),
    (error: unknown) => {
      assert.ok(error instanceof PiSessionContextTraceServiceError);
      assert.equal(error.code, "context-trace-journal-corrupt");
      assert.equal(error.message, journalFailure.message);
      assert.equal(error.cause, journalFailure);
      assert.deepEqual(error.details, {
        sessionId: "session-1",
        activationId: "activation-history",
      });
      return true;
    },
  );
});

test("returns stable coordinates when trace detail retention has expired", async () => {
  const service = createPiSessionContextTraceService(
    dependencies({
      getTrace: () => reader({ readAny: async () => undefined }),
    }),
  );

  await assert.rejects(
    service.read({ sessionId: "session-1", traceId: "activation-1:99" }),
    (error: unknown) => {
      assert.ok(error instanceof PiSessionContextTraceServiceError);
      assert.equal(error.code, "context-trace-not-found");
      assert.deepEqual(error.details, {
        sessionId: "session-1",
        traceId: "activation-1:99",
        activationId: "activation-1",
      });
      return true;
    },
  );
});
