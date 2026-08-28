import { randomUUID } from "node:crypto";

import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import type { AgentNode, WorkflowJsonValue } from "@/runtime/shared/execution";
import { ExecutionError } from "@/runtime/server/executions/execution-errors";
import {
  type ExecutionNodeContext,
  type ExecutionNodeExecutor,
  type ExecutionNodeResult,
} from "@/runtime/server/executions/execution-node-executor";
import { createWorkbenchBashToolOverride } from "@/runtime/terminal/server/interactive-bash-tool";
import {
  reportWorkbenchInternalPiExtensionErrors,
  workbenchInternalPiExtensions,
} from "../internal-extensions";
import { getProjectTrustService } from "../trust/project-trust-service";

export function resolveAgentModelSelection<T extends { provider: string; id: string }>(
  node: AgentNode,
  availableModels: readonly T[],
): { model?: T; thinkingLevel?: NonNullable<AgentNode["config"]["model"]>["thinkingLevel"] } {
  const selection = node.config.model;
  if (!selection) return {};
  const model = availableModels.find(
    (candidate) => candidate.provider === selection.provider && candidate.id === selection.modelId,
  );
  if (!model) {
    const error = new Error(
      `The configured execution model ${selection.provider}/${selection.modelId} is unavailable.`,
    );
    Object.assign(error, { code: "agent-model-unavailable" });
    throw error;
  }
  return {
    model,
    ...(selection.thinkingLevel ? { thinkingLevel: selection.thinkingLevel } : {}),
  };
}

function assertTrustedWorkspace(workspaceId: string, workspacePath: string): void {
  if (!getProjectTrustService().isTrusted(workspacePath)) {
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
  async execute(context: ExecutionNodeContext): Promise<ExecutionNodeResult> {
    const node = context.node as AgentNode;
    assertTrustedWorkspace(context.workspaceId, context.workspacePath);
    const sessionId = randomUUID();
    const sessionManager = SessionManager.create(context.workspacePath, context.sessionDirectory, {
      id: sessionId,
    });
    sessionManager.appendCustomEntry("workbench.execution.origin", {
      origin: "execution",
      runId: context.runId,
      nodeId: node.id,
      attempt: context.attempt,
    });
    const services = await createAgentSessionServices({
      cwd: context.workspacePath,
      resourceLoaderOptions: {
        extensionFactories: workbenchInternalPiExtensions,
        extensionsOverride: reportWorkbenchInternalPiExtensionErrors,
      },
      resourceLoaderReloadOptions: {
        resolveProjectTrust: async () => getProjectTrustService().isTrusted(context.workspacePath),
      },
    });
    const modelSelection = resolveAgentModelSelection(
      node,
      services.modelRuntime.getAvailableSnapshot(),
    );
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...modelSelection,
      customTools: [
        createWorkbenchBashToolOverride(context.workspacePath, sessionId, {
          commandPrefix: services.settingsManager.getShellCommandPrefix(),
          shellPath: services.settingsManager.getShellPath(),
        }),
      ],
    });
    const abort = (): void => void session.abort();
    context.signal.addEventListener("abort", abort, { once: true });
    try {
      await session.bindExtensions({ mode: "rpc" });
      session.setActiveToolsByName(
        session.getActiveToolNames().filter((toolName) => toolName !== "ask_user"),
      );
      await session.prompt(promptWithInput(node, context.input));
      if (context.signal.aborted) throw new DOMException("Run cancelled", "AbortError");
      return {
        sessionId,
        output: { text: assistantText(session.messages), sessionId },
      };
    } finally {
      context.signal.removeEventListener("abort", abort);
      session.dispose();
    }
  }
}
