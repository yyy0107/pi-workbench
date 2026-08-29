import type {
  TriggerSpec,
  ExecutionProtocol,
  ExecutionThinkingLevel,
  WorkflowDocument,
  WorkflowJsonValue,
  WorkflowScope,
} from "@/runtime/shared/execution";
import {
  assertExecutionJsonValue,
  parseExecutionDocument,
  parseTriggerSpec,
} from "@/runtime/server/executions/execution-schema";
import {
  handleRpcPost,
  rpcBoolean,
  rpcEnum,
  rpcInteger,
  rpcObject,
  rpcOptional,
  rpcRefine,
  rpcString,
  rpcUnion,
  rpcUnknown,
  type RpcValidator,
} from "../rpc-transport";
import type { RpcRouteGroup } from "./rpc-route-group";

export interface ExecutionRpcRoutesDependencies {
  readonly service: ExecutionProtocol;
  readonly projectDomainError: (error: unknown) => never;
}

const id = rpcString({ minLength: 1, maxLength: 200 });
const pathSegmentId = rpcString({
  minLength: 1,
  maxLength: 200,
  pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/u,
});
const runId = rpcString({
  minLength: 1,
  maxLength: 200,
  pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/u,
});
const kind = rpcEnum(["workflow", "sop"]);
const runStatus = rpcEnum([
  "queued",
  "running",
  "waiting-for-approval",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
]);
const workflowScope = rpcUnion([
  rpcObject({ type: rpcEnum(["personal"]) }),
  rpcObject({ type: rpcEnum(["project"]), workspaceId: id }),
]) as RpcValidator<WorkflowScope>;
const executionDocument = rpcRefine(
  rpcUnknown,
  (value) => {
    try {
      parseExecutionDocument(value);
      return true;
    } catch {
      return false;
    }
  },
  { code: "invalid_workflow", message: "Expected a valid workflow document." },
) as RpcValidator<WorkflowDocument>;
const triggerSpec = rpcRefine(
  rpcUnknown,
  (value) => {
    try {
      parseTriggerSpec(value);
      return true;
    } catch {
      return false;
    }
  },
  { code: "invalid_trigger", message: "Expected a valid workflow trigger." },
) as RpcValidator<TriggerSpec>;
const jsonValue = rpcRefine(
  rpcUnknown,
  (value) => {
    try {
      assertExecutionJsonValue(value);
      return true;
    } catch {
      return false;
    }
  },
  { code: "invalid_json", message: "Expected JSON-serializable data." },
) as RpcValidator<WorkflowJsonValue>;

const listPayload = rpcObject({
  workspaceId: rpcOptional(id),
  kind: rpcOptional(kind),
  includeArchived: rpcOptional(rpcBoolean),
});
const readPayload = rpcObject({ workflowId: id, workspaceId: rpcOptional(id) });
const agentResourcesPayload = rpcObject({
  workflowId: id,
  agentId: pathSegmentId,
  promptTemplate: pathSegmentId,
});
const thinkingLevel = rpcEnum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]) as RpcValidator<ExecutionThinkingLevel>;
const agentResourcesUpdatePayload = rpcObject({
  workflowId: id,
  agentId: pathSegmentId,
  promptTemplate: pathSegmentId,
  prompt: rpcString({ maxLength: 100_000 }),
  model: rpcOptional(
    rpcObject({
      provider: id,
      modelId: id,
      thinkingLevel: rpcOptional(thinkingLevel),
    }),
  ),
});
const createPayload = rpcObject({
  kind,
  scope: workflowScope,
  name: rpcString({ minLength: 1, maxLength: 240, trim: true }),
  templateId: rpcOptional(id),
});
const saveDraftPayload = rpcObject({
  workflowId: id,
  baseDraftRevision: rpcInteger({ minimum: 0 }),
  draft: executionDocument,
});
const publishPayload = rpcObject({
  workflowId: id,
  baseDraftRevision: rpcInteger({ minimum: 0 }),
});
const archivePayload = rpcObject({ workflowId: id, archived: rpcBoolean });
const runStartPayload = rpcObject({
  workflowId: id,
  revisionSource: rpcEnum(["draft", "published"]),
  revisionId: rpcOptional(id),
  targetWorkspaceId: rpcOptional(id),
  input: rpcOptional(jsonValue),
  source: rpcOptional(rpcEnum(["manual", "replay"])),
});
const runIdPayload = rpcObject({ runId });
const runListPayload = rpcObject({
  workflowId: rpcOptional(id),
  status: rpcOptional(runStatus),
  limit: rpcOptional(rpcInteger({ minimum: 1, maximum: 1_000 })),
});
const runReadPayload = rpcObject({
  runId,
  afterSeq: rpcOptional(rpcInteger({ minimum: 0 })),
  limit: rpcOptional(rpcInteger({ minimum: 1, maximum: 1_000 })),
});
const approvalPayload = rpcObject({
  runId: id,
  nodeId: id,
  approved: rpcBoolean,
  result: rpcOptional(jsonValue),
});
const triggerListPayload = rpcObject({ workflowId: id });
const triggerUpsertPayload = rpcObject({
  workflowId: id,
  baseDraftRevision: rpcInteger({ minimum: 0 }),
  trigger: triggerSpec,
});
const triggerRemovePayload = rpcObject({
  workflowId: id,
  baseDraftRevision: rpcInteger({ minimum: 0 }),
  triggerId: id,
});
const triggerEnabledPayload = rpcObject({
  workflowId: id,
  triggerId: id,
  enabled: rpcBoolean,
});

