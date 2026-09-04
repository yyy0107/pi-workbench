import assert from "node:assert/strict";
import test from "node:test";

import { AgentExecutionError } from "@workbench/agent-runtime-server/execution";
import {
  AgentThreadStoreError,
  type AgentThreadCreateInput,
  type AgentThreadStoreCapabilities,
  type AgentThreadStorePort,
  type AgentThreadSummary,
} from "@workbench/agent-runtime-server/threads";

import { workspaceFromCwd } from "../../src/workspaces/workspace-paths";

const [sessionRpcModule, sessionHistoryModule, sessionModelContextModule] = await Promise.all([
  import(new URL("../../src/sessions/session-rpc-service.ts", import.meta.url).href) as Promise<
    typeof import("../../src/sessions/session-rpc-service")
  >,
  import(
    new URL("../../src/sessions/pi-session-history-service.ts", import.meta.url).href
  ) as Promise<typeof import("../../src/sessions/pi-session-history-service")>,
  import(
    new URL("../../src/sessions/pi-session-model-context-service.ts", import.meta.url).href
  ) as Promise<typeof import("../../src/sessions/pi-session-model-context-service")>,
]);
const { SessionRpcService, SessionRpcServiceError } = sessionRpcModule;
const { createPiSessionHistoryService } = sessionHistoryModule;
const { createPiSessionModelContextService } = sessionModelContextModule;

type PiSessionHistory = import("@workbench/agent-runtime-pi-protocol/messages").PiSessionHistory;
type ModelProviderGroup = import("@workbench/agent-runtime-pi-protocol/rpc").ModelProviderGroup;
type SessionEvent = import("@workbench/agent-runtime-pi-protocol/rpc").SessionEvent;
type WorkspaceView = import("@workbench/agent-runtime-pi-protocol/rpc").WorkspaceView;
type AgentExecutionPort = import("@workbench/agent-runtime-server/execution").AgentExecutionPort;
type PiSessionHistoryServiceDependencies =
  import("../../src/sessions/pi-session-history-service").PiSessionHistoryServiceDependencies;
type PiSessionModelContextServiceDependencies =
  import("../../src/sessions/pi-session-model-context-service").PiSessionModelContextServiceDependencies;
type SessionRpcWorkspaceStore =
  import("../../src/sessions/session-rpc-service").SessionRpcWorkspaceStore;
type SessionRpcScratchStore =
  import("../../src/sessions/session-rpc-service").SessionRpcScratchStore;

const PNG_BASE64 = "iVBORw0KGgo=";
const PDF_BASE64 = Buffer.from("%PDF-1.7\nfixture").toString("base64");

