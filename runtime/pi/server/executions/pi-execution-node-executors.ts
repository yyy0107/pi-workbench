import { createHash } from "node:crypto";
import path from "node:path";

import {
  defineTool,
  type PromptTemplate,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";

import type { AgentNode, WorkflowJsonValue } from "@/runtime/shared/execution";
import { EXECUTION_SESSION_ORIGIN_CUSTOM_TYPE } from "@/runtime/shared/execution";
import type { AgentExecutionPort } from "@/runtime/server/agent-execution-port";
import { ExecutionError } from "@/runtime/server/executions/execution-errors";
import {
  type ExecutionNodeContext,
  type ExecutionNodeExecutor,
  type ExecutionNodeResult,
} from "@/runtime/server/executions/execution-node-executor";
import { createPiAgentExecutionAdapter } from "../agent-runtime/pi-agent-execution-adapter";
import { createSession } from "../sessions/session-registry";
import { getProjectTrustService } from "../trust/project-trust-service";

const SUBMIT_WORKFLOW_OUTPUT_TOOL = "submit_workflow_output";

interface ActiveWorkflowOutputContract {
  runId: string;
  nodeId: string;
  attempt: number;
  schema: WorkflowJsonValue;
}

interface WorkflowOutputSubmission {
  result: WorkflowJsonValue;
  summary?: string;
}

interface WorkflowOutputState {
  contract?: ActiveWorkflowOutputContract;
  submission?: WorkflowOutputSubmission;
}

export interface ExecutionSessionHost {
  readonly id: string;
  readonly isAlive: boolean;
  rename(name: string): number;
  waitForCurrentPrompt(): Promise<void>;
  readonly session: {
    readonly sessionManager: {
      appendCustomEntry(customType: string, data: unknown): unknown;
    };
    readonly promptTemplates?: ReadonlyArray<PromptTemplate>;
    getActiveToolNames(): string[];
    setActiveToolsByName(toolNames: string[]): void;
  };
}

interface WorkflowAgentSession {
  host: ExecutionSessionHost;
  output: WorkflowOutputState;
}

export interface PiAgentExecutionNodeExecutorOptions {
  execution?: Pick<AgentExecutionPort, "submit" | "cancel">;
  isWorkspaceTrusted?: (workspacePath: string) => boolean;
  createSession?: (
    workspacePath: string,
    sessionId: string | undefined,
    model: undefined,
    options: { sessionDirectory: string; customTools: readonly ToolDefinition[] },
  ) => Promise<ExecutionSessionHost>;
}

function assertTrustedAgentWorkspace(
  agentId: string,
  workspacePath: string,
  isWorkspaceTrusted: (workspacePath: string) => boolean,
): void {
  if (!isWorkspaceTrusted(workspacePath)) {
    throw new ExecutionError(
      "agent-workspace-not-trusted",
      "Trust the workflow agent workspace before running project-local Pi resources.",
      { agentId },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaIssues(schema: WorkflowJsonValue, result: WorkflowJsonValue): string[] {
  if (!isRecord(schema)) return ["The output contract must be a JSON Schema object."];
  try {
    return [...Value.Errors(schema as TSchema, result)].slice(0, 8).map((error) => {
      const location = error.instancePath || "/";
      return `${location}: ${error.message}`;
    });
  } catch (error) {
    return [
      error instanceof Error
        ? `The output contract is not a supported JSON Schema: ${error.message}`
        : "The output contract is not a supported JSON Schema.",
    ];
  }
}

export function createSubmitWorkflowOutputTool(state: WorkflowOutputState): ToolDefinition {
  const parameters = Type.Object(
    {
      result: Type.Unknown({ description: "The complete JSON-compatible workflow result" }),
      summary: Type.Optional(
        Type.String({ description: "Optional short human-readable description of the result" }),
      ),
    },
    { additionalProperties: false },
  );
  type Details = {
    accepted: boolean;
    issues?: string[];
    contract?: ActiveWorkflowOutputContract;
  };
  return defineTool<typeof parameters, Details>({
    name: SUBMIT_WORKFLOW_OUTPUT_TOOL,
    label: "Submit workflow output",
    description:
      "Validate and submit the final structured result for the active workflow node. Call this as the final action for every workflow step.",
    promptSnippet: "Submit the final schema-valid result for the active workflow node",
    promptGuidelines: [
      "For a workflow step, finish by calling submit_workflow_output with the complete result required by the active output contract.",
      "If submit_workflow_output reports validation errors, correct the result and call it again. Do not finish with plain text only.",
    ],
    parameters,
    async execute(_toolCallId, params) {
      const contract = state.contract;
      if (!contract) {
        return {
          content: [{ type: "text", text: "No workflow output contract is active." }],
          details: { accepted: false },
        };
      }
      const result = params.result as WorkflowJsonValue;
      const issues = schemaIssues(contract.schema, result);
      if (issues.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `The workflow result does not match the required schema:\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
            },
          ],
          details: { accepted: false, issues },
        };
      }
      state.submission = {
        result,
        ...(params.summary === undefined ? {} : { summary: params.summary }),
      };
      return {
        content: [{ type: "text", text: "Workflow output accepted." }],
        details: { accepted: true, contract },
        terminate: true,
      };
    },
  });
}

function promptForNode(
  host: ExecutionSessionHost,
  node: AgentNode,
  input: WorkflowJsonValue | undefined,
): string {
  const templateName = node.config.promptTemplate;
  const template = templateName
    ? host.session.promptTemplates?.find((candidate) => candidate.name === templateName)
    : undefined;
  if (templateName && !template) {
    throw new ExecutionError(
      "prompt-template-not-found",
      "The workflow agent prompt template does not exist.",
      { agentId: node.config.agentId, promptTemplate: templateName },
    );
  }
  const parts = [template?.content?.trim()].filter((part): part is string => Boolean(part));
  if (input !== undefined) {
    parts.push(`Workflow input (JSON):\n${JSON.stringify(input, null, 2)}`);
  }
  parts.push(
    `Complete workflow node ${JSON.stringify(node.name)}. Your final action must be ${SUBMIT_WORKFLOW_OUTPUT_TOOL}; its active contract will validate the result.`,
  );
  return parts.join("\n\n");
}

function workflowSessionId(runId: string, agentId: string): string {
  const digest = createHash("sha256").update(`${runId}\0${agentId}`).digest("hex").slice(0, 32);
  return `workflow-${digest}`;
}

export class PiAgentExecutionNodeExecutor implements ExecutionNodeExecutor {
  private readonly agentExecution: Pick<AgentExecutionPort, "submit" | "cancel">;
  private readonly isWorkspaceTrusted: (workspacePath: string) => boolean;
  private readonly createWorkflowSession: NonNullable<
    PiAgentExecutionNodeExecutorOptions["createSession"]
  >;
  private readonly sessions = new Map<string, Promise<WorkflowAgentSession>>();
  private readonly tails = new Map<string, Promise<void>>();

  constructor(options: PiAgentExecutionNodeExecutorOptions = {}) {
    this.agentExecution = options.execution ?? createPiAgentExecutionAdapter();
    this.isWorkspaceTrusted =
      options.isWorkspaceTrusted ??
      ((workspacePath) => getProjectTrustService().isTrusted(workspacePath));
    this.createWorkflowSession = options.createSession ?? createSession;
  }

  async execute(context: ExecutionNodeContext): Promise<ExecutionNodeResult> {
    const node = context.node as AgentNode;
    const key = `${context.runId}:${node.config.agentId}`;
    const previous = this.tails.get(key) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => this.executeSerialized(context, node, key));
    const tail = operation.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    try {
      return await operation;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  private async resolveSession(
    context: ExecutionNodeContext,
    node: AgentNode,
    key: string,
  ): Promise<WorkflowAgentSession> {
    const existing = this.sessions.get(key);
    if (existing) {
      const resolved = await existing;
      if (resolved.host.isAlive) return resolved;
      this.sessions.delete(key);
    }
    const session = (async () => {
      const workspacePath = path.join(context.workflowDirectory, "agents", node.config.agentId);
      assertTrustedAgentWorkspace(node.config.agentId, workspacePath, this.isWorkspaceTrusted);
      const output: WorkflowOutputState = {};
      const host = await this.createWorkflowSession(
        workspacePath,
        workflowSessionId(context.runId, node.config.agentId),
        undefined,
        {
          sessionDirectory: path.join(context.sessionDirectory, node.config.agentId),
          customTools: [createSubmitWorkflowOutputTool(output)],
        },
      );
      host.rename(`${context.executionOrigin.workflowName} · ${node.config.agentId}`);
      const activeTools = host.session
        .getActiveToolNames()
        .filter((toolName) => toolName !== "ask_user");
      if (!activeTools.includes(SUBMIT_WORKFLOW_OUTPUT_TOOL)) {
        activeTools.push(SUBMIT_WORKFLOW_OUTPUT_TOOL);
      }
      host.session.setActiveToolsByName(activeTools);
      return { host, output };
    })().catch((error) => {
      this.sessions.delete(key);
      throw error;
    });
    this.sessions.set(key, session);
    return session;
  }

  private async executeSerialized(
    context: ExecutionNodeContext,
    node: AgentNode,
    key: string,
  ): Promise<ExecutionNodeResult> {
    const { host, output } = await this.resolveSession(context, node, key);
    host.session.sessionManager.appendCustomEntry(
      EXECUTION_SESSION_ORIGIN_CUSTOM_TYPE,
      context.executionOrigin,
    );
    output.contract = {
      runId: context.runId,
      nodeId: node.id,
      attempt: context.attempt,
      schema: node.config.output.schema,
    };
    output.submission = undefined;

    if (context.signal.aborted) {
      await this.agentExecution.cancel({ threadId: host.id });
      throw new DOMException("Run cancelled", "AbortError");
    }
    const abort = (): void => void this.agentExecution.cancel({ threadId: host.id });
    context.signal.addEventListener("abort", abort, { once: true });
    try {
      const admission = await this.agentExecution.submit({
        threadId: host.id,
        mode: "follow-up",
        prompt: {
          text: promptForNode(host, node, context.input),
          attachments: [],
        },
        provenance: {
          requestId: `execution.prompt:${context.runId}:${node.id}:${context.attempt}`,
        },
      });
      if (admission.kind !== "started") {
        throw new Error("A serialized workflow agent unexpectedly queued its prompt.");
      }
      await host.waitForCurrentPrompt();
      if (context.signal.aborted) throw new DOMException("Run cancelled", "AbortError");
      const submission = output.submission as WorkflowOutputSubmission | undefined;
      if (!submission) {
        throw new ExecutionError(
          "structured-output-missing",
          "The workflow agent finished without submitting a structured output.",
          { agentId: node.config.agentId, nodeId: node.id },
        );
      }
      return { sessionId: host.id, output: submission.result };
    } finally {
      context.signal.removeEventListener("abort", abort);
      output.contract = undefined;
      output.submission = undefined;
      // The host stays alive for later calls to the same agent in this run.
    }
  }
}
