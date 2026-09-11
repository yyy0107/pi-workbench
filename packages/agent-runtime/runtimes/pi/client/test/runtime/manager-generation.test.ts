import assert from "node:assert/strict";
import test from "node:test";

import type { PiEvent, PiSessionSummary } from "@workbench/agent-runtime-pi-protocol/messages";
import type {
  SessionContextTraceEventSummary,
  SessionHistoryValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import type {
  HostStreamPayload,
  MuxStreamPayload,
  ServerRequest,
} from "@workbench/agent-runtime-pi-protocol/stream";
import { parsePiContextTraceData } from "../../src/context-trace/data-part";
import type {
  PiComposerMessage as AppendMessage,
  PiConversationMessage as ThreadMessage,
  PiConversationMessageRepository,
} from "../../src/conversation/pi-conversation-message";
import { PiSessionManager } from "../../src/runtime/manager";

function summary(overrides: Partial<PiSessionSummary> = {}): PiSessionSummary {
  return {
    id: "remote-session",
    cwd: "/workspace",
    workspace: { id: "workspace-1", name: "Workspace", cwd: "/workspace" },
    created: "2026-08-20T00:00:00.000Z",
    modified: "2026-08-20T00:00:01.000Z",
    messageCount: 1,
    firstMessage: "Realtime title",
    transient: false,
    running: false,
    ...overrides,
  };
}

function repositoryMessages(
  repository: PiConversationMessageRepository,
  headId: string | null = repository.headId,
): ThreadMessage[] {
  const byId = new Map(repository.messages.map((item) => [item.message.id, item]));
  const path: ThreadMessage[] = [];
  const seen = new Set<string>();
  let id = headId;
  while (id) {
    if (seen.has(id)) throw new Error(`cyclic message repository at ${id}`);
    seen.add(id);
    const item = byId.get(id);
    if (!item) throw new Error(`missing message repository node ${id}`);
    path.unshift(item.message);
    id = item.parentId;
  }
  return path;
}

function promptCompositionEvent(
  traceId: string,
  seq: number,
  roundId: string,
  activeTools = ["read"],
): SessionContextTraceEventSummary {
  return {
    schemaVersion: 1,
    traceId,
    sessionId: "session-live-parts",
    activationId: "activation-live-parts",
    seq,
    time: seq,
    kind: "prompt-composition",
    detailBytes: 48,
    truncated: false,
    redacted: false,
    roundId,
    promptInjections: ["system-prompt", "tools", "extensions"],
    promptResources: {
      cwd: "/workspace",
      systemPromptCharacters: 12,
      systemPromptSourceCount: 1,
      systemPromptSources: [{ kind: "builtin", scope: "builtin" }],
      contextFileCount: 0,
      contextFiles: [],
      skills: [],
      extensions: [{ name: "audit", hidden: false }],
      tools: { active: activeTools, total: activeTools.length },
    },
  };
}

test("does not duplicate the unary metadata baseline for the first socket generation", async (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const internals = manager as unknown as {
    handleGenerationReady(generation: number): void;
    requestRealtimeRefresh(): void;
  };
  let refreshCount = 0;
  internals.requestRealtimeRefresh = () => {
    refreshCount += 1;
  };

  internals.handleGenerationReady(1);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(refreshCount, 0);
});

test("keeps Composer delivery modes out of model request configuration", async (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session");
  const deliveries: Array<{ mode: string; runConfig: unknown }> = [];
  const internals = session as unknown as {
    send(message: AppendMessage): Promise<void>;
    messageQueue: { enqueue(mode: string, message: AppendMessage): Promise<void> };
  };
  internals.send = async (message) => {
    deliveries.push({ mode: "send", runConfig: message.runConfig });
  };
  internals.messageQueue.enqueue = async (mode, message) => {
    deliveries.push({ mode, runConfig: message.runConfig });
  };

  for (const deliveryMode of ["send", "queue", "steer"] as const) {
    for (const requestMode of [undefined, "plan"] as const) {
      const submission = {
        version: 2 as const,
        document: [{ type: "text" as const, text: "Explain this" }],
        sourceText: "Explain this",
        text: "Explain this",
        ...(requestMode === undefined ? {} : { mode: requestMode }),
        context: [],
        metadata: {},
        commands: [],
      };
      const action = session.actions[deliveryMode];
      assert.ok(action);
      await action(submission);

      assert.deepEqual(deliveries.pop(), {
        mode: deliveryMode === "queue" ? "followUp" : deliveryMode,
        runConfig: { custom: { workbenchComposer: submission } },
      });
      assert.equal(session.snapshot.getSnapshot().composer.mode, deliveryMode);
    }
  }
});

test("restores the submitted draft alongside typing added while a send is pending", async (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session");
  let rejectSend: ((error: Error) => void) | undefined;
  (session as unknown as { send(message: AppendMessage): Promise<void> }).send = () =>
    new Promise((_, reject) => {
      rejectSend = reject;
    });
  const submission = {
    version: 2 as const,
    document: [],
    sourceText: "original draft",
    text: "original draft",
    context: [],
    metadata: {},
    commands: [],
  };

  session.actions.setComposerText?.("original draft");
  await session.actions.addComposerAttachment?.({
    key: "original.png",
    name: "original.png",
    source: "data:image/png;base64,original",
    mediaType: "image/png",
  });
  const task = session.actions.send?.(submission);
  assert.ok(task);
  assert.equal(session.snapshot.getSnapshot().composer.phase, "submitting");
  assert.equal(session.snapshot.getSnapshot().composer.text, "");

  session.actions.setComposerText?.("typed while pending");
  await session.actions.addComposerAttachment?.({
    key: "pending.pdf",
    name: "pending.pdf",
    source: "data:application/pdf;base64,pending",
    mediaType: "application/pdf",
  });
  rejectSend?.(new Error("network unavailable"));
  await assert.rejects(task, /network unavailable/);

  const composer = session.snapshot.getSnapshot().composer;
  assert.equal(composer.phase, "error");
  assert.equal(composer.error?.code, "composer-submit-failed");
  assert.equal(composer.text, "original draft\n\ntyped while pending");
  assert.deepEqual(
    composer.attachments.map(({ key }) => key),
    ["original.png", "pending.pdf"],
  );
});

test("publishes the current Pi version from the host description", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string };
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: {
          version: "0.1.0",
          piVersion: "0.84.2",
          cwd: "/workspace",
          userPackageDir: "/home/example/.pi/agent/npm",
          attachedSessions: 0,
          canOpenPath: false,
        },
      },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const internals = manager as unknown as { refreshHostDescription(): Promise<void> };

  await internals.refreshHostDescription();

  assert.equal(manager.getHostDescription()?.piVersion, "0.84.2");
  assert.equal(manager.getHostDescription()?.userPackageDir, "/home/example/.pi/agent/npm");
});

test("regenerates from the existing user node without appending a duplicate user message", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requests: Array<{ method: string; payload: unknown }> = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: unknown;
    };
    requests.push({ method: request.method, payload: request.payload });
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: { accepted: true } },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("remote-session", "remote-session");
  const user: ThreadMessage = {
    id: "journal-user-1",
    role: "user",
    content: [{ type: "text", text: "Explain branches" }],
    attachments: [],
    createdAt: new Date(1_000),
    metadata: { custom: { piEventSeq: 2 } },
  };
  const assistant: ThreadMessage = {
    id: "journal-assistant-1",
    role: "assistant",
    content: [{ type: "text", text: "First answer", status: { type: "complete" } }],
    status: { type: "complete", reason: "stop" },
    createdAt: new Date(2_000),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  };
  const internals = session as unknown as {
    baseMessages: ThreadMessage[];
    baseMessageRepository: {
      headId: string | null;
      messages: Array<{ message: ThreadMessage; parentId: string | null }>;
    };
    snapshotValue: ReturnType<typeof session.getSnapshot>;
  };
  internals.baseMessages = [user, assistant];
  internals.baseMessageRepository = {
    headId: assistant.id,
    messages: [
      { message: user, parentId: null },
      { message: assistant, parentId: user.id },
    ],
  };
  internals.snapshotValue = {
    ...internals.snapshotValue,
    messages: [user, assistant],
    messageRepository: internals.baseMessageRepository,
    isLoading: false,
  };
  const connectionInternals = manager.connections as unknown as {
    ensureSessionEvents(): Promise<void>;
  };
  connectionInternals.ensureSessionEvents = async () => undefined;

  await session.retry(user.id, undefined);

  assert.deepEqual(requests, [
    {
      method: "session.regenerate",
      payload: { sessionId: "remote-session", messageId: "journal-user-1" },
    },
  ]);
  assert.equal(
    session.getSnapshot().messages.filter((message) => message.role === "user").length,
    1,
  );
  assert.equal(
    session.getSnapshot().messageRepository.headId,
    session.getSnapshot().messages[1]?.id,
  );
});

test("retries a cancelled attachment Composer marker with a fresh correlation id", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requests: Array<{ method: string; payload: unknown }> = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: unknown;
    };
    requests.push({ method: request.method, payload: request.payload });
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: { accepted: true } },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("remote-session", "remote-session");
  const user: ThreadMessage = {
    id: "optimistic-composer-user",
    role: "user",
    content: [
      { type: "text", text: "Read this image" },
      { type: "image", image: "data:image/png;base64,aW1hZ2U=" },
    ],
    attachments: [],
    createdAt: new Date(1_000),
    metadata: {
      custom: {
        piEntryId: "composer-marker-1",
        workbenchAttachmentRecognition: {
          version: 1,
          operationId: "cancelled-operation",
          submissionId: "cancelled-submission",
          rpcId: "original-prompt-rpc",
          revision: 2,
          status: "cancelled",
          method: "ocr",
          providerId: "paddleocr",
          attachmentCount: 1,
          completedCount: 0,
          timestamps: { createdAt: 1_000, updatedAt: 1_100, completedAt: 1_100 },
        },
        workbenchComposerSubmission: {
          version: 2,
          document: [{ type: "text", text: "Read this image" }],
          sourceText: "Read this image",
          text: "Read this image",
          context: [],
          metadata: {},
          commands: [],
        },
      },
    },
  };
  const cancelledAssistant: ThreadMessage = {
    id: "cancelled-assistant",
    role: "assistant",
    content: [],
    status: { type: "incomplete", reason: "cancelled" },
    createdAt: new Date(1_100),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  };
  const internals = session as unknown as {
    baseMessages: ThreadMessage[];
    baseMessageRepository: {
      headId: string | null;
      messages: Array<{ message: ThreadMessage; parentId: string | null }>;
    };
    snapshotValue: ReturnType<typeof session.getSnapshot>;
  };
  internals.baseMessages = [user, cancelledAssistant];
  internals.baseMessageRepository = {
    headId: cancelledAssistant.id,
    messages: [
      { message: user, parentId: null },
      { message: cancelledAssistant, parentId: user.id },
    ],
  };
  internals.snapshotValue = {
    ...internals.snapshotValue,
    messages: [user, cancelledAssistant],
    messageRepository: internals.baseMessageRepository,
    isLoading: false,
  };
  const connectionInternals = manager.connections as unknown as {
    ensureSessionEvents(): Promise<void>;
  };
  connectionInternals.ensureSessionEvents = async () => undefined;

  await session.retry(user.id, undefined);

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "session.regenerate");
  const payload = requests[0]?.payload as
    | { sessionId?: string; messageId?: string; requestId?: string }
    | undefined;
  assert.equal(payload?.sessionId, "remote-session");
  assert.equal(payload?.messageId, "composer-marker-1");
  assert.equal(typeof payload?.requestId, "string");
  assert.notEqual(payload?.requestId, "original-prompt-rpc");
  const activeAssistant = session.getSnapshot().messages.at(-1);
  assert.equal(activeAssistant?.role, "assistant");
  assert.equal(activeAssistant?.metadata.custom.workbenchPromptRpcId, payload?.requestId);
});

test("continues a matching checkpoint without regenerating or truncating messages", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requests: Array<{ method: string; payload: unknown }> = [];
  let finishCancel!: () => void;
  const cancelResponse = new Promise<void>((resolve) => {
    finishCancel = resolve;
  });
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: unknown;
    };
    requests.push({ method: request.method, payload: request.payload });
    if (request.method === "session.cancel") await cancelResponse;
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: { accepted: true } },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const managerInternals = manager as unknown as {
    setSummary(value: PiSessionSummary): void;
    handleHostFrame(payload: HostStreamPayload, generation: number): void;
    handleMuxFrame(frame: ServerRequest<MuxStreamPayload>, generation: number): void;
    applyRunningSnapshot(sessionIds: string[], authoritativeBaseline?: boolean): void;
    refreshMetadata(): Promise<void>;
  };
  managerInternals.setSummary(summary());
  managerInternals.refreshMetadata = async () => {};
  const session = manager.getSession("remote-session", "remote-session");
  const internals = session as unknown as {
    snapshotValue: ReturnType<typeof session.getSnapshot>;
    handleEvent(event: PiEvent): void;
    reload(): Promise<void>;
  };
  internals.reload = async () => {};
  const messages = internals.snapshotValue.messages;
  internals.snapshotValue = {
    ...internals.snapshotValue,
    isLoading: false,
    resumeCheckpoint: {
      checkpointId: "checkpoint-1",
      terminalMessageId: "assistant-1",
      branchLeafId: "leaf-1",
      sourceEventSeq: 8,
      reason: "user-cancelled",
      capability: "ready",
      createdAt: 1_777_000_000_000,
    },
  };
  const connectionInternals = manager.connections as unknown as {
    ensureSessionEvents(): Promise<void>;
  };
  connectionInternals.ensureSessionEvents = async () => undefined;

  internals.handleEvent({ type: "agent_start", sequence: 6 });
  assert.equal(manager.isRunning("remote-session"), true);
  const cancelling = session.cancel();
  assert.equal(manager.getThreadStateSnapshot("remote-session").metadata.running, false);
  managerInternals.handleHostFrame(
    { type: "host/session-status", sessionId: "remote-session", running: true },
    1,
  );
  assert.equal(manager.isRunning("remote-session"), false);
  internals.handleEvent({ type: "agent_settled", sequence: 8 });
  finishCancel();
  await cancelling;
  managerInternals.handleHostFrame(
    {
      type: "host/session-changed",
      sessionId: "remote-session",
      summary: summary({ running: true }),
    },
    1,
  );
  assert.equal(manager.isRunning("remote-session"), false);
  assert.equal(session.getSnapshot().isRunning, false);

  await session.resume("checkpoint-1", "leaf-1");
  const resumedTiming = session.getSnapshot().runTiming;
  assert.ok(resumedTiming);
  assert.equal(resumedTiming.elapsedMs, 0);

  assert.deepEqual(requests, [
    { method: "session.cancel", payload: { sessionId: "remote-session" } },
    {
      method: "session.resume",
      payload: {
        sessionId: "remote-session",
        checkpointId: "checkpoint-1",
        expectedLeafId: "leaf-1",
      },
    },
  ]);
  assert.deepEqual(session.getSnapshot().messages, messages);
  assert.equal(session.getSnapshot().isRunning, true);

  const assertRunning = () => {
    assert.equal(session.getSnapshot().isRunning, true);
    assert.equal(session.getSnapshot().runTiming?.startedAt, resumedTiming.startedAt);
    assert.equal(manager.isRunning("remote-session"), true);
    assert.equal(manager.getThreadStateSnapshot("remote-session").metadata.running, true);
    assert.equal(manager.getThreadCustom("remote-session")?.piRunning, true);
    assert.equal(manager.getThreadStateSnapshot("remote-session").metadata.completed, false);
  };
  // A stop-time metadata baseline can arrive while resume is still awaiting agent_start.
  managerInternals.applyRunningSnapshot([], true);
  assertRunning();
  internals.handleEvent({ type: "agent_start", sequence: 9 });
  managerInternals.handleHostFrame(
    { type: "host/session-status", sessionId: "remote-session", running: false },
    1,
  );
  assertRunning();
  for (const type of ["host/session-added", "host/session-changed"] as const) {
    managerInternals.handleHostFrame(
      { type, sessionId: "remote-session", blank: false, summary: summary() },
      1,
    );
    assertRunning();
  }
  managerInternals.handleMuxFrame(
    {
      type: "server-request",
      rpcId: "stopped-prompt",
      method: "session/prompt-accepted",
      payload: {
        type: "session/prompt-accepted",
        sessionId: "remote-session",
        mode: "queue",
        running: false,
      },
    },
    1,
  );
  assertRunning();
  internals.handleEvent({
    type: "turn_start",
    runTiming: { startedAt: 1_000, elapsedMs: 500 },
  });
  assert.equal(session.getSnapshot().runTiming?.startedAt, 1_000);
  assert.equal(session.getSnapshot().runTiming?.elapsedMs, 500);
  internals.handleEvent({ type: "agent_settled", sequence: 10 });
  assert.equal(session.getSnapshot().isRunning, false);
  assert.equal(session.getSnapshot().runTiming, undefined);
  assert.equal(manager.getThreadStateSnapshot("remote-session").metadata.running, false);
});

test("restores the running indicator when stopping fails", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    throw new Error("cancel failed");
  };
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("remote-session", "remote-session");
  const internals = session as unknown as { handleEvent(event: PiEvent): void };
  internals.handleEvent({ type: "agent_start" });

  const cancelling = session.cancel();
  assert.equal(manager.isRunning("remote-session"), false);
  await assert.rejects(cancelling);
  assert.equal(session.isStopRequested, false);
  assert.equal(session.getSnapshot().isRunning, true);
  assert.equal(manager.isRunning("remote-session"), true);
});

