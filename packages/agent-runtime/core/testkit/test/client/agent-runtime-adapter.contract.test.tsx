import {
  createFixtureAgentRuntime,
  defineWorkbenchAgentRuntimeAdapterContract,
} from "@workbench/agent-runtime-testkit/client";

const fixtureCommand = {
  kind: "builtin" as const,
  name: "fixture",
  invocationName: "fixture",
  effect: "agent-turn" as const,
  exclusive: false,
  description: "Fixture command",
};

defineWorkbenchAgentRuntimeAdapterContract({
  name: "fixture",
  createHarness() {
    const fixture = createFixtureAgentRuntime();
    fixture.setCommands([fixtureCommand]);
    fixture.setThreadSnapshot("contract-thread", {
      title: "Fixture conversation",
      isRunning: false,
      isWaitingForInput: false,
      hasUnreadCompletion: false,
      isPinned: false,
    });
    return { adapter: fixture.adapter, fixture };
  },
  expected: {
    id: "fixture-agent",
    commandNames: ["fixture"],
    hasThreadStore: true,
    threadSnapshot: { title: "Fixture conversation" },
  },
  mutateThreadList: ({ fixture }) => fixture.publishThreadListChange(),
  mutateThread: ({ fixture }, threadId) =>
    fixture.setThreadSnapshot(threadId, {
      title: "Updated fixture conversation",
      isRunning: true,
      isWaitingForInput: true,
      hasUnreadCompletion: false,
      isPinned: true,
    }),
});