const workspace: WorkspaceView = {
  workspaceId: "workspace-1",
  path: "/workspace",
  title: "Workspace",
  sessionIds: ["session-1"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function summary(overrides: Partial<AgentThreadSummary> = {}): AgentThreadSummary {
  return {
    threadId: "session-1",
    rootPath: "/workspace",
    title: "Protocol work",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    messageCount: 2,
    firstMessage: "Design the session protocol",
    transient: false,
    running: false,
    ...overrides,
  };
}

function piSummary(thread: AgentThreadSummary) {
  return {
    id: thread.threadId,
    cwd: thread.rootPath,
    workspace: workspaceFromCwd(thread.rootPath),
    ...(thread.title === undefined ? {} : { name: thread.title }),
    created: thread.createdAt,
    modified: thread.updatedAt,
    messageCount: thread.messageCount,
    firstMessage: thread.firstMessage,
    transient: thread.transient,
    running: thread.running,
    ...(thread.waitingForUserInput === undefined
      ? {}
      : { waitingForUserInput: thread.waitingForUserInput }),
    ...(thread.runTiming === undefined ? {} : { runTiming: thread.runTiming }),
    ...(thread.automationOrigin === undefined ? {} : { automationOrigin: thread.automationOrigin }),
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
          imageInput: "unknown",
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

type ThreadStoreOverrides = Omit<Partial<AgentThreadStorePort>, "capabilities"> & {
  capabilities?: Partial<AgentThreadStoreCapabilities>;
};

type HarnessOverrides = Partial<
  PiSessionHistoryServiceDependencies & PiSessionModelContextServiceDependencies
> & {
  execution?: Partial<AgentExecutionPort>;
  scratch?: SessionRpcScratchStore;
  threads?: ThreadStoreOverrides;
};

function harness(overrides: HarnessOverrides = {}) {
  const {
    execution: executionOverrides = {},
    scratch,
    threads: threadOverrides = {},
    ...dependencyOverrides
  } = overrides;
  const { capabilities: capabilityOverrides = {}, ...threadMethodOverrides } = threadOverrides;
  let workspaces = [structuredClone(workspace)];
  const calls: Array<{ name: string; value?: unknown }> = [];
  const dependencies: PiSessionHistoryServiceDependencies &
    PiSessionModelContextServiceDependencies = {
    getSessionEventBranches: async () => ({ headLeafId: null, items: [] }),
    getSessionEvents: async () => [],
    getSessionHistory: async () => history(),
    getSessionResumeState: async () => ({}),
    getModelCatalog: async () => ({ groups: modelGroups(), failures: [] }),
    listModels: async () => ({
      models: [],
      defaultModel: { provider: "openai", modelId: "gpt-reasoning" },
    }),
    selectSessionModel: async (sessionId, selection) => {
      calls.push({ name: "select-model", value: [sessionId, selection] });
    },
    getSessionContextPolicy: async () => ({
      policy: { mode: "inherit" },
      overridden: false,
      compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
      usage: { tokens: null, percent: null },
      nearingCompaction: false,
    }),
    updateSessionContextPolicy: async (_sessionId, policy) => ({
      policy,
      overridden: policy.mode !== "inherit",
      compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
      usage: { tokens: null, percent: null },
      nearingCompaction: false,
    }),
    compactSessionContext: async () => ({
      compacted: true,
      context: {
        policy: { mode: "inherit" },
        overridden: false,
        compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
        usage: { tokens: null, percent: null },
        nearingCompaction: false,
      },
    }),
    ...dependencyOverrides,
  };
  const threads: AgentThreadStorePort = {
    capabilities: {
      requestedThreadId: false,
      preset: false,
      ...capabilityOverrides,
    },
    list: async () => [summary()],
    search: {
      listDocuments: async () => [],
    },
    create: async (input) => {
      calls.push({ name: "create", value: input });
      return { threadId: "session-created" };
    },
    delete: async ({ threadId }) => {
      calls.push({ name: "delete", value: threadId });
    },
    fork: {
      fork: async ({ threadId, atStateToken }) => {
        calls.push({ name: "fork", value: [threadId, atStateToken] });
        return { threadId: "session-forked" };
      },
    },
    rename: async ({ threadId, title }) => {
      calls.push({ name: "rename", value: [threadId, title] });
      return { stateToken: "7" };
    },
    ...threadMethodOverrides,
  };
  const execution: AgentExecutionPort = {
    regeneration: {
      regenerate: async (input) => {
        calls.push({ name: "regenerate", value: input });
      },
    },
    resume: {
      resume: async (input) => {
        calls.push({ name: "resume", value: input });
      },
    },
    branches: {
      select: async (input) => {
        calls.push({ name: "select-branch", value: input });
      },
    },
    submit: async (input) => {
      calls.push({ name: "submit-prompt", value: input });
      return { kind: "started" };
    },
    queue: {
      update: async (input) => {
        calls.push({ name: "update-queue", value: input });
      },
    },
    cancel: async (input) => {
      calls.push({ name: "cancel", value: input });
    },
    ...executionOverrides,
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
    execution,
    threads,
    history: createPiSessionHistoryService(dependencies),
    modelContext: createPiSessionModelContextService(dependencies),
    ...(scratch ? { scratch } : {}),
    defaultCwd: "/default",
  });
  return { service, calls, workspaceStore };
}

test("lists legacy summaries and searches with protocol bounds", async () => {
  const longSnippet = `${"😀".repeat(250)} needle`;
  const sessions = Array.from({ length: 21 }, (_, index) =>
    summary({
      threadId: `session-${index}`,
      title: index === 0 ? longSnippet : `needle ${index}`,
      messageCount: index === 0 ? 0 : 2,
      running: index === 1,
      waitingForUserInput: index === 0,
      ...(index === 0
        ? {
            automationOrigin: {
              version: 1,
              origin: "automation",
              automationId: "automation-1",
              automationName: "Morning briefing",
              source: "schedule",
              triggeredAt: 1_777_000_000_000,
            } as const,
          }
        : {}),
    }),
  );
  const { service } = harness({
    threads: { list: async () => sessions },
  });

  const listed = await service.list({ cursor: "reserved" });
  assert.deepEqual(
    { ...listed.items[0], projections: undefined },
    {
      sessionId: "session-0",
      updatedAt: Date.parse("2026-01-02T03:04:05.000Z"),
      running: false,
      waitingForUserInput: true,
      blank: true,
      cwd: "/workspace",
      projections: undefined,
    },
  );
  assert.deepEqual(
    listed.items[0]?.projections?.values["workbench.piSessionSummary"],
    piSummary(sessions[0]!),
  );
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

test("deletes an existing session through the session service", async () => {
  const { service, calls } = harness();

  assert.deepEqual(await service.delete({ sessionId: "session-1" }), { deleted: true });
  assert.deepEqual(calls.at(-1), { name: "delete", value: "session-1" });

  const missing = harness({
    threads: { list: async () => [] },
  });
  await assert.rejects(missing.service.delete({ sessionId: "missing" }), (error: unknown) => {
    assert.ok(error instanceof SessionRpcServiceError);
    assert.equal(error.code, "session-not-found");
    assert.deepEqual(error.details, { sessionId: "missing" });
    return true;
  });
});

test("searches complete persisted and live user/assistant text around the actual match", async () => {
  const persistedBody = `${"前".repeat(180)} Deep Hidden Needle ${"后".repeat(180)}`;
  const persisted = harness({
    threads: {
      search: {
        listDocuments: async () => [{ threadId: "session-1", text: persistedBody }],
      },
    },
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
    { name: "create", value: { rootPath: "/workspace" } },
    { name: "attach", value: ["workspace-1", "session-created"] },
  ]);

  const cwdOnly = harness();
  assert.deepEqual(await cwdOnly.service.create({ cwd: "/workspace" }), {
    sessionId: "session-created",
  });
  assert.deepEqual(cwdOnly.calls, [{ name: "create", value: { rootPath: "/workspace" } }]);

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
  const existing = summary({ threadId: "chosen", rootPath: "/workspace" });
  const adopted = harness({
    threads: {
      capabilities: { requestedThreadId: true },
      list: async () => [summary(), existing],
    },
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
    threads: {
      capabilities: { requestedThreadId: true },
      list: async () => [summary(), summary({ threadId: "alias", rootPath: "/workspace" })],
    },
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
  let createdInput: AgentThreadCreateInput | undefined;
  const concurrent = harness({
    threads: {
      capabilities: { requestedThreadId: true },
      list: async () => structuredClone(sessions),
      create: async (input) => {
        createCalls += 1;
        createdInput = input;
        await Promise.resolve();
        sessions.push(summary({ threadId: input.requestedThreadId, rootPath: input.rootPath }));
        return { threadId: input.requestedThreadId! };
      },
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
  assert.deepEqual(createdInput, {
    rootPath: "/workspace",
    requestedThreadId: "concurrent",
  });

  const registryConflict = harness({
    threads: {
      capabilities: { requestedThreadId: true },
      create: async () => {
        throw new AgentThreadStoreError("thread-id-conflict", "already allocated", {
          existingRootPath: "/other",
        });
      },
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

test("projects branch history and forwards branch mutations", async () => {
  const events = canonicalEvents(2);
  const branch = {
    headLeafId: "leaf-2",
    items: [{ leafId: "leaf-2", events: events.map((event) => ({ event })) }],
  };
  const branchHarness = harness({
    getSessionEvents: async () => events,
    getSessionEventBranches: async () => branch,
  });

  const historyValue = await branchHarness.service.history({ sessionId: "session-1" });
  assert.deepEqual(historyValue.branches, branch);
  assert.deepEqual(
    await branchHarness.service.regenerate({
      sessionId: "session-1",
      messageId: "message-1",
      requestId: "attachment-retry-1",
    }),
    { accepted: true },
  );
  assert.deepEqual(
    await branchHarness.service.selectBranch({ sessionId: "session-1", leafId: "leaf-1" }),
    { selected: true },
  );
  assert.deepEqual(branchHarness.calls.slice(-2), [
    {
      name: "regenerate",
      value: {
        threadId: "session-1",
        userMessageId: "message-1",
        requestId: "attachment-retry-1",
      },
    },
    {
      name: "select-branch",
      value: { threadId: "session-1", branchToken: "leaf-1" },
    },
  ]);
});

test("projects and resumes the active durable checkpoint", async () => {
  const checkpoint = {
    checkpointId: "checkpoint-1",
    terminalMessageId: "terminal-1",
    branchLeafId: "leaf-1",
    sourceEventSeq: 7,
    reason: "user-cancelled" as const,
    capability: "ready" as const,
    createdAt: 1_777_000_000_000,
  };
  const resumeHarness = harness({
    getSessionResumeState: async () => ({ checkpoint }),
  });

  assert.deepEqual((await resumeHarness.service.history({ sessionId: "session-1" })).resume, {
    checkpoint,
  });
  assert.deepEqual(
    await resumeHarness.service.resume({
      sessionId: "session-1",
      checkpointId: "checkpoint-1",
      expectedLeafId: "leaf-1",
    }),
    { accepted: true },
  );
  assert.deepEqual(resumeHarness.calls.at(-1), {
    name: "resume",
    value: {
      threadId: "session-1",
      checkpointId: "checkpoint-1",
      expectedStateToken: "leaf-1",
    },
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

test("reads, updates, and compacts session-scoped context policy", async () => {
  const policies: unknown[] = [];
  const { service } = harness({
    updateSessionContextPolicy: async (_sessionId, policy) => {
      policies.push(policy);
      return {
        policy,
        overridden: policy.mode !== "inherit",
        model: {
          provider: "openai",
          model: "gpt-reasoning",
          name: "GPT Reasoning",
          capacity: 200_000,
          effectiveBudget: policy.desiredContextTokens ?? 200_000,
        },
        compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
        usage: { tokens: 50_000, percent: 25 },
        nearingCompaction: false,
      };
    },
  });
  assert.equal((await service.contextPolicy({ sessionId: "session-1" })).policy.mode, "inherit");
  const updated = await service.updateContextPolicy({
    sessionId: "session-1",
    policy: { mode: "custom", desiredContextTokens: 96_000 },
  });
  assert.equal(updated.model?.effectiveBudget, 96_000);
  assert.deepEqual(policies, [{ mode: "custom", desiredContextTokens: 96_000 }]);
  assert.equal((await service.compactContext({ sessionId: "session-1" })).compacted, true);
});

test("normalizes expected manual compaction failures into stable protocol reasons", async () => {
  const cases = [
    ["Nothing to compact (session too small)", "context-too-small"],
    ["Already compacted", "already-compacted"],
    ["Compaction cancelled", "cancelled"],
  ] as const;

  for (const [message, reason] of cases) {
    const { service } = harness({
      compactSessionContext: async () => {
        throw new Error(message);
      },
    });

    await assert.rejects(service.compactContext({ sessionId: "session-1" }), {
      code: "compaction-unavailable",
      details: { sessionId: "session-1", reason },
    });
  }
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
          {
            type: "file",
            mediaType: "application/pdf",
            data: PDF_BASE64,
            name: "notes.pdf",
          },
        ],
      },
      { rpcId: "rpc-prompt" },
    ),
    { accepted: true, queued: false },
  );
  assert.deepEqual(await idle.service.cancel({ sessionId: "session-1" }), { accepted: true });
  assert.deepEqual(
    idle.calls.map(({ name }) => name),
    ["rename", "submit-prompt", "cancel"],
  );
  assert.deepEqual(idle.calls[1]?.value, {
    threadId: "session-1",
    mode: "follow-up",
    prompt: {
      text: "hello",
      attachments: [
        {
          kind: "image",
          data: PNG_BASE64,
          mediaType: "image/png",
          name: "screen.png",
        },
        {
          kind: "document",
          data: PDF_BASE64,
          mediaType: "application/pdf",
          name: "notes.pdf",
        },
      ],
    },
    provenance: { requestId: "rpc-prompt", clientTimeZone: "America/Los_Angeles" },
  });

  const running = harness({
    threads: { list: async () => [summary({ running: true })] },
  });
  await running.service.prompt({
    sessionId: "session-1",
    mode: "steer",
    content: [{ type: "text", text: "adjust" }],
  });
  assert.deepEqual(running.calls.at(-1), {
    name: "submit-prompt",
    value: {
      threadId: "session-1",
      mode: "steer",
      prompt: { text: "adjust", attachments: [] },
      provenance: {},
    },
  });
  const queued = harness({
    execution: {
      submit: async ({ provenance }) => ({
        kind: "queued",
        queueItemId: provenance?.requestId,
      }),
    },
  });
  assert.deepEqual(
    await queued.service.prompt(
      {
        sessionId: "session-1",
        mode: "queue",
        content: [{ type: "text", text: "later" }],
      },
      { rpcId: "rpc-queued" },
    ),
    { accepted: true, queued: true, queueItemId: "rpc-queued" },
  );
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

test("admits a token-only Composer transaction and forwards its structured semantics", async () => {
  const { service, calls } = harness();
  const composer = {
    version: 2 as const,
    document: [
      {
        type: "command" as const,
        id: "command:agent:plan:0",
        commandId: "plan",
        label: "Plan",
        scope: "message" as const,
        source: "agent" as const,
      },
      { type: "text" as const, text: " " },
    ],
    sourceText: ":agent-command[plan|Plan] ",
    text: "",
    context: [],
    metadata: {},
    commands: [
      {
        id: "command:agent:plan:0",
        commandId: "plan",
        label: "Plan",
        scope: "message" as const,
        source: "agent" as const,
      },
    ],
  };

  assert.deepEqual(
    await service.prompt({
      sessionId: "session-1",
      mode: "queue",
      content: [],
      composer,
    }),
    { accepted: true, queued: false },
  );
  assert.deepEqual(calls.at(-1), {
    name: "submit-prompt",
    value: {
      threadId: "session-1",
      mode: "follow-up",
      prompt: { text: "", attachments: [], composer },
      provenance: {},
    },
  });

  await assert.rejects(
    service.prompt({
      sessionId: "session-1",
      mode: "queue",
      content: [],
      composer: {
        ...composer,
        commands: [{ ...composer.commands[0]!, commandId: "different" }],
      },
    }),
    { code: "command-error" },
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

test("strictly admits PDF base64, signatures, media types, and mixed attachment count", async () => {
  const { service, calls } = harness();
  await service.prompt({
    sessionId: "session-1",
    mode: "queue",
    content: [
      { type: "file", mediaType: "application/pdf", data: PDF_BASE64, name: "invoice.pdf" },
    ],
  });
  assert.deepEqual(calls.at(-1), {
    name: "submit-prompt",
    value: {
      threadId: "session-1",
      mode: "follow-up",
      prompt: {
        text: "",
        attachments: [
          {
            kind: "document",
            mediaType: "application/pdf",
            data: PDF_BASE64,
            name: "invoice.pdf",
          },
        ],
      },
      provenance: {},
    },
  });

  await assert.rejects(
    service.prompt({
      sessionId: "session-1",
      mode: "queue",
      content: [
        {
          type: "file",
          mediaType: "application/pdf",
          data: Buffer.from("not a PDF").toString("base64"),
        },
      ],
    }),
    { code: "attachment-error", details: { reason: "UNRECOGNIZED_DOCUMENT_FORMAT" } },
  );
  await assert.rejects(
    service.prompt({
      sessionId: "session-1",
      mode: "queue",
      content: Array.from({ length: 21 }, () => ({
        type: "file" as const,
        mediaType: "application/pdf" as const,
        data: PDF_BASE64,
      })),
    }),
    { code: "attachment-error", details: { reason: "TOO_MANY_INLINE_ATTACHMENTS" } },
  );
});

test("maps image modality admission failures to the protocol operation", async () => {
  const promptHarness = harness({
    execution: {
      submit: async () => {
        throw new AgentExecutionError("image-input-unsupported", "image unsupported");
      },
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
    value: ["session-1", "4"],
  });
});

test("reports stable fork validation, missing, and unavailable errors", async () => {
  const { service } = harness();
  await assert.rejects(service.fork({ sessionId: "session-1", atSeq: -1 }), {
    code: "bad-request",
  });
  await assert.rejects(
    service.fork({ sessionId: "session-1", atSeq: Number.MAX_SAFE_INTEGER + 1 }),
    { code: "bad-request" },
  );

  const unavailable = harness({
    threads: {
      fork: {
        fork: async () => {
          throw new AgentThreadStoreError("fork-unavailable", "busy or unmappable");
        },
      },
    },
  }).service;
  await assert.rejects(unavailable.fork({ sessionId: "session-1", atSeq: 4 }), {
    code: "fork-unavailable",
    details: { sessionId: "session-1" },
  });

  const missing = harness({
    threads: { list: async () => [] },
  }).service;
  await assert.rejects(missing.fork({ sessionId: "missing" }), {
    code: "session-not-found",
    details: { sessionId: "missing" },
  });
});

test("projects missing optional Agent Runtime ports as stable unsupported capabilities", async () => {
  const { service } = harness({
    execution: {
      regeneration: undefined,
      resume: undefined,
      branches: undefined,
      queue: undefined,
    },
    threads: { search: undefined, fork: undefined },
  });

  const cases: Array<{
    capability: string;
    operation(): Promise<unknown>;
  }> = [
    { capability: "thread-search", operation: () => service.search({ query: "fixture" }) },
    {
      capability: "regeneration",
      operation: () => service.regenerate({ sessionId: "session-1", messageId: "message-1" }),
    },
    {
      capability: "resume",
      operation: () =>
        service.resume({
          sessionId: "session-1",
          checkpointId: "checkpoint-1",
          expectedLeafId: "leaf-1",
        }),
    },
    {
      capability: "branch-selection",
      operation: () => service.selectBranch({ sessionId: "session-1", leafId: "leaf-1" }),
    },
    { capability: "fork", operation: () => service.fork({ sessionId: "session-1" }) },
    {
      capability: "queue-mutation",
      operation: () =>
        service.updateQueue({
          sessionId: "session-1",
          itemId: "queue-1",
          action: { kind: "remove" },
        }),
    },
  ];

  for (const { capability, operation } of cases) {
    await assert.rejects(operation(), {
      code: "unsupported",
      details: { capability },
    });
  }
});

test("rejects a malformed mutation state token instead of treating it as a Pi event revision", async () => {
  const { service } = harness({
    threads: { rename: async () => ({ stateToken: "01" }) },
  });

  await assert.rejects(service.rename({ sessionId: "session-1", title: "Renamed" }), {
    code: "internal",
  });
});

test("creates, routes, releases, and promotes scratch sessions without catalog membership", async () => {
  const records = new Map<string, Awaited<ReturnType<SessionRpcScratchStore["create"]>>>();
  const scratchCalls: Array<{ name: string; value: unknown }> = [];
  let sequence = 0;
  const scratch: SessionRpcScratchStore = {
    get: async (sessionId) => records.get(sessionId),
    runningSessionIds: async () =>
      [...records.values()]
        .filter((record) => record.summary.running)
        .map((record) => record.summary.threadId),
    create: async (input) => {
      scratchCalls.push({ name: "create", value: input });
      const scratchId = `scratch-${++sequence}`;
      const record = {
        summary: summary({
          threadId: scratchId,
          title: undefined,
          transient: true,
        }),
        sourceSessionId: input.sourceSessionId,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        expiresAt: 1_800_000_000_000,
      };
      records.set(scratchId, record);
      return record;
    },
    release: async (sessionId) => {
      scratchCalls.push({ name: "release", value: sessionId });
      records.delete(sessionId);
    },
    promote: async (sessionId, title) => {
      scratchCalls.push({ name: "promote", value: [sessionId, title] });
      const record = records.get(sessionId)!;
      records.delete(sessionId);
      return {
        summary: summary({ threadId: "session-promoted", title }),
        sourceSessionId: record.sourceSessionId,
        ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
      };
    },
  };
  const scratchHarness = harness({ scratch });

  assert.deepEqual(
    await scratchHarness.service.scratchCreate({ sourceSessionId: "session-1", atSeq: 4 }),
    {
      sessionId: "scratch-1",
      sourceSessionId: "session-1",
      expiresAt: 1_800_000_000_000,
    },
  );
  assert.deepEqual(scratchCalls.at(-1), {
    name: "create",
    value: {
      sourceSessionId: "session-1",
      atEventRevision: 4,
      workspaceId: "workspace-1",
    },
  });
  const createdScratch = records.get("scratch-1")!;
  records.set("scratch-1", {
    ...createdScratch,
    summary: { ...createdScratch.summary, running: true },
  });
  const scratchList = await scratchHarness.service.list();
  assert.deepEqual(scratchList.runningSessionIds, ["scratch-1"]);
  assert.equal(
    scratchList.items.some((item) => item.sessionId === "scratch-1"),
    false,
  );

  await scratchHarness.service.prompt({
    sessionId: "scratch-1",
    mode: "queue",
    content: [{ type: "text", text: "Side request" }],
  });
  assert.deepEqual(scratchHarness.calls.at(-1), {
    name: "submit-prompt",
    value: {
      threadId: "scratch-1",
      mode: "follow-up",
      prompt: { text: "Side request", attachments: [] },
      provenance: {},
    },
  });

  assert.deepEqual(await scratchHarness.service.scratchRelease({ sessionId: "scratch-1" }), {
    released: true,
  });
  await assert.rejects(
    scratchHarness.service.prompt({
      sessionId: "scratch-1",
      mode: "queue",
      content: [{ type: "text", text: "Released" }],
    }),
    { code: "session-not-found" },
  );

  await scratchHarness.service.scratchCreate({ sourceSessionId: "session-1" });
  assert.deepEqual(
    await scratchHarness.service.scratchPromote({
      sessionId: "scratch-2",
      title: "Saved side chat",
    }),
    { sessionId: "session-promoted", sourceSessionId: "session-1" },
  );
  assert.deepEqual(scratchCalls.at(-1), {
    name: "promote",
    value: ["scratch-2", "Saved side chat"],
  });
  assert.deepEqual(scratchHarness.calls.at(-1), {
    name: "attach",
    value: ["workspace-1", "session-promoted"],
  });
});

test("reports the document-defined attachment error", async () => {
  const { service } = harness();
  await assert.rejects(
    service.attachment({ sessionId: "session-1", attachmentId: "attachment-1" }),
    (error: unknown) => {
      assert.ok(error instanceof SessionRpcServiceError);
      assert.equal(error.code, "attachment-error");
      assert.equal(error.details.reason, "PERSISTED_ATTACHMENT_UNAVAILABLE");
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
    value: {
      threadId: "session-1",
      itemId: "queue-1",
      mutation: { kind: "edit", text: "edited" },
    },
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
    execution: {
      queue: {
        update: async () => {
          throw new AgentExecutionError("queue-item-not-found", "gone");
        },
      },
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
    execution: {
      queue: {
        update: async () => {
          throw new AgentExecutionError("steer-unavailable", "settled");
        },
      },
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
