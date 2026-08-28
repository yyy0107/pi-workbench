import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { WorkbenchCommandExecutionNodeExecutor } from "@/runtime/server/executions/execution-command-node-executor";
import type { AgentExecutionPort } from "@/runtime/server/agent-execution-port";
import { ExecutionNodeExecutorRegistry } from "@/runtime/server/executions/execution-node-executor";
import { ExecutionRepository } from "@/runtime/server/executions/execution-repository";
import { ExecutionService } from "@/runtime/server/executions/execution-service";
import { getRunningSessionIds, subscribeRunningSessions } from "../sessions/session-registry";
import { getStreamHub } from "../streams/stream-hub";
import { getProjectTrustService } from "../trust/project-trust-service";
import { getWorkspaceStore } from "../workspaces/workspace-registry";
import { PiAgentExecutionNodeExecutor } from "./pi-execution-node-executors";

function executionRootDirectory(): string {
  return (
    process.env.WORKBENCH_EXECUTION_DIR?.trim() ??
    process.env.PI_WORKBENCH_WORKFLOW_DIR?.trim() ??
    path.join(getAgentDir(), "workbench-workflows", "v1")
  );
}

export interface PiExecutionServiceOptions {
  execution?: AgentExecutionPort;
}

export function createPiExecutionService(
  options: PiExecutionServiceOptions = {},
): ExecutionService {
  const workspaceStore = getWorkspaceStore();
  const isWorkspaceTrusted = (workspacePath: string): boolean =>
    getProjectTrustService().isTrusted(workspacePath);
  const repository = new ExecutionRepository({
    rootDirectory: executionRootDirectory(),
    listWorkspaces: async () => (await workspaceStore.list()).items,
  });
  return new ExecutionService({
    repository,
    executors: new ExecutionNodeExecutorRegistry({
      agent: new PiAgentExecutionNodeExecutor({ execution: options.execution }),
      command: new WorkbenchCommandExecutionNodeExecutor({ isWorkspaceTrusted }),
    }),
    isWorkspaceTrusted,
    getRunningSessionIds,
    subscribeRunningSessions: (listener) => {
      subscribeRunningSessions(listener);
    },
    subscribeWorkspaceEvents: (listener) => {
      workspaceStore.subscribe(listener);
    },
    onDefinitionChanged: (workflow) => {
      getStreamHub().publishHost({ type: "host/workflow-changed", workflow });
    },
    onRunChanged: (run) => {
      getStreamHub().publishHost({ type: "host/workflow-run-changed", run });
    },
    onRunRemoved: ({ runId, workflowId }) => {
      getStreamHub().publishHost({ type: "host/workflow-run-removed", runId, workflowId });
    },
    onTriggerChanged: (state) => {
      getStreamHub().publishHost({ type: "host/workflow-trigger-changed", state });
    },
  });
}

interface ExecutionRegistryGlobal {
  __workbenchExecutionService?: ExecutionService;
}

const executionRegistry = globalThis as typeof globalThis & ExecutionRegistryGlobal;

export function getExecutionService(options: PiExecutionServiceOptions = {}): ExecutionService {
  executionRegistry.__workbenchExecutionService ??= createPiExecutionService(options);
  return executionRegistry.__workbenchExecutionService;
}
