import type { PiSessionSummary } from "@workbench/agent-runtime-pi-protocol/messages";
import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@workbench/agent-runtime-pi-shared/descriptor";
import {
  AgentCommandCatalogError,
  type AgentCommandCatalogTarget,
} from "@workbench/agent-runtime-server/commands";
import { defineWorkbenchAgentServerAdapterContract } from "@workbench/agent-runtime-testkit/server";

import { createPiAgentExecutionAdapter } from "../../src/agent-runtime/pi-agent-execution-adapter";
import { createPiAgentServerAdapter } from "../../src/agent-runtime/pi-agent-server-adapter";
import { createPiAgentThreadStoreAdapter } from "../../src/agent-runtime/pi-agent-thread-store-adapter";

const commandCases = (
  [
    { kind: "thread", threadId: "contract-thread" },
    { kind: "user" },
    { kind: "project", workspaceId: "contract-workspace" },
  ] satisfies AgentCommandCatalogTarget[]
).map((target) => ({
  target,
  commands: [
    {
      kind: "builtin" as const,
      name: `pi-${target.kind}`,
      invocationName: `pi-${target.kind}`,
      effect: "agent-turn" as const,
      exclusive: false,
    },
  ],
}));

const summary: PiSessionSummary = {
  id: "pi-thread",
  cwd: "/pi-workspace",
  workspace: { id: "pi-workspace", name: "Pi Workspace", cwd: "/pi-workspace" },
  name: "Pi contract thread",
  created: "2026-01-01T00:00:00.000Z",
  modified: "2026-01-02T00:00:00.000Z",
  messageCount: 2,
  firstMessage: "Pi contract message",
  transient: false,
  running: true,
  waitingForUserInput: true,
  runTiming: { startedAt: 1_000, elapsedMs: 250 },
};

defineWorkbenchAgentServerAdapterContract({
  name: "Pi",
  createHarness() {
    const commands = {
      getCatalog: async (target: AgentCommandCatalogTarget) => [
        {
          kind: "builtin" as const,
          name: `pi-${target.kind}`,
          invocationName: `pi-${target.kind}`,
          effect: "agent-turn" as const,
          exclusive: false,
        },
      ],
    };
    const execution = createPiAgentExecutionAdapter({
      submitPrompt: async () => ({ queued: true, queueItemId: "pi-queue" }),
      regenerateSession: async () => undefined,
      resumeSession: async () => undefined,
      selectSessionBranch: async () => undefined,
      updateQueueItem: async () => undefined,
      cancelSession: async () => undefined,
    });
    const threads = createPiAgentThreadStoreAdapter({
      listSessions: async () => ({ sessions: [summary], runningSessionIds: [summary.id] }),
      listSessionSearchText: async () => [
        { sessionId: summary.id, allMessagesText: "Pi searchable content" },
      ],
      createSession: async (_cwd, sessionId) => ({ id: sessionId ?? "pi-created" }),
      renameSession: async () => 9,
      forkSession: async () => ({ id: "pi-forked" }),
      deleteSession: async () => undefined,
    });
    return {
      adapter: createPiAgentServerAdapter({ commands, execution, threads }),
      expectedPorts: { commands, execution, threads },
    };
  },
  expected: {
    id: PI_AGENT_RUNTIME_DESCRIPTOR.id,
    commands: commandCases,
    admission: { kind: "queued", queueItemId: "pi-queue" },
    threadCapabilities: { requestedThreadId: true, preset: false },
    threads: [
      {
        threadId: "pi-thread",
        rootPath: "/pi-workspace",
        title: "Pi contract thread",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        messageCount: 2,
        firstMessage: "Pi contract message",
        transient: false,
        running: true,
        waitingForUserInput: true,
        runTiming: { startedAt: 1_000, elapsedMs: 250 },
      },
    ],
    created: { threadId: "contract-created" },
    renamed: { stateToken: "9" },
    optional: {
      regeneration: true,
      resume: true,
      branches: true,
      queue: true,
      searchDocuments: [{ threadId: "pi-thread", text: "Pi searchable content" }],
      forked: { threadId: "pi-forked" },
    },
  },
  failures: {
    createHarness() {
      const piMissingError = () =>
        Object.assign(new Error("Pi session is missing."), { code: "pi_session_not_found" });
      const commands = {
        getCatalog: async () => {
          throw new AgentCommandCatalogError("thread-not-found", "Pi thread is missing.");
        },
      };
      const execution = createPiAgentExecutionAdapter({
        cancelSession: async () => {
          throw piMissingError();
        },
      });
      const threads = createPiAgentThreadStoreAdapter({
        deleteSession: async () => {
          throw piMissingError();
        },
      });
      return {
        adapter: createPiAgentServerAdapter({ commands, execution, threads }),
      };
    },
    commandCode: "thread-not-found",
    executionCode: "thread-not-found",
    threadCode: "thread-not-found",
  },
});
