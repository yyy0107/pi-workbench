import type { AgentCommandCatalogTarget } from "./agent-command-catalog-port";
import { defineWorkbenchAgentServerAdapterContract } from "./testing/agent-server-adapter-contract";
import {
  createFailingFixtureAgentServerAdapter,
  createFixtureAgentServerAdapter,
} from "./testing/fixture-agent-server-adapter";

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
    searchDocuments: [{ threadId: "fixture-thread", text: "Fixture searchable content" }],
    created: { threadId: "contract-created" },
    renamed: { revision: 1 },
    forked: { threadId: "fixture-forked" },
  },
  failures: {
    createHarness: () => ({ adapter: createFailingFixtureAgentServerAdapter() }),
    commandCode: "thread-not-found",
    executionCode: "thread-not-found",
    threadCode: "thread-not-found",
  },
});
