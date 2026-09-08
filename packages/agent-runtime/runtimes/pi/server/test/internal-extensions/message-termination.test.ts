import assert from "node:assert/strict";
import test from "node:test";

const { reportWorkbenchInternalPiExtensionErrors, workbenchInternalPiExtensions } =
  await import("../../src/internal-extensions/index");
const { messageTerminationExtension } =
  await import("../../src/internal-extensions/message-termination");

type MessageEndHandler = (event: unknown, context: unknown) => unknown | Promise<unknown>;

function captureMessageEndHandler(): MessageEndHandler {
  let messageEndHandler: MessageEndHandler | undefined;
  messageTerminationExtension({
    on(event: string, handler: MessageEndHandler) {
      if (event === "message_end") messageEndHandler = handler;
    },
  } as never);
  assert.ok(messageEndHandler);
  return messageEndHandler;
}

test("registers Workbench-owned adapters as hidden inline extensions", () => {
  assert.deepEqual(
    workbenchInternalPiExtensions.map(({ name, hidden }) => ({ name, hidden })),
    [
      ...["read", "bash", "edit", "write", "grep", "find", "ls"].map((name) => ({
        name: `workbench.tool.${name}`,
        hidden: true,
      })),
      { name: "workbench.settings", hidden: true },
      { name: "workbench.rpiv-todo", hidden: true },
      { name: "workbench.message-termination", hidden: true },
      { name: "workbench.ask-user", hidden: true },
      { name: "workbench.composer-context", hidden: true },
      { name: "workbench.context-trace", hidden: true },
    ],
  );
});

test("reports internal load errors without changing the extension result", () => {
  const messages: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => messages.push(args);
  try {
    const result = {
      extensions: [],
      errors: [
        { path: "/home/user/.pi/agent/extensions/broken.ts", error: "user failure" },
        {
          path: "<inline:workbench.message-termination>",
          error: "internal failure",
        },
      ],
      runtime: {},
    } as never;

    assert.equal(reportWorkbenchInternalPiExtensionErrors(result), result);
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(messages, [
    [
      "[workbench-pi] internal extension <inline:workbench.message-termination> failed to load.",
      "internal failure",
    ],
  ]);
});

test("records an explicit Workbench cancellation on the assistant message", async () => {
  const handler = captureMessageEndHandler();
  const result = (await handler(
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "aborted",
        timestamp: 1_000,
        diagnostics: [],
      },
    },
    {
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: "workbench.cancel-intent.v1",
            data: { requestedAt: 1_500, source: "workbench" },
          },
        ],
      },
    },
  )) as {
    message: { diagnostics: Array<{ type: string; timestamp: number; details: unknown }> };
  };

  assert.deepEqual(result.message.diagnostics.at(-1), {
    type: "workbench.message-termination.v1",
    timestamp: result.message.diagnostics.at(-1)?.timestamp,
    details: {
      schemaVersion: 1,
      kind: "cancelled",
      stopReason: "aborted",
      source: "workbench",
    },
  });
});

test("classifies transport failures without discarding provider diagnostics", async () => {
  const handler = captureMessageEndHandler();
  const networkDiagnostic = {
    type: "provider_transport_failure",
    timestamp: 2_000,
    error: { message: "socket closed", code: "ECONNRESET" },
  };
  const result = (await handler(
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "fetch failed",
        timestamp: 1_000,
        diagnostics: [networkDiagnostic],
      },
    },
    { sessionManager: { getBranch: () => [] } },
  )) as { message: { diagnostics: Array<{ type: string; details: unknown }> } };

  assert.deepEqual(result.message.diagnostics[0], networkDiagnostic);
  assert.deepEqual(result.message.diagnostics.at(-1)?.details, {
    schemaVersion: 1,
    kind: "network-error",
    stopReason: "error",
    errorMessage: "fetch failed",
  });
});

test("classifies delayed abort failures within their run without reusing an earlier stop", async (t) => {
  const handlers = new Map<string, MessageEndHandler>();
  messageTerminationExtension({
    on: (event: string, handler: MessageEndHandler) => handlers.set(event, handler),
  } as never);
  const start = handlers.get("agent_start");
  const end = handlers.get("message_end");
  assert.ok(start);
  assert.ok(end);
  const controller = new AbortController();
  const context = {
    signal: controller.signal,
    sessionManager: {
      getBranch: () => [
        {
          type: "custom",
          customType: "workbench.cancel-intent.v1",
          data: { requestedAt: 1_500, source: "workbench" },
        },
      ],
    },
  };
  const terminal = (stopReason: string) => ({
    type: "message_end",
    message: {
      role: "assistant",
      content: [],
      stopReason,
      timestamp: 1_509,
      errorMessage: "This operation was aborted",
    },
  });
  const termination = async (stopReason: string) => {
    const result = (await end(terminal(stopReason), context)) as {
      message: { diagnostics: Array<{ details: { kind: string; source?: string } }> };
    };
    return result.message.diagnostics.at(-1)?.details;
  };

  let now = 1_000;
  t.mock.method(Date, "now", () => now);
  await start({ type: "agent_start" }, context);
  // An error message alone does not prove the current run was cancelled.
  assert.equal((await termination("error"))?.kind, "provider-error");
  controller.abort();
  for (const stopReason of ["aborted", "error"]) {
    const detail = await termination(stopReason);
    assert.equal(detail?.kind, "cancelled");
    assert.equal(detail?.source, "workbench");
  }
  assert.equal((await termination("stop"))?.kind, "completed");

  now = 2_000;
  await start({ type: "agent_start" }, context);
  assert.equal((await termination("aborted"))?.kind, "aborted");
});

test("replaces an earlier termination diagnostic with the authoritative Workbench result", async () => {
  const handler = captureMessageEndHandler();
  const result = (await handler(
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "length",
        timestamp: 1_000,
        diagnostics: [
          {
            type: "workbench.message-termination.v1",
            timestamp: 900,
            details: { schemaVersion: 1, kind: "completed", stopReason: "stop" },
          },
          { type: "provider_observation", timestamp: 950 },
        ],
      },
    },
    { sessionManager: { getBranch: () => [] } },
  )) as { message: { diagnostics: Array<{ type: string; details: unknown }> } };

  assert.deepEqual(
    result.message.diagnostics.map((diagnostic) => diagnostic.type),
    ["provider_observation", "workbench.message-termination.v1"],
  );
  assert.deepEqual(result.message.diagnostics.at(-1)?.details, {
    schemaVersion: 1,
    kind: "length",
    stopReason: "length",
  });
});
