import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type { AgentExecutionPort } from "@/runtime/server/agent-execution-port";
import { AutomationRepository } from "@/runtime/server/automations/automation-repository";
import {
  AutomationService,
  type AutomationServiceOptions,
} from "@/runtime/server/automations/automation-service";
import { isPiThinkingLevel, type PiModelSelection } from "@/runtime/pi/contracts/pi";
import { AUTOMATION_SESSION_ORIGIN_CUSTOM_TYPE } from "@/runtime/shared/automation";
import type { ModelSelection } from "@/runtime/shared/model-selection";
import { createPiAgentExecutionAdapter } from "../agent-runtime/pi-agent-execution-adapter";
import { createSession } from "../sessions/session-registry";
import { getProjectTrustService } from "../trust/project-trust-service";
import { getWorkspaceStore } from "../workspaces/workspace-registry";

function automationRootDirectory(): string {
  return (
    process.env.WORKBENCH_AUTOMATION_DIR?.trim() ??
    path.join(getAgentDir(), "workbench-automations", "v1")
  );
}

export interface PiAutomationServiceOptions {
  agentExecution?: Pick<AgentExecutionPort, "cancel" | "submit">;
  rootDirectory?: string;
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

function piAutomationRuntime(
  agentExecution: Pick<AgentExecutionPort, "cancel" | "submit">,
): Pick<AutomationServiceOptions, "cancel" | "isWorkspaceTrusted" | "launch" | "resolveWorkspace"> {
  const workspaceStore = getWorkspaceStore();
  return {
    async resolveWorkspace(workspaceId) {
      const workspace = (await workspaceStore.list()).items.find(
        ({ workspaceId: id }) => id === workspaceId,
      );
      return workspace ? { workspaceId: workspace.workspaceId, path: workspace.path } : undefined;
    },
    isWorkspaceTrusted: (workspacePath) => getProjectTrustService().isTrusted(workspacePath),
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

export function createPiAutomationService(
  options: PiAutomationServiceOptions = {},
): AutomationService {
  const agentExecution = options.agentExecution ?? createPiAgentExecutionAdapter();
  const repository = new AutomationRepository({
    rootDirectory: options.rootDirectory ?? automationRootDirectory(),
  });
  return new AutomationService({
    repository,
    ...piAutomationRuntime(agentExecution),
  });
}

interface AutomationRegistryGlobal {
  __workbenchAutomationService?: AutomationService;
}

const registry = globalThis as typeof globalThis & AutomationRegistryGlobal;

export function getAutomationService(options: PiAutomationServiceOptions = {}): AutomationService {
  const current = registry.__workbenchAutomationService;
  if (current) {
    Object.setPrototypeOf(current, AutomationService.prototype);
    Object.setPrototypeOf(current.repository, AutomationRepository.prototype);
    const agentExecution = options.agentExecution ?? createPiAgentExecutionAdapter();
    current.rebindRuntime(piAutomationRuntime(agentExecution));
    return current;
  }
  const created = createPiAutomationService(options);
  registry.__workbenchAutomationService = created;
  return created;
}