test("reloads and repairs a missing checkpoint before continuing an existing stopped card", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const methods: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
    methods.push(request.method);
    const value =
      request.method === "session.history"
        ? {
            events: [],
            hasMore: false,
            resume: {
              checkpoint: {
                checkpointId: "checkpoint-repaired",
                terminalMessageId: "assistant-stopped",
                branchLeafId: "leaf-repaired",
                sourceEventSeq: 12,
                reason: "user-cancelled",
                capability: "ready",
                createdAt: 1_777_000_000_000,
              },
            },
          }
        : { accepted: true };
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("remote-session", "remote-session");
  const connectionInternals = manager.connections as unknown as {
    ensureSessionEvents(): Promise<void>;
  };
  connectionInternals.ensureSessionEvents = async () => undefined;

  await session.resumeLatest("assistant-stopped");

  assert.deepEqual(methods, ["session.history", "session.resume"]);
  assert.equal(session.getSnapshot().isRunning, true);
});

test("continues a checkpoint from the coalesced visible assistant id", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requests: Array<{ method: string; payload: unknown }> = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: unknown;
    };
    requests.push({ method: request.method, payload: request.payload });
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: { accepted: true } },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("remote-session", "remote-session");
  const visibleAssistant = {
    id: "visible-assistant-turn",
    role: "assistant",
    content: [{ type: "text", text: "Stopped", status: { type: "complete" } }],
    status: { type: "incomplete", reason: "cancelled" },
    createdAt: new Date(2_000),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: { piEventSeq: 12 },
    },
  } satisfies ThreadMessage;
  const internals = session as unknown as {
    snapshotValue: ReturnType<typeof session.getSnapshot>;
  };
  internals.snapshotValue = {
    ...internals.snapshotValue,
    messages: [visibleAssistant],
    resumeCheckpoint: {
      checkpointId: "checkpoint-1",
      terminalMessageId: "terminal-message-end-entry",
      branchLeafId: "leaf-1",
      sourceEventSeq: 12,
      reason: "user-cancelled",
      capability: "ready",
      createdAt: 1_777_000_000_000,
    },
  };
  const connectionInternals = manager.connections as unknown as {
    ensureSessionEvents(): Promise<void>;
  };
  connectionInternals.ensureSessionEvents = async () => undefined;

  await session.resumeLatest(visibleAssistant.id);

  assert.deepEqual(requests, [
    {
      method: "session.resume",
      payload: {
        sessionId: "remote-session",
        checkpointId: "checkpoint-1",
        expectedLeafId: "leaf-1",
      },
    },
  ]);
  assert.equal(session.getSnapshot().isRunning, true);
});

test("retains a live-only user as the parent when regenerating before history reloads", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: { messageId: string };
    };
    assert.equal(request.method, "session.regenerate");
    assert.equal(request.payload.messageId, "journal-live-user");
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: { accepted: true } },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("remote-session", "remote-session");
  const user: ThreadMessage = {
    id: "live-user",
    role: "user",
    content: [{ type: "text", text: "Retry this answer" }],
    attachments: [],
    createdAt: new Date(1_000),
    metadata: {
      custom: { piOptimistic: true },
      isOptimistic: true,
    },
  };
  const completedAssistant: ThreadMessage = {
    id: "live-assistant",
    role: "assistant",
    content: [{ type: "text", text: "First answer", status: { type: "complete" } }],
    status: { type: "complete", reason: "stop" },
    createdAt: new Date(2_000),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  };
  const internals = session as unknown as {
    handleEvent(event: PiEvent): void;
    liveMessages: ThreadMessage[];
    publishMessages(): void;
  };
  internals.liveMessages = [user, completedAssistant];
  internals.handleEvent({
    type: "message_end",
    entryId: "journal-live-user",
    sequence: 4,
    message: { role: "user", content: "Retry this answer", timestamp: 1_000 },
  });
  const connectionInternals = manager.connections as unknown as {
    ensureSessionEvents(): Promise<void>;
  };
  connectionInternals.ensureSessionEvents = async () => undefined;

  await session.retry(user.id, undefined);

  const snapshot = session.getSnapshot();
  const byId = new Map(snapshot.messageRepository.messages.map((item) => [item.message.id, item]));
  assert.equal(byId.get(user.id)?.parentId, null);
  assert.equal(byId.get(completedAssistant.id)?.parentId, user.id);
  assert.equal(byId.get(snapshot.messageRepository.headId ?? "")?.parentId, user.id);

  assert.deepEqual(
    repositoryMessages(snapshot.messageRepository).map((message) => [message.id, message.role]),
    [
      [user.id, "user"],
      [snapshot.messageRepository.headId, "assistant"],
    ],
  );
});

test("coalesces internal assistant cycles in the active message repository", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("remote-session", "remote-session");
  const user: ThreadMessage = {
    id: "user",
    role: "user",
    content: [{ type: "text", text: "Crawl the site" }],
    attachments: [],
    createdAt: new Date(1_000),
    metadata: { custom: {} },
  };
  const firstCycle: ThreadMessage = {
    id: "assistant-cycle-1",
    role: "assistant",
    content: [{ type: "text", text: "Intermediate tool turn", status: { type: "complete" } }],
    status: { type: "complete", reason: "stop" },
    createdAt: new Date(2_000),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  };
  const finalCycle: ThreadMessage = {
    id: "assistant-cycle-2",
    role: "assistant",
    content: [{ type: "text", text: "Final answer", status: { type: "running" } }],
    status: { type: "running" },
    createdAt: new Date(3_000),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  };
  const internals = session as unknown as {
    liveMessages: ThreadMessage[];
    publishMessagesAndSetRunning(running: boolean): void;
  };
  internals.liveMessages = [user, firstCycle, finalCycle];
  internals.publishMessagesAndSetRunning(true);

  const snapshot = session.getSnapshot();
  const activeMessages = repositoryMessages(snapshot.messageRepository);

  assert.equal(snapshot.isRunning, true);
  assert.deepEqual(
    activeMessages.map((message) => [message.id, message.role]),
    [
      [user.id, "user"],
      [firstCycle.id, "assistant"],
    ],
  );
  const assistant = activeMessages.at(-1);
  assert.equal(assistant?.status?.type, "running");
  assert.deepEqual(
    assistant?.content.map((part) => (part.type === "text" ? part.text : part.type)),
    ["Intermediate tool turn", "Final answer"],
  );

  internals.liveMessages = [
    user,
    firstCycle,
    {
      ...finalCycle,
      content: [{ type: "text", text: "Final answer", status: { type: "complete" } }],
      status: { type: "complete", reason: "stop" },
    },
  ];
  internals.publishMessagesAndSetRunning(false);

  const completedSnapshot = session.getSnapshot();
  const completedMessages = repositoryMessages(completedSnapshot.messageRepository);
  assert.equal(completedSnapshot.isRunning, false);
  assert.equal(completedMessages.length, 2);
  assert.equal(completedMessages.at(-1)?.status?.type, "complete");
});

test("keeps settled history identities stable across streamed tail updates", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("remote-session", "remote-session");
  const firstUser: ThreadMessage = {
    id: "stable-user-1",
    role: "user",
    content: [{ type: "text", text: "First turn" }],
    attachments: [],
    createdAt: new Date(1_000),
    metadata: { custom: {} },
  };
  const settledAssistant: ThreadMessage = {
    id: "stable-assistant-1",
    role: "assistant",
    content: [{ type: "text", text: "Settled answer", status: { type: "complete" } }],
    status: { type: "complete", reason: "stop" },
    createdAt: new Date(2_000),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  };
  const activeUser: ThreadMessage = {
    ...firstUser,
    id: "stable-user-2",
    content: [{ type: "text", text: "Second turn" }],
    createdAt: new Date(3_000),
  };
  const streamingAssistant: ThreadMessage = {
    ...settledAssistant,
    id: "streaming-assistant",
    content: [{ type: "text", text: "Partial", status: { type: "running" } }],
    status: { type: "running" },
    createdAt: new Date(4_000),
  };
  const internals = session as unknown as {
    baseMessages: ThreadMessage[];
    baseMessageRepository: ReturnType<typeof session.getSnapshot>["messageRepository"];
    liveMessages: ThreadMessage[];
    streamingMessage?: ThreadMessage;
    publishMessages(): void;
  };

  internals.liveMessages = [firstUser, settledAssistant, activeUser];
  internals.publishMessages();
  const settled = session.getSnapshot();
  internals.baseMessages = [...settled.messages];
  internals.baseMessageRepository = settled.messageRepository;
  internals.liveMessages = [];
  internals.streamingMessage = streamingAssistant;

  internals.publishMessages();
  const firstFrame = session.getSnapshot();
  internals.streamingMessage = {
    ...streamingAssistant,
    content: [{ type: "text", text: "Partial answer", status: { type: "running" } }],
  };
  internals.publishMessages();
  const secondFrame = session.getSnapshot();

  assert.equal(secondFrame.messages[0], firstFrame.messages[0]);
  assert.equal(secondFrame.messages[1], firstFrame.messages[1]);
  assert.equal(
    secondFrame.messageRepository.messages.find(
      ({ message }) => message.id === settledAssistant.id,
    ),
    firstFrame.messageRepository.messages.find(({ message }) => message.id === settledAssistant.id),
  );
  assert.notEqual(secondFrame.messages.at(-1), firstFrame.messages.at(-1));
  const streamedPart = secondFrame.messages.at(-1)?.content[0];
  assert.equal(streamedPart?.type === "text" ? streamedPart.text : undefined, "Partial answer");

  internals.streamingMessage = undefined;
  internals.publishMessages();
  assert.equal(session.getSnapshot().messageRepository, settled.messageRepository);
});

test("keeps regenerated answer numbering stable across branch switches and reloads", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("remote-session", "remote-session");
  const userEvent = {
    event: {
      type: "message_end",
      seq: 0,
      time: 1_000,
      entryId: "journal-user-1",
      data: { message: { role: "user", content: "Explain branches", timestamp: 1_000 } },
    },
  };
  const assistantEvent = (entryId: string, text: string, time: number) => ({
    event: {
      type: "message_end",
      seq: 1,
      time,
      entryId,
      data: {
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
          timestamp: time,
        },
      },
    },
  });
  const branches = [
    {
      leafId: "leaf-1",
      events: [userEvent, assistantEvent("journal-assistant-1", "First", 2_000)],
    },
    {
      leafId: "leaf-2",
      events: [userEvent, assistantEvent("journal-assistant-2", "Second", 3_000)],
    },
  ];
  let activeBranch = branches[1]!;
  let deferSelection = false;
  const pendingSelections: Array<() => void> = [];
  const selectedLeaves: string[] = [];
  let historyLoads = 0;
  let historyGate: Promise<void> | undefined;
  let rejectSelection = false;
  let rejectHistory = false;
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: { leafId?: string };
    };
    if (request.method === "session.selectBranch") {
      const selected = branches.find(({ leafId }) => leafId === request.payload.leafId);
      assert.ok(selected);
      selectedLeaves.push(selected.leafId);
      if (deferSelection) await new Promise<void>((resolve) => pendingSelections.push(resolve));
      if (rejectSelection) throw new Error("branch selection rejected");
      activeBranch = selected;
      return Response.json({
        type: "server-response",
        rpcId: request.rpcId,
        result: { ok: true, value: { selected: true } },
      });
    }
    assert.equal(request.method, "session.history");
    historyLoads += 1;
    if (rejectHistory) throw new Error("history unavailable");
    const response = Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: {
          events: activeBranch.events,
          hasMore: false,
          branches: {
            headLeafId: activeBranch.leafId,
            // The server returns the active branch first, regardless of creation order.
            items: [activeBranch, ...branches.filter((branch) => branch !== activeBranch)],
          },
        },
      },
    });
    await historyGate;
    return response;
  };

  await session.reload();
  const repository = session.getSnapshot().messageRepository;
  const byId = new Map(repository.messages.map((item) => [item.message.id, item]));
  assert.equal(byId.get("journal-assistant-1")?.parentId, "journal-user-1");
  assert.equal(byId.get("journal-assistant-2")?.parentId, "journal-user-1");
  assert.equal(repository.headId, "journal-assistant-2");

  for (const time of [3_000, 2_000]) {
    // Equal timestamps must also retain a deterministic order.
    branches[1]!.events[1] = assistantEvent("journal-assistant-2", "Second", time);
    await session.reload();
    const second = session.node("journal-assistant-2").getSnapshot();
    assert.deepEqual(second?.presentation?.branch, {
      index: 1,
      count: 2,
      previousKey: "journal-assistant-1",
    });
    assert.ok(session.actions.selectBranch);
    const previousSelection = session.actions.selectBranch(second.presentation.branch.previousKey!);
    const previousHead = session.getSnapshot().messageRepository.headId;
    const first = session.node("journal-assistant-1").getSnapshot();
    await previousSelection;
    assert.equal(previousHead, "journal-assistant-1");
    assert.deepEqual(first?.presentation?.branch, {
      index: 0,
      count: 2,
      nextKey: "journal-assistant-2",
    });
    const nextSelection = session.actions.selectBranch(first.presentation.branch.nextKey!);
    const nextHead = session.getSnapshot().messageRepository.headId;
    const nextBranch = session.node("journal-assistant-2").getSnapshot()?.presentation?.branch;
    await nextSelection;
    assert.equal(nextHead, "journal-assistant-2");
    assert.deepEqual(nextBranch, second.presentation.branch);
  }

  // An in-flight switch cannot overwrite a newer preview; queued intermediate clicks are skipped.
  deferSelection = true;
  selectedLeaves.length = 0;
  const loadsBeforeSwitches = historyLoads;
  const firstSelection = session.selectBranch("journal-assistant-1");
  await new Promise<void>((resolve) => setImmediate(resolve));
  const intermediateSelection = session.selectBranch("journal-assistant-2");
  const anotherIntermediateSelection = session.selectBranch("journal-assistant-1");
  const latestSelection = session.selectBranch("journal-assistant-2");
  try {
    assert.equal(session.getSnapshot().messageRepository.headId, "journal-assistant-2");
    assert.deepEqual(selectedLeaves, ["leaf-1"]);
    pendingSelections.shift()?.();
    await firstSelection;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(historyLoads, loadsBeforeSwitches);
    assert.equal(session.getSnapshot().messageRepository.headId, "journal-assistant-2");
    assert.deepEqual(selectedLeaves, ["leaf-1", "leaf-2"]);
  } finally {
    deferSelection = false;
    pendingSelections.splice(0).forEach((resolve) => resolve());
    await Promise.allSettled([
      firstSelection,
      intermediateSelection,
      anotherIntermediateSelection,
      latestSelection,
    ]);
  }
  assert.equal(historyLoads, loadsBeforeSwitches + 1);
  assert.equal(activeBranch.leafId, "leaf-2");
  assert.equal(session.getSnapshot().messageRepository.headId, "journal-assistant-2");
  await session.selectBranch("journal-assistant-1");

  // A refresh already in flight still contains the old branch and must not win the switch.
  let releaseHistory!: () => void;
  historyGate = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  const staleReload = session.reload();
  const selectionDuringReload = session.selectBranch("journal-assistant-2");
  await new Promise<void>((resolve) => setImmediate(resolve));
  const previewDuringReload = session.getSnapshot();
  releaseHistory();
  await Promise.all([staleReload, selectionDuringReload]);
  assert.equal(previewDuringReload.messageRepository.headId, "journal-assistant-2");
  assert.equal(session.getSnapshot().messageRepository.headId, "journal-assistant-2");

  // A rejected switch restores the last authoritative reply, even if history is also offline.
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    rejectSelection = true;
    for (const offline of [false, true]) {
      rejectHistory = offline;
      const rejectedSelection = session.selectBranch("journal-assistant-1");
      const preview = session.getSnapshot();
      await assert.rejects(rejectedSelection, /branch selection rejected/);
      assert.equal(preview.messageRepository.headId, "journal-assistant-1");
      assert.equal(session.getSnapshot().messageRepository.headId, "journal-assistant-2");
      assert.equal(
        session.node("journal-assistant-2").getSnapshot()?.presentation?.branch?.index,
        1,
      );
    }
  } finally {
    console.error = originalConsoleError;
  }
});

test("collapses legacy duplicate Composer users into answer branches", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("remote-session", "remote-session");
  const composer: SessionHistoryValue["events"][number] = {
    event: {
      type: "message",
      seq: 0,
      time: 1_000,
      entryId: "composer-user",
      data: {
        role: "custom",
        customType: "workbench.composer-user.v3",
        content: "",
        display: false,
        details: {
          version: 3,
          submissionId: "image-submission",
          sourceText: "Describe this image",
          text: "Describe this image",
          document: [{ type: "text", text: "Describe this image" }],
          commands: [],
          composer: {
            version: 2,
            document: [{ type: "text", text: "Describe this image" }],
            sourceText: "Describe this image",
            text: "Describe this image",
            context: [],
            metadata: {},
            commands: [],
          },
          attachments: [{ data: "aW1hZ2U=", mimeType: "image/png" }],
          status: "accepted",
        },
        timestamp: 1_000,
      },
    },
  };
  const failure: SessionHistoryValue["events"][number] = {
    event: {
      type: "message",
      seq: 1,
      time: 2_000,
      entryId: "attachment-failure",
      data: {
        role: "custom",
        customType: "workbench.prompt-failure.v1",
        content: "",
        display: false,
        details: {
          version: 1,
          submissionId: "image-submission",
          code: "image-input-unsupported",
          userEntryId: "composer-user",
        },
        timestamp: 2_000,
      },
    },
  };
  const retriedComposer = structuredClone(composer);
  retriedComposer.event.entryId = "composer-retry-user";
  (retriedComposer.event.data as { details: { submissionId: string } }).details.submissionId =
    "image-retry-submission";
  const resolvedUser: SessionHistoryValue["events"][number] = {
    event: {
      type: "message",
      seq: 1,
      time: 3_000,
      entryId: "resolved-user",
      data: {
        role: "user",
        content: [
          { type: "text", text: "compiled prompt" },
          { type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
        ],
        timestamp: 3_000,
        workbenchComposer: {
          version: 2,
          submissionId: "image-retry-submission",
          sourceText: "Describe this image",
          document: [{ type: "text", text: "Describe this image" }],
          hidden: true,
        },
      },
    },
  };
  const answer: SessionHistoryValue["events"][number] = {
    event: {
      type: "message",
      seq: 2,
      time: 4_000,
      entryId: "retried-answer",
      data: {
        role: "assistant",
        content: [{ type: "text", text: "It is a screenshot." }],
        timestamp: 4_000,
      },
    },
  };
  const history: SessionHistoryValue = {
    events: [composer, resolvedUser, answer],
    hasMore: false,
    branches: {
      headLeafId: "answer-leaf",
      items: [
        { leafId: "failure-leaf", events: [composer, failure] },
        { leafId: "answer-leaf", events: [retriedComposer, resolvedUser, answer] },
      ],
    },
  };
  const internals = session as unknown as {
    messageRepositoryFromHistory(
      sessionId: string,
      value: SessionHistoryValue,
      activeMessages: readonly ThreadMessage[],
    ): {
      repository: {
        headId: string | null;
        messages: Array<{ message: ThreadMessage; parentId: string | null }>;
      };
    };
  };

  const state = internals.messageRepositoryFromHistory("remote-session", history, []);
  const users = state.repository.messages.filter(({ message }) => message.role === "user");
  const byId = new Map(state.repository.messages.map((item) => [item.message.id, item]));

  assert.deepEqual(
    users.map(({ message }) => message.id),
    ["composer-retry-user"],
  );
  assert.equal(byId.get("attachment-failure")?.parentId, "composer-retry-user");
  assert.equal(byId.get("retried-answer")?.parentId, "composer-retry-user");
  assert.equal(state.repository.headId, "retried-answer");
});

