import type { AgentExecutionPort } from "@workbench/agent-runtime-server/execution";
import {
  isPiThinkingLevel,
  type PiModelSelection,
} from "@workbench/agent-runtime-pi-protocol/messages";
import {
  AUTOMATION_SESSION_ORIGIN_CUSTOM_TYPE,
  type AutomationDefinition,
  type AutomationLaunchSource,
} from "@workbench/automation-contracts";
import type { ModelSelection } from "@workbench/contracts/model-selection";

import { createSession, getRunningSessionIds } from "../sessions/session-registry";
import { getProjectTrustService } from "../trust/project-trust-service";
import { getWorkspaceStore } from "../workspaces/workspace-registry";

export interface PiAutomationWorkspace {
  readonly workspaceId: string;
  readonly path: string;
}

/** Pi-owned callbacks consumed by the Workbench Automation service composition. */
export interface PiAutomationRuntimeBindings {
  resolveWorkspace(workspaceId: string): Promise<PiAutomationWorkspace | undefined>;
  isWorkspaceTrusted(workspacePath: string): boolean;
  isSessionRunning(sessionId: string): boolean;
  cancel(sessionId: string): Promise<void>;
  launch(
    automation: AutomationDefinition,
    workspace: PiAutomationWorkspace,
    source: AutomationLaunchSource,
    triggeredAt: number,
  ): Promise<string>;
}

export interface PiAutomationRuntimeBindingOptions {
  readonly agentExecution: Pick<AgentExecutionPort, "cancel" | "submit">;
}

function initialModelSelection(
  selection: ModelSelection | undefined,
): PiModelSelection | undefined {
  if (!selection) return undefined;
  const persisted = selection as unknown as Record<string, unknown>;
  const model =
    typeof selection.model === "string"
      ? selection.model
      : typeof persisted.modelId === "string"
        ? persisted.modelId
        : undefined;
  if (!model) return undefined;
  const reasoningEffort =
    typeof selection.reasoningEffort === "string"
      ? selection.reasoningEffort
      : persisted.thinkingLevel;
  return {
    provider: selection.provider,
    modelId: model,
    ...(isPiThinkingLevel(reasoningEffort) ? { thinkingLevel: reasoningEffort } : {}),
  };
}

export function createPiAutomationRuntimeBindings({
  agentExecution,
}: PiAutomationRuntimeBindingOptions): PiAutomationRuntimeBindings {
  const workspaceStore = getWorkspaceStore();
  return {
    async resolveWorkspace(workspaceId) {
      const workspace = (await workspaceStore.list()).items.find(
        ({ workspaceId: id }) => id === workspaceId,
      );
      return workspace ? { workspaceId: workspace.workspaceId, path: workspace.path } : undefined;
    },
    isWorkspaceTrusted: (workspacePath) => getProjectTrustService().isTrusted(workspacePath),
    isSessionRunning: (sessionId) => getRunningSessionIds().includes(sessionId),
    cancel: (sessionId) => agentExecution.cancel({ threadId: sessionId }),
    async launch(automation, workspace, source, triggeredAt) {
      const host = await createSession(
        workspace.path,
        undefined,
        initialModelSelection(automation.model),
      );
      host.session.sessionManager.appendCustomEntry(AUTOMATION_SESSION_ORIGIN_CUSTOM_TYPE, {
        version: 1,
        origin: "automation",
        automationId: automation.id,
        automationName: automation.name,
        source,
        triggeredAt,
      });
      host.rename(automation.name);
      await workspaceStore.attachSession(workspace.workspaceId, host.id);
      await agentExecution.submit({
        threadId: host.id,
        mode: "follow-up",
        prompt: { text: automation.prompt, attachments: [] },
        provenance: { requestId: `automation:${automation.id}:${triggeredAt}` },
      });
      return host.id;
    },
  };
}
