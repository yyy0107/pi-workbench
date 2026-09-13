import type { AgentCommandCatalogTarget } from "@workbench/agent-runtime-server/commands";
import {
  createFailingFixtureAgentServerAdapter,
  createFixtureAgentServerAdapter,
  defineWorkbenchAgentServerAdapterContract,
} from "@workbench/agent-runtime-testkit/server";

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
      name: `fixture-${target.kind}`,
      invocationName: `fixture-${target.kind}`,
      effect: "agent-turn" as const,
      exclusive: false,
    },
  ],
}));

defineWorkbenchAgentServerAdapterContract({
  name: "fixture",
  createHarness: () => ({ adapter: createFixtureAgentServerAdapter() }),
  expected: {
    id: "fixture-agent-server",
    commands: commandCases,
    admission: { kind: "started" },
    threadCapabilities: { requestedThreadId: true, preset: false },
    threads: [
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
    created: { threadId: "contract-created" },
    renamed: {},
  },
  failures: {
    createHarness: () => ({ adapter: createFailingFixtureAgentServerAdapter() }),
    commandCode: "thread-not-found",
    executionCode: "thread-not-found",
    threadCode: "thread-not-found",
  },
});