test("reloads the authoritative branch after a branch selection is rejected", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  t.after(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  });
  const methods: string[] = [];
  console.error = () => undefined;
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
    methods.push(request.method);
    if (request.method === "session.selectBranch") {
      return Response.json({
        type: "server-response",
        rpcId: request.rpcId,
        result: {
          ok: false,
          error: {
            code: "pi_branch_not_found",
            message: "Branch not found",
            details: {},
          },
        },
      });
    }
    assert.equal(request.method, "session.history");
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: { events: [], hasMore: false },
      },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("remote-session", "remote-session");
  const internals = session as unknown as {
    branchLeafByHeadMessageId: Map<string, string>;
    branchSwitchTask?: Promise<void>;
  };
  internals.branchLeafByHeadMessageId.set("assistant-head", "missing-leaf");

  const selection = session.selectBranch("assistant-head");
  const task = internals.branchSwitchTask;
  assert.ok(task);
  await assert.rejects(selection, /Branch not found/);

  assert.deepEqual(methods, ["session.selectBranch", "session.history"]);
  assert.equal(internals.branchSwitchTask, undefined);
});

test("keeps projected Composer messages on both repository branches without reparenting the active id", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("remote-session", "remote-session");
  const previousUser: SessionHistoryValue["events"][number] = {
    event: {
      type: "message",
      seq: 0,
      time: 1_000,
      entryId: "previous-user",
      data: { role: "user", content: "Initial prompt", timestamp: 1_000 },
    },
  };
  const composerMarker: SessionHistoryValue["events"][number] = {
    event: {
      type: "message",
      seq: 1,
      time: 2_000,
      entryId: "composer-marker",
      data: {
        role: "custom",
        customType: "workbench.composer-user.v2",
        content: "",
        display: false,
        details: {
          version: 1,
          submissionId: "follow-up-submission",
          sourceText: "Follow-up prompt",
        },
        timestamp: 2_000,
      },
    },
  };
  const composerResolution: SessionHistoryValue["events"][number] = {
    event: {
      type: "message",
      seq: 2,
      time: 2_100,
      entryId: "composer-resolution",
      data: {
        role: "custom",
        customType: "workbench.composer-resolution.v1",
        content: "",
        display: false,
        details: {
          version: 1,
          submissionId: "follow-up-submission",
          status: "resolved",
          commandTrace: [],
        },
        timestamp: 2_100,
      },
    },
  };
  const previousAssistant: SessionHistoryValue["events"][number] = {
    event: {
      type: "message",
      seq: 3,
      time: 3_000,
      entryId: "previous-assistant",
      data: {
        role: "assistant",
        content: [{ type: "text", text: "Initial answer" }],
        timestamp: 3_000,
      },
    },
  };
  const projectedUser: SessionHistoryValue["events"][number] = {
    event: {
      type: "message",
      seq: 4,
      time: 4_000,
      entryId: "projected-user",
      data: {
        role: "user",
        content: "Compiled follow-up prompt",
        timestamp: 4_000,
        workbenchComposer: {
          version: 1,
          submissionId: "follow-up-submission",
          sourceText: "Follow-up prompt",
          hidden: true,
        },
      },
    },
  };
  const unresolvedEvents = [previousUser, composerMarker, previousAssistant];
  const resolvedEvents = [
    previousUser,
    composerMarker,
    composerResolution,
    previousAssistant,
    projectedUser,
  ];
  const history: SessionHistoryValue = {
    events: resolvedEvents,
    hasMore: false,
    branches: {
      headLeafId: "resolved-leaf",
      // Deliberately return the inactive branch first: the active branch must still own canonical
      // message ids when the projection moves composer-marker after previous-assistant.
      items: [
        { leafId: "unresolved-leaf", events: unresolvedEvents },
        { leafId: "resolved-leaf", events: resolvedEvents },
      ],
    },
  };
  const internals = session as unknown as {
    messageRepositoryFromHistory(
      sessionId: string,
      value: SessionHistoryValue,
      activeMessages: readonly ThreadMessage[],
    ): {
      repository: {
        headId: string | null;
        messages: Array<{ message: ThreadMessage; parentId: string | null }>;
      };
      leafByHeadMessageId: Map<string, string>;
    };
  };

  const state = internals.messageRepositoryFromHistory("remote-session", history, []);
  const byId = new Map(state.repository.messages.map((item) => [item.message.id, item]));
  const branchPath = (headId: string): string[] => {
    const path: string[] = [];
    let cursor: string | null = headId;
    while (cursor) {
      const item = byId.get(cursor);
      assert.ok(item, `repository is missing ${cursor}`);
      path.unshift(cursor);
      cursor = item.parentId;
    }
    return path;
  };

  assert.equal(state.repository.headId, "composer-marker");
  assert.equal(byId.get("composer-marker")?.parentId, "previous-assistant");
  assert.deepEqual(branchPath("composer-marker"), [
    "previous-user",
    "previous-assistant",
    "composer-marker",
  ]);
  assert.equal(state.leafByHeadMessageId.get("composer-marker"), "resolved-leaf");

  const unresolvedHead = [...state.leafByHeadMessageId].find(
    ([, leafId]) => leafId === "unresolved-leaf",
  )?.[0];
  assert.ok(unresolvedHead);
  const unresolvedPath = branchPath(unresolvedHead);
  assert.equal(unresolvedPath[0], "previous-user");
  assert.match(unresolvedPath[1] ?? "", /^pi-branch:unresolved-leaf:composer-marker/);
  assert.match(unresolvedPath[2] ?? "", /^pi-branch:unresolved-leaf:previous-assistant/);
  assert.equal(state.leafByHeadMessageId.get(unresolvedHead), "unresolved-leaf");

  const seen = new Set<string>();
  for (const item of state.repository.messages) {
    assert.equal(
      item.parentId === null || seen.has(item.parentId),
      true,
      `${item.message.id} must be exported after its parent ${item.parentId}`,
    );
    assert.equal(seen.has(item.message.id), false, `${item.message.id} must be exported once`);
    seen.add(item.message.id);
  }

  assert.deepEqual(
    repositoryMessages(state.repository).map((message) => message.id),
    ["previous-user", "previous-assistant", "composer-marker"],
  );
  assert.deepEqual(
    repositoryMessages(state.repository, unresolvedHead).map((message) => message.id),
    unresolvedPath,
  );

  const repeated = internals.messageRepositoryFromHistory("remote-session", history, []);
  assert.deepEqual(
    repeated.repository.messages.map((item) => [item.message.id, item.parentId]),
    state.repository.messages.map((item) => [item.message.id, item.parentId]),
  );
  assert.deepEqual([...repeated.leafByHeadMessageId], [...state.leafByHeadMessageId]);
});

test("applies unarchive state from the host event rather than the mutation response", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: unknown;
    };
    assert.equal(request.method, "workspace.unarchiveSession");
    assert.deepEqual(request.payload, { sessionId: "remote-session" });
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: {
          sessionId: "remote-session",
          archived: false,
        },
      },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const internals = manager as unknown as {
    archived: Set<string>;
    handleHostFrame(payload: HostStreamPayload, generation: number): void;
    setSessionArchivedMetadata(sessionId: string, archived: boolean): Promise<void>;
    workspaces: Map<
      string,
      { workspaceId: string; title: string; path: string; sessionIds: string[] }
    >;
  };
  internals.archived.add("remote-session");
  internals.workspaces.set("workspace-1", {
    workspaceId: "workspace-1",
    title: "Workspace",
    path: "/workspace",
    sessionIds: [],
  });

  await internals.setSessionArchivedMetadata("remote-session", false);

  assert.equal(internals.archived.has("remote-session"), true);
  assert.deepEqual(internals.workspaces.get("workspace-1")?.sessionIds, []);

  internals.handleHostFrame(
    {
      type: "host/session-archive-changed",
      sessionId: "remote-session",
      archived: false,
      workspace: {
        workspaceId: "workspace-1",
        title: "Workspace",
        path: "/workspace",
        sessionIds: ["remote-session"],
        createdAt: "2026-08-20T00:00:00.000Z",
        updatedAt: "2026-08-20T00:00:01.000Z",
      },
    },
    1,
  );

  assert.equal(internals.archived.has("remote-session"), false);
  assert.deepEqual(internals.workspaces.get("workspace-1")?.sessionIds, ["remote-session"]);
});

test("persists conversation and workspace pins through workspace RPC", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requests: Array<{ method: string; payload: unknown }> = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: { workspaceId?: string; sessionId?: string; pinned: boolean };
    };
    requests.push({ method: request.method, payload: request.payload });
    const value =
      request.method === "workspace.setPinned"
        ? { workspaceId: request.payload.workspaceId, pinned: request.payload.pinned }
        : { sessionId: request.payload.sessionId, pinned: request.payload.pinned };
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const internals = manager as unknown as {
    setSummary(value: PiSessionSummary): boolean;
    workspaces: Map<
      string,
      { workspaceId: string; title: string; path: string; sessionIds: string[] }
    >;
  };
  const remoteSummary = summary();
  internals.setSummary(remoteSummary);
  internals.workspaces.set("workspace-1", {
    workspaceId: "workspace-1",
    title: "Workspace",
    path: "/workspace",
    sessionIds: ["remote-session"],
  });

  await manager.threadActions.setPinned("remote-session", true);
  await manager.setWorkspacePinned("workspace-1", true);

  assert.deepEqual(requests, [
    {
      method: "workspace.setSessionPinned",
      payload: { sessionId: "remote-session", pinned: true },
    },
    {
      method: "workspace.setPinned",
      payload: { workspaceId: "workspace-1", pinned: true },
    },
  ]);
  assert.equal(manager.getThreadCustom("remote-session")?.piPinned, true);
  assert.equal(manager.getThreadCustom("remote-session")?.piCreatedAt, remoteSummary.created);
  assert.equal(manager.getWorkspaces()[0]?.pinned, true);
});

test("forks at the selected event and increments the conversation title", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const requests: Array<{ method: string; payload: unknown }> = [];
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: unknown;
    };
    requests.push({ method: request.method, payload: request.payload });
    const value =
      request.method === "session.fork"
        ? { sessionId: "forked-session" }
        : { title: "Research (2)", seq: 9 };
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const internals = manager as unknown as {
    start(): Promise<void>;
    refreshMetadata(): Promise<void>;
    setSummary(value: PiSessionSummary): boolean;
    workspaces: Map<
      string,
      { workspaceId: string; title: string; path: string; sessionIds: string[] }
    >;
  };
  internals.start = async () => {};
  internals.refreshMetadata = async () => {};
  internals.setSummary(summary({ name: "Research" }));
  internals.setSummary(summary({ id: "existing-fork", name: "Research (1)" }));
  internals.workspaces.set("workspace-1", {
    workspaceId: "workspace-1",
    title: "Workspace",
    path: "/workspace",
    sessionIds: ["remote-session", "existing-fork"],
  });

  const result = await manager.forkSessionAt({
    sessionId: "remote-session",
    atSeq: 7,
    sourceTitle: "Research",
  });

  assert.deepEqual(result, { sessionId: "forked-session", title: "Research (2)" });
  assert.equal(manager.getThreadListItemSnapshot("forked-session")?.title, "Research (2)");
  assert.deepEqual(requests, [
    { method: "session.fork", payload: { sessionId: "remote-session", atSeq: 7 } },
    {
      method: "session.rename",
      payload: { sessionId: "forked-session", title: "Research (2)" },
    },
  ]);
});

test("renders an authoritative steering item as an optimistic user message", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    handleEvent(event: PiEvent): void;
  };
  session.setRunningFromManager(true, { startedAt: 1_000, elapsedMs: 250 });
  const originalRunStartedAt = session.getSnapshot().runTiming?.startedAt;
  assert.equal(originalRunStartedAt, 1_000);

  session.applyQueueSnapshot([
    {
      id: "queue-steer-1",
      placement: "steering",
      message: {
        id: "queue-steer-1",
        role: "user",
        content: [{ type: "text", text: "change direction" }],
        source: { kind: "user" },
      },
    },
  ]);

  assert.deepEqual(session.getSnapshot().steeringQueueIds, ["queue-steer-1"]);
  assert.equal(session.getSnapshot().messages[0]?.metadata.custom.piSteering, true);
  assert.deepEqual(
    session
      .getSnapshot()
      .messages.map((message) => [
        message.role,
        message.content[0]?.type === "text" ? message.content[0].text : undefined,
      ]),
    [["user", "change direction"]],
  );

  session.applyQueueSnapshot([]);
  assert.deepEqual(session.getSnapshot().steeringQueueIds, []);
  assert.equal(session.getSnapshot().messages.length, 1);

  internals.handleEvent({
    type: "message_start",
    sequence: 10,
    runTiming: { startedAt: 1_000, elapsedMs: 500 },
    message: {
      role: "user",
      content:
        'change direction\n\n<pi-workbench-workspace-feedback version="1">\n[]\n</pi-workbench-workspace-feedback>',
      timestamp: 2_000,
    },
  });
  assert.equal(session.getSnapshot().messages.length, 1);
  assert.equal(session.getSnapshot().runTiming?.startedAt, originalRunStartedAt);
  assert.equal(session.getSnapshot().messages[0]?.metadata.custom.piSteering, true);
});

test("keeps a streaming assistant segment before steering messages as they arrive", async (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    handleEvent(event: PiEvent): void;
  };

  internals.handleEvent({
    type: "message_start",
    sequence: 0,
    message: { role: "user", content: "initial", timestamp: 1_000 },
  });
  internals.handleEvent({
    type: "message_end",
    sequence: 1,
    message: { role: "user", content: "initial", timestamp: 1_000 },
  });
  internals.handleEvent({
    type: "message_start",
    sequence: 2,
    message: { role: "assistant", content: [], timestamp: 1_100 },
  });
  internals.handleEvent({
    type: "message_update",
    sequence: 3,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "partial answer" }],
      timestamp: 1_100,
    },
  });

  session.applyQueueSnapshot([
    {
      id: "queue-steer-streaming",
      placement: "steering",
      message: {
        id: "queue-steer-streaming",
        role: "user",
        content: [{ type: "text", text: "change direction" }],
        source: { kind: "user" },
      },
    },
  ]);

  assert.deepEqual(
    session
      .getSnapshot()
      .messages.map((message) => [
        message.role,
        message.content[0]?.type === "text" ? message.content[0].text : undefined,
      ]),
    [
      ["user", "initial"],
      ["assistant", "partial answer"],
      ["user", "change direction"],
    ],
  );
  assert.equal(session.getSnapshot().messages[1]?.metadata.custom.piSteerInterrupted, true);

  internals.handleEvent({
    type: "message_end",
    sequence: 4,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "completed first segment" }],
      stopReason: "stop",
      timestamp: 1_100,
    },
  });
  assert.deepEqual(
    session.getSnapshot().messages.map((message) => message.role),
    ["user", "assistant", "user"],
  );

  session.applyQueueSnapshot([]);
  internals.handleEvent({
    type: "message_start",
    sequence: 5,
    message: { role: "user", content: "change direction", timestamp: 1_200 },
  });
  internals.handleEvent({
    type: "message_end",
    sequence: 6,
    message: { role: "user", content: "change direction", timestamp: 1_200 },
  });
  internals.handleEvent({
    type: "message_start",
    sequence: 7,
    message: { role: "assistant", content: [], timestamp: 1_300 },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(
    session.getSnapshot().messages.map((message) => message.role),
    ["user", "assistant", "user", "assistant"],
  );
});

test("publishes streaming updates before completion even when animation frames are suspended", async (t) => {
  const originalFrameScheduler = Object.getOwnPropertyDescriptor(
    globalThis,
    "requestAnimationFrame",
  );
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: () => 1,
  });
  t.after(() => {
    if (originalFrameScheduler) {
      Object.defineProperty(globalThis, "requestAnimationFrame", originalFrameScheduler);
    } else {
      Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    }
  });
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    lastSequence: number;
    handleEvent(event: PiEvent): void;
  };

  internals.handleEvent({
    type: "message_start",
    sequence: 10,
    message: { role: "assistant", content: [], timestamp: 1_000 },
  });
  internals.handleEvent({
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "partial" }],
      timestamp: 1_000,
    },
    transientKind: "delta",
    transientStreamId: "stream-1",
    transientRevision: 1,
    transientMessageStartSeq: 10,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(internals.lastSequence, 10);
  const streamingPart = session.getSnapshot().messages.at(-1)?.content[0];
  assert.equal(streamingPart?.type, "text");
  assert.equal(streamingPart?.type === "text" ? streamingPart.text : undefined, "partial");

  internals.handleEvent({
    type: "message_end",
    sequence: 11,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "complete" }],
      stopReason: "stop",
      timestamp: 1_000,
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(internals.lastSequence, 11);
  const completedPart = session.getSnapshot().messages.at(-1)?.content[0];
  assert.equal(completedPart?.type === "text" ? completedPart.text : undefined, "complete");
  assert.equal(session.getSnapshot().messages.at(-1)?.status?.type, "complete");
});

