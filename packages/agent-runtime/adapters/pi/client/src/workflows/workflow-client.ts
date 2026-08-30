import type {
  WorkflowArchivePayload,
  WorkflowAgentResourcesPayload,
  WorkflowAgentResourcesUpdatePayload,
  WorkflowAgentResourcesValue,
  WorkflowCreatePayload,
  WorkflowListPayload,
  WorkflowListValue,
  WorkflowPublishPayload,
  WorkflowReadPayload,
  WorkflowReadValue,
  WorkflowResolveApprovalPayload,
  WorkflowRunAdmission,
  WorkflowRunCancelPayload,
  WorkflowRunDeletePayload,
  WorkflowRunDeleteValue,
  WorkflowRunListPayload,
  WorkflowRunListValue,
  WorkflowRunReadPayload,
  WorkflowRunReadValue,
  WorkflowRunStartPayload,
  WorkflowSaveDraftPayload,
  WorkflowValidationResult,
  WorkflowRunSummary,
} from "@workbench/execution-contracts";
import { callPiRpc, type PiRpcCallOptions } from "../transport/api";

// The first execution query can include a cold server-module compile in development. Keep a
// bounded timeout, but leave enough room for that one-time startup work instead of turning it into
// a catalog-wide load failure.
const WORKFLOW_QUERY_TIMEOUT_MS = 30_000;

function callWorkflowQuery<Payload, Value>(method: string, payload: Payload): Promise<Value> {
  const options: PiRpcCallOptions = {
    signal: AbortSignal.timeout(WORKFLOW_QUERY_TIMEOUT_MS),
  };
  return callPiRpc(method, payload, options);
}

export const workflowClient = {
  list(payload: WorkflowListPayload = {}): Promise<WorkflowListValue> {
    return callWorkflowQuery("workflow.list", payload);
  },
  read(payload: WorkflowReadPayload): Promise<WorkflowReadValue> {
    return callWorkflowQuery("workflow.read", payload);
  },
  readAgentResources(payload: WorkflowAgentResourcesPayload): Promise<WorkflowAgentResourcesValue> {
    return callWorkflowQuery("workflow.agent.resources.read", payload);
  },
  updateAgentResources(
    payload: WorkflowAgentResourcesUpdatePayload,
  ): Promise<WorkflowAgentResourcesValue> {
    return callPiRpc("workflow.agent.resources.update", payload);
  },
  create(payload: WorkflowCreatePayload): Promise<WorkflowReadValue> {
    return callPiRpc("workflow.create", payload);
  },
  saveDraft(payload: WorkflowSaveDraftPayload): Promise<WorkflowReadValue> {
    return callPiRpc("workflow.saveDraft", payload);
  },
  validate(payload: WorkflowReadPayload): Promise<WorkflowValidationResult> {
    return callWorkflowQuery("workflow.validate", payload);
  },
  publish(payload: WorkflowPublishPayload): Promise<WorkflowReadValue> {
    return callPiRpc("workflow.publish", payload);
  },
  archive(payload: WorkflowArchivePayload): Promise<WorkflowReadValue> {
    return callPiRpc("workflow.archive", payload);
  },
  startRun(payload: WorkflowRunStartPayload): Promise<WorkflowRunAdmission> {
    return callPiRpc("workflow.run.start", payload);
  },
  cancelRun(payload: WorkflowRunCancelPayload): Promise<WorkflowRunSummary> {
    return callPiRpc("workflow.run.cancel", payload);
  },
  deleteRun(payload: WorkflowRunDeletePayload): Promise<WorkflowRunDeleteValue> {
    return callPiRpc("workflow.run.delete", payload);
  },
  listRuns(payload: WorkflowRunListPayload = {}): Promise<WorkflowRunListValue> {
    return callWorkflowQuery("workflow.run.list", payload);
  },
  readRun(payload: WorkflowRunReadPayload): Promise<WorkflowRunReadValue> {
    return callWorkflowQuery("workflow.run.read", payload);
  },
  resolveApproval(payload: WorkflowResolveApprovalPayload): Promise<WorkflowRunSummary> {
    return callPiRpc("workflow.run.resolveApproval", payload);
  },
};
