import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AgentExecutionPort } from "@workbench/agent-runtime-server/execution";
import { ExecutionEngine } from "@workbench/execution-server/engine";
import { ExecutionNodeExecutorRegistry } from "@workbench/execution-server/node-executor";
import { ExecutionRepository } from "@workbench/execution-server/repository";
import { ExecutionService } from "@workbench/execution-server/service";
import { WorkbenchCommandExecutionNodeExecutor } from "@workbench/execution-server/terminal-command-executor";

import { createPiExecutionRuntimeBindings } from "@workbench/agent-runtime-pi-server/installation";

export interface InstalledPiExecutionServiceOptions {
  readonly execution: AgentExecutionPort;
  readonly nodeExecutors?: ExecutionNodeExecutorRegistry;
  readonly rootDirectory?: string;
}

function executionRootDirectory(): string {
  return (
    process.env.WORKBENCH_EXECUTION_DIR?.trim() ??
    process.env.PI_WORKBENCH_WORKFLOW_DIR?.trim() ??
    path.join(getAgentDir(), "workbench-workflows", "v1")
  );
}

function bindCurrentNodeExecutors(
  executors: ExecutionNodeExecutorRegistry,
  execution: AgentExecutionPort,
): ReturnType<typeof createPiExecutionRuntimeBindings> {
  const bindings = createPiExecutionRuntimeBindings({ execution });
  executors.register("agent", bindings.createAgentNodeExecutor());
  executors.register(
    "command",
    new WorkbenchCommandExecutionNodeExecutor({
      isWorkspaceTrusted: bindings.isWorkspaceTrusted,
    }),
  );
  return bindings;
}

export function createInstalledPiExecutionService({
  execution,
  nodeExecutors = new ExecutionNodeExecutorRegistry(),
  rootDirectory = executionRootDirectory(),
}: InstalledPiExecutionServiceOptions): ExecutionService {
  const bindings = bindCurrentNodeExecutors(nodeExecutors, execution);
  const repository = new ExecutionRepository({
    rootDirectory,
    listWorkspaces: bindings.listWorkspaces,
  });
  return new ExecutionService({
    repository,
    executors: nodeExecutors,
    isWorkspaceTrusted: bindings.isWorkspaceTrusted,
    onDefinitionChanged: bindings.onDefinitionChanged,
    onRunChanged: bindings.onRunChanged,
    onRunRemoved: bindings.onRunRemoved,
    readAgentResourceCatalog: bindings.readAgentResourceCatalog,
  });
}

interface InstalledPiExecutionRegistryGlobal {
  __workbenchExecutionService?: ExecutionService;
  __workbenchExecutionNodeExecutors?: ExecutionNodeExecutorRegistry;
}

const executionRegistry = globalThis as typeof globalThis & InstalledPiExecutionRegistryGlobal;

interface LegacyExecutionTriggerRuntime {
  dispose?(): void;
  handleInternalEvent(...args: unknown[]): Promise<void>;
}

const retiredExecutionTriggers: LegacyExecutionTriggerRuntime = Object.freeze({
  dispose() {},
  async handleInternalEvent() {},
});

function retireLegacyExecutionTriggers(service: ExecutionService): void {
  const legacyService = service as ExecutionService & {
    triggers?: LegacyExecutionTriggerRuntime;
  };
  const triggers = legacyService.triggers;
  if (!triggers || triggers === retiredExecutionTriggers) return;
  triggers.dispose?.();
  legacyService.triggers = retiredExecutionTriggers;
}

function bindCurrentExecutionImplementation(
  service: ExecutionService,
): ExecutionNodeExecutorRegistry {
  retireLegacyExecutionTriggers(service);
  Object.setPrototypeOf(service, ExecutionService.prototype);
  Object.setPrototypeOf(service.repository, ExecutionRepository.prototype);
  Object.setPrototypeOf(service.engine, ExecutionEngine.prototype);

  const nodeExecutors = service.engine.nodeExecutorRegistry();
  Object.setPrototypeOf(nodeExecutors, ExecutionNodeExecutorRegistry.prototype);
  return nodeExecutors;
}

/** Preserve active/queued runs and repository caches while rebinding current implementations. */
export function getInstalledPiExecutionService(
  options: InstalledPiExecutionServiceOptions,
): ExecutionService {
  const current = executionRegistry.__workbenchExecutionService;
  if (current) {
    const nodeExecutors = bindCurrentExecutionImplementation(current);
    executionRegistry.__workbenchExecutionNodeExecutors = nodeExecutors;
    const bindings = bindCurrentNodeExecutors(nodeExecutors, options.execution);
    current.bindAgentResourceCatalog(bindings.readAgentResourceCatalog);
    return current;
  }

  const nodeExecutors =
    options.nodeExecutors ??
    executionRegistry.__workbenchExecutionNodeExecutors ??
    new ExecutionNodeExecutorRegistry();
  const created = createInstalledPiExecutionService({ ...options, nodeExecutors });
  executionRegistry.__workbenchExecutionService = created;
  executionRegistry.__workbenchExecutionNodeExecutors = nodeExecutors;
  return created;
}