test("projects raw partial tool arguments from transient updates", async (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    handleEvent(event: PiEvent): void;
  };

  internals.handleEvent({
    type: "message_start",
    sequence: 10,
    message: { role: "assistant", content: [], timestamp: 1_000 },
  });
  internals.handleEvent({
    type: "message_update",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "tool-1",
          name: "search",
          arguments: { query: "hel" },
        },
      ],
      timestamp: 1_000,
    },
    rawToolArgsText: { "0": '{"query":"hel' },
    transientKind: "delta",
    transientStreamId: "stream-1",
    transientRevision: 1,
    transientMessageStartSeq: 10,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  const partial = session.getSnapshot().messages.at(-1)?.content[0];
  assert.equal(partial?.type, "tool-call");
  if (partial?.type !== "tool-call") return;
  assert.deepEqual(partial.args, { query: "hel" });
  assert.equal(partial.argsText, '{"query":"hel');

  internals.handleEvent({
    type: "message_end",
    sequence: 11,
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "tool-1",
          name: "search",
          arguments: { query: "hello" },
        },
      ],
      stopReason: "stop",
      timestamp: 1_000,
    },
  });

  const completed = session.getSnapshot().messages.at(-1)?.content[0];
  assert.equal(completed?.type, "tool-call");
  assert.equal(
    completed?.type === "tool-call" ? completed.argsText : undefined,
    '{"query":"hello"}',
  );
});

test("renders a consumed follow-up at user message_start before the next assistant output", async (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    handleEvent(event: PiEvent): void;
  };

  session.applyQueueSnapshot([
    {
      id: "queue-follow-up-1",
      placement: "queued",
      message: {
        id: "queue-follow-up-1",
        role: "user",
        content: [{ type: "text", text: "continue after this turn" }],
        source: { kind: "user" },
      },
    },
  ]);
  session.applyQueueSnapshot([]);
  assert.deepEqual(session.getSnapshot().messages, []);

  internals.handleEvent({
    type: "agent_start",
    sequence: 9,
    runTiming: { startedAt: 1_000, elapsedMs: 0 },
  });
  internals.handleEvent({
    type: "message_start",
    sequence: 10,
    runTiming: { startedAt: 1_000, elapsedMs: 0 },
    message: {
      role: "user",
      content: "continue after this turn",
      timestamp: 1_000,
    },
  });

  assert.equal(session.getSnapshot().runTiming?.startedAt, 1_000);

  assert.deepEqual(
    session
      .getSnapshot()
      .messages.map((message) => [
        message.role,
        message.content[0]?.type === "text" ? message.content[0].text : undefined,
      ]),
    [["user", "continue after this turn"]],
  );

  internals.handleEvent({
    type: "message_end",
    sequence: 11,
    message: {
      role: "user",
      content: "continue after this turn",
      timestamp: 1_000,
    },
  });
  assert.equal(session.getSnapshot().messages.length, 1);

  internals.handleEvent({
    type: "message_start",
    sequence: 12,
    message: { role: "assistant", content: [], timestamp: 1_001 },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(
    session.getSnapshot().messages.map((message) => message.role),
    ["user", "assistant"],
  );
});

test("does not collapse identical follow-up turns or duplicate an unclaimed optimistic user", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    handleEvent(event: PiEvent): void;
    liveMessages: ThreadMessage[];
    publishMessages(): void;
  };
  internals.liveMessages = [
    {
      id: "optimistic-user",
      role: "user",
      content: [{ type: "text", text: "same prompt" }],
      attachments: [],
      createdAt: new Date(0),
      metadata: { custom: { piOptimistic: true }, isOptimistic: true },
    },
  ];
  internals.publishMessages();

  internals.handleEvent({
    type: "message_end",
    sequence: 20,
    message: { role: "user", content: "same prompt", timestamp: 2_000 },
  });
  assert.equal(session.getSnapshot().messages.length, 1);

  internals.handleEvent({
    type: "message_end",
    sequence: 21,
    message: { role: "user", content: "same prompt", timestamp: 3_000 },
  });
  assert.deepEqual(
    session.getSnapshot().messages.map((message) => [message.id, message.role]),
    [
      ["optimistic-user", "user"],
      ["pi-event-21", "user"],
    ],
  );
});

for (const compiled of [false, true]) {
  test(`reconciles a live user start when history overtakes its end (compiled=${compiled})`, (t) => {
    const manager = new PiSessionManager();
    t.after(() => manager.dispose());
    const session = manager.getSession("local-session", "remote-session");
    const internals = session as unknown as {
      applyHistory(value: SessionHistoryValue, remoteId: string): void;
      handleEvent(event: PiEvent): void;
    };
    const composer = {
      version: 2 as const,
      submissionId: "submission-1",
      sourceText: "Hello",
      hidden: true,
    };
    const marker: SessionHistoryValue["events"][number] = {
      event: {
        type: "message",
        seq: 0,
        time: 1_000,
        entryId: "composer-user",
        data: {
          role: "custom",
          customType: "workbench.composer-user.v3",
          content: "",
          display: false,
          timestamp: 1_000,
          details: {
            version: 3,
            submissionId: composer.submissionId,
            sourceText: composer.sourceText,
            text: composer.sourceText,
            document: [{ type: "text", text: composer.sourceText }],
            status: "accepted",
          },
        },
      },
    };
    const user = {
      role: "user" as const,
      content: compiled ? "Compiled model input" : "Hello",
      timestamp: 2_000,
    };
    internals.applyHistory({ events: [marker], hasMore: false }, "remote-session");
    assert.deepEqual(
      session.getSnapshot().messages.map((message) => message.id),
      ["composer-user"],
    );
    internals.handleEvent({ type: "agent_start" });
    internals.handleEvent({ type: "message_start", sequence: 1, message: user });
    const history: SessionHistoryValue = {
      events: [
        marker,
        { event: { type: "message_start", seq: 1, time: 2_000, data: { message: user } } },
        {
          event: {
            type: "message_end",
            seq: 2,
            time: 2_001,
            entryId: "resolved-user",
            data: { message: user, workbenchComposer: composer },
          },
        },
        {
          event: {
            type: "message_end",
            seq: 3,
            time: 3_000,
            entryId: "assistant-response",
            data: {
              message: {
                role: "assistant",
                content: [{ type: "text", text: "Hello back" }],
                timestamp: 2_500,
                stopReason: "toolUse",
              },
            },
          },
        },
      ],
      hasMore: false,
    };
    internals.applyHistory(history, "remote-session");
    // Its live end is now below the history watermark, so it will never repair the start row.
    internals.handleEvent({
      type: "message_end",
      sequence: 2,
      message: user,
      workbenchComposer: composer,
    });
    assert.deepEqual(
      session.getSnapshot().messages.map((message) => [message.id, message.role]),
      [
        ["composer-user", "user"],
        ["assistant-response", "assistant"],
      ],
    );
    assert.deepEqual(
      repositoryMessages(session.getSnapshot().messageRepository).map((message) => message.id),
      ["composer-user", "assistant-response"],
    );
    // Even equal text and native timestamps can belong to a genuinely newer queued turn.
    internals.handleEvent({ type: "message_start", sequence: 4, message: user });
    internals.applyHistory(history, "remote-session");
    assert.deepEqual(
      session.getSnapshot().messages.map((message) => [message.id, message.role]),
      [
        ["composer-user", "user"],
        ["assistant-response", "assistant"],
        ["pi-event-4", "user"],
      ],
    );
  });
}

test("publishes a complete optimistic turn and running state in one session snapshot", async (t) => {
  const originalFetch = globalThis.fetch;
  let promptRpcId: string | undefined;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
    assert.equal(request.method, "session.prompt");
    promptRpcId = request.rpcId;
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: { accepted: true } },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("remote-session", "remote-session");
  const managerInternals = manager as unknown as {
    ensureRemote(): Promise<PiSessionSummary>;
    connections: { ensureSessionEvents(): Promise<void> };
  };
  managerInternals.ensureRemote = async () => summary();
  managerInternals.connections.ensureSessionEvents = async () => {};

  const snapshots: Array<{ isRunning: boolean; roles: string[] }> = [];
  const unsubscribe = session.subscribe(() => {
    const snapshot = session.getSnapshot();
    snapshots.push({
      isRunning: snapshot.isRunning,
      roles: snapshot.messages.map((candidate) => candidate.role),
    });
  });
  t.after(unsubscribe);
  const message: AppendMessage = {
    role: "user",
    content: [{ type: "text", text: "Continue the existing conversation" }],
    attachments: [],
    createdAt: new Date(0),
    metadata: { custom: {} },
    parentId: null,
    runConfig: undefined,
    sourceId: null,
  };

  await session.send(message);
  if (promptRpcId) session.acknowledgePrompt(promptRpcId);

  assert.deepEqual(snapshots, [{ isRunning: true, roles: ["user", "assistant"] }]);
  const assistant = session.getSnapshot().messages[1];
  assert.equal(assistant?.role, "assistant");
  assert.equal(assistant?.status.type, "running");
  assert.equal(assistant?.content[0]?.type, "text");
  assert.equal(assistant?.content[0]?.type === "text" ? assistant.content[0].text : undefined, "");

  (session as unknown as { handleEvent(event: PiEvent): void }).handleEvent({
    type: "agent_start",
    sequence: 0,
  });
});

test("loads one older history page only after the Headless Session action is requested", async (t) => {
  const originalFetch = globalThis.fetch;
  let releaseBackfill: (() => void) | undefined;
  const backfillGate = new Promise<void>((resolve) => {
    releaseBackfill = resolve;
  });
  let markBackfillStarted: (() => void) | undefined;
  const backfillStarted = new Promise<void>((resolve) => {
    markBackfillStarted = resolve;
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: { beforeSeq?: number };
    };
    assert.equal(request.method, "session.history");
    const sequences =
      request.payload.beforeSeq === undefined ? [10, 11] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    if (request.payload.beforeSeq !== undefined) {
      markBackfillStarted?.();
      await backfillGate;
    }
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: {
          events: sequences.map((seq) => ({
            event: {
              type: "message",
              seq,
              time: seq,
              data: { role: "user", content: String(seq) },
            },
          })),
          hasMore: request.payload.beforeSeq === undefined,
        },
      },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const publishedCounts: number[] = [];
  const unsubscribe = session.subscribe(() => {
    publishedCounts.push(session.getSnapshot().messages.length);
  });
  t.after(unsubscribe);

  await session.reload();
  assert.equal(session.getSnapshot().messages.length, 2);
  assert.equal(session.snapshot.getSnapshot().hasMore, true);
  assert.ok(publishedCounts.length > 0);
  assert.ok(publishedCounts.every((count) => count === 2));

  const loadOlder = session.actions.loadOlder?.();
  assert.ok(loadOlder);
  await backfillStarted;
  assert.equal(session.getSnapshot().messages.length, 2);
  releaseBackfill?.();
  await loadOlder;

  assert.equal(session.getSnapshot().messages.length, 12);
  assert.equal(session.snapshot.getSnapshot().hasMore, false);
});

for (const hasLoadedHistory of [false, true]) {
  test(`keeps the user before a completed answer when the history tail starts inside its tool cycles (loaded=${hasLoadedHistory})`, async (t) => {
    const originalFetch = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = originalFetch;
    });
    const manager = new PiSessionManager();
    t.after(() => manager.dispose());
    const session = manager.getSession("local-session", "remote-session");
    const internals = session as unknown as {
      applyHistory(value: SessionHistoryValue, remoteId: string): void;
      handleEvent(event: PiEvent): void;
      localRunLeaseActive: boolean;
    };
    const events: SessionHistoryValue["events"] = [];
    if (hasLoadedHistory) {
      events.push(
        {
          event: {
            type: "message",
            seq: 0,
            time: 0,
            data: { role: "user", content: "Hello", timestamp: 0 },
          },
        },
        {
          event: {
            type: "message",
            seq: 1,
            time: 1,
            data: {
              role: "assistant",
              content: [{ type: "text", text: "Previous answer" }],
              stopReason: "stop",
              timestamp: 1,
            },
          },
        },
      );
      internals.applyHistory({ events: [...events], hasMore: false }, "remote-session");
    }
    internals.localRunLeaseActive = true;
    internals.handleEvent({ type: "agent_start" });
    const appendMessage = (message: PiEvent["message"]) => {
      for (const type of ["message_start", "message_end"]) {
        const seq = events.length;
        events.push({ event: { type, seq, time: 1_000 + seq, data: { message } } });
        internals.handleEvent({ type, sequence: seq, message });
      }
    };
    appendMessage({ role: "user", content: "Hello", timestamp: 1_000 });
    for (let index = 0; index < 5; index += 1) {
      appendMessage({
        role: "assistant",
        content: [{ type: "text", text: `Step ${index}` }],
        stopReason: "toolUse",
        timestamp: 1_001 + index * 2,
      });
      appendMessage({
        role: "toolResult",
        toolCallId: `tool-${index}`,
        toolName: "read",
        content: [{ type: "text", text: "Result" }],
        isError: false,
        timestamp: 1_002 + index * 2,
      });
    }
    appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Done" }],
      stopReason: "stop",
      timestamp: 2_000,
    });
    const expectedIds = session.getSnapshot().messages.map((message) => message.id);
    assert.equal(session.getSnapshot().isRunning, false);
    const requests: Array<{ beforeSeq?: number; maxMessages: number }> = [];
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        rpcId: string;
        method: string;
        payload: { beforeSeq?: number; maxMessages: number };
      };
      assert.equal(request.method, "session.history");
      requests.push(request.payload);
      const end = request.payload.beforeSeq ?? events.length;
      const start = Math.max(0, end - request.payload.maxMessages * 2);
      return Response.json({
        type: "server-response",
        rpcId: request.rpcId,
        result: {
          ok: true,
          value: { events: events.slice(start, end), hasMore: start > 0 },
        },
      });
    };
    await session.reload();
    assert.deepEqual(
      session.getSnapshot().messages.map((message) => message.id),
      expectedIds,
    );
    assert.deepEqual(
      repositoryMessages(session.getSnapshot().messageRepository).map((message) => message.id),
      expectedIds,
    );
    assert.equal(requests[0]?.maxMessages, 8);
    assert.ok(requests.some((request) => request.beforeSeq !== undefined));
    // The settled refresh must retain both real sends, including identical prompt text.
    internals.localRunLeaseActive = false;
    await session.reload();
    assert.deepEqual(
      session.getSnapshot().messages.map((message) => message.id),
      expectedIds,
    );
  });
}

test("keeps the optimistic assistant placeholder through a running history rebaseline", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
    assert.equal(request.method, "session.history");
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: { events: [], hasMore: false } },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    liveMessages: ThreadMessage[];
    streamingMessage?: ThreadMessage;
    activeAssistantMessageId?: string;
    publishMessagesAndSetRunning(running: boolean): void;
  };
  internals.liveMessages = [
    {
      id: "optimistic-user",
      role: "user",
      content: [{ type: "text", text: "Hello" }],
      attachments: [],
      createdAt: new Date(0),
      metadata: { custom: { piOptimistic: true }, isOptimistic: true },
    },
  ];
  internals.streamingMessage = {
    id: "optimistic-assistant",
    role: "assistant",
    content: [{ type: "text", text: "", status: { type: "running" } }],
    status: { type: "running" },
    createdAt: new Date(0),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
      isOptimistic: true,
    },
  };
  internals.activeAssistantMessageId = internals.streamingMessage.id;
  internals.publishMessagesAndSetRunning(true);

  const publishedRoles: string[][] = [];
  const unsubscribe = session.subscribe(() => {
    publishedRoles.push(session.getSnapshot().messages.map((message) => message.role));
  });
  t.after(unsubscribe);

  await session.reload();
  await session.reload();

  assert.deepEqual(
    session.getSnapshot().messages.map((message) => message.id),
    ["optimistic-user", "optimistic-assistant"],
  );
  assert.ok(
    publishedRoles.every(
      (roles) => roles.length === 2 && roles[0] === "user" && roles[1] === "assistant",
    ),
  );
});

test("restores a cold unfinished assistant from durable chunks", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const history: SessionHistoryValue = {
    events: [
      {
        event: {
          type: "message_start",
          seq: 7,
          time: 1_000,
          entryId: "assistant-start",
          data: { message: { role: "assistant", content: [], stopReason: "pending" } },
        },
      },
      {
        event: {
          type: "message_update",
          seq: 8,
          time: 1_010,
          data: {
            format: "pi-messages-v1",
            streamId: "stream-1",
            firstRevision: 1,
            revision: 2,
            startSeq: 7,
            message: { role: "assistant", stopReason: "pending" },
            updates: [
              { type: "text_start", contentIndex: 0 },
              { type: "text_delta", contentIndex: 0, delta: "Recovered" },
            ],
          },
        },
      },
    ],
    hasMore: false,
  };

  (
    session as unknown as { applyHistory(value: SessionHistoryValue, remoteId: string): void }
  ).applyHistory(history, "remote-session");

  const [message] = session.getSnapshot().messages;
  assert.equal(message?.id, "assistant-start");
  assert.deepEqual(message?.status, { type: "incomplete", reason: "other" });
  assert.equal(
    message?.content[0]?.type === "text" ? message.content[0].text : undefined,
    "Recovered",
  );
  assert.equal(message?.metadata.custom.piEventSeq, 8);
});

