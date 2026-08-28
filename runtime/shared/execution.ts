export type ExecutionThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type WorkflowKind = "workflow" | "sop" | "automation";

export type WorkflowScope = { type: "personal" } | { type: "project"; workspaceId: string };

export type WorkflowConcurrency =
  | { mode: "queue" }
  | { mode: "skip" }
  | { mode: "independent" }
  | { mode: "parallel"; maxActiveRuns: number };

export type WorkflowJsonPrimitive = null | boolean | number | string;
export type WorkflowJsonValue =
  | WorkflowJsonPrimitive
  | WorkflowJsonValue[]
  | { [key: string]: WorkflowJsonValue };

export interface ValueBinding {
  source: "run-input" | "node-output";
  nodeId?: string;
  /** RFC 6901 JSON Pointer. The empty string addresses the entire source value. */
  path: string;
}

export interface FlowNodeBase {
  id: string;
  name: string;
  position: { x: number; y: number };
}

export interface StartNode extends FlowNodeBase {
  type: "start";
  config: Record<string, never>;
}

export interface EndNode extends FlowNodeBase {
  type: "end";
  config: { output?: ValueBinding };
}

export interface AgentNode extends FlowNodeBase {
  type: "agent";
  config: {
    prompt: string;
    input?: ValueBinding;
    model?: {
      provider: string;
      modelId: string;
      thinkingLevel?: ExecutionThinkingLevel;
    };
  };
}

export interface CommandNode extends FlowNodeBase {
  type: "command";
  config: {
    command: string;
    relativeCwd?: string;
    timeoutSeconds?: number;
    input?: ValueBinding;
  };
}

export type ConditionOperator = "equals" | "not-equals" | "exists" | "contains" | "greater-than";

export interface ConditionNode extends FlowNodeBase {
  type: "condition";
  config: {
    binding: ValueBinding;
    operator: ConditionOperator;
    value?: WorkflowJsonValue;
  };
}

export interface ApprovalNode extends FlowNodeBase {
  type: "approval";
  config: {
    message: string;
    input?: ValueBinding;
  };
}

export type FlowNode = StartNode | EndNode | AgentNode | CommandNode | ConditionNode | ApprovalNode;

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: "true" | "false";
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  editor: {
    viewport?: { x: number; y: number; zoom: number };
  };
}

export interface ScheduleTriggerSpec {
  id: string;
  type: "schedule";
  name: string;
  cron: string;
  timezone: string;
  targetWorkspaceId?: string;
}

export type WorkflowInternalEventName =
  | "workbench.application.started"
  | "workbench.session.completed"
  | "workbench.workspace.updated";

export interface InternalEventTriggerSpec {
  id: string;
  type: "event";
  name: string;
  event: WorkflowInternalEventName;
  targetWorkspaceId?: string;
}

export type TriggerSpec = ScheduleTriggerSpec | InternalEventTriggerSpec;

