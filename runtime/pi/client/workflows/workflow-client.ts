import type {
  WorkflowArchivePayload,
  WorkflowCreatePayload,
  WorkflowListPayload,
  WorkflowListValue,
  WorkflowPublishPayload,
  WorkflowReadPayload,
  WorkflowReadValue,
  WorkflowResolveApprovalPayload,
  WorkflowRunAdmission,
  WorkflowRunCancelPayload,
  WorkflowRunListPayload,
  WorkflowRunListValue,
  WorkflowRunReadPayload,
  WorkflowRunReadValue,
  WorkflowRunStartPayload,
  WorkflowSaveDraftPayload,
  WorkflowTriggerListPayload,
  WorkflowTriggerListValue,
  WorkflowTriggerRemovePayload,
  WorkflowTriggerSetEnabledPayload,
  WorkflowTriggerState,
  WorkflowTriggerUpsertPayload,
  WorkflowValidationResult,
  WorkflowRunSummary,
} from "@/runtime/shared/execution";
import { callPiRpc } from "../transport/api";

export const workflowClient = {
  list(payload: WorkflowListPayload = {}): Promise<WorkflowListValue> {
    return callPiRpc("workflow.list", payload);
  },
  read(payload: WorkflowReadPayload): Promise<WorkflowReadValue> {
    return callPiRpc("workflow.read", payload);
  },
  create(payload: WorkflowCreatePayload): Promise<WorkflowReadValue> {
    return callPiRpc("workflow.create", payload);
  },
  saveDraft(payload: WorkflowSaveDraftPayload): Promise<WorkflowReadValue> {
    return callPiRpc("workflow.saveDraft", payload);
  },
  validate(payload: WorkflowReadPayload): Promise<WorkflowValidationResult> {
    return callPiRpc("workflow.validate", payload);
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
  listRuns(payload: WorkflowRunListPayload = {}): Promise<WorkflowRunListValue> {
    return callPiRpc("workflow.run.list", payload);
  },
  readRun(payload: WorkflowRunReadPayload): Promise<WorkflowRunReadValue> {
    return callPiRpc("workflow.run.read", payload);
  },
  resolveApproval(payload: WorkflowResolveApprovalPayload): Promise<WorkflowRunSummary> {
    return callPiRpc("workflow.run.resolveApproval", payload);
  },
  listTriggers(payload: WorkflowTriggerListPayload): Promise<WorkflowTriggerListValue> {
    return callPiRpc("workflow.trigger.list", payload);
  },
  upsertTrigger(payload: WorkflowTriggerUpsertPayload): Promise<WorkflowReadValue> {
    return callPiRpc("workflow.trigger.upsert", payload);
  },
  removeTrigger(payload: WorkflowTriggerRemovePayload): Promise<WorkflowReadValue> {
    return callPiRpc("workflow.trigger.remove", payload);
  },
  setTriggerEnabled(payload: WorkflowTriggerSetEnabledPayload): Promise<WorkflowTriggerState> {
    return callPiRpc("workflow.trigger.setEnabled", payload);
  },
};