test("keeps the optimistic turn ids when history persists the running user message", async (t) => {
  const originalFetch = globalThis.fetch;
  let historyGate: Promise<void> | undefined;
  let regenerationCount = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      rpcId: string;
      method: string;
      payload: { messageId?: string };
    };
    if (request.method === "session.regenerate") {
      regenerationCount += 1;
      assert.equal(request.payload.messageId, "persisted-user-entry");
      return Response.json({
        type: "server-response",
        rpcId: request.rpcId,
        result: { ok: true, value: { accepted: true } },
      });
    }
    assert.equal(request.method, "session.history");
    await historyGate;
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: {
          events: [
            {
              event: {
                type: "message",
                entryId: "persisted-user-entry",
                seq: 7,
                time: 1_000,
                data: { role: "user", content: "Hello" },
              },
            },
          ],
          hasMore: false,
        },
      },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    activeAssistantMessageId?: string;
    liveMessages: ThreadMessage[];
    localRunLeaseActive: boolean;
    publishMessagesAndSetRunning(running: boolean): void;
    streamingMessage?: ThreadMessage;
  };
  internals.liveMessages = [
    {
      id: "optimistic-user",
      role: "user",
      content: [{ type: "text", text: "Hello" }],
      attachments: [],
      createdAt: new Date(0),
      metadata: { custom: { piOptimistic: true }, isOptimistic: true },
    },
  ];
  internals.streamingMessage = {
    id: "optimistic-assistant",
    role: "assistant",
    content: [{ type: "text", text: "", status: { type: "running" } }],
    status: { type: "running" },
    createdAt: new Date(0),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
      isOptimistic: true,
    },
  };
  internals.activeAssistantMessageId = internals.streamingMessage.id;
  internals.localRunLeaseActive = true;
  internals.publishMessagesAndSetRunning(true);

  const publishedIds: string[][] = [];
  const unsubscribe = session.subscribe(() => {
    publishedIds.push(session.getSnapshot().messages.map((message) => message.id));
  });
  t.after(unsubscribe);

  await session.reload();
  await session.reload();

  assert.deepEqual(
    session.getSnapshot().messages.map((message) => message.id),
    ["optimistic-user", "optimistic-assistant"],
  );
  assert.ok(publishedIds.length >= 2);
  assert.ok(
    publishedIds.every((ids) => ids[0] === "optimistic-user" && ids[1] === "optimistic-assistant"),
  );
  const connections = manager.connections as unknown as { ensureSessionEvents(): Promise<void> };
  connections.ensureSessionEvents = async () => undefined;
  let releaseHistory!: () => void;
  historyGate = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  const reload = session.reload();
  const retry = session.retry("optimistic-user", undefined);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(regenerationCount, 0, "retry must wait for the pending history baseline");
  releaseHistory();
  await Promise.all([reload, retry]);
  assert.equal(regenerationCount, 1);
});

test("keeps the optimistic assistant between prompt admission and agent start", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    activeAssistantMessageId?: string;
    liveMessages: ThreadMessage[];
    localRunLeaseActive: boolean;
    pendingPromptRpcIds: Set<string>;
    promptRequestPending: boolean;
    publishMessagesAndSetRunning(running: boolean): void;
    streamingMessage?: ThreadMessage;
  };
  internals.liveMessages = [
    {
      id: "optimistic-user",
      role: "user",
      content: [{ type: "text", text: "Hello" }],
      attachments: [],
      createdAt: new Date(0),
      metadata: { custom: { piOptimistic: true }, isOptimistic: true },
    },
  ];
  internals.streamingMessage = {
    id: "optimistic-assistant",
    role: "assistant",
    content: [{ type: "text", text: "", status: { type: "running" } }],
    status: { type: "running" },
    createdAt: new Date(0),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
      isOptimistic: true,
    },
  };
  internals.activeAssistantMessageId = internals.streamingMessage.id;
  internals.localRunLeaseActive = true;
  internals.promptRequestPending = true;
  internals.pendingPromptRpcIds.add("prompt-rpc");
  internals.publishMessagesAndSetRunning(true);

  session.acknowledgePrompt("prompt-rpc");
  session.setRunningFromManager(false);

  assert.equal(session.getSnapshot().isRunning, true);
  assert.deepEqual(
    session.getSnapshot().messages.map((message) => message.id),
    ["optimistic-user", "optimistic-assistant"],
  );
  assert.equal(internals.promptRequestPending, true);
  assert.equal(internals.pendingPromptRpcIds.size, 0);
});

test("keeps the optimistic assistant after agent start until the run settles", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  (manager as unknown as { refreshMetadata(): Promise<void> }).refreshMetadata = async () => {};
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    activeAssistantMessageId?: string;
    handleEvent(event: PiEvent): void;
    liveMessages: ThreadMessage[];
    localRunLeaseActive: boolean;
    promptRequestPending: boolean;
    publishMessagesAndSetRunning(running: boolean): void;
    reload(): Promise<void>;
    streamingMessage?: ThreadMessage;
  };
  internals.reload = async () => {};
  internals.liveMessages = [
    {
      id: "optimistic-user",
      role: "user",
      content: [{ type: "text", text: "Hello" }],
      attachments: [],
      createdAt: new Date(0),
      metadata: { custom: { piOptimistic: true }, isOptimistic: true },
    },
  ];
  internals.streamingMessage = {
    id: "optimistic-assistant",
    role: "assistant",
    content: [{ type: "text", text: "", status: { type: "running" } }],
    status: { type: "running" },
    createdAt: new Date(0),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
      isOptimistic: true,
    },
  };
  internals.activeAssistantMessageId = internals.streamingMessage.id;
  internals.localRunLeaseActive = true;
  internals.promptRequestPending = true;
  internals.publishMessagesAndSetRunning(true);

  internals.handleEvent({ type: "agent_start", sequence: 0 });
  session.setRunningFromManager(false);

  assert.equal(internals.promptRequestPending, false);
  assert.equal(internals.localRunLeaseActive, true);
  assert.equal(session.getSnapshot().isRunning, true);
  assert.deepEqual(
    session.getSnapshot().messages.map((message) => message.id),
    ["optimistic-user", "optimistic-assistant"],
  );

  internals.handleEvent({ type: "agent_settled", sequence: 1 });
  assert.equal(internals.localRunLeaseActive, false);
  assert.equal(session.getSnapshot().isRunning, false);
});

test("uses an authoritative idle rebaseline to release a stale local run lease", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const sessionInternals = session as unknown as {
    localRunLeaseActive: boolean;
    promptRequestPending: boolean;
    publishMessagesAndSetRunning(running: boolean): void;
    reload(): Promise<void>;
  };
  const managerInternals = manager as unknown as {
    applyRunningSnapshot(sessionIds: string[], authoritativeBaseline?: boolean): void;
  };
  sessionInternals.reload = async () => {};
  sessionInternals.localRunLeaseActive = true;
  sessionInternals.promptRequestPending = true;
  sessionInternals.publishMessagesAndSetRunning(true);

  managerInternals.applyRunningSnapshot([], true);
  assert.equal(
    session.getSnapshot().isRunning,
    true,
    "an in-flight prompt still owns its local admission lease",
  );
  assert.equal(sessionInternals.localRunLeaseActive, true);

  sessionInternals.promptRequestPending = false;
  managerInternals.applyRunningSnapshot([], true);

  assert.equal(sessionInternals.localRunLeaseActive, false);
  assert.equal(session.getSnapshot().isRunning, false);
  assert.equal(manager.isRunning("remote-session"), false);
});

test("ends the visible run at a terminal response while host cleanup remains active", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  (manager as unknown as { refreshMetadata(): Promise<void> }).refreshMetadata = async () => {};
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    handleEvent(event: PiEvent): void;
    publishMessagesAndSetRunning(running: boolean): void;
    reload(): Promise<void>;
  };
  internals.reload = async () => {};
  internals.publishMessagesAndSetRunning(true);
  const publishedStates: string[] = [];
  const unsubscribe = session.subscribe(() => {
    const snapshot = session.getSnapshot();
    const lastMessage = snapshot.messages.at(-1);
    if (lastMessage?.role === "assistant") {
      publishedStates.push(`${snapshot.isRunning}:${lastMessage.status.type}`);
    }
  });
  t.after(unsubscribe);

  internals.handleEvent({
    type: "message_start",
    sequence: 0,
    message: { role: "assistant", content: [], timestamp: 1 },
  });
  internals.handleEvent({
    type: "message_end",
    sequence: 1,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Done" }],
      stopReason: "stop",
      timestamp: 1,
    },
  });

  assert.equal(session.getSnapshot().isRunning, false);
  assert.equal(manager.isRunning("remote-session"), true);
  assert.equal(publishedStates.includes("true:complete"), false);

  // A host/session-changed summary can still report cleanup as running. It must not reopen the
  // completed visible run while Pi executes agent_settled extension handlers.
  session.setRunningFromManager(true);
  assert.equal(session.getSnapshot().isRunning, false);

  // A queued continuation starts a new visible response even within the same host prompt task.
  internals.handleEvent({
    type: "message_start",
    sequence: 2,
    message: { role: "user", content: "Follow up", timestamp: 2 },
  });
  assert.equal(session.getSnapshot().isRunning, true);

  internals.handleEvent({ type: "agent_settled", sequence: 3 });
  assert.equal(session.getSnapshot().isRunning, false);
  assert.equal(manager.isRunning("remote-session"), false);
});

test("clears automatic-retry progress as output resumes while the run stays active", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  (manager as unknown as { refreshMetadata(): Promise<void> }).refreshMetadata = async () => {};
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    handleEvent(event: PiEvent): void;
    publishMessagesAndSetRunning(running: boolean): void;
    reload(): Promise<void>;
  };
  internals.reload = async () => {};
  internals.publishMessagesAndSetRunning(true);

  internals.handleEvent({
    type: "auto_retry_start",
    sequence: 0,
    attempt: 2,
    maxAttempts: 3,
    delayMs: 4_000,
    errorMessage: "fetch failed",
  });

  assert.deepEqual(session.getSnapshot().autoRetry, { attempt: 2, maxAttempts: 3 });
  assert.equal(session.getSnapshot().isRunning, true);

  internals.handleEvent({
    type: "message_start",
    sequence: 1,
    message: { role: "assistant", content: [], timestamp: 1 },
  });
  assert.deepEqual(session.getSnapshot().autoRetry, { attempt: 2, maxAttempts: 3 });

  internals.handleEvent({
    type: "message_update",
    sequence: 2,
    message: { role: "assistant", content: [{ type: "text", text: "Recovered" }], timestamp: 1 },
  });
  assert.equal(session.getSnapshot().autoRetry, undefined);
  assert.equal(session.getSnapshot().isRunning, true);

  internals.handleEvent({
    type: "auto_retry_start",
    sequence: 3,
    attempt: 3,
    maxAttempts: 3,
  });
  internals.handleEvent({
    type: "auto_retry_end",
    sequence: 4,
    success: false,
    attempt: 3,
    finalError: "fetch failed",
  });
  assert.deepEqual(session.getSnapshot().autoRetry, { attempt: 3, maxAttempts: 3 });

  internals.handleEvent({ type: "agent_settled", sequence: 5 });
  assert.equal(session.getSnapshot().autoRetry, undefined);
  assert.equal(session.getSnapshot().isRunning, false);
});

test("replaces failed automatic-retry attempts in the visible response", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  (manager as unknown as { refreshMetadata(): Promise<void> }).refreshMetadata = async () => {};
  const session = manager.getSession("session-live-parts", "session-live-parts");
  const internals = session as unknown as {
    handleEvent(event: PiEvent): void;
    publishMessagesAndSetRunning(running: boolean): void;
    reload(): Promise<void>;
  };
  internals.reload = async () => {};
  internals.publishMessagesAndSetRunning(true);

  session.applyContextTraceEvent(promptCompositionEvent("activation-retry:0", 0, "round-retry"));
  internals.handleEvent({
    type: "message_start",
    sequence: 0,
    message: { role: "assistant", content: [], timestamp: 1 },
  });
  internals.handleEvent({
    type: "message_end",
    sequence: 1,
    message: {
      role: "assistant",
      content: [],
      stopReason: "error",
      errorMessage: "fetch failed",
      timestamp: 1,
    },
  });
  internals.handleEvent({
    type: "auto_retry_start",
    sequence: 2,
    attempt: 2,
    maxAttempts: 3,
    delayMs: 1,
    errorMessage: "fetch failed",
  });

  assert.equal(
    session.getSnapshot().messages.filter((message) => message.role === "assistant").length,
    0,
  );

  session.applyContextTraceEvent(promptCompositionEvent("activation-retry:1", 1, "round-retry"));
  internals.handleEvent({
    type: "message_start",
    sequence: 3,
    message: { role: "assistant", content: [], timestamp: 2 },
  });
  internals.handleEvent({
    type: "message_end",
    sequence: 4,
    message: {
      role: "assistant",
      content: [],
      stopReason: "error",
      errorMessage: "fetch failed",
      timestamp: 2,
    },
  });
  internals.handleEvent({ type: "agent_settled", sequence: 5 });

  const assistants = session
    .getSnapshot()
    .messages.filter((message) => message.role === "assistant");
  assert.equal(assistants.length, 1);
  const assistant = assistants[0];
  assert.equal(assistant?.role, "assistant");
  if (assistant?.role !== "assistant") return;
  assert.deepEqual(assistant.status, {
    type: "incomplete",
    reason: "error",
    error: "fetch failed",
  });
  assert.deepEqual(
    [
      ...new Set(
        assistant.content.flatMap((part) =>
          part.type === "data"
            ? [parsePiContextTraceData(part.data)?.event.traceId].filter(
                (traceId): traceId is string => traceId !== undefined,
              )
            : [],
        ),
      ),
    ],
    ["activation-retry:1"],
  );
});

test("uses server timestamps for replayed message and tool durations", (t) => {
  t.mock.method(Date, "now", () => 500_000);
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session");
  const internals = session as unknown as { handleEvent(event: PiEvent): void };
  let sequence = 0;
  const emit = (eventTime: number, event: PiEvent) =>
    internals.handleEvent({ ...event, eventTime, sequence: sequence++ });
  emit(1_000_000, {
    type: "message_end",
    message: { role: "user", content: "Fix it", timestamp: 1_000_000 },
  });
  const toolMessage = {
    role: "assistant",
    timestamp: 1_010_000,
    content: [{ type: "toolCall", id: "tool", name: "read", arguments: {} }],
    stopReason: "toolUse",
  };
  emit(1_010_000, { type: "message_start", message: toolMessage });
  emit(1_060_000, { type: "message_end", message: toolMessage });
  emit(1_060_000, { type: "tool_execution_start", toolCallId: "tool" });
  emit(1_240_000, {
    type: "tool_execution_end",
    toolCallId: "tool",
    result: { content: [{ type: "text", text: "OK" }] },
  });
  const finalMessage = {
    role: "assistant",
    timestamp: 1_300_000,
    content: [{ type: "text", text: "Done" }],
    stopReason: "stop",
  };
  emit(1_300_000, { type: "message_start", message: { ...finalMessage, content: [] } });
  emit(1_360_000, { type: "message_update", message: finalMessage });
  emit(1_600_000, { type: "message_end", message: finalMessage });

  const assistant = session.getSnapshot().messages.at(-1);
  assert.equal(assistant?.role, "assistant");
  assert.deepEqual(assistant?.metadata.custom.workbenchTurnTiming, {
    startedAt: 1_000_000,
    completedAt: 1_600_000,
  });
  assert.equal(assistant?.metadata.timing?.totalStreamTime, 300_000);
  assert.equal(assistant?.metadata.timing?.firstTokenTime, 60_000);
  const tool = assistant?.content.find((part) => part.type === "tool-call");
  assert.deepEqual(tool?.timing, { startedAt: 1_060_000, completedAt: 1_240_000 });
});

test("recovers completed message timing when reconnect missed message_start", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session");
  const internals = session as unknown as { handleEvent(event: PiEvent): void };
  internals.handleEvent({
    type: "message_end",
    sequence: 0,
    eventTime: 601_000,
    message: {
      role: "assistant",
      timestamp: 1_000,
      content: [{ type: "text", text: "Done" }],
      stopReason: "stop",
    },
  });
  assert.deepEqual(session.getSnapshot().messages.at(-1)?.metadata.custom.workbenchTurnTiming, {
    startedAt: 1_000,
    completedAt: 601_000,
  });
  assert.equal(session.getSnapshot().messages.at(-1)?.metadata.timing?.firstTokenTime, undefined);
});

test("keeps the optimistic assistant id from stream start through completion", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    activeAssistantMessageId?: string;
    streamingMessage?: ThreadMessage;
    liveMessages: ThreadMessage[];
    handleEvent(event: PiEvent): void;
    publishMessagesAndSetRunning(running: boolean): void;
  };
  const assistantId = "optimistic-assistant";
  internals.activeAssistantMessageId = assistantId;
  internals.streamingMessage = {
    id: assistantId,
    role: "assistant",
    content: [{ type: "text", text: "", status: { type: "running" } }],
    status: { type: "running" },
    createdAt: new Date(0),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
      isOptimistic: true,
    },
  };
  internals.publishMessagesAndSetRunning(true);

  internals.handleEvent({
    type: "message_start",
    sequence: 0,
    message: { role: "assistant", content: [], timestamp: 1 },
  });
  assert.equal(session.getSnapshot().messages.at(-1)?.id, assistantId);

  internals.handleEvent({
    type: "message_update",
    sequence: 1,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "OK" }],
      timestamp: 1,
    },
  });
  assert.equal(session.getSnapshot().messages.at(-1)?.id, assistantId);

  internals.handleEvent({
    type: "message_end",
    sequence: 2,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "OK" }],
      stopReason: "stop",
      timestamp: 1,
    },
  });
  assert.equal(session.getSnapshot().messages.at(-1)?.id, assistantId);
  assert.equal(session.getSnapshot().messages.at(-1)?.status?.type, "complete");
});