async function invoke<Value>(
  operation: () => Promise<Value>,
  projectDomainError: ExecutionRpcRoutesDependencies["projectDomainError"],
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    projectDomainError(error);
  }
}

export function createExecutionRpcRoutes({
  service,
  projectDomainError,
}: ExecutionRpcRoutesDependencies): RpcRouteGroup {
  return {
    handle(request, method) {
      switch (method) {
        case "workflow.list":
          return handleRpcPost(request, {
            method,
            payload: listPayload,
            handler: (payload) => invoke(() => service.list(payload), projectDomainError),
          });
        case "workflow.read":
          return handleRpcPost(request, {
            method,
            payload: readPayload,
            handler: (payload) => invoke(() => service.read(payload), projectDomainError),
          });
        case "workflow.agent.resources.read":
          return handleRpcPost(request, {
            method,
            payload: agentResourcesPayload,
            handler: (payload) =>
              invoke(() => service.readAgentResources(payload), projectDomainError),
          });
        case "workflow.agent.resources.update":
          return handleRpcPost(request, {
            method,
            payload: agentResourcesUpdatePayload,
            handler: (payload) =>
              invoke(() => service.updateAgentResources(payload), projectDomainError),
          });
        case "workflow.create":
          return handleRpcPost(request, {
            method,
            payload: createPayload,
            handler: (payload) => invoke(() => service.create(payload), projectDomainError),
          });
        case "workflow.saveDraft":
          return handleRpcPost(request, {
            method,
            payload: saveDraftPayload,
            handler: (payload) => invoke(() => service.saveDraft(payload), projectDomainError),
          });
        case "workflow.validate":
          return handleRpcPost(request, {
            method,
            payload: readPayload,
            handler: (payload) => invoke(() => service.validate(payload), projectDomainError),
          });
        case "workflow.publish":
          return handleRpcPost(request, {
            method,
            payload: publishPayload,
            handler: (payload) => invoke(() => service.publish(payload), projectDomainError),
          });
        case "workflow.archive":
          return handleRpcPost(request, {
            method,
            payload: archivePayload,
            handler: (payload) => invoke(() => service.archive(payload), projectDomainError),
          });
        case "workflow.run.start":
          return handleRpcPost(request, {
            method,
            payload: runStartPayload,
            handler: (payload) => invoke(() => service.startRun(payload), projectDomainError),
          });
        case "workflow.run.cancel":
          return handleRpcPost(request, {
            method,
            payload: runIdPayload,
            handler: (payload) => invoke(() => service.cancelRun(payload), projectDomainError),
          });
        case "workflow.run.delete":
          return handleRpcPost(request, {
            method,
            payload: runIdPayload,
            handler: (payload) => invoke(() => service.deleteRun(payload), projectDomainError),
          });
        case "workflow.run.list":
          return handleRpcPost(request, {
            method,
            payload: runListPayload,
            handler: (payload) => invoke(() => service.listRuns(payload), projectDomainError),
          });
        case "workflow.run.read":
          return handleRpcPost(request, {
            method,
            payload: runReadPayload,
            handler: (payload) => invoke(() => service.readRun(payload), projectDomainError),
          });
        case "workflow.run.resolveApproval":
          return handleRpcPost(request, {
            method,
            payload: approvalPayload,
            handler: (payload) =>
              invoke(() => service.resolveApproval(payload), projectDomainError),
          });
        case "workflow.trigger.list":
          return handleRpcPost(request, {
            method,
            payload: triggerListPayload,
            handler: (payload) => invoke(() => service.listTriggers(payload), projectDomainError),
          });
        case "workflow.trigger.upsert":
          return handleRpcPost(request, {
            method,
            payload: triggerUpsertPayload,
            handler: (payload) => invoke(() => service.upsertTrigger(payload), projectDomainError),
          });
        case "workflow.trigger.remove":
          return handleRpcPost(request, {
            method,
            payload: triggerRemovePayload,
            handler: (payload) => invoke(() => service.removeTrigger(payload), projectDomainError),
          });
        case "workflow.trigger.setEnabled":
          return handleRpcPost(request, {
            method,
            payload: triggerEnabledPayload,
            handler: (payload) =>
              invoke(() => service.setTriggerEnabled(payload), projectDomainError),
          });
        default:
          return undefined;
      }
    },
  };
}
