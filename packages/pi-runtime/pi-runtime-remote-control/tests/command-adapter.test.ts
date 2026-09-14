import assert from "node:assert/strict";
import test from "node:test";

import {
  createRemoteCommandAdapter,
  projectPiRpcRemoteSessionCatalog,
  RemoteCommandAdapterError,
  type RemoteCommandRuntimePort,
} from "../src/command-adapter.ts";

test("projects raw Pi RPC catalog rows without leaking paths or unknown fields", () => {
  const value = projectPiRpcRemoteSessionCatalog({
    sessionCatalog: {
      items: [
        {
          sessionId: "session-running",
          updatedAt: Date.parse("2026-09-13T20:00:00.000Z"),
          running: true,
          blank: false,
          cwd: "/private/customer/project",
          agentPreset: "secret-preset",
          projections: {
            asOfSeq: 8,
            values: { "workbench.piSessionSummary": { name: "Visible title" } },
          },
        },
        {
          sessionId: "session-waiting",
          updatedAt: Date.parse("2026-09-13T21:00:00.000Z"),
          running: true,
          waitingForUserInput: true,
          blank: false,
        },
        {
          sessionId: "session-archived",
          updatedAt: Date.parse("2026-09-13T22:00:00.000Z"),
          running: false,
          blank: false,
        },
      ],
    },
    workspaceCatalog: {
      items: [
        {
          workspaceId: "workspace-1",
          path: "/private/customer",
          title: "Customer workspace",
          sessionIds: ["session-running", "session-waiting", "session-archived"],
          createdAt: "2026-09-13T19:00:00.000Z",
          updatedAt: "2026-09-13T22:00:00.000Z",
        },
      ],
      pinnedSessionIds: ["session-running"],
    },
    archivedCatalog: { sessionIds: ["session-archived"] },
  });

  assert.deepEqual(
    value.map(({ sessionId, title, pinned, runState, attention, workspace }) => ({
      sessionId,
      title,
      pinned,
      runState,
      attention,
      workspaceId: workspace?.workspaceId,
    })),
    [
      {
        sessionId: "session-running",
        title: "Visible title",
        pinned: true,
        runState: "running",
        attention: "none",
        workspaceId: "workspace-1",
      },
      {
        sessionId: "session-waiting",
        title: "Session session-",
        pinned: false,
        runState: "waiting-for-input",
        attention: "input-needed",
        workspaceId: "workspace-1",
      },
    ],
  );
  assert.equal(JSON.stringify(value).includes("/private"), false);
  assert.equal(JSON.stringify(value).includes("secret-preset"), false);
});

function harness() {
  const calls: Array<{ name: string; value: unknown }> = [];
  const runtime: RemoteCommandRuntimePort = {
    history: async (input) => {
      calls.push({ name: "history", value: input });
      return {
        events: [
          {
            event: {
              entryId: "message-1",
              time: Date.parse("2026-09-13T20:00:00.000Z"),
              data: { message: { role: "assistant", content: "Safe answer" } },
            },
          },
        ],
        hasMore: false,
      };
    },
    prompt: async (input, rpcId) => {
      calls.push({ name: "prompt", value: { input, rpcId } });
      return { accepted: true, queued: false, messageId: input.clientMutation.messageId };
    },
    cancel: async (input) => {
      calls.push({ name: "cancel", value: input });
      return { accepted: true };
    },
    answerQuestion: async (input) => {
      calls.push({ name: "answer-question", value: input });
      return { accepted: true };
    },
  };
  return { adapter: createRemoteCommandAdapter({ runtime }), calls, runtime };
}

test("maps bounded history, one text block, stop, and an ordinary question only", async () => {
  const { adapter, calls } = harness();
  const page = await adapter.readHistory({
    sessionId: "session-1",
    historyCursor: "history-1",
    sessionRevision: "revision-1",
    projectionCursor: { epoch: "epoch-1", offset: "7" },
  });
  assert.equal(page.items[0]?.type, "assistant-message");
  assert.equal(JSON.stringify(page).includes("Safe answer"), true);

  assert.deepEqual(
    await adapter.execute({
      operationId: "operation-1",
      messageId: "message-1",
      command: {
        type: "session.send",
        sessionId: "session-1",
        text: "Hello from mobile",
        attachment: "/secret" as never,
      } as never,
    }),
    { type: "message-accepted", sessionId: "session-1", messageId: "message-1" },
  );
  assert.deepEqual(
    await adapter.execute({
      operationId: "operation-2",
      command: { type: "session.stop", sessionId: "session-1" },
    }),
    undefined,
  );
  assert.deepEqual(
    await adapter.execute({
      operationId: "operation-3",
      command: {
        type: "interaction.answerQuestion",
        sessionId: "session-1",
        interactionId: "question-rpc-1",
        interactionRevision: "question-revision-1",
        answers: [{ questionId: "target", optionIds: ["Code"], text: "details" }],
      },
    }),
    { type: "interaction-resolved", interactionId: "question-rpc-1" },
  );

  assert.deepEqual(calls[1], {
    name: "prompt",
    value: {
      input: {
        sessionId: "session-1",
        mode: "queue",
        content: [{ type: "text", text: "Hello from mobile" }],
        clientMutation: { operationId: "operation-1", messageId: "message-1" },
      },
      rpcId: "operation-1",
    },
  });
  assert.equal(JSON.stringify(calls[1]).includes("secret"), false);
  assert.deepEqual(calls[2], { name: "cancel", value: { sessionId: "session-1" } });
  assert.deepEqual(calls[3], {
    name: "answer-question",
    value: {
      type: "client-response",
      rpcId: "question-rpc-1",
      result: {
        ok: true,
        value: {
          sessionId: "session-1",
          answer: {
            answers: [{ id: "target", selected: ["Code"], custom: "details" }],
          },
        },
      },
    },
  });
});

test("has no fallback for management, attachments, composer commands, or tool approvals", async () => {
  const { adapter, runtime } = harness();
  for (const command of [
    { type: "session.create" },
    { type: "session.rename", sessionId: "session-1", title: "Renamed" },
    { type: "session.setPinned", sessionId: "session-1", pinned: true },
    { type: "session.setArchived", sessionId: "session-1", archived: true },
  ] as const) {
    await assert.rejects(
      adapter.execute({ operationId: "operation-1", command }),
      (error: unknown) =>
        error instanceof RemoteCommandAdapterError && error.code === "command_not_available",
    );
  }

  await assert.rejects(
    adapter.execute({
      operationId: "operation-2",
      command: { type: "session.send", sessionId: "session-1", text: "missing identity" },
    }),
    (error: unknown) =>
      error instanceof RemoteCommandAdapterError && error.code === "local_rejected",
  );

  runtime.answerQuestion = async () => ({ accepted: false, reason: "not-pending" });
  await assert.rejects(
    adapter.execute({
      operationId: "operation-3",
      command: {
        type: "interaction.answerQuestion",
        sessionId: "session-1",
        interactionId: "approval-1",
        interactionRevision: "revision-1",
        answers: [{ questionId: "approval", optionIds: ["allow"] }],
      },
    }),
    (error: unknown) =>
      error instanceof RemoteCommandAdapterError && error.code === "interaction_not_pending",
  );
});