test("keeps the in-flight assistant id when settled history wins the stream race", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
    assert.equal(request.method, "session.history");
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: {
          events: [
            {
              event: {
                type: "message_end",
                seq: 1,
                time: 1_000,
                entryId: "journal-user",
                data: { message: { role: "user", content: "Hello", timestamp: 1_000 } },
              },
            },
            {
              event: {
                type: "message_end",
                seq: 2,
                time: 2_000,
                entryId: "journal-assistant",
                data: {
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: "Settled answer" }],
                    stopReason: "stop",
                    timestamp: 2_000,
                  },
                },
              },
            },
          ],
          hasMore: false,
        },
      },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    activeAssistantMessageId?: string;
    liveMessages: ThreadMessage[];
    publishMessagesAndSetRunning(running: boolean): void;
    streamingMessage?: ThreadMessage;
  };
  internals.liveMessages = [
    {
      id: "optimistic-user",
      role: "user",
      content: [{ type: "text", text: "Hello" }],
      attachments: [],
      createdAt: new Date(1_000),
      metadata: { custom: { piOptimistic: true }, isOptimistic: true },
    },
  ];
  internals.streamingMessage = {
    id: "optimistic-assistant",
    role: "assistant",
    content: [{ type: "text", text: "", status: { type: "running" } }],
    status: { type: "running" },
    createdAt: new Date(2_000),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: { piMessageTimestamp: 2_000 },
      isOptimistic: true,
    },
  };
  internals.activeAssistantMessageId = internals.streamingMessage.id;
  internals.publishMessagesAndSetRunning(true);

  await session.reload();

  assert.deepEqual(
    session.getSnapshot().messages.map((message) => message.id),
    ["optimistic-user", "optimistic-assistant"],
  );
  assert.equal(session.getSnapshot().messageRepository.headId, "optimistic-assistant");
  assert.equal(session.getSnapshot().isRunning, false);
  assert.equal(internals.streamingMessage, undefined);
  assert.equal(internals.activeAssistantMessageId, undefined);
  const settledPart = session.getSnapshot().messages.at(-1)?.content[0];
  assert.equal(settledPart?.type === "text" ? settledPart.text : undefined, "Settled answer");
});

test("removes an unused optimistic assistant when a command settles without model output", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const managerInternals = manager as unknown as { refreshMetadata(): Promise<void> };
  managerInternals.refreshMetadata = async () => {};
  const session = manager.getSession("local-session");
  const internals = session as unknown as {
    activeAssistantMessageId?: string;
    streamingMessage?: ThreadMessage;
    handleEvent(event: PiEvent): void;
    publishMessagesAndSetRunning(running: boolean): void;
  };
  const assistantId = "unused-optimistic-assistant";
  internals.activeAssistantMessageId = assistantId;
  internals.streamingMessage = {
    id: assistantId,
    role: "assistant",
    content: [{ type: "text", text: "", status: { type: "running" } }],
    status: { type: "running" },
    createdAt: new Date(0),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
      isOptimistic: true,
    },
  };
  internals.publishMessagesAndSetRunning(true);

  internals.handleEvent({ type: "command_done", sequence: 0 });

  assert.equal(session.getSnapshot().isRunning, false);
  assert.equal(session.getSnapshot().messages.length, 0);
  assert.equal(internals.activeAssistantMessageId, undefined);
});

test("does not leave an empty assistant message when native vision skips preprocessing", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const managerInternals = manager as unknown as { refreshMetadata(): Promise<void> };
  managerInternals.refreshMetadata = async () => {};
  const session = manager.getSession("local-session");
  const internals = session as unknown as {
    activeAssistantMessageId?: string;
    liveMessages: ThreadMessage[];
    streamingMessage?: ThreadMessage;
    handleEvent(event: PiEvent): void;
    publishMessagesAndSetRunning(running: boolean): void;
  };
  const assistantId = "native-vision-assistant";
  internals.liveMessages = [
    {
      id: "native-vision-user",
      role: "user",
      content: [{ type: "text", text: "Describe this image" }],
      attachments: [],
      createdAt: new Date(1_000),
      metadata: { custom: { workbenchPromptRpcId: "native-vision-rpc" } },
    },
  ];
  internals.activeAssistantMessageId = assistantId;
  internals.streamingMessage = {
    id: assistantId,
    role: "assistant",
    content: [{ type: "text", text: "", status: { type: "running" } }],
    status: { type: "running" },
    createdAt: new Date(1_000),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: { workbenchPromptRpcId: "native-vision-rpc" },
      isOptimistic: true,
    },
  };
  internals.publishMessagesAndSetRunning(true);

  internals.handleEvent({
    type: "message",
    sequence: 0,
    role: "custom",
    customType: "workbench.attachment-recognition.v1",
    content: "",
    display: true,
    details: {
      version: 1,
      operationId: "native-vision-operation",
      submissionId: "native-vision-submission",
      rpcId: "native-vision-rpc",
      revision: 0,
      status: "skipped",
      method: "native",
      attachmentCount: 1,
      completedCount: 0,
      progress: 0,
      timestamps: { createdAt: 1_000, updatedAt: 1_100, completedAt: 1_100 },
    },
    timestamp: 1_100,
  });

  assert.deepEqual(
    session.getSnapshot().messages.map((message) => message.role),
    ["user", "assistant"],
  );
  internals.handleEvent({ type: "command_done", sequence: 1 });
  assert.deepEqual(
    session.getSnapshot().messages.map((message) => message.role),
    ["user"],
  );
  assert.equal(internals.activeAssistantMessageId, undefined);
});

test("replaces the optimistic assistant with a durable prompt failure inside the conversation", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const managerInternals = manager as unknown as { refreshMetadata(): Promise<void> };
  managerInternals.refreshMetadata = async () => {};
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    activeAssistantMessageId?: string;
    liveMessages: ThreadMessage[];
    streamingMessage?: ThreadMessage;
    handleEvent(event: PiEvent): void;
    publishMessagesAndSetRunning(running: boolean): void;
  };
  const assistantId = "prompt-failure-assistant";
  internals.liveMessages = [
    {
      id: "prompt-failure-user",
      role: "user",
      content: [{ type: "text", text: "Describe this image" }],
      attachments: [],
      createdAt: new Date(1_000),
      metadata: {
        custom: {
          piOptimistic: true,
          workbenchPromptRpcId: "session.prompt:image",
        },
        isOptimistic: true,
      },
    },
  ];
  internals.activeAssistantMessageId = assistantId;
  internals.streamingMessage = {
    id: assistantId,
    role: "assistant",
    content: [{ type: "text", text: "", status: { type: "running" } }],
    status: { type: "running" },
    createdAt: new Date(1_000),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: { workbenchPromptRpcId: "session.prompt:image" },
      isOptimistic: true,
    },
  };
  internals.publishMessagesAndSetRunning(true);

  internals.handleEvent({
    type: "message_end",
    sequence: 0,
    message: {
      role: "custom",
      customType: "workbench.prompt-failure.v1",
      content: "",
      display: false,
      details: {
        version: 1,
        submissionId: "image-submission",
        code: "image-input-unsupported",
        rpcId: "session.prompt:image",
        userEntryId: "persisted-image-user",
      },
      timestamp: 1_100,
    },
  });

  const snapshot = session.getSnapshot();
  assert.equal(snapshot.isRunning, false);
  assert.deepEqual(
    snapshot.messages.map((message) => message.role),
    ["user", "assistant"],
  );
  const failure = snapshot.messages[1];
  assert.equal(failure?.id, assistantId);
  assert.equal(failure?.role, "assistant");
  if (failure?.role === "assistant") {
    assert.deepEqual(failure.status, {
      type: "incomplete",
      reason: "error",
      error: "image-input-unsupported",
    });
    assert.deepEqual(failure.metadata.custom.workbenchPromptFailure, {
      version: 1,
      submissionId: "image-submission",
      code: "image-input-unsupported",
      rpcId: "session.prompt:image",
      userEntryId: "persisted-image-user",
    });
  }
  assert.equal(snapshot.messages[0]?.metadata.custom.piResolvedEntryId, "persisted-image-user");
  assert.equal(internals.streamingMessage, undefined);
  assert.equal(internals.activeAssistantMessageId, undefined);
});

test("records a terminal accepted prompt without leaving the thread list running", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const internals = manager as unknown as {
    setSummary(value: PiSessionSummary): boolean;
  };
  internals.setSummary(summary({ firstMessage: "", running: true }));

  manager.notePrompt("remote-session", "Describe this image", false);

  assert.equal(manager.getThreadCustom("remote-session")?.piRunning, false);
  assert.equal(manager.getThreadListItemSnapshot("remote-session")?.title, "Describe this image");
});

test("keeps a late attachment-recognition event on its original turn", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const originalUser: ThreadMessage = {
    id: "original-attachment-user",
    role: "user",
    content: [{ type: "text", text: "Read the original image" }],
    attachments: [],
    createdAt: new Date(1_000),
    metadata: {
      custom: {
        workbenchComposerSubmissionId: "original-attachment-submission",
        workbenchComposerProjectionResolved: true,
        workbenchPromptRpcId: "original-attachment-rpc",
      },
    },
  };
  const originalAssistant: ThreadMessage = {
    id: "original-attachment-assistant",
    role: "assistant",
    content: [{ type: "text", text: "Original answer", status: { type: "complete" } }],
    status: { type: "complete", reason: "stop" },
    createdAt: new Date(2_000),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  };
  const currentUser: ThreadMessage = {
    id: "current-text-user",
    role: "user",
    content: [{ type: "text", text: "This is a new turn without an attachment" }],
    attachments: [],
    createdAt: new Date(3_000),
    metadata: {
      custom: { piOptimistic: true, workbenchPromptRpcId: "current-text-rpc" },
      isOptimistic: true,
    },
  };
  const currentAssistant: ThreadMessage = {
    id: "current-text-assistant",
    role: "assistant",
    content: [{ type: "text", text: "", status: { type: "running" } }],
    status: { type: "running" },
    createdAt: new Date(3_000),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: { workbenchPromptRpcId: "current-text-rpc" },
      isOptimistic: true,
    },
  };
  const internals = session as unknown as {
    baseMessages: ThreadMessage[];
    baseMessageRepository: {
      headId: string | null;
      messages: Array<{ message: ThreadMessage; parentId: string | null }>;
    };
    liveMessages: ThreadMessage[];
    streamingMessage?: ThreadMessage;
    localRunLeaseActive: boolean;
    handleEvent(event: PiEvent): void;
    publishMessagesAndSetRunning(running: boolean): void;
  };
  internals.baseMessages = [originalUser, originalAssistant];
  internals.baseMessageRepository = {
    headId: originalAssistant.id,
    messages: [
      { message: originalUser, parentId: null },
      { message: originalAssistant, parentId: originalUser.id },
    ],
  };
  internals.liveMessages = [currentUser];
  internals.streamingMessage = currentAssistant;
  internals.localRunLeaseActive = true;
  internals.publishMessagesAndSetRunning(true);

  internals.handleEvent({
    type: "message",
    sequence: 0,
    role: "custom",
    customType: "workbench.attachment-recognition.v1",
    content: "",
    display: true,
    details: {
      version: 1,
      operationId: "original-attachment-operation",
      submissionId: "original-attachment-submission",
      rpcId: "original-attachment-rpc",
      revision: 2,
      status: "succeeded",
      method: "ocr",
      providerId: "paddleocr",
      attachmentCount: 1,
      completedCount: 1,
      progress: 1,
      results: [{ attachmentId: "image-1", format: "text", text: "Original OCR" }],
      timestamps: { createdAt: 1_100, updatedAt: 3_100, completedAt: 3_100 },
    },
    timestamp: 3_100,
  });

  const messages = session.getSnapshot().messages;
  const updatedOriginal = messages.find((message) => message.id === originalAssistant.id);
  const untouchedCurrent = messages.find((message) => message.id === currentAssistant.id);
  assert.equal(
    updatedOriginal?.content.some(
      (part) =>
        part.type === "data" &&
        typeof part.data === "object" &&
        part.data !== null &&
        "operationId" in part.data &&
        part.data.operationId === "original-attachment-operation",
    ),
    true,
  );
  assert.equal(
    untouchedCurrent?.content.some((part) => part.type === "data"),
    false,
    "a late event from the previous prompt must not appear in the current assistant turn",
  );
});

test("keeps a late failed recognition before a newer attachment-free running turn", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const originalUser: ThreadMessage = {
    id: "failed-attachment-user",
    role: "user",
    content: [{ type: "text", text: "Read the old attachment" }],
    attachments: [],
    createdAt: new Date(1_000),
    metadata: {
      custom: {
        workbenchComposerSubmissionId: "failed-attachment-submission",
        workbenchComposerProjectionResolved: true,
        workbenchPromptRpcId: "failed-attachment-rpc",
      },
    },
  };
  const currentUser: ThreadMessage = {
    id: "attachment-free-user",
    role: "user",
    content: [{ type: "text", text: "This turn has no attachment" }],
    attachments: [],
    createdAt: new Date(2_000),
    metadata: {
      custom: {
        workbenchComposerSubmissionId: "attachment-free-submission",
        workbenchComposerProjectionResolved: true,
        workbenchPromptRpcId: "attachment-free-rpc",
      },
    },
  };
  const currentAssistant: ThreadMessage = {
    id: "attachment-free-assistant",
    role: "assistant",
    content: [{ type: "text", text: "Current answer", status: { type: "running" } }],
    status: { type: "running" },
    createdAt: new Date(2_000),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: { workbenchPromptRpcId: "attachment-free-rpc" },
      isOptimistic: true,
    },
  };
  const internals = session as unknown as {
    baseMessages: ThreadMessage[];
    baseMessageRepository: {
      headId: string | null;
      messages: Array<{ message: ThreadMessage; parentId: string | null }>;
    };
    liveMessages: ThreadMessage[];
    streamingMessage?: ThreadMessage;
    localRunLeaseActive: boolean;
    handleEvent(event: PiEvent): void;
    publishMessagesAndSetRunning(running: boolean): void;
  };
  internals.baseMessages = [originalUser, currentUser];
  internals.baseMessageRepository = {
    headId: currentUser.id,
    messages: [
      { message: originalUser, parentId: null },
      { message: currentUser, parentId: originalUser.id },
    ],
  };
  internals.liveMessages = [];
  internals.streamingMessage = currentAssistant;
  internals.localRunLeaseActive = true;
  internals.publishMessagesAndSetRunning(true);

  internals.handleEvent({
    type: "message",
    sequence: 0,
    role: "custom",
    customType: "workbench.attachment-recognition.v1",
    content: "",
    display: true,
    details: {
      version: 1,
      operationId: "failed-attachment-operation",
      submissionId: "failed-attachment-submission",
      rpcId: "failed-attachment-rpc",
      revision: 2,
      status: "failed",
      method: "ocr",
      providerId: "paddleocr",
      attachmentCount: 1,
      completedCount: 0,
      progress: 0,
      errorCode: "provider-invalid-response",
      timestamps: { createdAt: 1_000, updatedAt: 2_100, completedAt: 2_100 },
    },
    timestamp: 2_100,
  });

  const messages = session.getSnapshot().messages;
  const recognitionIndex = messages.findIndex(
    (message) =>
      message.role === "assistant" &&
      message.content.some(
        (part) =>
          part.type === "data" &&
          typeof part.data === "object" &&
          part.data !== null &&
          "operationId" in part.data &&
          part.data.operationId === "failed-attachment-operation",
      ),
  );
  const currentUserIndex = messages.findIndex((message) => message.id === currentUser.id);
  const untouchedCurrent = messages.find((message) => message.id === currentAssistant.id);
  assert.equal(recognitionIndex, 1);
  assert.equal(currentUserIndex, 2);
  assert.equal(
    untouchedCurrent?.content.some((part) => part.type === "data"),
    false,
    "the previous OCR failure must not appear in the attachment-free assistant turn",
  );
});

test("does not replay cached attachment recognition into a newer running turn", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const recognition = {
    version: 1 as const,
    operationId: "cached-attachment-operation",
    submissionId: "cached-attachment-submission",
    rpcId: "cached-attachment-rpc",
    revision: 2,
    status: "succeeded" as const,
    method: "ocr" as const,
    providerId: "paddleocr",
    attachmentCount: 1,
    completedCount: 1,
    progress: 1,
    results: [{ attachmentId: "image-1", format: "text" as const, text: "Cached OCR" }],
    timestamps: { createdAt: 1_000, updatedAt: 2_000, completedAt: 2_000 },
  };
  const originalUser: ThreadMessage = {
    id: "cached-attachment-user",
    role: "user",
    content: [{ type: "text", text: "Read the cached image" }],
    attachments: [],
    createdAt: new Date(1_000),
    metadata: {
      custom: {
        workbenchComposerSubmissionId: recognition.submissionId,
        workbenchComposerProjectionResolved: true,
        workbenchPromptRpcId: recognition.rpcId,
      },
    },
  };
  const originalAssistant: ThreadMessage = {
    id: "cached-attachment-assistant",
    role: "assistant",
    content: [{ type: "text", text: "Cached answer", status: { type: "complete" } }],
    status: { type: "complete", reason: "stop" },
    createdAt: new Date(2_000),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  };
  const currentAssistant: ThreadMessage = {
    id: "new-running-assistant",
    role: "assistant",
    content: [{ type: "text", text: "", status: { type: "running" } }],
    status: { type: "running" },
    createdAt: new Date(3_000),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: { workbenchPromptRpcId: "new-running-rpc" },
      isOptimistic: true,
    },
  };
  const internals = session as unknown as {
    attachmentRecognitionSnapshots: Map<string, typeof recognition>;
    streamingMessage?: ThreadMessage;
    snapshotValue: ReturnType<typeof session.getSnapshot>;
    mergeAttachmentRecognitionHistory(messages: readonly ThreadMessage[]): ThreadMessage[];
  };
  internals.attachmentRecognitionSnapshots.set(recognition.operationId, recognition);
  internals.streamingMessage = currentAssistant;
  internals.snapshotValue = { ...internals.snapshotValue, isRunning: true };

  const reconciled = internals.mergeAttachmentRecognitionHistory([originalUser, originalAssistant]);
  const updatedOriginal = reconciled.find((message) => message.id === originalAssistant.id);
  assert.equal(
    updatedOriginal?.content.some((part) => part.type === "data"),
    true,
  );
  assert.equal(
    internals.streamingMessage?.content.some((part) => part.type === "data"),
    false,
    "history refresh must not copy an earlier OCR result into the new assistant",
  );
});

