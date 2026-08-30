import assert from "node:assert/strict";
import test from "node:test";

import type { PromptTemplate, ToolDefinition } from "@earendil-works/pi-coding-agent";

import {
  EXECUTION_SESSION_ORIGIN_CUSTOM_TYPE,
  type AgentNode,
  type ExecutionSessionOrigin,
} from "@workbench/execution-contracts";
import type { AgentPromptSubmission } from "@workbench/agent-runtime-server/execution";
import { ExecutionError } from "@workbench/execution-server/errors";
import {
  createSubmitWorkflowOutputTool,
  PiAgentExecutionNodeExecutor,
  type ExecutionSessionHost,
} from "../../src/executions/pi-execution-node-executors";
import { resolveInitialSessionModel } from "../../src/sessions/session-initial-model";

function agent(agentId = "reviewer", id = "agent"): AgentNode {
  return {
    id,
    type: "agent",
    name: "Agent",
    position: { x: 0, y: 0 },
    config: {
      agentId,
      promptTemplate: "default",
      output: {
        schema: {
          type: "object",
          properties: { verdict: { type: "string" } },
          required: ["verdict"],
          additionalProperties: false,
        },
      },
    },
  };
}

function origin(nodeId = "agent"): ExecutionSessionOrigin {
  return {
    version: 1,
    origin: "execution",
    workflowId: "workflow-1",
    workflowName: "Daily review",
    workflowKind: "workflow",
    runId: "run-1",
    nodeId,
    attempt: 1,
    source: "schedule",
    triggerId: "trigger-1",
  };
}

