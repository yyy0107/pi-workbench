import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { before } from "node:test";
import type { AppendMessage } from "@assistant-ui/react";

import type { PiEvent, PiSessionSummary } from "../../contracts";
import type { HostStreamPayload, MuxStreamPayload, ServerRequest } from "../../stream-contracts";

let PiSessionManager: typeof import("./manager").PiSessionManager;

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

before(async () => {
  const moduleHooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) {
        return nextResolve(
          new URL(`../../../../${specifier.slice(2)}.ts`, import.meta.url).href,
          context,
        );
      }
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
  ({ PiSessionManager } = (await import(
    new URL("./manager.ts", import.meta.url).href
  )) as typeof import("./manager"));
  moduleHooks.deregister();
});

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
  internals.setSummary(summary());
  internals.workspaces.set("workspace-1", {
    workspaceId: "workspace-1",
    title: "Workspace",
    path: "/workspace",
    sessionIds: ["remote-session"],
  });

  const updateCustom = manager.createThreadListAdapter().updateCustom;
  assert.ok(updateCustom);
  await updateCustom("remote-session", { piPinned: true });
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
    publishMessagesAndSetRunning(running: boolean): void;
  };
  internals.publishMessagesAndSetRunning(true);
  const originalRunStartedAt = session.getSnapshot().runStartedAt;
  assert.equal(typeof originalRunStartedAt, "number");

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
    message: {
      role: "user",
      content:
        'change direction\n\n<pi-workbench-workspace-feedback version="1">\n[]\n</pi-workbench-workspace-feedback>',
      timestamp: 2_000,
    },
  });
  assert.equal(session.getSnapshot().messages.length, 1);
  assert.equal(session.getSnapshot().runStartedAt, originalRunStartedAt);
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
    type: "message_start",
    sequence: 10,
    message: {
      role: "user",
      content: "continue after this turn",
      timestamp: 1_000,
    },
  });

  assert.equal(session.getSnapshot().runStartedAt, 1_000);

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
    liveMessages: import("@assistant-ui/react").ThreadMessage[];
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

test("keeps complete visible history while a paginated refresh backfills older messages", async (t) => {
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
  const internals = session as unknown as {
    baseMessages: import("@assistant-ui/react").ThreadMessage[];
    publishMessages(): void;
  };
  internals.baseMessages = Array.from({ length: 12 }, (_, seq) => ({
    id: `pi-event-${seq}`,
    role: "user" as const,
    content: [{ type: "text" as const, text: String(seq) }],
    attachments: [],
    createdAt: new Date(seq),
    metadata: { custom: { piEntryId: `pi-event-${seq}` } },
  }));
  internals.publishMessages();

  const publishedCounts: number[] = [];
  const unsubscribe = session.subscribe(() => {
    publishedCounts.push(session.getSnapshot().messages.length);
  });
  t.after(unsubscribe);

  const reload = session.reload();
  await backfillStarted;

  assert.equal(session.getSnapshot().messages.length, 12);
  assert.ok(publishedCounts.every((count) => count === 12));

  releaseBackfill?.();
  await reload;

  assert.equal(session.getSnapshot().messages.length, 12);
  assert.ok(publishedCounts.every((count) => count === 12));
});

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
    liveMessages: import("@assistant-ui/react").ThreadMessage[];
    streamingMessage?: import("@assistant-ui/react").ThreadMessage;
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

test("keeps the optimistic turn ids when history persists the running user message", async (t) => {
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
                type: "message",
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
    liveMessages: import("@assistant-ui/react").ThreadMessage[];
    localRunLeaseActive: boolean;
    publishMessagesAndSetRunning(running: boolean): void;
    streamingMessage?: import("@assistant-ui/react").ThreadMessage;
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
});

test("keeps the optimistic assistant between prompt admission and agent start", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    activeAssistantMessageId?: string;
    liveMessages: import("@assistant-ui/react").ThreadMessage[];
    localRunLeaseActive: boolean;
    pendingPromptRpcIds: Set<string>;
    promptRequestPending: boolean;
    publishMessagesAndSetRunning(running: boolean): void;
    streamingMessage?: import("@assistant-ui/react").ThreadMessage;
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
    liveMessages: import("@assistant-ui/react").ThreadMessage[];
    localRunLeaseActive: boolean;
    promptRequestPending: boolean;
    publishMessagesAndSetRunning(running: boolean): void;
    reload(): Promise<void>;
    streamingMessage?: import("@assistant-ui/react").ThreadMessage;
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

test("projects automatic-retry progress until the complete run settles", (t) => {
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
    type: "auto_retry_end",
    sequence: 1,
    success: false,
    attempt: 2,
    finalError: "fetch failed",
  });
  assert.deepEqual(session.getSnapshot().autoRetry, { attempt: 2, maxAttempts: 3 });

  internals.handleEvent({ type: "agent_settled", sequence: 2 });
  assert.equal(session.getSnapshot().autoRetry, undefined);
  assert.equal(session.getSnapshot().isRunning, false);
});

test("keeps the optimistic assistant id from stream start through completion", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const session = manager.getSession("local-session", "remote-session");
  const internals = session as unknown as {
    activeAssistantMessageId?: string;
    streamingMessage?: import("@assistant-ui/react").ThreadMessage;
    liveMessages: import("@assistant-ui/react").ThreadMessage[];
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

test("removes an unused optimistic assistant when a command settles without model output", (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const managerInternals = manager as unknown as { refreshMetadata(): Promise<void> };
  managerInternals.refreshMetadata = async () => {};
  const session = manager.getSession("local-session");
  const internals = session as unknown as {
    activeAssistantMessageId?: string;
    streamingMessage?: import("@assistant-ui/react").ThreadMessage;
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

test("applies rich host session deltas without requesting a list refresh", async (t) => {
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
  let listed = await manager.createThreadListAdapter().list();
  assert.deepEqual(
    listed.threads.map((thread) => thread.remoteId),
    [initial.id],
  );
  assert.equal(listed.threads[0]?.title, "Realtime title");

  const renamed = summary({ name: "Renamed elsewhere" });
  internals.handleHostFrame(
    { type: "host/session-changed", sessionId: renamed.id, summary: renamed },
    1,
  );
  listed = await manager.createThreadListAdapter().list();
  assert.equal(listed.threads[0]?.title, "Renamed elsewhere");
  assert.equal(refreshCount, 0);
});

test("publishes thread-list invalidation after applying an archive host delta", async (t) => {
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
  const unsubscribe = manager.subscribeThreadList(() => {
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

  assert.equal(invalidations, 1);
  const listed = await manager.createThreadListAdapter().list();
  assert.equal(listed.threads[0]?.status, "archived");
});

test("does not expose a remote duplicate while the same browser promotes its draft", async (t) => {
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

  const listed = await manager.createThreadListAdapter().list();
  assert.deepEqual(listed.threads, []);
});

test("running-state changes preserve the message activity timestamp", async (t) => {
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
  const before = (await manager.createThreadListAdapter().list()).threads[0]?.lastMessageAt;

  internals.updateRunning(created.id, true);
  internals.updateRunning(created.id, false);

  const after = (await manager.createThreadListAdapter().list()).threads[0]?.lastMessageAt;
  assert.equal(after?.toISOString(), before?.toISOString());
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
      },
    },
    1,
  );

  assert.equal(acknowledgedRpcId, "prompt-http-rpc");
  assert.equal(manager.isRunning(created.id), true);
  assert.equal(session.getSnapshot().isRunning, true);
});