test("updates a built-in command response from running to success without a silent gap", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    handleEvent(event: PiEvent): void;
  };
  const details = {
    version: 1,
    submissionId: "submission-live",
    source: "pi",
    commandId: "compact",
    label: "Compact",
  } as const;

  internals.handleEvent({
    type: "message",
    sequence: 0,
    role: "custom",
    customType: "workbench.composer-command-response.v1",
    content: "",
    display: true,
    details: { ...details, status: "running" },
    timestamp: 1_000,
  });

  let [response] = session.getSnapshot().messages;
  assert.equal(response?.role, "system");
  assert.equal(response?.createdAt.getTime(), 1_000);
  assert.equal(
    (response?.metadata.custom.workbenchComposerCommandResponse as { status?: string } | undefined)
      ?.status,
    "running",
  );

  internals.handleEvent({
    type: "compaction_end",
    sequence: 1,
    reason: "manual",
    result: { tokensBefore: 42_000, estimatedTokensAfter: 8_000 },
  });
  assert.equal(
    session.getSnapshot().messages.length,
    1,
    "the generic compaction separator must not duplicate an active command state",
  );

  internals.handleEvent({
    type: "message",
    sequence: 2,
    role: "custom",
    customType: "workbench.composer-command-response.v1",
    content: "",
    display: true,
    details: { ...details, status: "success" },
    timestamp: 2_000,
  });

  [response] = session.getSnapshot().messages;
  assert.equal(session.getSnapshot().messages.length, 1);
  assert.equal(response?.createdAt.getTime(), 1_000);
  assert.equal(
    (response?.metadata.custom.workbenchComposerCommandResponse as { status?: string } | undefined)
      ?.status,
    "success",
  );
});

test("updates image recognition in place and preserves the original image at user message end", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    handleEvent(event: PiEvent): void;
    liveMessages: ThreadMessage[];
    publishMessages(): void;
  };
  const originalImage = "data:image/png;base64,iVBORw0KGgo=";
  internals.liveMessages = [
    {
      id: "optimistic-image-user",
      role: "user",
      content: [
        { type: "text", text: "Read the image" },
        { type: "image", image: originalImage },
      ],
      attachments: [],
      createdAt: new Date(1_000),
      metadata: {
        custom: {
          piOptimistic: true,
          workbenchPromptRpcId: "image-prompt-rpc",
        },
        isOptimistic: true,
      },
    },
  ];
  internals.publishMessages();

  const common = {
    version: 1 as const,
    operationId: "image-operation-live",
    submissionId: "image-submission-live",
    rpcId: "image-prompt-rpc",
    method: "ocr" as const,
    providerId: "glm-ocr",
    attachmentCount: 1,
    timestamps: { createdAt: 1_100, updatedAt: 1_100 },
  };
  internals.handleEvent({
    type: "message",
    sequence: 0,
    role: "custom",
    customType: "workbench.attachment-recognition.v1",
    content: "",
    display: true,
    details: {
      ...common,
      revision: 0,
      status: "pending",
      completedCount: 0,
      progress: 0,
    },
    timestamp: 1_100,
  });
  internals.handleEvent({
    type: "message",
    sequence: 1,
    role: "custom",
    customType: "workbench.attachment-recognition.v1",
    content: "",
    display: true,
    details: {
      ...common,
      revision: 1,
      status: "running",
      stage: "recognizing",
      completedCount: 0,
      progress: 0.5,
      timestamps: { createdAt: 1_100, updatedAt: 1_200 },
    },
    timestamp: 1_200,
  });
  internals.handleEvent({
    type: "message",
    sequence: 2,
    role: "custom",
    customType: "workbench.attachment-recognition.v1",
    content: "",
    display: true,
    details: {
      ...common,
      revision: 2,
      status: "succeeded",
      completedCount: 1,
      progress: 1,
      results: [
        {
          attachmentId: "image-1",
          format: "text",
          text: "Recognized live result",
        },
      ],
      timestamps: { createdAt: 1_100, updatedAt: 1_300, completedAt: 1_300 },
    },
    timestamp: 1_300,
  });

  let snapshot = session.getSnapshot();
  let user = snapshot.messages[0];
  let assistant = snapshot.messages[1];
  assert.deepEqual(
    snapshot.messages.map((message) => message.role),
    ["user", "assistant"],
  );
  assert.equal(user?.id, "optimistic-image-user");
  assert.equal(
    user?.content.filter(
      (part) => part.type === "data" && part.name === "workbench.attachment-recognition",
    ).length,
    0,
  );
  const recognition = assistant?.content.find(
    (part) => part.type === "data" && part.name === "workbench.attachment-recognition",
  );
  assert.equal(
    recognition?.type === "data" ? (recognition.data as { status?: string }).status : undefined,
    "succeeded",
  );
  assert.deepEqual(
    recognition?.type === "data" ? (recognition.data as { results?: unknown }).results : undefined,
    [{ attachmentId: "image-1", format: "text", text: "Recognized live result" }],
  );
  const recognitionAssistantId = assistant?.id;

  internals.handleEvent({
    type: "message_end",
    sequence: 3,
    message: { role: "user", content: "compiled text-only prompt", timestamp: 2_000 },
    workbenchComposer: {
      version: 1,
      submissionId: "image-submission-live",
      sourceText: "Read the image",
      document: [{ type: "text", text: "Read the image" }],
      hidden: true,
    },
  });

  snapshot = session.getSnapshot();
  user = snapshot.messages[0];
  assistant = snapshot.messages[1];
  assert.equal(snapshot.messages.length, 2);
  assert.equal(user?.id, "optimistic-image-user");
  assert.equal(
    user?.content.some((part) => part.type === "image" && part.image === originalImage),
    true,
  );
  assert.equal(
    user?.content.filter(
      (part) => part.type === "data" && part.name === "workbench.attachment-recognition",
    ).length,
    0,
  );
  assert.equal(user?.metadata.custom.workbenchComposerSubmissionId, "image-submission-live");
  assert.equal(assistant?.id, recognitionAssistantId);
  assert.equal(assistant?.role, "assistant");
  assert.equal(
    assistant?.content[0]?.type === "data"
      ? (assistant.content[0].data as { status?: string }).status
      : undefined,
    "succeeded",
  );
  assert.deepEqual(
    assistant?.content[0]?.type === "data"
      ? (assistant.content[0].data as { results?: unknown }).results
      : undefined,
    [{ attachmentId: "image-1", format: "text", text: "Recognized live result" }],
  );
});

test("publishes image-recognition updates through the repository for a base-history user", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const user: ThreadMessage = {
    id: "base-image-user",
    role: "user",
    content: [{ type: "text", text: "Read the persisted image" }],
    attachments: [],
    createdAt: new Date(1_000),
    metadata: {
      custom: { workbenchComposerSubmissionId: "base-image-submission" },
    },
  };
  const internals = session as unknown as {
    baseMessages: ThreadMessage[];
    baseMessageRepository: {
      headId: string | null;
      messages: Array<{ message: ThreadMessage; parentId: string | null }>;
    };
    handleEvent(event: PiEvent): void;
    publishMessages(): void;
  };
  internals.baseMessages = [user];
  internals.baseMessageRepository = {
    headId: user.id,
    messages: [{ message: user, parentId: null }],
  };
  internals.publishMessages();

  internals.handleEvent({
    type: "message",
    sequence: 0,
    role: "custom",
    customType: "workbench.attachment-recognition.v1",
    content: "",
    display: true,
    details: {
      version: 1,
      operationId: "base-image-operation",
      submissionId: "base-image-submission",
      revision: 0,
      status: "pending",
      method: "ocr",
      providerId: "glm-ocr",
      attachmentCount: 1,
      completedCount: 0,
      progress: 0,
      timestamps: { createdAt: 1_100, updatedAt: 1_100 },
    },
    timestamp: 1_100,
  });

  const snapshot = session.getSnapshot();
  assert.deepEqual(
    snapshot.messages.map((message) => message.role),
    ["user", "assistant"],
  );
  assert.equal(
    snapshot.messages[0]?.content.some(
      (part) => part.type === "data" && part.name === "workbench.attachment-recognition",
    ),
    false,
  );
  const visiblePart = snapshot.messages[1]?.content.find(
    (part) => part.type === "data" && part.name === "workbench.attachment-recognition",
  );
  const repositoryAssistant = snapshot.messageRepository.messages.find(
    (item) => item.message.role === "assistant",
  );
  const repositoryPart = repositoryAssistant?.message.content.find(
    (part) => part.type === "data" && part.name === "workbench.attachment-recognition",
  );
  assert.equal(
    visiblePart?.type === "data" ? (visiblePart.data as { status?: string }).status : undefined,
    "pending",
  );
  assert.equal(
    repositoryPart?.type === "data"
      ? (repositoryPart.data as { status?: string }).status
      : undefined,
    "pending",
  );
  assert.equal(snapshot.messageRepository.messages[0]?.message.id, user.id);
  assert.equal(snapshot.messageRepository.messages[0]?.parentId, null);
  assert.equal(repositoryAssistant?.parentId, user.id);
  assert.equal(snapshot.messageRepository.headId, repositoryAssistant?.message.id);
  assert.doesNotThrow(() => repositoryMessages(snapshot.messageRepository));
});

test("does not let stale history replace a newer image-recognition revision", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const pending = {
    version: 1 as const,
    operationId: "stale-history-image-operation",
    submissionId: "stale-history-image-submission",
    revision: 0,
    status: "pending" as const,
    method: "ocr" as const,
    providerId: "glm-ocr",
    attachmentCount: 1,
    completedCount: 0,
    progress: 0,
    timestamps: { createdAt: 1_000, updatedAt: 1_000 },
  };
  const succeeded = {
    ...pending,
    revision: 2,
    status: "succeeded" as const,
    completedCount: 1,
    progress: 1,
    timestamps: { createdAt: 1_000, updatedAt: 1_200, completedAt: 1_200 },
  };
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
    assert.equal(request.method, "session.history");
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: {
          events: [
            {
              event: {
                type: "message",
                seq: 0,
                time: 1_000,
                entryId: "stale-history-image-pending",
                data: {
                  role: "custom",
                  customType: "workbench.attachment-recognition.v1",
                  content: "",
                  display: true,
                  details: pending,
                  timestamp: 1_000,
                },
              },
            },
            {
              event: {
                type: "message",
                seq: 1,
                time: 1_100,
                entryId: "stale-history-image-user",
                data: {
                  role: "user",
                  content: "compiled text-only prompt",
                  timestamp: 1_100,
                  workbenchComposer: {
                    version: 1,
                    submissionId: pending.submissionId,
                    sourceText: "Read the image",
                    hidden: true,
                  },
                },
              },
            },
          ],
          hasMore: false,
        },
      },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as { handleEvent(event: PiEvent): void };
  internals.handleEvent({
    type: "message",
    sequence: 10,
    role: "custom",
    customType: "workbench.attachment-recognition.v1",
    content: "",
    display: true,
    details: succeeded,
    timestamp: 1_200,
  });

  await session.reload();

  const recognitionStatus = (message: ThreadMessage | undefined): string | undefined => {
    const part = message?.content.find(
      (candidate) =>
        candidate.type === "data" && candidate.name === "workbench.attachment-recognition",
    );
    return part?.type === "data" ? (part.data as { status?: string }).status : undefined;
  };
  let snapshot = session.getSnapshot();
  assert.deepEqual(
    snapshot.messages.map((message) => message.role),
    ["user", "assistant"],
  );
  assert.equal(recognitionStatus(snapshot.messages[0]), undefined);
  assert.equal(recognitionStatus(snapshot.messages[1]), "succeeded");
  assert.equal(
    recognitionStatus(
      snapshot.messageRepository.messages.find((item) => item.message.role === "assistant")
        ?.message,
    ),
    "succeeded",
  );

  internals.handleEvent({
    type: "message",
    sequence: 11,
    role: "custom",
    customType: "workbench.attachment-recognition.v1",
    content: "",
    display: true,
    details: succeeded,
    timestamp: 1_200,
  });
  snapshot = session.getSnapshot();
  assert.equal(recognitionStatus(snapshot.messages[0]), undefined);
  assert.equal(recognitionStatus(snapshot.messages[1]), "succeeded");
  assert.equal(
    recognitionStatus(
      snapshot.messageRepository.messages.find((item) => item.message.role === "assistant")
        ?.message,
    ),
    "succeeded",
  );
  assert.doesNotThrow(() => repositoryMessages(snapshot.messageRepository));
});

test("binds a created session without starting a redundant metadata pull", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
    assert.equal(request.method, "session.create");
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: { sessionId: "remote-session" } },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  let refreshCount = 0;
  const internals = manager as unknown as {
    start(): Promise<void>;
    refreshMetadata(): Promise<void>;
    requestRealtimeRefresh(): void;
  };
  internals.start = async () => {};
  internals.refreshMetadata = async () => {
    refreshCount += 1;
  };
  internals.requestRealtimeRefresh = () => {};

  manager.setDraftWorkspace("local-session", {
    id: "workspace-1",
    name: "Workspace",
    cwd: "/workspace",
  });
  const session = manager.getSession("local-session");
  const summary = await manager.ensureRemote(session);

  assert.equal(summary.id, "remote-session");
  assert.equal(session.remoteId, "remote-session");
  assert.equal(refreshCount, 0);
});

test("coalesces initialization while manager startup is pending", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let createCount = 0;
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
    assert.equal(request.method, "session.create");
    createCount += 1;
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: { sessionId: "coalesced-remote-session" } },
    });
  };

  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  let releaseStart!: () => void;
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  const internals = manager as unknown as {
    start(): Promise<void>;
    requestRealtimeRefresh(): void;
  };
  internals.start = () => startGate;
  internals.requestRealtimeRefresh = () => {};

  manager.setDraftWorkspace("local-session", {
    id: "workspace-1",
    name: "Workspace",
    cwd: "/workspace",
  });
  const session = manager.getSession("local-session");
  const initialize = manager.initialize("local-session");
  await new Promise<void>((resolve) => setImmediate(resolve));

  manager.setDraftWorkspace("local-session", undefined);
  const ensureFromOnNew = manager.ensureRemote(session);
  releaseStart();

  const [initialized, ensured] = await Promise.all([initialize, ensureFromOnNew]);
  assert.equal(initialized.remoteId, "coalesced-remote-session");
  assert.equal(ensured.id, "coalesced-remote-session");
  assert.equal(session.remoteId, "coalesced-remote-session");
  assert.equal(createCount, 1);
});

test("applies rich host session deltas to the Headless thread list", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const internals = manager as unknown as {
    start(): Promise<void>;
    handleHostFrame(payload: HostStreamPayload, generation: number): void;
    requestRealtimeRefresh(): void;
  };
  internals.start = async () => {};
  let refreshCount = 0;
  internals.requestRealtimeRefresh = () => {
    refreshCount += 1;
  };

  const initial = summary();
  internals.handleHostFrame(
    {
      type: "host/session-added",
      sessionId: initial.id,
      blank: false,
      summary: initial,
      cwd: initial.cwd,
    },
    1,
  );
  let listed = manager.threads.getSnapshot();
  assert.deepEqual(
    listed.threads.map((thread) => thread.threadId),
    [initial.id],
  );
  assert.equal(listed.threads[0]?.title, "Realtime title");

  const renamed = summary({ name: "Renamed elsewhere" });
  internals.handleHostFrame(
    { type: "host/session-changed", sessionId: renamed.id, summary: renamed },
    1,
  );
  listed = manager.threads.getSnapshot();
  assert.equal(listed.threads[0]?.title, "Renamed elsewhere");
  assert.equal(refreshCount, 0);
});

test("publishes an archived Headless thread after applying a host delta", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const internals = manager as unknown as {
    start(): Promise<void>;
    handleHostFrame(payload: HostStreamPayload, generation: number): void;
  };
  internals.start = async () => {};

  const created = summary();
  internals.handleHostFrame(
    {
      type: "host/session-added",
      sessionId: created.id,
      blank: false,
      summary: created,
      cwd: created.cwd,
    },
    1,
  );
  let invalidations = 0;
  const unsubscribe = manager.threads.subscribe(() => {
    invalidations += 1;
  });
  t.after(unsubscribe);

  internals.handleHostFrame(
    {
      type: "host/session-archive-changed",
      sessionId: created.id,
      archived: true,
    },
    1,
  );

  assert.ok(invalidations >= 1);
  assert.equal(manager.threads.getSnapshot().threads[0]?.isArchived, true);
});

test("publishes Headless thread-list host deltas", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const internals = manager as unknown as {
    start(): Promise<void>;
    handleHostFrame(payload: HostStreamPayload, generation: number): void;
  };
  internals.start = async () => {};
  let invalidations = 0;
  const unsubscribe = manager.threads.subscribe(() => {
    invalidations += 1;
  });
  t.after(unsubscribe);

  const created = summary();
  internals.handleHostFrame(
    {
      type: "host/session-added",
      sessionId: created.id,
      blank: false,
      summary: created,
      cwd: created.cwd,
    },
    1,
  );
  assert.deepEqual(
    manager.threads.getSnapshot().threads.map((thread) => thread.threadId),
    [created.id],
  );

  internals.handleHostFrame(
    {
      type: "host/session-changed",
      sessionId: created.id,
      summary: { ...created, name: "Metadata-only rename" },
    },
    1,
  );
  internals.handleHostFrame(
    { type: "host/session-status", sessionId: created.id, running: true },
    1,
  );
  assert.equal(manager.threads.getSnapshot().threads[0]?.title, "Metadata-only rename");
  assert.equal(manager.threads.getSnapshot().threads[0]?.isRunning, true);

  internals.handleHostFrame(
    { type: "host/agent-error", sessionId: created.id, message: "Test failure" },
    1,
  );
  assert.equal(manager.threads.getSnapshot().threads[0]?.lastRunFailed, true);
  internals.handleHostFrame(
    { type: "host/session-status", sessionId: created.id, running: true },
    1,
  );
  assert.equal(manager.threads.getSnapshot().threads[0]?.lastRunFailed, true);
  internals.handleHostFrame(
    { type: "host/session-status", sessionId: created.id, running: false },
    1,
  );
  internals.handleHostFrame(
    { type: "host/session-status", sessionId: created.id, running: true },
    1,
  );
  assert.equal(manager.threads.getSnapshot().threads[0]?.lastRunFailed, false);

  internals.handleHostFrame({ type: "host/session-removed", sessionId: created.id }, 1);
  assert.ok(invalidations >= 3);
  assert.deepEqual(manager.threads.getSnapshot().threads, []);
});

