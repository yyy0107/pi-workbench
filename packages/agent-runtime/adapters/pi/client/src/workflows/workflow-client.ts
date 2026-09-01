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

/**
 * Create a Workflow RPC facade for one Pi installation.  Keep this factory explicit so two
 * Workbench sidecars can coexist without a module singleton retaining either host transport.
 */
export function createWorkflowClient(rpcOptions: Readonly<PiRpcCallOptions> = {}) {
  const options = Object.freeze({ ...rpcOptions });
  const query = <Payload, Value>(method: string, payload: Payload): Promise<Value> =>
    callPiRpc(method, payload, {
      ...options,
      signal: AbortSignal.timeout(WORKFLOW_QUERY_TIMEOUT_MS),
    });

  return Object.freeze({
    list(payload: WorkflowListPayload = {}): Promise<WorkflowListValue> {
      return query("workflow.list", payload);
    },
    read(payload: WorkflowReadPayload): Promise<WorkflowReadValue> {
      return query("workflow.read", payload);
    },
    readAgentResources(
      payload: WorkflowAgentResourcesPayload,
    ): Promise<WorkflowAgentResourcesValue> {
      return query("workflow.agent.resources.read", payload);
    },
    updateAgentResources(
      payload: WorkflowAgentResourcesUpdatePayload,
    ): Promise<WorkflowAgentResourcesValue> {
      return callPiRpc("workflow.agent.resources.update", payload, options);
    },
    create(payload: WorkflowCreatePayload): Promise<WorkflowReadValue> {
      return callPiRpc("workflow.create", payload, options);
    },
    saveDraft(payload: WorkflowSaveDraftPayload): Promise<WorkflowReadValue> {
      return callPiRpc("workflow.saveDraft", payload, options);
    },
    validate(payload: WorkflowReadPayload): Promise<WorkflowValidationResult> {
      return query("workflow.validate", payload);
    },
    publish(payload: WorkflowPublishPayload): Promise<WorkflowReadValue> {
      return callPiRpc("workflow.publish", payload, options);
    },
    archive(payload: WorkflowArchivePayload): Promise<WorkflowReadValue> {
      return callPiRpc("workflow.archive", payload, options);
    },
    startRun(payload: WorkflowRunStartPayload): Promise<WorkflowRunAdmission> {
      return callPiRpc("workflow.run.start", payload, options);
    },
    cancelRun(payload: WorkflowRunCancelPayload): Promise<WorkflowRunSummary> {
      return callPiRpc("workflow.run.cancel", payload, options);
    },
    deleteRun(payload: WorkflowRunDeletePayload): Promise<WorkflowRunDeleteValue> {
      return callPiRpc("workflow.run.delete", payload, options);
    },
    listRuns(payload: WorkflowRunListPayload = {}): Promise<WorkflowRunListValue> {
      return query("workflow.run.list", payload);
    },
    readRun(payload: WorkflowRunReadPayload): Promise<WorkflowRunReadValue> {
      return query("workflow.run.read", payload);
    },
    resolveApproval(payload: WorkflowResolveApprovalPayload): Promise<WorkflowRunSummary> {
      return callPiRpc("workflow.run.resolveApproval", payload, options);
    },
  });
}

export type PiWorkflowClient = ReturnType<typeof createWorkflowClient>;
