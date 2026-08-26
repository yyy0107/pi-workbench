import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { before } from "node:test";
import { INTERNAL, type AppendMessage, type ThreadMessage } from "@assistant-ui/react";

import type { PiEvent, PiSessionSummary } from "../../contracts";
import type { SessionHistoryValue } from "../../rpc-contracts";
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

test("fetches a route-selected thread without waiting for full manager startup", async (t) => {
  const manager = new PiSessionManager();
  t.after(() => manager.dispose());
  const internals = manager as unknown as {
    summaries: Map<string, PiSessionSummary>;
    refreshMetadata(): Promise<void>;
    start(): Promise<void>;
  };
  let refreshCount = 0;
  let startCount = 0;
  internals.refreshMetadata = async () => {
    refreshCount += 1;
    internals.summaries.set("route-session", summary({ id: "route-session" }));
  };
  internals.start = async () => {
    startCount += 1;
    throw new Error("fetch must not wait for full startup");
  };

  const fetched = await manager.createThreadListAdapter().fetch("route-session");

  assert.equal(fetched.remoteId, "route-session");
  assert.equal(refreshCount, 1);
  assert.equal(startCount, 0);
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

test("continues a matching checkpoint without regenerating or truncating messages", async (t) => {
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
  const internals = session as unknown as {
    snapshotValue: ReturnType<typeof session.getSnapshot>;
  };
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

  await session.resume("checkpoint-1", "leaf-1");

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
  assert.deepEqual(session.getSnapshot().messages, messages);
  assert.equal(session.getSnapshot().isRunning, true);
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

test("retains a live-only user as the parent when regenerating before history reloads", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
    assert.equal(request.method, "session.regenerate");
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
      custom: { piEventSeq: 4, piResolvedEntryId: "journal-live-user" },
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
    liveMessages: ThreadMessage[];
    publishMessages(): void;
  };
  internals.liveMessages = [user, completedAssistant];
  internals.publishMessages();
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

  const repository = new INTERNAL.MessageRepository();
  assert.doesNotThrow(() => repository.import(snapshot.messageRepository));
  assert.deepEqual(
    repository.getMessages().map((message) => [message.id, message.role]),
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
  const repository = new INTERNAL.MessageRepository();
  assert.doesNotThrow(() => repository.import(snapshot.messageRepository));
  const activeMessages = repository.getMessages();

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
  const completedRepository = new INTERNAL.MessageRepository();
  assert.doesNotThrow(() => completedRepository.import(completedSnapshot.messageRepository));
  const completedMessages = completedRepository.getMessages();
  assert.equal(completedSnapshot.isRunning, false);
  assert.equal(completedMessages.length, 2);
  assert.equal(completedMessages.at(-1)?.status?.type, "complete");
});

test("maps regenerated assistant answers to sibling repository branches", (t) => {
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
  const internals = session as unknown as {
    messageRepositoryFromHistory(
      sessionId: string,
      history: {
        events: never[];
        hasMore: false;
        branches: {
          headLeafId: string;
          items: Array<{
            leafId: string;
            events: Array<typeof userEvent | ReturnType<typeof assistantEvent>>;
          }>;
        };
      },
      activeMessages: readonly ThreadMessage[],
    ): {
      repository: {
        headId: string | null;
        messages: Array<{ message: ThreadMessage; parentId: string | null }>;
      };
      leafByHeadMessageId: Map<string, string>;
    };
  };

  const state = internals.messageRepositoryFromHistory(
    "remote-session",
    {
      events: [],
      hasMore: false,
      branches: {
        headLeafId: "leaf-2",
        items: [
          {
            leafId: "leaf-1",
            events: [userEvent, assistantEvent("journal-assistant-1", "First", 2_000)],
          },
          {
            leafId: "leaf-2",
            events: [userEvent, assistantEvent("journal-assistant-2", "Second", 3_000)],
          },
        ],
      },
    },
    [],
  );
  const byId = new Map(state.repository.messages.map((item) => [item.message.id, item]));
  assert.equal(byId.get("journal-assistant-1")?.parentId, "journal-user-1");
  assert.equal(byId.get("journal-assistant-2")?.parentId, "journal-user-1");
  assert.equal(state.repository.headId, "journal-assistant-2");
  assert.equal(state.leafByHeadMessageId.get("journal-assistant-1"), "leaf-1");
  assert.equal(state.leafByHeadMessageId.get("journal-assistant-2"), "leaf-2");
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

  session.selectBranch("assistant-head");
  const task = internals.branchSwitchTask;
  assert.ok(task);
  await assert.rejects(task, /Branch not found/);

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

  const repository = new INTERNAL.MessageRepository();
  assert.doesNotThrow(() => repository.import(state.repository));
  assert.deepEqual(
    repository.getMessages().map((message) => message.id),
    ["previous-user", "previous-assistant", "composer-marker"],
  );
  repository.switchToBranch(unresolvedPath[1] ?? "");
  assert.deepEqual(
    repository.getMessages().map((message) => message.id),
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

test("applies cumulative transient updates without advancing the durable sequence", async (t) => {
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

  // A host/session-changed summary can still report cleanup as running. It must not reopen the
  // completed assistant-ui run while Pi executes agent_settled extension handlers.
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
  const repository = new INTERNAL.MessageRepository();
  assert.doesNotThrow(() => repository.import(snapshot.messageRepository));
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
  const repository = new INTERNAL.MessageRepository();
  assert.doesNotThrow(() => repository.import(snapshot.messageRepository));
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