test("updates the Headless thread order when pinning changes", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const internals = manager as unknown as {
    start(): Promise<void>;
    handleHostFrame(payload: HostStreamPayload, generation: number): void;
  };
  internals.start = async () => {};

  for (const created of [summary({ id: "thread-a" }), summary({ id: "thread-b" })]) {
    internals.handleHostFrame(
      {
        type: "host/session-added",
        sessionId: created.id,
        blank: false,
        summary: created,
        cwd: created.cwd,
      },
      1,
    );
  }
  let invalidations = 0;
  const unsubscribe = manager.threads.subscribe(() => {
    invalidations += 1;
  });
  t.after(unsubscribe);

  internals.handleHostFrame(
    { type: "host/session-pinned-changed", sessionId: "thread-b", pinned: true },
    1,
  );
  assert.ok(invalidations >= 1);
  assert.deepEqual(
    manager.threads.getSnapshot().threads.map((thread) => thread.threadId),
    ["thread-b", "thread-a"],
  );
});

test("updates the Headless thread order when workspace order changes", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const internals = manager as unknown as {
    start(): Promise<void>;
    handleHostFrame(payload: HostStreamPayload, generation: number): void;
  };
  internals.start = async () => {};

  for (const created of [summary({ id: "thread-a" }), summary({ id: "thread-b" })]) {
    internals.handleHostFrame(
      {
        type: "host/session-added",
        sessionId: created.id,
        blank: false,
        summary: created,
        cwd: created.cwd,
      },
      1,
    );
  }
  const workspace = (workspaceId: string, sessionId: string) => ({
    workspaceId,
    path: `/workspace/${workspaceId}`,
    title: workspaceId,
    sessionIds: [sessionId],
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:01.000Z",
  });
  internals.handleHostFrame(
    { type: "host/workspace-changed", workspace: workspace("workspace-a", "thread-a") },
    1,
  );
  internals.handleHostFrame(
    { type: "host/workspace-changed", workspace: workspace("workspace-b", "thread-b") },
    1,
  );

  assert.deepEqual(
    manager.threads.getSnapshot().threads.map((thread) => thread.threadId),
    ["thread-a", "thread-b"],
  );

  let invalidations = 0;
  const unsubscribe = manager.threads.subscribe(() => {
    invalidations += 1;
  });
  t.after(unsubscribe);

  internals.handleHostFrame(
    {
      type: "host/workspace-order-changed",
      workspaceIds: ["workspace-b", "workspace-a"],
    },
    1,
  );

  assert.ok(invalidations >= 1);
  assert.deepEqual(
    manager.threads.getSnapshot().threads.map((thread) => thread.threadId),
    ["thread-b", "thread-a"],
  );
});

test("does not expose a remote duplicate while the same browser promotes its draft", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const internals = manager as unknown as {
    start(): Promise<void>;
    handleHostFrame(payload: HostStreamPayload, generation: number): void;
    requestedSessionIntents: Map<string, { workspaceId: string; sessionId: string }>;
  };
  internals.start = async () => {};
  internals.requestedSessionIntents.set("local-session", {
    workspaceId: "workspace-1",
    sessionId: "remote-session",
  });
  const created = summary();
  internals.handleHostFrame(
    {
      type: "host/session-added",
      sessionId: created.id,
      blank: false,
      summary: created,
      cwd: created.cwd,
    },
    1,
  );

  assert.deepEqual(manager.threads.getSnapshot().threads, []);
});

test("running-state changes preserve the message activity timestamp", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const internals = manager as unknown as {
    start(): Promise<void>;
    handleHostFrame(payload: HostStreamPayload, generation: number): void;
    updateRunning(remoteId: string, running: boolean): void;
  };
  internals.start = async () => {};
  const created = summary();
  internals.handleHostFrame(
    {
      type: "host/session-added",
      sessionId: created.id,
      blank: false,
      summary: created,
      cwd: created.cwd,
    },
    1,
  );
  const before = manager.threads.getSnapshot().threads[0]?.updatedAt;

  internals.updateRunning(created.id, true);
  internals.updateRunning(created.id, false);

  const after = manager.threads.getSnapshot().threads[0]?.updatedAt;
  assert.equal(after, before);
});

test("applies the correlated prompt admission from events.mux", async (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const internals = manager as unknown as {
    start(): Promise<void>;
    handleHostFrame(payload: HostStreamPayload, generation: number): void;
    handleMuxFrame(frame: ServerRequest<MuxStreamPayload>, generation: number): void;
  };
  internals.start = async () => {};
  const created = summary();
  internals.handleHostFrame(
    {
      type: "host/session-added",
      sessionId: created.id,
      blank: false,
      summary: created,
      cwd: created.cwd,
    },
    1,
  );
  const session = manager.getSession(created.id);
  let acknowledgedRpcId: string | undefined;
  session.acknowledgePrompt = (rpcId) => {
    acknowledgedRpcId = rpcId;
  };

  internals.handleMuxFrame(
    {
      type: "server-request",
      rpcId: "prompt-http-rpc",
      method: "session/prompt-accepted",
      payload: {
        type: "session/prompt-accepted",
        sessionId: created.id,
        mode: "queue",
        running: true,
        runTiming: { startedAt: 1_000, elapsedMs: 250 },
      },
    },
    1,
  );

  assert.equal(acknowledgedRpcId, "prompt-http-rpc");
  assert.equal(manager.isRunning(created.id), true);
  assert.equal(session.getSnapshot().isRunning, true);
  assert.equal(session.getSnapshot().runTiming?.startedAt, 1_000);
  assert.ok((session.getSnapshot().runTiming?.elapsedMs ?? 0) >= 250);
});

test("exposes context trace summaries to visualization subscribers", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const internals = manager as unknown as {
    handleMuxFrame(frame: ServerRequest<MuxStreamPayload>, generation: number): void;
  };
  const received: Array<{ kind: string; seq: number }> = [];
  const unsubscribe = manager.subscribeSessionContextTrace((event) => {
    received.push({ kind: event.kind, seq: event.seq });
    event.seq = 99;
  });

  internals.handleMuxFrame(
    {
      type: "server-request",
      rpcId: "trace-rpc",
      method: "session/context-trace",
      payload: {
        type: "session/context-trace",
        sessionId: "session-1",
        event: {
          schemaVersion: 1,
          traceId: "activation-1:0",
          sessionId: "session-1",
          activationId: "activation-1",
          seq: 0,
          time: 1_725_000_000_000,
          kind: "round-start",
          detailBytes: 48,
          truncated: false,
          redacted: false,
          roundId: "round-1",
        },
      },
    },
    1,
  );
  unsubscribe();
  internals.handleMuxFrame(
    {
      type: "server-request",
      rpcId: "trace-rpc-2",
      method: "session/context-trace",
      payload: {
        type: "session/context-trace",
        sessionId: "session-1",
        event: {
          schemaVersion: 1,
          traceId: "activation-1:1",
          sessionId: "session-1",
          activationId: "activation-1",
          seq: 1,
          time: 1_725_000_000_001,
          kind: "run-start",
          detailBytes: 20,
          truncated: false,
          redacted: false,
        },
      },
    },
    1,
  );

  assert.deepEqual(received, [{ kind: "round-start", seq: 0 }]);
});

test("projects context trace mux events into the active assistant message as Data Parts", async (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("session-parts", "session-parts");
  const sessionInternals = session as unknown as {
    streamingMessage: ThreadMessage;
  };
  sessionInternals.streamingMessage = {
    id: "assistant",
    role: "assistant",
    content: [{ type: "text", text: "The response arrived first.", status: { type: "running" } }],
    status: { type: "running" },
    createdAt: new Date(0),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  };
  const internals = manager as unknown as {
    handleMuxFrame(frame: ServerRequest<MuxStreamPayload>, generation: number): void;
  };

  internals.handleMuxFrame(
    {
      type: "server-request",
      rpcId: "trace-part-rpc",
      method: "session/context-trace",
      payload: {
        type: "session/context-trace",
        sessionId: "session-parts",
        event: {
          schemaVersion: 1,
          traceId: "activation-parts:0",
          sessionId: "session-parts",
          activationId: "activation-parts",
          seq: 0,
          time: 1_725_000_000_000,
          kind: "prompt-composition",
          detailBytes: 48,
          truncated: false,
          redacted: false,
          roundId: "round-parts",
          promptInjections: ["system-prompt", "workspace", "skills", "tools", "extensions"],
          promptResources: {
            cwd: "/workspace",
            systemPromptCharacters: 12,
            systemPromptSourceCount: 1,
            systemPromptSources: [{ kind: "builtin", scope: "builtin" }],
            contextFileCount: 1,
            contextFiles: ["/workspace/AGENTS.md"],
            skills: [{ name: "review", disableModelInvocation: false }],
            extensions: [{ name: "audit", hidden: false }],
            tools: { active: ["read"], total: 1 },
          },
        },
      },
    },
    1,
  );
  internals.handleMuxFrame(
    {
      type: "server-request",
      rpcId: "trace-part-provider-rpc",
      method: "session/context-trace",
      payload: {
        type: "session/context-trace",
        sessionId: "session-parts",
        event: {
          schemaVersion: 1,
          traceId: "activation-parts:1",
          sessionId: "session-parts",
          activationId: "activation-parts",
          seq: 1,
          time: 1_725_000_000_001,
          kind: "provider-request",
          detailBytes: 48,
          truncated: false,
          redacted: false,
          roundId: "round-parts",
        },
      },
    },
    1,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));

  const assistant = session.getSnapshot().messages.find((message) => message.role === "assistant");
  assert.equal(assistant?.role, "assistant");
  if (assistant?.role !== "assistant") return;
  const dataPart = assistant.content.find(
    (part) => part.type === "data" && part.name === "workbench.pi-context-trace-event",
  );
  assert.equal(dataPart?.type, "data");
  assert.equal(
    dataPart?.type === "data" &&
      typeof dataPart.data === "object" &&
      dataPart.data !== null &&
      "event" in dataPart.data &&
      typeof dataPart.data.event === "object" &&
      dataPart.data.event !== null &&
      "traceId" in dataPart.data.event
      ? dataPart.data.event.traceId
      : undefined,
    "activation-parts:0",
  );
  assert.equal(
    assistant.content.filter(
      (part) => part.type === "data" && part.name === "workbench.pi-context-trace-event",
    ).length,
    3,
  );
  assert.deepEqual(
    assistant.content.map((part) => (part.type === "data" ? `data:${part.name}` : part.type)),
    [
      "data:workbench.pi-context-trace-event",
      "data:workbench.pi-context-trace-event",
      "data:workbench.pi-context-trace-event",
      "text",
    ],
  );
});

test("projects one live prompt composition per round until its presentation changes", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("session-live-parts", "session-live-parts");
  const internals = session as unknown as { streamingMessage: ThreadMessage };
  internals.streamingMessage = {
    id: "assistant",
    role: "assistant",
    content: [{ type: "text", text: "Running", status: { type: "running" } }],
    status: { type: "running" },
    createdAt: new Date(0),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  };

  session.applyContextTraceEvent(promptCompositionEvent("activation-live-parts:0", 0, "round-1"));
  session.applyContextTraceEvent(promptCompositionEvent("activation-live-parts:1", 1, "round-1"));
  session.applyContextTraceEvent(
    promptCompositionEvent("activation-live-parts:2", 2, "round-1", ["read", "bash"]),
  );
  session.applyContextTraceEvent(
    promptCompositionEvent("activation-live-parts:3", 3, "round-2", ["read", "bash"]),
  );

  const traceIds = [
    ...new Set(
      internals.streamingMessage.content.flatMap((part) =>
        part.type === "data"
          ? [parsePiContextTraceData(part.data)?.event.traceId].filter(
              (traceId): traceId is string => traceId !== undefined,
            )
          : [],
      ),
    ),
  ].sort();

  assert.deepEqual(traceIds, [
    "activation-live-parts:0",
    "activation-live-parts:2",
    "activation-live-parts:3",
  ]);
});

test("holds an early prompt composition for the next assistant message", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("session-pending-parts", "session-pending-parts");
  const previousAssistant: ThreadMessage = {
    id: "previous-assistant",
    role: "assistant",
    content: [{ type: "text", text: "Previous answer", status: { type: "complete" } }],
    status: { type: "complete", reason: "stop" },
    createdAt: new Date(1_000),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  };
  const sessionInternals = session as unknown as {
    baseMessages: ThreadMessage[];
    pendingContextTraceEvents: unknown[];
    streamingMessage?: ThreadMessage;
    handleEvent(event: PiEvent): void;
  };
  sessionInternals.baseMessages = [previousAssistant];
  const managerInternals = manager as unknown as {
    handleMuxFrame(frame: ServerRequest<MuxStreamPayload>, generation: number): void;
  };

  managerInternals.handleMuxFrame(
    {
      type: "server-request",
      rpcId: "trace-pending-rpc",
      method: "session/context-trace",
      payload: {
        type: "session/context-trace",
        sessionId: "session-pending-parts",
        event: {
          schemaVersion: 1,
          traceId: "activation-pending:0",
          sessionId: "session-pending-parts",
          activationId: "activation-pending",
          seq: 0,
          time: 1_725_000_000_000,
          kind: "prompt-composition",
          detailBytes: 48,
          truncated: false,
          redacted: false,
          roundId: "round-pending",
          promptInjections: ["system-prompt", "tools", "extensions"],
          promptResources: {
            cwd: "/workspace",
            systemPromptCharacters: 12,
            systemPromptSourceCount: 1,
            systemPromptSources: [{ kind: "builtin", scope: "builtin" }],
            contextFileCount: 0,
            contextFiles: [],
            skills: [],
            extensions: [{ name: "audit", hidden: false }],
            tools: { active: ["read"], total: 1 },
          },
        },
      },
    },
    1,
  );

  assert.equal(
    previousAssistant.content.some(
      (part) => part.type === "data" && part.name === "workbench.pi-context-trace-event",
    ),
    false,
  );
  assert.equal(sessionInternals.pendingContextTraceEvents.length, 1);

  sessionInternals.handleEvent({
    type: "message_start",
    sequence: 1,
    message: { role: "assistant", content: [], timestamp: 2_000 },
  });

  assert.equal(sessionInternals.pendingContextTraceEvents.length, 0);
  assert.equal(
    sessionInternals.streamingMessage?.content.filter(
      (part) => part.type === "data" && part.name === "workbench.pi-context-trace-event",
    ).length,
    3,
  );
});

for (const trigger of ["open", "agent_settled"] as const) {
  test(`hydrates persisted prompt-composition Parts on ${trigger} without live trace events`, async (t) => {
    const originalFetch = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = originalFetch;
    });
    const methods: string[] = [];
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
      methods.push(request.method);
      const value =
        request.method === "session.contextTrace.promptParts"
          ? {
              parts: [
                {
                  event: {
                    schemaVersion: 1,
                    traceId: "persisted-activation:1",
                    sessionId: "persisted-session",
                    activationId: "persisted-activation",
                    seq: 1,
                    time: 1_500,
                    kind: "prompt-composition",
                    detailBytes: 128,
                    truncated: false,
                    redacted: false,
                    roundId: "persisted-round",
                    promptPreview: "Explain persistence",
                    promptInjections: [
                      "system-prompt",
                      "workspace",
                      "skills",
                      "tools",
                      "extensions",
                    ],
                    promptResources: {
                      cwd: "/workspace",
                      systemPromptCharacters: 12,
                      systemPromptSourceCount: 1,
                      systemPromptSources: [{ kind: "builtin", scope: "builtin" }],
                      contextFileCount: 1,
                      contextFiles: ["/workspace/AGENTS.md"],
                      skills: [{ name: "review", disableModelInvocation: false }],
                      extensions: [{ name: "audit", hidden: false }],
                      tools: { active: ["read"], total: 1 },
                    },
                  },
                  assistantMessageTimestamp: 2_000,
                },
              ],
            }
          : {
              events: [
                {
                  event: {
                    type: "message",
                    seq: 0,
                    time: 1_000,
                    entryId: "persisted-user",
                    data: { role: "user", content: "Explain persistence", timestamp: 1_000 },
                  },
                },
                {
                  event: {
                    type: "message",
                    seq: 1,
                    time: 2_000,
                    entryId: "persisted-assistant",
                    data: {
                      role: "assistant",
                      content: [{ type: "text", text: "It persists." }],
                      timestamp: 2_000,
                    },
                  },
                },
              ],
              hasMore: false,
            };
      return Response.json({
        type: "server-response",
        rpcId: request.rpcId,
        result: { ok: true, value },
      });
    };

    const manager = new PiSessionManager();
    t.after(() => manager.dispose());
    const session = manager.getSession("persisted-session", "persisted-session");

    if (trigger === "open") {
      await session.open();
    } else {
      manager.refreshMetadata = async () => undefined;
      const internals = session as unknown as {
        handleEvent(event: PiEvent): void;
        reloadTask?: Promise<void>;
      };
      internals.handleEvent({ type: "agent_settled" });
      await internals.reloadTask;
    }

    assert.deepEqual(methods.sort(), ["session.contextTrace.promptParts", "session.history"]);
    const assistant = session
      .getSnapshot()
      .messages.find((message) => message.role === "assistant");
    assert.equal(assistant?.role, "assistant");
    if (assistant?.role !== "assistant") return;
    assert.deepEqual(
      assistant.content.map((part) => (part.type === "data" ? `data:${part.name}` : part.type)),
      [
        "data:workbench.pi-context-trace-event",
        "data:workbench.pi-context-trace-event",
        "data:workbench.pi-context-trace-event",
        "text",
      ],
    );
  });
}
