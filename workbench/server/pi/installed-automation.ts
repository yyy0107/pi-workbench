import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AgentExecutionPort } from "@workbench/agent-runtime-server/execution";

import { AutomationRepository } from "@/runtime/server/automations/automation-repository";
import { AutomationService } from "@/runtime/server/automations/automation-service";
import { createPiAutomationRuntimeBindings } from "@workbench/agent-runtime-pi-server/installation";

export interface InstalledPiAutomationServiceOptions {
  readonly agentExecution: Pick<AgentExecutionPort, "cancel" | "submit">;
  readonly rootDirectory?: string;
}

function automationRootDirectory(): string {
  return (
    process.env.WORKBENCH_AUTOMATION_DIR?.trim() ??
    path.join(getAgentDir(), "workbench-automations", "v1")
  );
}

export function createInstalledPiAutomationService({
  agentExecution,
  rootDirectory = automationRootDirectory(),
}: InstalledPiAutomationServiceOptions): AutomationService {
  const repository = new AutomationRepository({ rootDirectory });
  return new AutomationService({
    repository,
    ...createPiAutomationRuntimeBindings({ agentExecution }),
  });
}

interface InstalledPiAutomationRegistryGlobal {
  __workbenchAutomationService?: AutomationService;
}

const registry = globalThis as typeof globalThis & InstalledPiAutomationRegistryGlobal;

/** Preserve the timer/repository identity while rebinding current Pi callbacks after HMR. */
export function getInstalledPiAutomationService(
  options: InstalledPiAutomationServiceOptions,
): AutomationService {
  const runtime = createPiAutomationRuntimeBindings({ agentExecution: options.agentExecution });
  const current = registry.__workbenchAutomationService;
  if (current) {
    Object.setPrototypeOf(current, AutomationService.prototype);
    Object.setPrototypeOf(current.repository, AutomationRepository.prototype);
    current.rebindRuntime(runtime);
    return current;
  }
  const created = createInstalledPiAutomationService(options);
  registry.__workbenchAutomationService = created;
  return created;
}
