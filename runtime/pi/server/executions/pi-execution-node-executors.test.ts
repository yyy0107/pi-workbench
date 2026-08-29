import assert from "node:assert/strict";
import test from "node:test";

import {
  EXECUTION_SESSION_ORIGIN_CUSTOM_TYPE,
  type AgentNode,
  type ExecutionSessionOrigin,
} from "@/runtime/shared/execution";
import type { AgentPromptSubmission } from "@/runtime/server/agent-execution-port";
import {
  PiAgentExecutionNodeExecutor,
  type ExecutionSessionHost,
} from "./pi-execution-node-executors";
import { resolveInitialSessionModel } from "../sessions/session-initial-model";

function agent(model?: AgentNode["config"]["model"]): AgentNode {
  return {
    id: "agent",
    type: "agent",
    name: "Agent",
    position: { x: 0, y: 0 },
    config: { prompt: "Review", ...(model ? { model } : {}) },
  };
}

test("resolves the configured execution model without mutating runtime defaults", () => {
  const selected = { provider: "openai", id: "gpt-5" };
  const result = resolveInitialSessionModel(
    { provider: "openai", modelId: "gpt-5", thinkingLevel: "high" },
    [{ provider: "anthropic", id: "claude" }, selected],
  );
  assert.equal(result.model, selected);
  assert.equal(result.thinkingLevel, "high");
});

test("rejects a configured execution model that is unavailable in the target workspace", () => {
  assert.throws(
    () =>
      resolveInitialSessionModel({ provider: "openai", modelId: "missing" }, [
        { provider: "openai", id: "gpt-5" },
      ]),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === "agent-model-unavailable",
  );
});

test("submits an automation turn through the shared frontend execution port", async () => {
  const origin: ExecutionSessionOrigin = {
    version: 1,
    origin: "execution",
    workflowId: "workflow-1",
    workflowName: "Daily review",
    workflowKind: "workflow",
    runId: "run-1",
    nodeId: "agent",
    attempt: 1,
    source: "schedule",
    triggerId: "trigger-1",
  };
  const appended: Array<{ customType: string; data: unknown }> = [];
  const attached: Array<{ workspaceId: string; sessionId: string }> = [];
  let created:
    | {
        workspacePath: string;
        sessionId: string | undefined;
        model: AgentNode["config"]["model"];
      }
    | undefined;
  let renamed: string | undefined;
  let activeTools = ["read", "ask_user", "bash"];
  let submittedPrompt: AgentPromptSubmission | undefined;
  let promptStarted!: () => void;
  const promptWasStarted = new Promise<void>((resolve) => {
    promptStarted = resolve;
  });
  let finishPrompt!: () => void;
  const promptCanFinish = new Promise<void>((resolve) => {
    finishPrompt = resolve;
  });
  const messages: unknown[] = [];
  const host: ExecutionSessionHost = {
    id: "session-1",
    rename(name) {
      renamed = name;
      return 1;
    },
    async waitForCurrentPrompt() {
      await promptCanFinish;
      messages.push({ role: "assistant", content: [{ type: "text", text: "Review complete" }] });
    },
    session: {
      sessionManager: {
        appendCustomEntry(customType, data) {
          appended.push({ customType, data });
        },
      },
      messages,
      getActiveToolNames: () => activeTools,
      setActiveToolsByName(toolNames) {
        activeTools = toolNames;
      },
    },
  };
  const executor = new PiAgentExecutionNodeExecutor({
    execution: {
      async submit(input) {
        submittedPrompt = input;
        promptStarted();
        return { kind: "started" };
      },
      async cancel() {},
    },
    isWorkspaceTrusted: () => true,
    async createSession(workspacePath, sessionId, model) {
      created = { workspacePath, sessionId, model };
      return host;
    },
    async attachSession(workspaceId, sessionId) {
      attached.push({ workspaceId, sessionId });
    },
  });

  let executionSettled = false;
  const execution = executor.execute({
    runId: "run-1",
    executionOrigin: origin,
    node: agent({ provider: "openai", modelId: "gpt-5", thinkingLevel: "high" }),
    attempt: 1,
    workspaceId: "workspace-1",
    workspacePath: "/project",
    input: { branch: "main" },
    signal: new AbortController().signal,
    sessionDirectory: "/private-run/sessions",
    artifactDirectory: "/private-run/artifacts",
  });
  void execution.finally(() => {
    executionSettled = true;
  });

  await promptWasStarted;
  assert.equal(executionSettled, false, "the automation must wait for the Hosted prompt to finish");
  finishPrompt();
  const result = await execution;

  assert.deepEqual(created, {
    workspacePath: "/project",
    sessionId: undefined,
    model: { provider: "openai", modelId: "gpt-5", thinkingLevel: "high" },
  });
  assert.deepEqual(appended, [{ customType: EXECUTION_SESSION_ORIGIN_CUSTOM_TYPE, data: origin }]);
  assert.equal(renamed, "Daily review");
  assert.deepEqual(activeTools, ["read", "bash"]);
  assert.deepEqual(attached, [{ workspaceId: "workspace-1", sessionId: "session-1" }]);
  assert.equal(submittedPrompt?.threadId, "session-1");
  assert.equal(submittedPrompt?.mode, "follow-up");
  assert.match(submittedPrompt?.prompt.text ?? "", /Execution input \(JSON\):/u);
  assert.deepEqual(submittedPrompt?.prompt.attachments, []);
  assert.deepEqual(submittedPrompt?.provenance, {
    requestId: "execution.prompt:run-1:agent:1",
  });
  assert.deepEqual(result, {
    sessionId: "session-1",
    output: { text: "Review complete", sessionId: "session-1" },
  });
});
