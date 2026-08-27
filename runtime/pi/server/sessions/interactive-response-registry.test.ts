import assert from "node:assert/strict";
import test from "node:test";

import type { ClientResponse, RpcReceipt } from "../../rpc-contracts";
import type { HostStreamPayload, MuxStreamPayload, ServerRequest } from "../../stream-contracts";

const { createStreamHub } = (await import(
  new URL("../streams/stream-hub.ts", import.meta.url).href
)) as typeof import("../streams/stream-hub");
const { handleInteractiveResponsePost, InteractiveResponseRegistry, parseClientResponse } =
  (await import(
    new URL("./interactive-response-registry.ts", import.meta.url).href
  )) as typeof import("./interactive-response-registry");

function createHarness() {
  let interactiveId = 0;
  let streamId = 0;
  const hub = createStreamHub({ createRpcId: () => `stream-${++streamId}` });
  const registry = new InteractiveResponseRegistry({
    hub,
    createRpcId: () => `interactive-${++interactiveId}`,
  });
  const frames: ServerRequest<MuxStreamPayload>[] = [];
  const hostFrames: ServerRequest<HostStreamPayload>[] = [];
  const muxSubscription = hub.subscribe("mux", {
    onFrame: (frame) => frames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  const hostSubscription = hub.subscribe("host", {
    onFrame: (frame) => hostFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  return {
    hub,
    registry,
    frames,
    hostFrames,
    ready: Promise.all([muxSubscription.ready, hostSubscription.ready]),
  };
}

function answerQuestion(
  rpcId: string,
  sessionId: string,
  id: string,
  selected: string[],
  custom?: string,
): ClientResponse {
  return {
    type: "client-response",
    rpcId,
    result: {
      ok: true,
      value: {
        sessionId,
        answer: {
          answers: [{ id, selected, ...(custom === undefined ? {} : { custom }) }],
        },
      },
    },
  };
}

function requestedFrame(
  frames: readonly ServerRequest<MuxStreamPayload>[],
  type: "question/requested" | "approval/requested",
): ServerRequest<MuxStreamPayload> {
  const frame = frames.find((candidate) => candidate.payload.type === type);
  assert.ok(frame, `Expected ${type}`);
  return frame;
}

test("maps extension select to a stable mux question and accepts only the first valid claim", async () => {
  const { registry, frames, ready } = createHarness();
  await ready;
  const selection = registry
    .createExtensionUIContext("session-1")
    .select("Target", ["Code", "Docs"]);
  const requested = requestedFrame(frames, "question/requested");
  assert.equal(requested.rpcId, "interactive-1");
  assert.deepEqual(requested.payload, {
    type: "question/requested",
    sessionId: "session-1",
    questions: [
      {
        id: "selection",
        question: "Target",
        options: [{ label: "Code" }, { label: "Docs" }],
        multiSelect: false,
      },
    ],
  });

  assert.deepEqual(
    registry.respond(answerQuestion(requested.rpcId, "wrong-session", "selection", ["Code"])),
    { accepted: false, reason: "bad-response" },
  );
  assert.deepEqual(
    registry.respond(answerQuestion(requested.rpcId, "session-1", "selection", ["Unknown"])),
    { accepted: false, reason: "bad-response" },
  );
  const response = answerQuestion(requested.rpcId, "session-1", "selection", ["Docs"]);
  assert.deepEqual(registry.respond(response), { accepted: true });
  assert.deepEqual(registry.respond(response), { accepted: false, reason: "not-pending" });
  assert.equal(await selection, "Docs");
  assert.deepEqual(
    frames
      .filter((frame) => frame.payload.type === "question/resolved")
      .map((frame) => frame.payload),
    [
      {
        type: "question/resolved",
        sessionId: "session-1",
        questionRpcId: requested.rpcId,
        outcome: "answered",
      },
    ],
  );
});

test("maps Workbench Ask User question groups to one paginated interaction", async () => {
  const { registry, frames, hostFrames, ready } = createHarness();
  await ready;
  const ui = registry.createExtensionUIContext("session-ask-user");
  await assert.rejects(ui.workbenchAskUser([]), /Invalid Workbench Ask User question group/);
  const questions = [
    {
      id: "scope",
      header: "Scope",
      question: "Which areas should change?",
      options: [
        { label: "Chat", recommended: true },
        { label: "Workspace", description: "Workspace surfaces" },
      ],
      allowCustom: true,
      multiSelect: true,
      required: true,
    },
    {
      id: "component-name",
      header: "Name",
      question: "What should the component be called?",
      required: true,
    },
  ];
  await assert.rejects(
    ui.workbenchAskUser([
      {
        id: "invalid-recommendations",
        question: "Which target?",
        options: [
          { label: "Chat", recommended: true },
          { label: "Workspace", recommended: true },
        ],
      },
    ]),
    /Invalid Workbench Ask User question group/,
  );
  await assert.rejects(
    ui.workbenchAskUser([
      {
        id: "invalid-single-choice",
        question: "Which concept?",
        options: [{ label: "Agent Harness" }],
      },
    ]),
    /Invalid Workbench Ask User question group/,
  );
  const answers = ui.workbenchAskUser(questions);
  const requested = requestedFrame(frames, "question/requested");

  assert.equal(registry.isSessionWaitingForUserInput("session-ask-user"), true);
  assert.deepEqual(hostFrames.at(-1)?.payload, {
    type: "host/session-interaction-status",
    sessionId: "session-ask-user",
    waitingForUserInput: true,
  });

  assert.equal(requested.rpcId, "interactive-1");
  assert.deepEqual(requested.payload, {
    type: "question/requested",
    sessionId: "session-ask-user",
    questions,
  });

  assert.deepEqual(
    registry.respond({
      type: "client-response",
      rpcId: requested.rpcId,
      result: {
        ok: true,
        value: {
          sessionId: "session-ask-user",
          answer: {
            answers: [
              { id: "scope", selected: [] },
              { id: "component-name", selected: [], custom: "AskUserPanel" },
            ],
          },
        },
      },
    }),
    { accepted: false, reason: "bad-response" },
  );

  assert.deepEqual(
    registry.respond({
      type: "client-response",
      rpcId: requested.rpcId,
      result: {
        ok: true,
        value: {
          sessionId: "session-ask-user",
          answer: {
            answers: [
              { id: "component-name", selected: [], custom: "AskUserPanel" },
              {
                id: "scope",
                selected: ["Chat", "Workspace"],
                custom: "Keep the Composer overlay",
              },
            ],
          },
        },
      },
    }),
    { accepted: true },
  );
  assert.deepEqual(await answers, [
    {
      id: "scope",
      selected: ["Chat", "Workspace"],
      custom: "Keep the Composer overlay",
    },
    { id: "component-name", selected: [], custom: "AskUserPanel" },
  ]);
  assert.equal(registry.isSessionWaitingForUserInput("session-ask-user"), false);
  assert.deepEqual(
    hostFrames.map((frame) => frame.payload),
    [
      {
        type: "host/session-interaction-status",
        sessionId: "session-ask-user",
        waitingForUserInput: true,
      },
      {
        type: "host/session-interaction-status",
        sessionId: "session-ask-user",
        waitingForUserInput: false,
      },
    ],
  );
});

test("accepts one suggested choice when the question also allows a custom answer", async () => {
  const { registry, frames, ready } = createHarness();
  await ready;
  const answers = registry.createExtensionUIContext("session-custom-choice").workbenchAskUser([
    {
      id: "concept",
      question: "Which concept should be explained?",
      options: [{ label: "Agent Harness" }],
      allowCustom: true,
      required: true,
    },
  ]);
  const requested = requestedFrame(frames, "question/requested");

  assert.deepEqual(
    registry.respond(
      answerQuestion(requested.rpcId, "session-custom-choice", "concept", [], "Context windows"),
    ),
    { accepted: true },
  );
  assert.deepEqual(await answers, [{ id: "concept", selected: [], custom: "Context windows" }]);
});

test("maps confirm and input answers and settles cancellation, abort, and timeout", async () => {
  const { registry, frames, ready } = createHarness();
  await ready;
  const ui = registry.createExtensionUIContext("session-dialogs");

  const confirmed = ui.confirm("Proceed", "Apply changes?");
  const confirmation = frames.find(
    (frame) =>
      frame.payload.type === "question/requested" &&
      frame.payload.questions[0]?.id === "confirmation",
  );
  assert.ok(confirmation);
  assert.deepEqual(
    registry.respond(
      answerQuestion(confirmation.rpcId, "session-dialogs", "confirmation", ["true"]),
    ),
    { accepted: true },
  );
  assert.equal(await confirmed, true);

  const input = ui.input("Name", "Optional label");
  const inputFrame = frames.find(
    (frame) =>
      frame.payload.type === "question/requested" && frame.payload.questions[0]?.id === "value",
  );
  assert.ok(inputFrame);
  assert.deepEqual(
    registry.respond(answerQuestion(inputFrame.rpcId, "session-dialogs", "value", [], "Release")),
    { accepted: true },
  );
  assert.equal(await input, "Release");

  const cancelled = ui.input("Cancelled");
  const cancelledFrame = frames.findLast(
    (frame) =>
      frame.payload.type === "question/requested" && frame.payload.questions[0]?.id === "value",
  );
  assert.ok(cancelledFrame);
  assert.deepEqual(
    registry.respond({
      type: "client-response",
      rpcId: cancelledFrame.rpcId,
      result: {
        ok: false,
        error: { code: "cancelled", message: "closed", details: {} },
      },
    }),
    { accepted: true },
  );
  assert.equal(await cancelled, undefined);

  const abort = new AbortController();
  const aborted = ui.select("Abort", ["A"], { signal: abort.signal });
  abort.abort();
  assert.equal(await aborted, undefined);

  const timedOut = ui.confirm("Timeout", "No response", { timeout: 5 });
  assert.equal(await timedOut, false);
  assert.equal(registry.pendingCount, 0);
  assert.ok(
    frames.filter(
      (frame) =>
        frame.payload.type === "question/resolved" && frame.payload.outcome === "cancelled",
    ).length >= 3,
  );
});

test("exposes an explicit generic approval wait without inventing a Pi policy hook", async () => {
  const { registry, frames, ready } = createHarness();
  await ready;
  const approval = registry.requestApproval({
    sessionId: "session-approval",
    approvalId: "approval-1",
    toolName: "shell",
    reason: "requires confirmation",
  });
  const requested = requestedFrame(frames, "approval/requested");
  assert.deepEqual(
    registry.respond({
      type: "client-response",
      rpcId: requested.rpcId,
      result: {
        ok: false,
        error: { code: "cancelled", message: "not valid for approvals", details: {} },
      },
    }),
    { accepted: false, reason: "bad-response" },
  );
  assert.deepEqual(
    registry.respond({
      type: "client-response",
      rpcId: requested.rpcId,
      result: {
        ok: true,
        value: {
          sessionId: "session-approval",
          approvalId: "approval-1",
          outcome: "allowed-once",
        },
      },
    }),
    { accepted: true },
  );
  assert.equal(await approval, "allowed-once");
  assert.ok(
    frames.some(
      (frame) =>
        frame.payload.type === "approval/resolved" &&
        frame.payload.approvalId === "approval-1" &&
        frame.payload.outcome === "allowed-once",
    ),
  );

  const pendingQuestion = registry.createExtensionUIContext("session-clear").select("Clear", ["A"]);
  const pendingApproval = registry.requestApproval({
    sessionId: "session-clear",
    approvalId: "approval-clear",
    toolName: "shell",
  });
  registry.clearSession("session-clear");
  assert.equal(await pendingQuestion, undefined);
  assert.equal(await pendingApproval, "cancelled");
  assert.equal(registry.pendingCount, 0);
});

test("parses only complete ClientResponse wire shapes", () => {
  assert.deepEqual(
    parseClientResponse(answerQuestion("rpc", "session", "question", [], "text")),
    answerQuestion("rpc", "session", "question", [], "text"),
  );
  assert.equal(
    parseClientResponse({
      type: "client-response",
      rpcId: "ambiguous",
      result: {
        ok: true,
        value: {
          sessionId: "session",
          approvalId: "approval",
          outcome: "rejected",
          answer: { answers: [] },
        },
      },
    }),
    undefined,
  );
  assert.equal(
    parseClientResponse({
      type: "client-response",
      rpcId: "bad-cancel",
      result: { ok: false, error: { code: "internal", message: "x", details: {} } },
    }),
    undefined,
  );
});

function respondRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1:3000/api/respond", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      "content-type": "application/json",
      ...headers,
    },
    body,
  });
}

