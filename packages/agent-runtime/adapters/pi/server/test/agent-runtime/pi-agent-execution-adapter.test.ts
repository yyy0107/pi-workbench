import assert from "node:assert/strict";
import test from "node:test";

import { AgentExecutionError } from "@workbench/agent-runtime-server/execution";

import {
  createPiAgentExecutionAdapter,
  type PiAgentExecutionDependencies,
} from "../../src/agent-runtime/pi-agent-execution-adapter";

function harness(overrides: Partial<PiAgentExecutionDependencies> = {}) {
  const calls: Array<{ name: string; value: unknown }> = [];
  const dependencies: PiAgentExecutionDependencies = {
    submitPrompt: async (sessionId, mode, prompt, provenance) => {
      calls.push({ name: "submit", value: { sessionId, mode, prompt, provenance } });
      return { queued: true, queueItemId: "queue-1" };
    },
    regenerateSession: async (sessionId, messageId, requestId) => {
      calls.push({ name: "regenerate", value: { sessionId, messageId, requestId } });
    },
    resumeSession: async (sessionId, checkpointId, expectedLeafId) => {
      calls.push({ name: "resume", value: { sessionId, checkpointId, expectedLeafId } });
    },
    selectSessionBranch: async (sessionId, leafId) => {
      calls.push({ name: "select-branch", value: { sessionId, leafId } });
    },
    updateQueueItem: async (sessionId, itemId, mutation) => {
      calls.push({ name: "update-queue", value: { sessionId, itemId, mutation } });
    },
    cancelSession: async (sessionId) => {
      calls.push({ name: "cancel", value: { sessionId } });
    },
    ...overrides,
  };
  return { adapter: createPiAgentExecutionAdapter(dependencies), calls };
}

test("maps the neutral prompt and provenance to Pi without leaking Pi into the port", async () => {
  const { adapter, calls } = harness();
  const composer = {
    version: 2 as const,
    sourceText: "inspect",
    text: "inspect",
    context: [],
    metadata: {},
    commands: [],
  };

  assert.deepEqual(
    await adapter.submit({
      threadId: "thread-1",
      mode: "follow-up",
      prompt: {
        text: "inspect",
        attachments: [
          { kind: "image", data: "image-data", mediaType: "image/png", name: "input.png" },
          { kind: "document", data: "pdf-data", mediaType: "application/pdf" },
        ],
        composer,
      },
      provenance: { requestId: "rpc-1", clientTimeZone: "Asia/Shanghai" },
    }),
    { kind: "queued", queueItemId: "queue-1" },
  );
  assert.deepEqual(calls, [
    {
      name: "submit",
      value: {
        sessionId: "thread-1",
        mode: "followUp",
        prompt: {
          message: "inspect",
          images: [
            {
              type: "image",
              data: "image-data",
              mimeType: "image/png",
              name: "input.png",
            },
          ],
          documents: [{ type: "file", data: "pdf-data", mimeType: "application/pdf" }],
        },
        provenance: {
          rpcId: "rpc-1",
          clientTimeZone: "Asia/Shanghai",
          composer,
        },
      },
    },
  ]);
});

test("maps lifecycle and queue operations to the existing Pi session host", async () => {
  const { adapter, calls } = harness();

  await adapter.regeneration!.regenerate({
    threadId: "thread-1",
    userMessageId: "message-1",
    requestId: "attachment-retry-1",
  });
  await adapter.resume!.resume({
    threadId: "thread-1",
    checkpointId: "checkpoint-1",
    expectedStateToken: "leaf-1",
  });
  await adapter.branches!.select({ threadId: "thread-1", branchToken: "leaf-2" });
  await adapter.queue!.update({
    threadId: "thread-1",
    itemId: "queue-1",
    mutation: { kind: "edit", text: "updated" },
  });
  await adapter.queue!.update({
    threadId: "thread-1",
    itemId: "queue-2",
    mutation: { kind: "steer" },
  });
  await adapter.cancel({ threadId: "thread-1" });

  assert.deepEqual(calls, [
    {
      name: "regenerate",
      value: {
        sessionId: "thread-1",
        messageId: "message-1",
        requestId: "attachment-retry-1",
      },
    },
    {
      name: "resume",
      value: {
        sessionId: "thread-1",
        checkpointId: "checkpoint-1",
        expectedLeafId: "leaf-1",
      },
    },
    { name: "select-branch", value: { sessionId: "thread-1", leafId: "leaf-2" } },
    {
      name: "update-queue",
      value: {
        sessionId: "thread-1",
        itemId: "queue-1",
        mutation: { kind: "edit", prompt: { message: "updated" } },
      },
    },
    {
      name: "update-queue",
      value: { sessionId: "thread-1", itemId: "queue-2", mutation: { kind: "steer" } },
    },
    { name: "cancel", value: { sessionId: "thread-1" } },
  ]);
});

test("normalizes Pi execution failures to stable Agent error codes", async () => {
  const cases = [
    ["pi_session_not_found", "thread-not-found"],
    ["pi_session_busy", "busy"],
    ["pi_resume_stale", "resume-stale"],
    ["pi_resume_unavailable", "resume-blocked"],
    ["pi_resume_confirmation_required", "resume-confirmation-required"],
    ["pi_queue_item_not_found", "queue-item-not-found"],
    ["pi_steer_unavailable", "steer-unavailable"],
    ["pi_model_image_unsupported", "image-input-unsupported"],
    ["pi_composer_command_conflict", "prompt-rejected"],
    ["unexpected", "internal"],
  ] as const;

  for (const [piCode, expected] of cases) {
    const { adapter } = harness({
      cancelSession: async () => {
        throw Object.assign(new Error(piCode), { code: piCode });
      },
    });
    await assert.rejects(adapter.cancel({ threadId: "thread-1" }), (error: unknown) => {
      assert.ok(error instanceof AgentExecutionError);
      assert.equal(error.code, expected);
      return true;
    });
  }
});

test("rejects a non-PDF document before entering Pi", async () => {
  const { adapter, calls } = harness();

  await assert.rejects(
    adapter.submit({
      threadId: "thread-1",
      mode: "steer",
      prompt: {
        text: "inspect",
        attachments: [{ kind: "document", data: "document-data", mediaType: "text/plain" }],
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AgentExecutionError);
      assert.equal(error.code, "prompt-rejected");
      return true;
    },
  );
  assert.deepEqual(calls, []);
});
