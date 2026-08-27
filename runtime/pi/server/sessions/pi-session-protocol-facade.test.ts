import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceView } from "@/runtime/pi/contracts/rpc";
import type { AgentExecutionPort } from "@/runtime/server/agent-execution-port";
import type {
  AgentThreadCreateInput,
  AgentThreadStorePort,
  AgentThreadSummary,
} from "@/runtime/server/agent-thread-store-port";

import { createPiSessionProtocolFacade } from "./pi-session-protocol-facade";
import type { SessionRpcWorkspaceStore } from "./session-rpc-service";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

function summary(threadId: string, rootPath = "/workspace"): AgentThreadSummary {
  return {
    threadId,
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messageCount: 0,
    firstMessage: "",
    transient: false,
    running: false,
  };
}

const execution: AgentExecutionPort = {
  submit: async () => ({ kind: "started" }),
  regenerate: async () => {},
  resume: async () => {},
  selectBranch: async () => {},
  updateQueue: async () => {},
  cancel: async () => {},
};

function threadStore(overrides: Partial<AgentThreadStorePort> = {}): AgentThreadStorePort {
  return {
    capabilities: { requestedThreadId: true, preset: false },
    list: async () => [],
    listSearchDocuments: async () => [],
    create: async (input) => ({ threadId: input.requestedThreadId ?? "generated" }),
    rename: async () => ({}),
    fork: async () => ({ threadId: "forked" }),
    delete: async () => {},
    ...overrides,
  };
}

const emptyWorkspaceStore: SessionRpcWorkspaceStore = {
  list: async () => ({ items: [] }),
  attachSession: async () => {
    throw new Error("The test does not attach a workspace.");
  },
  reconcile: async () => ({ items: [] }),
};

test("keeps requested-session creation serialized across independent facade calls", async () => {
  const sessions: AgentThreadSummary[] = [];
  const createEntered = deferred();
  const allowCreate = deferred();
  let createCalls = 0;
  let createdInput: AgentThreadCreateInput | undefined;
  const threads = threadStore({
    list: async () => structuredClone(sessions),
    create: async (input) => {
      createCalls += 1;
      createdInput = input;
      createEntered.resolve();
      await allowCreate.promise;
      sessions.push(summary(input.requestedThreadId!, input.rootPath));
      return { threadId: input.requestedThreadId! };
    },
  });
  const facade = createPiSessionProtocolFacade({
    agent: { execution, threads },
    resolveWorkspaceStore: () => emptyWorkspaceStore,
  });

  const firstRequest = facade.create({ cwd: "/workspace", sessionId: "shared-id" });
  await createEntered.promise;
  const secondRequest = facade.create({ cwd: "/workspace", sessionId: "shared-id" });
  allowCreate.resolve();

  assert.deepEqual(await Promise.all([firstRequest, secondRequest]), [
    { sessionId: "shared-id" },
    { sessionId: "shared-id" },
  ]);
  assert.equal(createCalls, 1);
  assert.deepEqual(createdInput, {
    rootPath: "/workspace",
    requestedThreadId: "shared-id",
  });
});

test("uses a replacement WorkspaceStore without rebuilding the facade", async () => {
  const workspace: WorkspaceView = {
    workspaceId: "workspace-1",
    path: "/workspace",
    title: "Workspace",
    sessionIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const calls: string[] = [];
  const store = (generation: string): SessionRpcWorkspaceStore => ({
    list: async () => {
      calls.push(`${generation}:list`);
      return { items: [structuredClone(workspace)] };
    },
    attachSession: async (_workspaceId, sessionId) => {
      calls.push(`${generation}:attach:${sessionId}`);
      return { workspace: { ...structuredClone(workspace), sessionIds: [sessionId] } };
    },
    reconcile: async () => ({ items: [structuredClone(workspace)] }),
  });
  const firstStore = store("v1");
  const secondStore = store("v2");
  let currentStore = firstStore;
  const sessions: AgentThreadSummary[] = [];
  const threads = threadStore({
    list: async () => structuredClone(sessions),
    create: async (input) => {
      const threadId = input.requestedThreadId!;
      sessions.push(summary(threadId, input.rootPath));
      return { threadId };
    },
  });
  const facade = createPiSessionProtocolFacade({
    agent: { execution, threads },
    resolveWorkspaceStore: () => currentStore,
  });

  await facade.create({ workspaceId: "workspace-1", sessionId: "first" });
  currentStore = secondStore;
  await facade.create({ workspaceId: "workspace-1", sessionId: "second" });

  assert.deepEqual(calls, ["v1:list", "v1:attach:first", "v2:list", "v2:attach:second"]);
});