export interface WorkflowDocument {
  schemaVersion: 1;
  id: string;
  kind: WorkflowKind;
  scope: WorkflowScope;
  name: string;
  description?: string;
  graph: FlowGraph;
  concurrency: WorkflowConcurrency;
  triggers: TriggerSpec[];
  draftRevision: number;
  publishedRevisionId?: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

export interface FlowRevision {
  schemaVersion: 1;
  revisionId: string;
  workflowId: string;
  kind: WorkflowKind;
  scope: WorkflowScope;
  name: string;
  description?: string;
  graph: FlowGraph;
  concurrency: WorkflowConcurrency;
  triggers: TriggerSpec[];
  publishedAt: number;
}

export type WorkflowValidationCode =
  | "invalid-schema"
  | "duplicate-node-id"
  | "duplicate-edge-id"
  | "missing-start"
  | "multiple-start"
  | "missing-end"
  | "multiple-end"
  | "dangling-edge"
  | "invalid-edge-port"
  | "cycle"
  | "unreachable-node"
  | "invalid-sop"
  | "invalid-trigger"
  | "invalid-binding"
  | "invalid-node-config";

export interface WorkflowValidationIssue {
  code: WorkflowValidationCode;
  message: string;
  path: string;
  nodeId?: string;
  edgeId?: string;
  triggerId?: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  issues: WorkflowValidationIssue[];
}

export interface WorkflowSummary {
  id: string;
  kind: WorkflowKind;
  scope: WorkflowScope;
  name: string;
  description?: string;
  draftRevision: number;
  publishedRevisionId?: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  triggerCount: number;
  enabledTriggerCount: number;
}

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "waiting-for-approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export type WorkflowRunSource = "manual" | "schedule" | "event" | "replay";

export const EXECUTION_SESSION_ORIGIN_CUSTOM_TYPE = "workbench.execution.origin";

/** Durable provenance linking a normal project conversation back to its Execution run. */
export interface ExecutionSessionOrigin {
  version: 1;
  origin: "execution";
  workflowId: string;
  workflowName: string;
  workflowKind: WorkflowKind;
  runId: string;
  nodeId: string;
  attempt: number;
  source: WorkflowRunSource;
  triggerId?: string;
}

export type WorkflowNodeRunStatus =
  | "pending"
  | "running"
  | "waiting-for-approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

export interface WorkflowNodeAttemptSummary {
  nodeId: string;
  attempt: number;
  status: WorkflowNodeRunStatus;
  startedAt?: number;
  completedAt?: number;
  sessionId?: string;
  exitCode?: number;
  errorCode?: string;
}

export interface WorkflowRunSummary {
  schemaVersion: 1;
  id: string;
  workflowId: string;
  workflowName: string;
  workflowKind: WorkflowKind;
  revisionId: string;
  source: WorkflowRunSource;
  status: WorkflowRunStatus;
  targetWorkspaceId?: string;
  triggerId?: string;
  dedupeKey?: string;
  input?: WorkflowJsonValue;
  output?: WorkflowJsonValue;
  errorCode?: string;
  errorMessage?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
  lastSeq: number;
  attempts: WorkflowNodeAttemptSummary[];
}

export type WorkflowRunEventType =
  | "run-created"
  | "run-status-changed"
  | "node-status-changed"
  | "node-output"
  | "node-log"
  | "approval-requested"
  | "approval-resolved"
  | "artifact-created";

export interface WorkflowRunEvent {
  seq: number;
  time: number;
  type: WorkflowRunEventType;
  runId: string;
  nodeId?: string;
  status?: WorkflowRunStatus | WorkflowNodeRunStatus;
  message?: string;
  output?: WorkflowJsonValue;
  approvalId?: string;
  approved?: boolean;
  artifact?: { id: string; name: string; mediaType: string; size: number };
  metadata?: Record<string, WorkflowJsonValue>;
}

export interface WorkflowRunReadValue {
  run: WorkflowRunSummary;
  events: WorkflowRunEvent[];
  nextSeq?: number;
}

export interface WorkflowTriggerState {
  workflowId: string;
  triggerId: string;
  enabled: boolean;
  nextRunAt?: number;
  lastTriggeredAt?: number;
  lastDedupeKey?: string;
  disabledReason?: string;
}

export type WorkflowRunAdmission =
  | { kind: "started" | "queued"; run: WorkflowRunSummary }
  | { kind: "skipped"; activeRunId: string };

export interface WorkflowChangedHostPayload {
  type: "host/workflow-changed";
  workflow: WorkflowSummary;
}

export interface WorkflowRemovedHostPayload {
  type: "host/workflow-removed";
  workflowId: string;
}

export interface WorkflowRunChangedHostPayload {
  type: "host/workflow-run-changed";
  run: WorkflowRunSummary;
}

export interface WorkflowRunRemovedHostPayload {
  type: "host/workflow-run-removed";
  runId: string;
  workflowId: string;
}

export interface WorkflowTriggerChangedHostPayload {
  type: "host/workflow-trigger-changed";
  state: WorkflowTriggerState;
}

export type WorkflowHostPayload =
  | WorkflowChangedHostPayload
  | WorkflowRemovedHostPayload
  | WorkflowRunChangedHostPayload
  | WorkflowRunRemovedHostPayload
  | WorkflowTriggerChangedHostPayload;

export interface WorkflowListPayload {
  workspaceId?: string;
  kind?: WorkflowKind;
  includeArchived?: boolean;
}

export interface WorkflowListValue {
  items: WorkflowSummary[];
}

export interface WorkflowReadPayload {
  workflowId: string;
  workspaceId?: string;
}

export interface WorkflowReadValue {
  document: WorkflowDocument;
  triggerStates: WorkflowTriggerState[];
}

export interface WorkflowCreatePayload {
  kind: WorkflowKind;
  scope: WorkflowScope;
  name: string;
  templateId?: string;
}

export interface WorkflowSaveDraftPayload {
  workflowId: string;
  baseDraftRevision: number;
  draft: WorkflowDocument;
}

export interface WorkflowPublishPayload {
  workflowId: string;
  baseDraftRevision: number;
}

export interface WorkflowArchivePayload {
  workflowId: string;
  archived: boolean;
}

export interface WorkflowRunStartPayload {
  workflowId: string;
  revisionSource: "draft" | "published";
  revisionId?: string;
  targetWorkspaceId?: string;
  input?: WorkflowJsonValue;
  source?: WorkflowRunSource;
}

export interface WorkflowRunCancelPayload {
  runId: string;
}

export interface WorkflowRunDeletePayload {
  runId: string;
}

export interface WorkflowRunDeleteValue {
  deleted: true;
  runId: string;
  workflowId: string;
}

export interface WorkflowRunListPayload {
  workflowId?: string;
  status?: WorkflowRunStatus;
  limit?: number;
}

export interface WorkflowRunListValue {
  items: WorkflowRunSummary[];
}

export interface WorkflowRunReadPayload {
  runId: string;
  afterSeq?: number;
  limit?: number;
}

export interface WorkflowResolveApprovalPayload {
  runId: string;
  nodeId: string;
  approved: boolean;
  result?: WorkflowJsonValue;
}

export interface WorkflowTriggerListPayload {
  workflowId: string;
}

export interface WorkflowTriggerListValue {
  triggers: TriggerSpec[];
  states: WorkflowTriggerState[];
}

export interface WorkflowTriggerUpsertPayload {
  workflowId: string;
  baseDraftRevision: number;
  trigger: TriggerSpec;
}

export interface WorkflowTriggerRemovePayload {
  workflowId: string;
  baseDraftRevision: number;
  triggerId: string;
}

export interface WorkflowTriggerSetEnabledPayload {
  workflowId: string;
  triggerId: string;
  enabled: boolean;
}

export interface ExecutionProtocol {
  list(payload: WorkflowListPayload): Promise<WorkflowListValue>;
  read(payload: WorkflowReadPayload): Promise<WorkflowReadValue>;
  create(payload: WorkflowCreatePayload): Promise<WorkflowReadValue>;
  saveDraft(payload: WorkflowSaveDraftPayload): Promise<WorkflowReadValue>;
  validate(payload: WorkflowReadPayload): Promise<WorkflowValidationResult>;
  publish(payload: WorkflowPublishPayload): Promise<WorkflowReadValue>;
  archive(payload: WorkflowArchivePayload): Promise<WorkflowReadValue>;
  startRun(payload: WorkflowRunStartPayload): Promise<WorkflowRunAdmission>;
  cancelRun(payload: WorkflowRunCancelPayload): Promise<WorkflowRunSummary>;
  deleteRun(payload: WorkflowRunDeletePayload): Promise<WorkflowRunDeleteValue>;
  listRuns(payload: WorkflowRunListPayload): Promise<WorkflowRunListValue>;
  readRun(payload: WorkflowRunReadPayload): Promise<WorkflowRunReadValue>;
  resolveApproval(payload: WorkflowResolveApprovalPayload): Promise<WorkflowRunSummary>;
  listTriggers(payload: WorkflowTriggerListPayload): Promise<WorkflowTriggerListValue>;
  upsertTrigger(payload: WorkflowTriggerUpsertPayload): Promise<WorkflowReadValue>;
  removeTrigger(payload: WorkflowTriggerRemovePayload): Promise<WorkflowReadValue>;
  setTriggerEnabled(payload: WorkflowTriggerSetEnabledPayload): Promise<WorkflowTriggerState>;
}

/** @deprecated Use ExecutionProtocol. Kept while the workflow.* wire protocol is compatible. */
export type WorkflowProtocol = ExecutionProtocol;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseExecutionSessionOrigin(value: unknown): ExecutionSessionOrigin | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.version !== 1 ||
    value.origin !== "execution" ||
    typeof value.workflowId !== "string" ||
    !value.workflowId ||
    typeof value.workflowName !== "string" ||
    !value.workflowName ||
    !["workflow", "sop", "automation"].includes(value.workflowKind as string) ||
    typeof value.runId !== "string" ||
    !value.runId ||
    typeof value.nodeId !== "string" ||
    !value.nodeId ||
    !Number.isInteger(value.attempt) ||
    (value.attempt as number) < 1 ||
    !["manual", "schedule", "event", "replay"].includes(value.source as string) ||
    (value.triggerId !== undefined && (typeof value.triggerId !== "string" || !value.triggerId))
  ) {
    return undefined;
  }
  return value as unknown as ExecutionSessionOrigin;
}

export function isWorkflowHostPayload(value: unknown): value is WorkflowHostPayload {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "host/workflow-changed":
      return isRecord(value.workflow) && typeof value.workflow.id === "string";
    case "host/workflow-removed":
      return typeof value.workflowId === "string";
    case "host/workflow-run-changed":
      return isRecord(value.run) && typeof value.run.id === "string";
    case "host/workflow-run-removed":
      return typeof value.runId === "string" && typeof value.workflowId === "string";
    case "host/workflow-trigger-changed":
      return (
        isRecord(value.state) &&
        typeof value.state.workflowId === "string" &&
        typeof value.state.triggerId === "string"
      );
    default:
      return false;
  }
}
