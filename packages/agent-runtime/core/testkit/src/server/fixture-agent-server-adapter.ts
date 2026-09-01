import type { WorkbenchAgentCommand } from "@workbench/agent-runtime-contracts/commands";
import { AgentCommandCatalogError } from "@workbench/agent-runtime-server/commands";
import { AgentExecutionError } from "@workbench/agent-runtime-server/execution";
import type { WorkbenchAgentServerAdapter } from "@workbench/agent-runtime-server/adapter";
import { AgentThreadStoreError } from "@workbench/agent-runtime-server/threads";

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
      create: async (input) => ({ threadId: input.requestedThreadId ?? "fixture-created" }),
      rename: async () => ({}),
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
