import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { WorkbenchCommandExecutionNodeExecutor } from "@/runtime/server/executions/execution-command-node-executor";
import type { AgentExecutionPort } from "@/runtime/server/agent-execution-port";
import { ExecutionEngine } from "@/runtime/server/executions/execution-engine";
import { ExecutionNodeExecutorRegistry } from "@/runtime/server/executions/execution-node-executor";
import { ExecutionRepository } from "@/runtime/server/executions/execution-repository";
import { ExecutionService } from "@/runtime/server/executions/execution-service";
import { getStreamHub } from "../streams/stream-hub";
import { getProjectTrustService } from "../trust/project-trust-service";
import { getWorkspaceStore } from "../workspaces/workspace-registry";
import { PiAgentExecutionNodeExecutor } from "./pi-execution-node-executors";
import { PiWorkflowAgentResourceCatalog } from "./workflow-agent-resource-catalog";

function executionRootDirectory(): string {
  return (
    process.env.WORKBENCH_EXECUTION_DIR?.trim() ??
    process.env.PI_WORKBENCH_WORKFLOW_DIR?.trim() ??
    path.join(getAgentDir(), "workbench-workflows", "v1")
  );
}

export interface PiExecutionServiceOptions {
  execution?: AgentExecutionPort;
  nodeExecutors?: ExecutionNodeExecutorRegistry;
}

function bindCurrentNodeExecutors(
  executors: ExecutionNodeExecutorRegistry,
  options: PiExecutionServiceOptions,
): void {
  const isWorkspaceTrusted = (workspacePath: string): boolean =>
    getProjectTrustService().isTrusted(workspacePath);
  executors.register("agent", new PiAgentExecutionNodeExecutor({ execution: options.execution }));
  executors.register("command", new WorkbenchCommandExecutionNodeExecutor({ isWorkspaceTrusted }));
}

function bindCurrentAgentResourceCatalog(
  service: ExecutionService,
  isWorkspaceTrusted: (workspacePath: string) => boolean,
): void {
  const catalog = new PiWorkflowAgentResourceCatalog({ isWorkspaceTrusted });
  service.bindAgentResourceCatalog((input) => catalog.read(input));
}

export function createPiExecutionService(
  options: PiExecutionServiceOptions = {},
): ExecutionService {
  const workspaceStore = getWorkspaceStore();
  const nodeExecutors = options.nodeExecutors ?? new ExecutionNodeExecutorRegistry();
  const isWorkspaceTrusted = (workspacePath: string): boolean =>
    getProjectTrustService().isTrusted(workspacePath);
  bindCurrentNodeExecutors(nodeExecutors, options);
  const repository = new ExecutionRepository({
    rootDirectory: executionRootDirectory(),
    listWorkspaces: async () => (await workspaceStore.list()).items,
  });
  const service = new ExecutionService({
    repository,
    executors: nodeExecutors,
    isWorkspaceTrusted,
    onDefinitionChanged: (workflow) => {
      getStreamHub().publishHost({ type: "host/workflow-changed", workflow });
    },
    onRunChanged: (run) => {
      getStreamHub().publishHost({ type: "host/workflow-run-changed", run });
    },
    onRunRemoved: ({ runId, workflowId }) => {
      getStreamHub().publishHost({ type: "host/workflow-run-removed", runId, workflowId });
    },
  });
  bindCurrentAgentResourceCatalog(service, isWorkspaceTrusted);
  return service;
}

interface ExecutionRegistryGlobal {
  __workbenchExecutionService?: ExecutionService;
  __workbenchExecutionNodeExecutors?: ExecutionNodeExecutorRegistry;
}

const executionRegistry = globalThis as typeof globalThis & ExecutionRegistryGlobal;

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
  // A cached pre-v3 service may still have old subscription closures that dereference this field.
  // Leave an inert target until the process restarts so HMR cannot revive scheduling side effects.
  legacyService.triggers = retiredExecutionTriggers;
}

function bindCurrentExecutionImplementation(
  service: ExecutionService,
): ExecutionNodeExecutorRegistry {
  // Development HMR replaces module constructors while the global service intentionally survives
  // to preserve active runs and subscriptions. Rebind the stateful objects to the
  // current prototypes instead of allocating a second service graph or leaving save/read methods
  // closed over the previous execution schema.
  retireLegacyExecutionTriggers(service);
  Object.setPrototypeOf(service, ExecutionService.prototype);
  Object.setPrototypeOf(service.repository, ExecutionRepository.prototype);
  Object.setPrototypeOf(service.engine, ExecutionEngine.prototype);

  const nodeExecutors = service.engine.nodeExecutorRegistry();
  Object.setPrototypeOf(nodeExecutors, ExecutionNodeExecutorRegistry.prototype);
  return nodeExecutors;
}

export function getExecutionService(options: PiExecutionServiceOptions = {}): ExecutionService {
  const current = executionRegistry.__workbenchExecutionService;
  if (current) {
    const nodeExecutors = bindCurrentExecutionImplementation(current);
    executionRegistry.__workbenchExecutionNodeExecutors = nodeExecutors;
    bindCurrentNodeExecutors(nodeExecutors, options);
    bindCurrentAgentResourceCatalog(current, (workspacePath) =>
      getProjectTrustService().isTrusted(workspacePath),
    );
    return current;
  }

  const nodeExecutors =
    options.nodeExecutors ??
    executionRegistry.__workbenchExecutionNodeExecutors ??
    new ExecutionNodeExecutorRegistry();
  const created = createPiExecutionService({ ...options, nodeExecutors });
  executionRegistry.__workbenchExecutionService = created;
  executionRegistry.__workbenchExecutionNodeExecutors = nodeExecutors;
  return created;
}
