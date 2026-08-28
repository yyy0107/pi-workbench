import type {
  FlowEdge,
  FlowNode,
  FlowRevision,
  ValueBinding,
  WorkflowJsonValue,
  WorkflowNodeAttemptSummary,
  WorkflowNodeRunStatus,
  WorkflowResolveApprovalPayload,
  WorkflowRunAdmission,
  WorkflowRunEvent,
  WorkflowRunSource,
  WorkflowRunStatus,
  WorkflowRunSummary,
} from "@/runtime/shared/execution";
import { compileExecutionRevision, type CompiledExecutionPlan } from "./execution-compiler";
import { ExecutionNodeExecutorRegistry, type ExecutionNodeResult } from "./execution-node-executor";
import { ExecutionError } from "./execution-errors";
import { ExecutionRepository } from "./execution-repository";

const MAX_READY_NODE_CONCURRENCY = 4;
const MAX_ACTIVE_EXECUTION_RUNS = 8;

interface StartExecutionInput {
  revision: FlowRevision;
  source: WorkflowRunSource;
  targetWorkspaceId?: string;
  workspacePath?: string;
  triggerId?: string;
  dedupeKey?: string;
  input?: WorkflowJsonValue;
}

interface QueuedRun {
  run: WorkflowRunSummary;
  plan: CompiledExecutionPlan;
  workspacePath?: string;
}

interface ApprovalResolution {
  approved: boolean;
  result?: WorkflowJsonValue;
  cancelled?: boolean;
}

interface PendingApproval {
  runId: string;
  nodeId: string;
  resolve(value: ApprovalResolution): void;
}

interface ActiveExecution {
  controller: AbortController;
  done: Promise<void>;
}

export interface ExecutionEngineOptions {
  repository: ExecutionRepository;
  executors?: ExecutionNodeExecutorRegistry;
  now?: () => number;
  onRunChanged?: (run: WorkflowRunSummary) => void;
}

function terminalNodeStatus(status: WorkflowNodeRunStatus): boolean {
  return ["succeeded", "failed", "cancelled", "skipped"].includes(status);
}