async function receipt(response: Response): Promise<RpcReceipt> {
  assert.equal(response.status, 200);
  return (await response.json()) as RpcReceipt;
}

test("POST /api/respond shares trust, JSON and body-limit rules and returns carrier receipts", async () => {
  const { registry, frames, ready } = createHarness();
  await ready;
  const wait = registry.createExtensionUIContext("session-http").select("HTTP", ["ok"]);
  const requested = requestedFrame(frames, "question/requested");
  const answer = answerQuestion(requested.rpcId, "session-http", "selection", ["ok"]);

  assert.deepEqual(
    await receipt(
      await handleInteractiveResponsePost(
        respondRequest(JSON.stringify({ type: "client-request", rpcId: "wrong" })),
        registry,
      ),
    ),
    { accepted: false, reason: "bad-response" },
  );
  assert.deepEqual(
    await receipt(
      await handleInteractiveResponsePost(respondRequest(JSON.stringify(answer)), registry),
    ),
    { accepted: true },
  );
  assert.equal(await wait, "ok");
  assert.deepEqual(
    await receipt(
      await handleInteractiveResponsePost(respondRequest(JSON.stringify(answer)), registry),
    ),
    { accepted: false, reason: "not-pending" },
  );

  assert.equal((await handleInteractiveResponsePost(respondRequest("{"), registry)).status, 400);
  assert.equal(
    (
      await handleInteractiveResponsePost(
        respondRequest("{}", { "content-type": "text/plain" }),
        registry,
      )
    ).status,
    415,
  );
  assert.equal(
    (await handleInteractiveResponsePost(respondRequest("{}", { host: "evil.example" }), registry))
      .status,
    403,
  );
  assert.equal(
    (
      await handleInteractiveResponsePost(
        respondRequest("{}", { "content-length": String(160 * 1024 * 1024 + 1) }),
        registry,
      )
    ).status,
    413,
  );
});