function context(node: AgentNode, signal = new AbortController().signal) {
  return {
    runId: "run-1",
    executionOrigin: origin(node.id),
    node,
    attempt: 1,
    workspaceId: "workspace-1",
    workspacePath: "/project",
    workflowDirectory: "/private-workflow",
    input: { branch: "main" },
    signal,
    sessionDirectory: "/private-run/sessions",
    artifactDirectory: "/private-run/artifacts",
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

test("submits a schema-valid result through a persistent workflow Agent session", async () => {
  const appended: Array<{ customType: string; data: unknown }> = [];
  let created:
    | {
        workspacePath: string;
        sessionId: string | undefined;
        sessionDirectory: string;
      }
    | undefined;
  let renamed: string | undefined;
  let activeTools = ["read", "ask_user", "bash"];
  let submittedPrompt: AgentPromptSubmission | undefined;
  let submitTool: ToolDefinition | undefined;
  let finishPrompt!: () => void;
  const promptCanFinish = new Promise<void>((resolve) => {
    finishPrompt = resolve;
  });
  const promptTemplate = {
    name: "default",
    description: "",
    content: "Review the supplied branch.",
    sourceInfo: { source: "project" },
    filePath: "/private-workflow/agents/reviewer/.pi/prompts/default.md",
  } as PromptTemplate;
  const host: ExecutionSessionHost = {
    id: "session-1",
    isAlive: true,
    rename(name) {
      renamed = name;
      return 1;
    },
    async waitForCurrentPrompt() {
      await promptCanFinish;
    },
    session: {
      sessionManager: {
        appendCustomEntry(customType, data) {
          appended.push({ customType, data });
        },
      },
      promptTemplates: [promptTemplate],
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
        assert.ok(submitTool);
        const response = await submitTool.execute(
          "tool-call",
          { result: { verdict: "approved" } },
          undefined,
          undefined,
          {} as never,
        );
        assert.equal(response.terminate, true);
        return { kind: "started" };
      },
      async cancel() {},
    },
    isWorkspaceTrusted: () => true,
    async createSession(workspacePath, sessionId, _model, options) {
      created = { workspacePath, sessionId, sessionDirectory: options.sessionDirectory };
      submitTool = options.customTools[0];
      return host;
    },
  });

  let settled = false;
  const execution = executor.execute(context(agent()));
  void execution.finally(() => {
    settled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "the workflow must wait for the Hosted prompt to finish");
  finishPrompt();
  const result = await execution;

  assert.equal(created?.workspacePath, "/private-workflow/agents/reviewer");
  assert.match(created?.sessionId ?? "", /^workflow-[a-f0-9]{32}$/u);
  assert.equal(created?.sessionDirectory, "/private-run/sessions/reviewer");
  assert.deepEqual(appended, [
    { customType: EXECUTION_SESSION_ORIGIN_CUSTOM_TYPE, data: origin() },
  ]);
  assert.equal(renamed, "Daily review · reviewer");
  assert.deepEqual(activeTools, ["read", "bash", "submit_workflow_output"]);
  assert.equal(submittedPrompt?.threadId, "session-1");
  assert.equal(submittedPrompt?.mode, "follow-up");
  assert.match(submittedPrompt?.prompt.text ?? "", /Review the supplied branch\./u);
  assert.match(submittedPrompt?.prompt.text ?? "", /Workflow input \(JSON\):/u);
  assert.match(submittedPrompt?.prompt.text ?? "", /submit_workflow_output/u);
  assert.deepEqual(submittedPrompt?.prompt.attachments, []);
  assert.deepEqual(result, {
    sessionId: "session-1",
    output: { verdict: "approved" },
  });
});

test("the output tool rejects invalid data and accepts a later valid submission", async () => {
  const state = {
    contract: {
      runId: "run-1",
      nodeId: "agent",
      attempt: 1,
      schema: {
        type: "object",
        properties: { verdict: { type: "string" } },
        required: ["verdict"],
        additionalProperties: false,
      },
    },
  };
  const tool = createSubmitWorkflowOutputTool(state);
  const invalid = await tool.execute(
    "invalid",
    { result: { verdict: 42 } },
    undefined,
    undefined,
    {} as never,
  );
  assert.equal(invalid.terminate, undefined);
  assert.match(invalid.content[0]?.type === "text" ? invalid.content[0].text : "", /schema/u);

  const valid = await tool.execute(
    "valid",
    { result: { verdict: "approved" }, summary: "Looks good" },
    undefined,
    undefined,
    {} as never,
  );
  assert.equal(valid.terminate, true);
  assert.deepEqual((state as { submission?: unknown }).submission, {
    result: { verdict: "approved" },
    summary: "Looks good",
  });
});

test("fails when an Agent finishes without submit_workflow_output", async () => {
  const executor = new PiAgentExecutionNodeExecutor({
    execution: {
      async submit() {
        return { kind: "started" };
      },
      async cancel() {},
    },
    isWorkspaceTrusted: () => true,
    async createSession() {
      return {
        id: "session-1",
        isAlive: true,
        rename: () => 1,
        waitForCurrentPrompt: async () => undefined,
        session: {
          sessionManager: { appendCustomEntry: () => undefined },
          promptTemplates: [
            {
              name: "default",
              description: "",
              content: "Review",
              sourceInfo: { source: "project" },
              filePath: "/prompt.md",
            } as PromptTemplate,
          ],
          getActiveToolNames: () => [],
          setActiveToolsByName: () => undefined,
        },
      };
    },
  });

  await assert.rejects(
    executor.execute(context(agent())),
    (error) => error instanceof ExecutionError && error.code === "structured-output-missing",
  );
});

test("does not load Agent-local Pi resources before Project Trust is granted", async () => {
  let createCalled = false;
  const executor = new PiAgentExecutionNodeExecutor({
    execution: {
      async submit() {
        return { kind: "started" };
      },
      async cancel() {},
    },
    isWorkspaceTrusted: () => false,
    async createSession() {
      createCalled = true;
      throw new Error("must not create");
    },
  });

  await assert.rejects(
    executor.execute(context(agent())),
    (error) => error instanceof ExecutionError && error.code === "agent-workspace-not-trusted",
  );
  assert.equal(createCalled, false);
});

test("reuses one session and serializes nodes for the same run Agent", async () => {
  let createCount = 0;
  let submitCount = 0;
  let submitTool: ToolDefinition | undefined;
  const releases: Array<() => void> = [];
  const waits: Promise<void>[] = [];
  for (let index = 0; index < 2; index += 1) {
    waits.push(
      new Promise<void>((resolve) => {
        releases.push(resolve);
      }),
    );
  }
  const executor = new PiAgentExecutionNodeExecutor({
    execution: {
      async submit() {
        submitCount += 1;
        assert.ok(submitTool);
        await submitTool.execute(
          `call-${submitCount}`,
          { result: { verdict: `result-${submitCount}` } },
          undefined,
          undefined,
          {} as never,
        );
        return { kind: "started" };
      },
      async cancel() {},
    },
    isWorkspaceTrusted: () => true,
    async createSession(_workspacePath, _sessionId, _model, options) {
      createCount += 1;
      submitTool = options.customTools[0];
      let waitIndex = 0;
      return {
        id: "shared-session",
        isAlive: true,
        rename: () => 1,
        waitForCurrentPrompt: async () => waits[waitIndex++]!,
        session: {
          sessionManager: { appendCustomEntry: () => undefined },
          promptTemplates: [
            {
              name: "default",
              description: "",
              content: "Review",
              sourceInfo: { source: "project" },
              filePath: "/prompt.md",
            } as PromptTemplate,
          ],
          getActiveToolNames: () => [],
          setActiveToolsByName: () => undefined,
        },
      };
    },
  });

  const first = executor.execute(context(agent("reviewer", "first")));
  while (submitCount < 1) await new Promise<void>((resolve) => setImmediate(resolve));
  const second = executor.execute(context(agent("reviewer", "second")));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(submitCount, 1, "a second node for the same Agent must wait");
  releases[0]!();
  assert.deepEqual(await first, {
    sessionId: "shared-session",
    output: { verdict: "result-1" },
  });
  while (submitCount < 2) await new Promise<void>((resolve) => setImmediate(resolve));
  releases[1]!();
  assert.deepEqual(await second, {
    sessionId: "shared-session",
    output: { verdict: "result-2" },
  });
  assert.equal(createCount, 1);
});

test("allows different Agents in one run to execute concurrently", async () => {
  const submissions: string[] = [];
  const tools = new Map<string, ToolDefinition>();
  let release!: () => void;
  const canFinish = new Promise<void>((resolve) => {
    release = resolve;
  });
  const executor = new PiAgentExecutionNodeExecutor({
    execution: {
      async submit(input) {
        submissions.push(input.threadId);
        const tool = tools.get(input.threadId);
        assert.ok(tool);
        await tool.execute(
          `call-${input.threadId}`,
          { result: { verdict: input.threadId } },
          undefined,
          undefined,
          {} as never,
        );
        return { kind: "started" };
      },
      async cancel() {},
    },
    isWorkspaceTrusted: () => true,
    async createSession(workspacePath, _sessionId, _model, options) {
      const agentId = workspacePath.split("/").at(-1)!;
      const id = `session-${agentId}`;
      tools.set(id, options.customTools[0]!);
      return {
        id,
        isAlive: true,
        rename: () => 1,
        waitForCurrentPrompt: async () => canFinish,
        session: {
          sessionManager: { appendCustomEntry: () => undefined },
          promptTemplates: [
            {
              name: "default",
              description: "",
              content: "Review",
              sourceInfo: { source: "project" },
              filePath: "/prompt.md",
            } as PromptTemplate,
          ],
          getActiveToolNames: () => [],
          setActiveToolsByName: () => undefined,
        },
      };
    },
  });

  const left = executor.execute(context(agent("left", "left-node")));
  const right = executor.execute(context(agent("right", "right-node")));
  while (submissions.length < 2) await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(new Set(submissions), new Set(["session-left", "session-right"]));
  release();
  await Promise.all([left, right]);
});
