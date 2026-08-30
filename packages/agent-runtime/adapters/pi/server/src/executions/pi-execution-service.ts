import type { AgentExecutionPort } from "@workbench/agent-runtime-server/execution";
import type {
  WorkflowAgentResourceCatalog,
  WorkflowRunDeleteValue,
  WorkflowRunReadValue,
  WorkflowSummary,
} from "@workbench/execution-contracts";
import type { ExecutionNodeExecutor } from "@workbench/execution-server/node-executor";

import { getStreamHub } from "../streams/stream-hub";
import { getProjectTrustService } from "../trust/project-trust-service";
import { getWorkspaceStore } from "../workspaces/workspace-registry";
import { PiAgentExecutionNodeExecutor } from "./pi-execution-node-executors";
import { PiWorkflowAgentResourceCatalog } from "./workflow-agent-resource-catalog";

export interface PiExecutionWorkspace {
  readonly workspaceId: string;
  readonly path: string;
}

export interface PiExecutionAgentResourceInput {
  readonly workflowId: string;
  readonly agentId: string;
  readonly workspacePath: string;
}

/** Pi-owned callbacks and adapters consumed by the Workbench Execution service composition. */
export interface PiExecutionRuntimeBindings {
  listWorkspaces(): Promise<PiExecutionWorkspace[]>;
  isWorkspaceTrusted(workspacePath: string): boolean;
  createAgentNodeExecutor(): ExecutionNodeExecutor;
  readAgentResourceCatalog(
    input: PiExecutionAgentResourceInput,
  ): Promise<WorkflowAgentResourceCatalog>;
  onDefinitionChanged(workflow: WorkflowSummary): void;
  onRunChanged(run: WorkflowRunReadValue["run"]): void;
  onRunRemoved(run: WorkflowRunDeleteValue): void;
}

export interface PiExecutionRuntimeBindingOptions {
  readonly execution: AgentExecutionPort;
}

export function createPiExecutionRuntimeBindings({
  execution,
}: PiExecutionRuntimeBindingOptions): PiExecutionRuntimeBindings {
  const workspaceStore = getWorkspaceStore();
  const isWorkspaceTrusted = (workspacePath: string): boolean =>
    getProjectTrustService().isTrusted(workspacePath);
  const catalog = new PiWorkflowAgentResourceCatalog({ isWorkspaceTrusted });

  return {
    async listWorkspaces() {
      return (await workspaceStore.list()).items;
    },
    isWorkspaceTrusted,
    createAgentNodeExecutor() {
      return new PiAgentExecutionNodeExecutor({ execution, isWorkspaceTrusted });
    },
    readAgentResourceCatalog: (input) => catalog.read(input),
    onDefinitionChanged(workflow) {
      getStreamHub().publishHost({ type: "host/workflow-changed", workflow });
    },
    onRunChanged(run) {
      getStreamHub().publishHost({ type: "host/workflow-run-changed", run });
    },
    onRunRemoved({ runId, workflowId }) {
      getStreamHub().publishHost({ type: "host/workflow-run-removed", runId, workflowId });
    },
  };
}
