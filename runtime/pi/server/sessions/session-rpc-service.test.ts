import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      !/\.[^/]+$/.test(specifier) &&
      context.parentURL?.includes("/runtime/pi/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { SessionRpcService, SessionRpcServiceError } = (await import(
  new URL("./session-rpc-service.ts", import.meta.url).href
)) as typeof import("./session-rpc-service");
moduleHooks.deregister();

type PiSessionHistory = import("../../contracts").PiSessionHistory;
type PiSessionSummary = import("../../contracts").PiSessionSummary;
type ModelProviderGroup = import("../../rpc-contracts").ModelProviderGroup;
type SessionEvent = import("../../rpc-contracts").SessionEvent;
type WorkspaceView = import("../../rpc-contracts").WorkspaceView;
type SessionRpcDependencies = import("./session-rpc-service").SessionRpcDependencies;
type SessionRpcWorkspaceStore = import("./session-rpc-service").SessionRpcWorkspaceStore;

const PNG_BASE64 = "iVBORw0KGgo=";

const workspace: WorkspaceView = {
  workspaceId: "workspace-1",
  path: "/workspace",
  title: "Workspace",
  sessionIds: ["session-1"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function summary(overrides: Partial<PiSessionSummary> = {}): PiSessionSummary {
  return {
    id: "session-1",
    cwd: "/workspace",
    workspace: { id: "workspace-1", name: "Workspace", cwd: "/workspace" },
    name: "Protocol work",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-02T03:04:05.000Z",
    messageCount: 2,
    firstMessage: "Design the session protocol",
    transient: false,
    running: false,
    ...overrides,
  };
}

function history(messages: PiSessionHistory["context"]["messages"] = []): PiSessionHistory {
  return {
    sessionId: "session-1",
    context: {
      messages,
      entryIds: messages.map((_, index) => `entry-${index}`),
      entryCompletedAts: messages.map((_, index) => 1_000 + index),
      thinkingLevel: "medium",
      model: { provider: "openai", modelId: "gpt-reasoning" },
    },
  };
}

function canonicalEvents(count: number): SessionEvent[] {
  return Array.from({ length: count }, (_, seq) => ({
    type: seq % 2 === 0 ? "message" : "agent_settled",
    seq,
    time: 10_000 + seq,
    data: seq % 2 === 0 ? { role: "user", content: `message ${seq}` } : {},
  }));
}

function modelGroups(): ModelProviderGroup[] {
  return [
    {
      id: "openai",
      name: "OpenAI",
      models: [
        {
          id: "gpt-reasoning",
          name: "GPT Reasoning",
          reasoning: {
            efforts: [
              { id: "low", name: "Low" },
              { id: "medium", name: "Medium" },
            ],
            defaultEffort: "medium",
          },
        },
      ],
    },
  ];
}

function harness(overrides: Partial<SessionRpcDependencies> = {}) {
  let workspaces = [structuredClone(workspace)];
  const calls: Array<{ name: string; value?: unknown }> = [];
  const dependencies: SessionRpcDependencies = {
    listSessions: async () => ({ sessions: [summary()], runningSessionIds: [] }),
    listSessionSearchText: async () => [],
    createSession: async (input) => {
      calls.push({ name: "create", value: input });
      return { id: "session-created" };
    },
    forkSession: async (sessionId, atSeq) => {
      calls.push({ name: "fork", value: [sessionId, atSeq] });
      return { id: "session-forked" };
    },
    getSessionEvents: async () => [],
    getSessionHistory: async () => history(),
    listModels: async () => ({
      models: [],
      defaultModel: { provider: "openai", modelId: "gpt-reasoning" },
    }),
    renameSession: async (sessionId, title) => {
      calls.push({ name: "rename", value: [sessionId, title] });
      return 7;
    },
    submitPrompt: async (sessionId, mode, prompt, provenance) => {
      calls.push({ name: "submit-prompt", value: [sessionId, mode, prompt, provenance] });
    },
    updateQueueItem: async (sessionId, itemId, mutation) => {
      calls.push({ name: "update-queue", value: [sessionId, itemId, mutation] });
    },
    cancelSession: async (sessionId) => {
      calls.push({ name: "cancel", value: sessionId });
    },
    selectSessionModel: async (sessionId, selection) => {
      calls.push({ name: "select-model", value: [sessionId, selection] });
    },
    supportsRequestedSessionId: false,
    supportsAgentPreset: false,
    ...overrides,
  };
  const workspaceStore: SessionRpcWorkspaceStore = {
    list: async () => ({ items: structuredClone(workspaces) }),
    attachSession: async (workspaceId, sessionId) => {
      calls.push({ name: "attach", value: [workspaceId, sessionId] });
      const destination = workspaces.find((item) => item.workspaceId === workspaceId);
      if (!destination) throw new Error("workspace missing");
      workspaces = workspaces.map((item) => ({
        ...item,
        sessionIds: item.sessionIds.filter((id) => id !== sessionId),
      }));
      const attached = workspaces.find((item) => item.workspaceId === workspaceId)!;
      attached.sessionIds.push(sessionId);
      return { workspace: structuredClone(attached) };
    },
    reconcile: async (sessions) => {
      calls.push({ name: "reconcile", value: sessions });
      workspaces = workspaces.map((item) => ({
        ...item,
        sessionIds: [...new Set([...item.sessionIds, ...sessions.map(({ id }) => id)])],
      }));
      return { items: structuredClone(workspaces) };
    },
  };
  const service = new SessionRpcService({
    workspaceStore,
    dependencies,
    defaultCwd: "/default",
    modelServiceFactory: () => ({
      models: async () => ({ groups: modelGroups(), failures: [] }),
    }),
  });
  return { service, calls, workspaceStore };
}

test("lists legacy summaries and searches with protocol bounds", async () => {
  const longSnippet = `${"😀".repeat(250)} needle`;
  const sessions = Array.from({ length: 21 }, (_, index) =>
    summary({
      id: `session-${index}`,
      name: index === 0 ? longSnippet : `needle ${index}`,
      messageCount: index === 0 ? 0 : 2,
      running: index === 1,
    }),
  );
  const { service } = harness({
    listSessions: async () => ({ sessions, runningSessionIds: ["session-1"] }),
  });

  const listed = await service.list({ cursor: "reserved" });
  assert.deepEqual(
    { ...listed.items[0], projections: undefined },
    {
      sessionId: "session-0",
      updatedAt: Date.parse("2026-01-02T03:04:05.000Z"),
      running: false,
      blank: true,
      cwd: "/workspace",
      projections: undefined,
    },
  );
  assert.deepEqual(listed.items[0]?.projections?.values["workbench.piSessionSummary"], sessions[0]);
  const searched = await service.search({ query: "  needle  " });
  assert.equal(searched.items.length, 20);
  assert.equal(searched.hasMore, true);
  assert.ok([...searched.items[0].snippet].length <= 240);

  await assert.rejects(service.search({ query: "\0" }), (error: unknown) => {
    assert.ok(error instanceof SessionRpcServiceError);
    assert.equal(error.code, "bad-request");
    assert.deepEqual(error.details.issues[0].path, ["query"]);
    return true;
  });
});

test("searches complete persisted and live user/assistant text around the actual match", async () => {
  const persistedBody = `${"前".repeat(180)} Deep Hidden Needle ${"后".repeat(180)}`;
  const persisted = harness({
    listSessionSearchText: async () => [{ sessionId: "session-1", allMessagesText: persistedBody }],
  });
  const persistedResult = await persisted.service.search({ query: "deep hidden needle" });
  assert.equal(persistedResult.items.length, 1);
  assert.match(persistedResult.items[0]!.snippet, /Deep Hidden Needle/);
  assert.ok([...persistedResult.items[0]!.snippet].length <= 240);

  const live = harness({
    getSessionHistory: async () =>
      history([
        { role: "user", content: "ordinary opening" },
        {
          role: "assistant",
          content: [{ type: "text", text: "The later assistant carries Live Needle Here." }],
        },
        {
          role: "toolResult",
          toolCallId: "tool-1",
          content: [{ type: "text", text: "tool-only secret" }],
        },
      ]),
  });
  assert.deepEqual(await live.service.search({ query: "live needle" }), {
    items: [
      {
        sessionId: "session-1",
        snippet: "ordinary opening The later assistant carries Live Needle Here.",
      },
    ],
    hasMore: false,
  });
  assert.deepEqual(await live.service.search({ query: "tool-only secret" }), {
    items: [],
    hasMore: false,
  });
});

test("creates a session in a workspace, attaches it, and rejects unsupported creation options", async () => {
  const { service, calls } = harness();
  assert.deepEqual(await service.create({ workspaceId: "workspace-1" }), {
    sessionId: "session-created",
  });
  assert.deepEqual(calls, [
    { name: "create", value: { cwd: "/workspace" } },
    { name: "attach", value: ["workspace-1", "session-created"] },
  ]);

  const cwdOnly = harness();
  assert.deepEqual(await cwdOnly.service.create({ cwd: "/workspace" }), {
    sessionId: "session-created",
  });
  assert.deepEqual(cwdOnly.calls, [{ name: "create", value: { cwd: "/workspace" } }]);

  await assert.rejects(
    service.create({ workspaceId: "workspace-1", cwd: "/other" }),
    (error: unknown) => {
      assert.ok(error instanceof SessionRpcServiceError);
      assert.equal(error.code, "bad-request");
      assert.equal(error.details.issues.length, 2);
      return true;
    },
  );
  await assert.rejects(service.create({ cwd: "/workspace", sessionId: "chosen" }), {
    code: "session-conflict",
    details: { sessionId: "chosen", requestedCwd: "/workspace" },
  });
  await assert.rejects(service.create({ agentPreset: "reviewer" }), (error: unknown) => {
    assert.ok(error instanceof SessionRpcServiceError);
    assert.equal(error.code, "agent-preset-invalid");
    assert.equal(error.details.agentPreset, "reviewer");
    return true;
  });
});

test("adopts requested ids idempotently, attaches matching sessions, and rejects cwd conflicts", async () => {
  const existing = summary({ id: "chosen", cwd: "/workspace" });
  const adopted = harness({
    supportsRequestedSessionId: true,
    listSessions: async () => ({ sessions: [summary(), existing], runningSessionIds: [] }),
  });

  assert.deepEqual(
    await adopted.service.create({
      workspaceId: "workspace-1",
      sessionId: "chosen",
    }),
    { sessionId: "chosen" },
  );
  assert.deepEqual(adopted.calls, [{ name: "attach", value: ["workspace-1", "chosen"] }]);

  const canonicalAlias = harness({
    supportsRequestedSessionId: true,
    listSessions: async () => ({
      sessions: [summary(), summary({ id: "alias", cwd: "/workspace" })],
      runningSessionIds: [],
    }),
  });
  assert.deepEqual(
    await canonicalAlias.service.create({ cwd: "/workspace/../workspace", sessionId: "alias" }),
    { sessionId: "alias" },
  );
  assert.deepEqual(canonicalAlias.calls, []);

  await assert.rejects(adopted.service.create({ cwd: "/other", sessionId: "chosen" }), {
    code: "session-conflict",
    details: {
      sessionId: "chosen",
      requestedCwd: "/other",
      existingCwd: "/workspace",
    },
  });
});

test("forwards requested ids and serializes concurrent creates for the same id", async () => {
  const sessions = [summary()];
  let createCalls = 0;
  let createdInput: Parameters<SessionRpcDependencies["createSession"]>[0] | undefined;
  const concurrent = harness({
    supportsRequestedSessionId: true,
    listSessions: async () => ({ sessions: structuredClone(sessions), runningSessionIds: [] }),
    createSession: async (input) => {
      createCalls += 1;
      createdInput = input;
      await Promise.resolve();
      sessions.push(summary({ id: input.sessionId, cwd: input.cwd }));
      return { id: input.sessionId! };
    },
  });

  assert.deepEqual(
    await Promise.all([
      concurrent.service.create({ cwd: "/workspace", sessionId: "concurrent" }),
      concurrent.service.create({ cwd: "/workspace", sessionId: "concurrent" }),
    ]),
    [{ sessionId: "concurrent" }, { sessionId: "concurrent" }],
  );
  assert.equal(createCalls, 1);
  assert.deepEqual(createdInput, { cwd: "/workspace", sessionId: "concurrent" });

  const registryConflict = harness({
    supportsRequestedSessionId: true,
    createSession: async () => {
      throw Object.assign(new Error("already allocated"), {
        code: "pi_session_conflict",
        existingCwd: "/other",
      });
    },
  });
  await assert.rejects(registryConflict.service.create({ cwd: "/workspace", sessionId: "raced" }), {
    code: "session-conflict",
    details: {
      sessionId: "raced",
      requestedCwd: "/workspace",
      existingCwd: "/other",
    },
  });
});

test("projects paginated history and returns projections only on the tail page", async () => {
  const { service } = harness({ getSessionEvents: async () => canonicalEvents(60) });

  const tail = await service.history({ sessionId: "session-1" });
  assert.equal(tail.events.length, 60);
  assert.equal(tail.events[0].event.seq, 0);
  assert.equal(tail.events[0].event.time, 10_000);
  assert.equal(tail.hasMore, false);
  assert.deepEqual(tail.projections, { asOfSeq: 59, values: {} });

  const previous = await service.history({
    sessionId: "session-1",
    beforeSeq: 10,
    maxMessages: 4,
  });
  assert.deepEqual(
    previous.events.map(({ event }) => event.seq),
    [2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(previous.hasMore, true);
  assert.equal(previous.projections, undefined);

  const empty = harness().service;
  assert.deepEqual(await empty.history({ sessionId: "session-1" }), {
    events: [],
    hasMore: false,
    projections: { asOfSeq: -1, values: {} },
  });

  await assert.rejects(service.history({ sessionId: "session-1", maxMessages: 0 }), {
    code: "bad-request",
  });
});

test("paginates long streamed events by whole message groups", async () => {
  const events: SessionEvent[] = [
    { type: "turn_start", seq: 0, time: 1, data: { turnIndex: 0 } },
    { type: "message_start", seq: 1, time: 2, data: { message: { role: "user" } } },
    { type: "message_end", seq: 2, time: 3, data: { message: { role: "user" } } },
    { type: "turn_start", seq: 3, time: 4, data: { turnIndex: 1 } },
    {
      type: "message_start",
      seq: 4,
      time: 5,
      data: { message: { role: "assistant" } },
    },
    ...Array.from({ length: 100 }, (_, index): SessionEvent => ({
      type: "message_update",
      seq: 5 + index,
      time: 6 + index,
      data: { delta: index },
    })),
    {
      type: "tool_execution_end",
      seq: 105,
      time: 106,
      data: { toolCallId: "tool-1" },
    },
    {
      type: "message_end",
      seq: 106,
      time: 107,
      data: { message: { role: "assistant" } },
    },
    { type: "turn_end", seq: 107, time: 108, data: { turnIndex: 1 } },
    { type: "message", seq: 108, time: 109, data: { role: "user", content: "legacy" } },
    { type: "agent_settled", seq: 109, time: 110, data: {} },
  ];
  const service = harness({ getSessionEvents: async () => events }).service;

  const page = await service.history({ sessionId: "session-1", maxMessages: 2 });
  assert.deepEqual(
    page.events.map(({ event }) => event.seq),
    Array.from({ length: 106 }, (_, index) => index + 4),
  );
  assert.equal(page.hasMore, true);
  assert.equal(page.events[0]!.event.type, "message_start");
  assert.equal(page.events.at(-1)!.event.type, "agent_settled");

  const insideStream = await service.history({
    sessionId: "session-1",
    beforeSeq: 60,
    maxMessages: 1,
  });
  assert.deepEqual(
    insideStream.events.map(({ event }) => event.seq),
    Array.from({ length: 56 }, (_, index) => index + 4),
  );
  assert.equal(insideStream.events[0]!.event.type, "message_start");
  assert.equal(insideStream.events.at(-1)!.event.seq, 59);
  assert.equal(insideStream.projections, undefined);
});

test("serves and selects session models with exact selections", async () => {
  const { service, calls } = harness();
  assert.deepEqual(await service.models({ sessionId: "session-1" }), {
    current: { provider: "openai", model: "gpt-reasoning", reasoningEffort: "medium" },
    routable: true,
    groups: modelGroups(),
    failures: [],
  });
  assert.deepEqual(
    await service.selectModel({
      sessionId: "session-1",
      provider: "openai",
      model: "gpt-reasoning",
      reasoningEffort: "low",
    }),
    {
      selected: { provider: "openai", model: "gpt-reasoning", reasoningEffort: "low" },
    },
  );
  assert.deepEqual(calls.at(-1), {
    name: "select-model",
    value: ["session-1", { provider: "openai", model: "gpt-reasoning", reasoningEffort: "low" }],
  });
  await assert.rejects(
    service.selectModel({
      sessionId: "session-1",
      provider: "openai",
      model: "missing",
    }),
    { code: "model-unavailable", details: { provider: "openai", model: "missing" } },
  );
});

test("renames, prompts, queues, and cancels supported session operations", async () => {
  const idle = harness({
    getSessionHistory: async () => history([{ role: "user", content: "hi" }]),
  });
  assert.deepEqual(await idle.service.rename({ sessionId: "session-1", title: "  New title  " }), {
    title: "New title",
    seq: 7,
  });
  assert.deepEqual(
    await idle.service.prompt(
      {
        sessionId: "session-1",
        mode: "queue",
        clientTimeZone: "US/Pacific",
        content: [
          { type: "text", text: "hello" },
          { type: "image", mediaType: "image/png", data: PNG_BASE64, name: "screen.png" },
        ],
      },
      { rpcId: "rpc-prompt" },
    ),
    { accepted: true },
  );
  assert.deepEqual(await idle.service.cancel({ sessionId: "session-1" }), { accepted: true });
  assert.deepEqual(
    idle.calls.map(({ name }) => name),
    ["rename", "submit-prompt", "cancel"],
  );
  assert.deepEqual(idle.calls[1]?.value, [
    "session-1",
    "followUp",
    {
      message: "hello",
      images: [{ type: "image", data: PNG_BASE64, mimeType: "image/png" }],
    },
    { rpcId: "rpc-prompt", clientTimeZone: "America/Los_Angeles" },
  ]);

  const running = harness({
    listSessions: async () => ({
      sessions: [summary({ running: true })],
      runningSessionIds: ["session-1"],
    }),
  });
  await running.service.prompt({
    sessionId: "session-1",
    mode: "steer",
    content: [{ type: "text", text: "adjust" }],
  });
  assert.deepEqual(running.calls.at(-1), {
    name: "submit-prompt",
    value: ["session-1", "steer", { message: "adjust" }, {}],
  });
  await assert.rejects(
    idle.service.prompt({
      sessionId: "session-1",
      mode: "queue",
      clientTimeZone: "CST",
      content: [{ type: "text", text: "hello" }],
    }),
    { code: "invalid-time-zone", details: { value: "CST" } },
  );
  await assert.rejects(
    idle.service.prompt({
      sessionId: "session-1",
      mode: "queue",
      clientTimeZone: "Mars/Olympus",
      content: [{ type: "text", text: "hello" }],
    }),
    { code: "invalid-time-zone", details: { value: "Mars/Olympus" } },
  );
});

test("strictly admits inline image base64, signatures, media types, and count", async () => {
  const { service, calls } = harness();
  const prompt = (data: string, mediaType: "image/png" | "image/jpeg" = "image/png") =>
    service.prompt({
      sessionId: "session-1",
      mode: "queue",
      content: [{ type: "image", mediaType, data }],
    });

  await assert.rejects(prompt("data:image/png;base64,iVBORw0KGgo="), {
    code: "attachment-error",
    details: { reason: "INVALID_IMAGE_BASE64" },
  });
  await assert.rejects(prompt("AAAA"), {
    code: "attachment-error",
    details: { reason: "UNRECOGNIZED_IMAGE_FORMAT" },
  });
  await assert.rejects(prompt(PNG_BASE64, "image/jpeg"), {
    code: "attachment-error",
    details: { reason: "IMAGE_MEDIA_TYPE_MISMATCH" },
  });
  await assert.rejects(
    service.prompt({
      sessionId: "session-1",
      mode: "queue",
      content: Array.from({ length: 21 }, () => ({
        type: "image" as const,
        mediaType: "image/png" as const,
        data: PNG_BASE64,
      })),
    }),
    { code: "attachment-error", details: { reason: "TOO_MANY_INLINE_IMAGES" } },
  );
  assert.equal(
    calls.some(({ name }) => name === "submit-prompt"),
    false,
  );
});

test("maps image modality admission failures to the protocol operation", async () => {
  const promptHarness = harness({
    submitPrompt: async () => {
      throw Object.assign(new Error("image unsupported"), {
        code: "pi_model_image_unsupported",
      });
    },
  });
  await assert.rejects(
    promptHarness.service.prompt({
      sessionId: "session-1",
      mode: "queue",
      content: [{ type: "image", mediaType: "image/png", data: PNG_BASE64 }],
    }),
    {
      code: "attachment-error",
      details: { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" },
    },
  );

  const selectionHarness = harness({
    selectSessionModel: async () => {
      throw Object.assign(new Error("image history incompatible"), {
        code: "pi_model_image_unsupported",
      });
    },
  });
  await assert.rejects(
    selectionHarness.service.selectModel({
      sessionId: "session-1",
      provider: "openai",
      model: "gpt-reasoning",
    }),
    {
      code: "model-unavailable",
      details: { provider: "openai", model: "gpt-reasoning" },
    },
  );
});

test("forks independently at an optional canonical sequence and inherits the workspace", async () => {
  const omitted = harness();
  assert.deepEqual(await omitted.service.fork({ sessionId: "session-1" }), {
    sessionId: "session-forked",
  });
  assert.deepEqual(omitted.calls, [
    { name: "fork", value: ["session-1", undefined] },
    { name: "attach", value: ["workspace-1", "session-forked"] },
  ]);

  const anchored = harness();
  assert.deepEqual(await anchored.service.fork({ sessionId: "session-1", atSeq: 4 }), {
    sessionId: "session-forked",
  });
  assert.deepEqual(anchored.calls[0], {
    name: "fork",
    value: ["session-1", 4],
  });
});

test("reports stable fork validation, missing, and unavailable errors", async () => {
  const { service } = harness();
  await assert.rejects(service.fork({ sessionId: "session-1", atSeq: -1 }), {
    code: "bad-request",
  });

  const unavailable = harness({
    forkSession: async () => {
      throw Object.assign(new Error("busy or unmappable"), { code: "pi_fork_unavailable" });
    },
  }).service;
  await assert.rejects(unavailable.fork({ sessionId: "session-1", atSeq: 4 }), {
    code: "fork-unavailable",
    details: { sessionId: "session-1" },
  });

  const missing = harness({
    listSessions: async () => ({ sessions: [], runningSessionIds: [] }),
  }).service;
  await assert.rejects(missing.fork({ sessionId: "missing" }), {
    code: "session-not-found",
    details: { sessionId: "missing" },
  });
});

test("reports the document-defined attachment error", async () => {
  const { service } = harness();
  await assert.rejects(
    service.attachment({ sessionId: "session-1", attachmentId: "attachment-1" }),
    (error: unknown) => {
      assert.ok(error instanceof SessionRpcServiceError);
      assert.equal(error.code, "attachment-error");
      assert.equal(typeof error.details.reason, "string");
      return true;
    },
  );
});

test("edits, removes, and steers stable queue ids and translates queue races", async () => {
  const { service, calls } = harness();
  assert.deepEqual(
    await service.updateQueue({
      sessionId: "session-1",
      itemId: "queue-1",
      action: { kind: "edit", content: [{ type: "text", text: "edited" }] },
    }),
    { accepted: true },
  );
  assert.deepEqual(calls.at(-1), {
    name: "update-queue",
    value: ["session-1", "queue-1", { kind: "edit", prompt: { message: "edited" } }],
  });
  await service.updateQueue({
    sessionId: "session-1",
    itemId: "queue-2",
    action: { kind: "remove" },
  });
  await service.updateQueue({
    sessionId: "session-1",
    itemId: "queue-3",
    action: { kind: "steer" },
  });

  await assert.rejects(
    service.updateQueue({
      sessionId: "session-1",
      itemId: "queue-image",
      action: { kind: "edit", content: [{ type: "image", data: "x" }] },
    }),
    { code: "attachment-error", details: { reason: "QUEUE_EDIT_NON_TEXT" } },
  );

  const missing = harness({
    updateQueueItem: async () => {
      throw Object.assign(new Error("gone"), { code: "pi_queue_item_not_found" });
    },
  });
  await assert.rejects(
    missing.service.updateQueue({
      sessionId: "session-1",
      itemId: "queue-missing",
      action: { kind: "remove" },
    }),
    { code: "queue-item-not-found", details: { itemId: "queue-missing" } },
  );

  const unavailable = harness({
    updateQueueItem: async () => {
      throw Object.assign(new Error("settled"), { code: "pi_steer_unavailable" });
    },
  });
  await assert.rejects(
    unavailable.service.updateQueue({
      sessionId: "session-1",
      itemId: "queue-settled",
      action: { kind: "steer" },
    }),
    { code: "steer-unavailable", details: { itemId: "queue-settled" } },
  );
});
