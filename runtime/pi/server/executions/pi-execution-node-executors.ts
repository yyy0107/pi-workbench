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
import { getWorkspaceStore } from "../workspaces/workspace-registry";

export interface ExecutionSessionHost {
  readonly id: string;
  rename(name: string): number;
  waitForCurrentPrompt(): Promise<void>;
  readonly session: {
    readonly sessionManager: {
      appendCustomEntry(customType: string, data: unknown): unknown;
    };
    readonly messages: readonly unknown[];
    getActiveToolNames(): string[];
    setActiveToolsByName(toolNames: string[]): void;
  };
}

export interface PiAgentExecutionNodeExecutorOptions {
  execution?: Pick<AgentExecutionPort, "submit" | "cancel">;
  isWorkspaceTrusted?: (workspacePath: string) => boolean;
  createSession?: (
    workspacePath: string,
    sessionId: string | undefined,
    model: AgentNode["config"]["model"],
  ) => Promise<ExecutionSessionHost>;
  attachSession?: (workspaceId: string, sessionId: string) => Promise<unknown>;
}

function assertTrustedWorkspace(
  workspaceId: string,
  workspacePath: string,
  isWorkspaceTrusted: (workspacePath: string) => boolean,
): void {
  if (!isWorkspaceTrusted(workspacePath)) {
    throw new ExecutionError(
      "workspace-not-trusted",
      "The execution target workspace is not trusted.",
      { workspaceId },
    );
  }
}

function promptWithInput(node: AgentNode, input: WorkflowJsonValue | undefined): string {
  if (input === undefined) return node.config.prompt;
  return `${node.config.prompt}\n\nExecution input (JSON):\n${JSON.stringify(input, null, 2)}`;
}

function assistantText(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (typeof message !== "object" || message === null || Array.isArray(message)) continue;
    const record = message as Record<string, unknown>;
    if (record.role !== "assistant" || !Array.isArray(record.content)) continue;
    const parts = record.content
      .map((part) => {
        if (typeof part !== "object" || part === null || Array.isArray(part)) return "";
        const value = part as Record<string, unknown>;
        return value.type === "text" && typeof value.text === "string" ? value.text : "";
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join("\n");
  }
  return "";
}

export class PiAgentExecutionNodeExecutor implements ExecutionNodeExecutor {
  private readonly agentExecution: Pick<AgentExecutionPort, "submit" | "cancel">;
  private readonly isWorkspaceTrusted: (workspacePath: string) => boolean;
  private readonly createProjectSession: NonNullable<
    PiAgentExecutionNodeExecutorOptions["createSession"]
  >;
  private readonly attachProjectSession: NonNullable<
    PiAgentExecutionNodeExecutorOptions["attachSession"]
  >;

  constructor(options: PiAgentExecutionNodeExecutorOptions = {}) {
    this.agentExecution = options.execution ?? createPiAgentExecutionAdapter();
    this.isWorkspaceTrusted =
      options.isWorkspaceTrusted ??
      ((workspacePath) => getProjectTrustService().isTrusted(workspacePath));
    this.createProjectSession = options.createSession ?? createSession;
    this.attachProjectSession =
      options.attachSession ??
      ((workspaceId, sessionId) => getWorkspaceStore().attachSession(workspaceId, sessionId));
  }

  async execute(context: ExecutionNodeContext): Promise<ExecutionNodeResult> {
    const node = context.node as AgentNode;
    assertTrustedWorkspace(context.workspaceId, context.workspacePath, this.isWorkspaceTrusted);

    // Use the ordinary project session path so an automation run is a real, durable Workbench
    // task. The execution-origin marker lets every projection identify both the task and project
    // as automation-owned without maintaining a second relationship store.
    const host = await this.createProjectSession(
      context.workspacePath,
      undefined,
      node.config.model,
    );
    host.session.sessionManager.appendCustomEntry(
      EXECUTION_SESSION_ORIGIN_CUSTOM_TYPE,
      context.executionOrigin,
    );
    host.rename(context.executionOrigin.workflowName);
    host.session.setActiveToolsByName(
      host.session.getActiveToolNames().filter((toolName) => toolName !== "ask_user"),
    );
    await this.attachProjectSession(context.workspaceId, host.id);

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
          text: promptWithInput(node, context.input),
          attachments: [],
        },
        provenance: {
          requestId: `execution.prompt:${context.runId}:${node.id}:${context.attempt}`,
        },
      });
      if (admission.kind !== "started") {
        throw new Error("A newly created automation task unexpectedly queued its first prompt.");
      }
      await host.waitForCurrentPrompt();
      if (context.signal.aborted) throw new DOMException("Run cancelled", "AbortError");
      return {
        sessionId: host.id,
        output: { text: assistantText(host.session.messages), sessionId: host.id },
      };
    } finally {
      context.signal.removeEventListener("abort", abort);
      // Deliberately keep the hosted session alive: it is now a normal task in the target project.
    }
  }
}