function jsonPointer(
  value: WorkflowJsonValue | undefined,
  pointer: string,
): WorkflowJsonValue | undefined {
  if (value === undefined) return undefined;
  if (pointer === "") return value;
  if (!pointer.startsWith("/")) return undefined;
  let current: WorkflowJsonValue | undefined = value;
  for (const rawToken of pointer.slice(1).split("/")) {
    const token = rawToken.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      const index = Number(token);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (typeof current === "object" && current !== null) {
      current = current[token];
    } else {
      current = undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
}

function resolveBinding(
  binding: ValueBinding | undefined,
  runInput: WorkflowJsonValue | undefined,
  outputs: ReadonlyMap<string, WorkflowJsonValue | undefined>,
): WorkflowJsonValue | undefined {
  if (!binding) return undefined;
  const source = binding.source === "run-input" ? runInput : outputs.get(binding.nodeId ?? "");
  return jsonPointer(source, binding.path);
}

function equalJson(
  left: WorkflowJsonValue | undefined,
  right: WorkflowJsonValue | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function evaluateCondition(
  node: Extract<FlowNode, { type: "condition" }>,
  runInput: WorkflowJsonValue | undefined,
  outputs: ReadonlyMap<string, WorkflowJsonValue | undefined>,
): boolean {
  const actual = resolveBinding(node.config.binding, runInput, outputs);
  switch (node.config.operator) {
    case "equals":
      return equalJson(actual, node.config.value);
    case "not-equals":
      return !equalJson(actual, node.config.value);
    case "exists":
      return actual !== undefined && actual !== null;
    case "contains":
      if (typeof actual === "string" && typeof node.config.value === "string") {
        return actual.includes(node.config.value);
      }
      if (Array.isArray(actual)) return actual.some((entry) => equalJson(entry, node.config.value));
      return false;
    case "greater-than":
      return typeof actual === "number" && typeof node.config.value === "number"
        ? actual > node.config.value
        : false;
  }
}

function nodeInputBinding(node: FlowNode): ValueBinding | undefined {
  switch (node.type) {
    case "agent":
    case "command":
    case "approval":
      return node.config.input;
    case "end":
      return node.config.output;
    case "condition":
      return node.config.binding;
    default:
      return undefined;
  }
}

function attemptFor(
  attempts: readonly WorkflowNodeAttemptSummary[],
  nodeId: string,
): WorkflowNodeAttemptSummary | undefined {
  return attempts.findLast((attempt) => attempt.nodeId === nodeId);
}

function replaceAttempt(
  attempts: readonly WorkflowNodeAttemptSummary[],
  next: WorkflowNodeAttemptSummary,
): WorkflowNodeAttemptSummary[] {
  return [...attempts.filter((attempt) => attempt !== attemptFor(attempts, next.nodeId)), next];
}

export class ExecutionEngine {
  private readonly repository: ExecutionRepository;
  private readonly executors: ExecutionNodeExecutorRegistry;
  private readonly now: () => number;
  private readonly onRunChanged: (run: WorkflowRunSummary) => void;
  private readonly active = new Map<string, ActiveExecution>();
  private readonly activeByWorkflow = new Map<string, Set<string>>();
  private readonly queuedByWorkflow = new Map<string, QueuedRun[]>();
  private readonly approvals = new Map<string, PendingApproval>();

  constructor(options: ExecutionEngineOptions) {
    this.repository = options.repository;
    this.executors = options.executors ?? new ExecutionNodeExecutorRegistry();
    this.now = options.now ?? Date.now;
    this.onRunChanged = options.onRunChanged ?? (() => undefined);
  }

  async initialize(): Promise<void> {
    for (const run of await this.repository.markInterruptedRuns()) this.onRunChanged(run);
  }

  private workflowActiveRuns(workflowId: string): Set<string> {
    let runs = this.activeByWorkflow.get(workflowId);
    if (!runs) {
      runs = new Set();
      this.activeByWorkflow.set(workflowId, runs);
    }
    return runs;
  }

  async start(input: StartExecutionInput): Promise<WorkflowRunAdmission> {
    const plan = compileExecutionRevision(input.revision);
    const activeRuns = this.workflowActiveRuns(input.revision.workflowId);
    if (input.revision.concurrency.mode === "skip" && activeRuns.size > 0) {
      return { kind: "skipped", activeRunId: activeRuns.values().next().value! };
    }
    const limit =
      input.revision.concurrency.mode === "parallel" ? input.revision.concurrency.maxActiveRuns : 1;
    const createdAt = this.now();
    const run: WorkflowRunSummary = {
      schemaVersion: 1,
      id: this.repository.createId(),
      workflowId: input.revision.workflowId,
      workflowName: input.revision.name,
      workflowKind: input.revision.kind,
      revisionId: input.revision.revisionId,
      source: input.source,
      status: "queued",
      ...(input.targetWorkspaceId === undefined
        ? {}
        : { targetWorkspaceId: input.targetWorkspaceId }),
      ...(input.triggerId === undefined ? {} : { triggerId: input.triggerId }),
      ...(input.dedupeKey === undefined ? {} : { dedupeKey: input.dedupeKey }),
      ...(input.input === undefined ? {} : { input: input.input }),
      createdAt,
      updatedAt: createdAt,
      lastSeq: 0,
      attempts: [],
    };
    const persisted = await this.repository.createRun(run);
    this.onRunChanged(persisted);
    const queued = { run: persisted, plan, workspacePath: input.workspacePath };
    if (activeRuns.size >= limit || this.active.size >= MAX_ACTIVE_EXECUTION_RUNS) {
      const items = this.queuedByWorkflow.get(run.workflowId) ?? [];
      items.push(queued);
      this.queuedByWorkflow.set(run.workflowId, items);
      return { kind: "queued", run: persisted };
    }
    this.launch(queued);
    return { kind: "started", run: persisted };
  }

  private launch(item: QueuedRun): void {
    const controller = new AbortController();
    this.workflowActiveRuns(item.run.workflowId).add(item.run.id);
    const done = this.execute(item, controller.signal)
      .catch(() => undefined)
      .finally(() => {
        this.active.delete(item.run.id);
        this.workflowActiveRuns(item.run.workflowId).delete(item.run.id);
        this.drainQueues();
      });
    this.active.set(item.run.id, { controller, done });
  }

  private drainQueues(): void {
    while (this.active.size < MAX_ACTIVE_EXECUTION_RUNS) {
      const candidate = [...this.queuedByWorkflow.entries()]
        .filter(([workflowId, queue]) => {
          const next = queue[0];
          if (!next) return false;
          const concurrency = next.plan.revision.concurrency;
          const limit = concurrency.mode === "parallel" ? concurrency.maxActiveRuns : 1;
          return this.workflowActiveRuns(workflowId).size < limit;
        })
        .sort((left, right) => left[1][0]!.run.createdAt - right[1][0]!.run.createdAt)[0];
      if (!candidate) return;
      const [workflowId, queue] = candidate;
      this.launch(queue.shift()!);
      if (queue.length === 0) this.queuedByWorkflow.delete(workflowId);
    }
  }

  async cancel(runId: string): Promise<WorkflowRunSummary> {
    const active = this.active.get(runId);
    if (active) {
      active.controller.abort();
      const approval = this.approvals.get(runId);
      approval?.resolve({ approved: false, cancelled: true });
      await active.done;
      return this.repository.readRunSummary(runId);
    }
    for (const [workflowId, queue] of this.queuedByWorkflow) {
      const index = queue.findIndex(({ run }) => run.id === runId);
      if (index < 0) continue;
      const [item] = queue.splice(index, 1);
      if (queue.length === 0) this.queuedByWorkflow.delete(workflowId);
      const next = await this.repository.updateRun(
        {
          ...item!.run,
          status: "cancelled",
          completedAt: this.now(),
        },
        { type: "run-status-changed", status: "cancelled" },
      );
      this.onRunChanged(next);
      return next;
    }
    return this.repository.readRunSummary(runId);
  }

  async resolveApproval(payload: WorkflowResolveApprovalPayload): Promise<WorkflowRunSummary> {
    const approval = this.approvals.get(payload.runId);
    if (!approval || approval.nodeId !== payload.nodeId) {
      throw new ExecutionError("approval-not-found", "The approval is no longer pending.", {
        runId: payload.runId,
        nodeId: payload.nodeId,
      });
    }
    approval.resolve({
      approved: payload.approved,
      ...(payload.result === undefined ? {} : { result: payload.result }),
    });
    return this.repository.readRunSummary(payload.runId);
  }

  private async persistRunStatus(
    run: WorkflowRunSummary,
    status: WorkflowRunStatus,
    additions: Partial<WorkflowRunSummary> = {},
  ): Promise<WorkflowRunSummary> {
    const next = await this.repository.updateRun(
      { ...run, ...additions, status },
      { type: "run-status-changed", status },
    );
    this.onRunChanged(next);
    return next;
  }

  private async persistNodeStatus(
    run: WorkflowRunSummary,
    nodeId: string,
    status: WorkflowNodeRunStatus,
    additions: Partial<WorkflowNodeAttemptSummary> = {},
  ): Promise<WorkflowRunSummary> {
    const current = attemptFor(run.attempts, nodeId);
    const attempt: WorkflowNodeAttemptSummary = {
      nodeId,
      attempt: current?.attempt ?? 1,
      ...current,
      ...additions,
      status,
    };
    const next = await this.repository.updateRun(
      { ...run, attempts: replaceAttempt(run.attempts, attempt) },
      { type: "node-status-changed", nodeId, status },
    );
    this.onRunChanged(next);
    return next;
  }

  private async awaitApproval(
    run: WorkflowRunSummary,
    node: Extract<FlowNode, { type: "approval" }>,
    signal: AbortSignal,
  ): Promise<ApprovalResolution> {
    let resolve!: (value: ApprovalResolution) => void;
    const promise = new Promise<ApprovalResolution>((resolvePromise) => {
      resolve = resolvePromise;
    });
    const pending = { runId: run.id, nodeId: node.id, resolve };
    this.approvals.set(run.id, pending);
    const abort = (): void => resolve({ approved: false, cancelled: true });
    signal.addEventListener("abort", abort, { once: true });
    try {
      return await promise;
    } finally {
      signal.removeEventListener("abort", abort);
      if (this.approvals.get(run.id) === pending) this.approvals.delete(run.id);
    }
  }

  private async executeNode(
    item: QueuedRun,
    node: FlowNode,
    outputs: ReadonlyMap<string, WorkflowJsonValue | undefined>,
    signal: AbortSignal,
  ): Promise<ExecutionNodeResult> {
    if (node.type === "start") return { output: item.run.input };
    if (node.type === "end") {
      return {
        output:
          resolveBinding(node.config.output, item.run.input, outputs) ??
          [...outputs.values()].findLast((value) => value !== undefined),
      };
    }
    if (node.type === "condition") {
      return { output: evaluateCondition(node, item.run.input, outputs) };
    }
    const executor = this.executors.get(node.type);
    if (!executor) throw new Error(`No executor registered for ${node.type}.`);
    return executor.execute({
      runId: item.run.id,
      node,
      attempt: 1,
      workspaceId: item.run.targetWorkspaceId ?? "",
      workspacePath: item.workspacePath ?? "",
      input: resolveBinding(nodeInputBinding(node), item.run.input, outputs),
      signal,
      sessionDirectory: this.repository.executionSessionDirectory(item.run.id),
      artifactDirectory: this.repository.artifactDirectory(item.run.id),
    });
  }

  private edgeActivation(
    node: FlowNode,
    edge: FlowEdge,
    output: WorkflowJsonValue | undefined,
  ): boolean {
    return node.type === "condition" ? edge.sourceHandle === String(output) : true;
  }

  private async execute(item: QueuedRun, signal: AbortSignal): Promise<void> {
    let run = await this.persistRunStatus(item.run, "running", { startedAt: this.now() });
    const statuses = new Map<string, WorkflowNodeRunStatus>(
      item.plan.topologicalOrder.map((nodeId) => [nodeId, "pending"]),
    );
    const edgeActive = new Map<string, boolean>();
    const outputs = new Map<string, WorkflowJsonValue | undefined>();
    try {
      while ([...statuses.values()].some((status) => status === "pending")) {
        if (signal.aborted) throw new DOMException("Run cancelled", "AbortError");
        let progressed = false;
        for (const nodeId of item.plan.topologicalOrder) {
          if (statuses.get(nodeId) !== "pending") continue;
          const incoming = item.plan.incoming.get(nodeId) ?? [];
          if (incoming.length === 0) continue;
          const allResolved = incoming.every((edge) =>
            terminalNodeStatus(statuses.get(edge.source) ?? "pending"),
          );
          if (!allResolved || incoming.some((edge) => edgeActive.get(edge.id) === true)) continue;
          statuses.set(nodeId, "skipped");
          run = await this.persistNodeStatus(run, nodeId, "skipped", { completedAt: this.now() });
          for (const edge of item.plan.outgoing.get(nodeId) ?? []) edgeActive.set(edge.id, false);
          progressed = true;
        }

        let ready = item.plan.topologicalOrder.filter((nodeId) => {
          if (statuses.get(nodeId) !== "pending") return false;
          const incoming = item.plan.incoming.get(nodeId) ?? [];
          return (
            (nodeId === item.plan.startNodeId && incoming.length === 0) ||
            (incoming.length > 0 &&
              incoming.every((edge) => terminalNodeStatus(statuses.get(edge.source)!)) &&
              incoming.some((edge) => edgeActive.get(edge.id) === true))
          );
        });
        const approvalId = ready.find((nodeId) => item.plan.nodes.get(nodeId)?.type === "approval");
        if (approvalId) ready = [approvalId];
        else ready = ready.slice(0, MAX_READY_NODE_CONCURRENCY);
        if (ready.length === 0) {
          if (progressed) continue;
          throw new Error("Execution reached an unresolved state.");
        }

        const approvalNode = item.plan.nodes.get(ready[0]!)!;
        if (approvalNode.type === "approval") {
          statuses.set(approvalNode.id, "waiting-for-approval");
          run = await this.persistNodeStatus(run, approvalNode.id, "waiting-for-approval", {
            startedAt: this.now(),
          });
          run = await this.persistRunStatus(run, "waiting-for-approval");
          const resolution = await this.awaitApproval(run, approvalNode, signal);
          if (resolution.cancelled) {
            statuses.set(approvalNode.id, "cancelled");
            run = await this.persistNodeStatus(run, approvalNode.id, "cancelled", {
              completedAt: this.now(),
              errorCode: "run-cancelled",
            });
            throw new DOMException("Run cancelled", "AbortError");
          }
          run = await this.repository.updateRun(run, {
            type: "approval-resolved",
            nodeId: approvalNode.id,
            approved: resolution.approved,
          });
          if (!resolution.approved) {
            statuses.set(approvalNode.id, "failed");
            run = await this.persistNodeStatus(run, approvalNode.id, "failed", {
              completedAt: this.now(),
              errorCode: "approval-rejected",
            });
            const rejection = new Error("Approval was rejected.");
            Object.assign(rejection, { code: "approval-rejected" });
            throw rejection;
          }
          outputs.set(approvalNode.id, resolution.result ?? true);
          statuses.set(approvalNode.id, "succeeded");
          run = await this.persistRunStatus(run, "running");
          run = await this.persistNodeStatus(run, approvalNode.id, "succeeded", {
            completedAt: this.now(),
          });
          for (const edge of item.plan.outgoing.get(approvalNode.id) ?? []) {
            edgeActive.set(edge.id, true);
          }
          continue;
        }

        for (const nodeId of ready) {
          statuses.set(nodeId, "running");
          run = await this.persistNodeStatus(run, nodeId, "running", { startedAt: this.now() });
        }
        const results = await Promise.allSettled(
          ready.map((nodeId) =>
            this.executeNode(item, item.plan.nodes.get(nodeId)!, outputs, signal),
          ),
        );
        let firstFailure: unknown;
        for (let index = 0; index < ready.length; index += 1) {
          const nodeId = ready[index]!;
          const node = item.plan.nodes.get(nodeId)!;
          const result = results[index]!;
          if (result.status === "rejected") {
            statuses.set(nodeId, signal.aborted ? "cancelled" : "failed");
            const rejected = result.reason as {
              code?: unknown;
              exitCode?: unknown;
              artifact?: NonNullable<WorkflowRunEvent["artifact"]>;
            };
            run = await this.persistNodeStatus(
              run,
              nodeId,
              signal.aborted ? "cancelled" : "failed",
              {
                completedAt: this.now(),
                ...(typeof rejected.code === "string" ? { errorCode: rejected.code } : {}),
                ...(typeof rejected.exitCode === "number" ? { exitCode: rejected.exitCode } : {}),
              },
            );
            if (rejected.artifact) {
              run = await this.repository.updateRun(run, {
                type: "artifact-created",
                nodeId,
                artifact: rejected.artifact,
              });
            }
            firstFailure ??= result.reason;
            continue;
          }
          outputs.set(nodeId, result.value.output);
          statuses.set(nodeId, "succeeded");
          run = await this.persistNodeStatus(run, nodeId, "succeeded", {
            completedAt: this.now(),
            ...(result.value.sessionId === undefined ? {} : { sessionId: result.value.sessionId }),
            ...(result.value.exitCode === undefined ? {} : { exitCode: result.value.exitCode }),
          });
          if (result.value.output !== undefined) {
            run = await this.repository.updateRun(run, {
              type: "node-output",
              nodeId,
              output: result.value.output,
            });
          }
          if (result.value.artifact) {
            run = await this.repository.updateRun(run, {
              type: "artifact-created",
              nodeId,
              artifact: result.value.artifact,
            });
          }
          for (const edge of item.plan.outgoing.get(nodeId) ?? []) {
            edgeActive.set(edge.id, this.edgeActivation(node, edge, result.value.output));
          }
        }
        if (firstFailure !== undefined) throw firstFailure;
      }
      run = await this.persistRunStatus(run, "succeeded", {
        output: outputs.get(item.plan.endNodeId),
        completedAt: this.now(),
      });
    } catch (error) {
      const cancelled =
        signal.aborted || (error instanceof DOMException && error.name === "AbortError");
      const status: WorkflowRunStatus = cancelled ? "cancelled" : "failed";
      const record = error as { code?: unknown; exitCode?: unknown };
      await this.persistRunStatus(run, status, {
        completedAt: this.now(),
        errorCode:
          typeof record.code === "string"
            ? record.code
            : cancelled
              ? "run-cancelled"
              : "node-execution-failed",
        errorMessage: error instanceof Error ? error.message : "Workflow node failed.",
      });
    }
  }
}
