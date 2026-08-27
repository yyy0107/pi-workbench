import type { WorkbenchAgentCommand } from "@/runtime/shared/agent-command/catalog";
import { AgentCommandCatalogError } from "../agent-command-catalog-port";
import { AgentExecutionError } from "../agent-execution-port";
import type { WorkbenchAgentServerAdapter } from "../agent-runtime-adapter";
import { AgentThreadStoreError } from "../agent-thread-store-port";

function command(kind: "thread" | "user" | "project"): WorkbenchAgentCommand {
  return {
    kind: "builtin",
    name: `fixture-${kind}`,
    invocationName: `fixture-${kind}`,
    effect: "agent-turn",
    exclusive: false,
  };
}

/** Minimal non-Pi server implementation used to validate the shared conformance suite itself. */
export function createFixtureAgentServerAdapter(): WorkbenchAgentServerAdapter {
  return {
    id: "fixture-agent-server",
    commands: {
      getCatalog: async (target) => [command(target.kind)],
    },
    execution: {
      submit: async () => ({ kind: "started" }),
      regenerate: async () => undefined,
      resume: async () => undefined,
      selectBranch: async () => undefined,
      updateQueue: async () => undefined,
      cancel: async () => undefined,
    },
    threads: {
      capabilities: { requestedThreadId: true, preset: false },
      list: async () => [
        {
          threadId: "fixture-thread",
          rootPath: "/fixture-workspace",
          title: "Fixture thread",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          messageCount: 1,
          firstMessage: "Fixture message",
          transient: false,
          running: false,
        },
      ],
      listSearchDocuments: async () => [
        { threadId: "fixture-thread", text: "Fixture searchable content" },
      ],
      create: async (input) => ({ threadId: input.requestedThreadId ?? "fixture-created" }),
      rename: async () => ({ revision: 1 }),
      fork: async () => ({ threadId: "fixture-forked" }),
      delete: async () => undefined,
    },
  };
}

/** Deterministic failure implementation used to validate stable cross-runtime error laws. */
export function createFailingFixtureAgentServerAdapter(): WorkbenchAgentServerAdapter {
  const adapter = createFixtureAgentServerAdapter();
  return {
    ...adapter,
    commands: {
      getCatalog: async () => {
        throw new AgentCommandCatalogError("thread-not-found", "Fixture thread is missing.");
      },
    },
    execution: {
      ...adapter.execution,
      cancel: async () => {
        throw new AgentExecutionError("thread-not-found", "Fixture thread is missing.");
      },
    },
    threads: {
      ...adapter.threads,
      delete: async () => {
        throw new AgentThreadStoreError("thread-not-found", "Fixture thread is missing.");
      },
    },
  };
}
