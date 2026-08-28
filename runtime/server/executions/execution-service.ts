import type {
  FlowNode,
  FlowRevision,
  WorkflowArchivePayload,
  WorkflowCreatePayload,
  WorkflowDocument,
  WorkflowJsonValue,
  WorkflowListPayload,
  WorkflowListValue,
  ExecutionProtocol,
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
  WorkflowSummary,
  WorkflowTriggerListPayload,
  WorkflowTriggerListValue,
  WorkflowTriggerRemovePayload,
  WorkflowTriggerSetEnabledPayload,
  WorkflowTriggerState,
  WorkflowTriggerUpsertPayload,
  WorkflowValidationResult,
} from "@/runtime/shared/execution";
import {
  compileExecutionDocument,
  compileExecutionRevision,
  validateExecutionDocument,
} from "./execution-compiler";
import { ExecutionEngine } from "./execution-engine";
import { ExecutionError } from "./execution-errors";
import type { ExecutionNodeExecutorRegistry } from "./execution-node-executor";
import { ExecutionRepository } from "./execution-repository";
import { parseExecutionDocument, parseTriggerSpec } from "./execution-schema";
import { ExecutionTriggerService } from "./execution-trigger-service";

export interface ExecutionServiceOptions {
  repository: ExecutionRepository;
  executors?: ExecutionNodeExecutorRegistry;
  now?: () => number;
  isWorkspaceTrusted(workspacePath: string): boolean;
  getRunningSessionIds?: () => readonly string[];
  subscribeRunningSessions?: (listener: (sessionIds: readonly string[]) => void) => void;
  subscribeWorkspaceEvents?: (listener: (event: unknown) => void) => void;
  onDefinitionChanged?: (workflow: WorkflowSummary) => void;
  onRunChanged?: (run: WorkflowRunReadValue["run"]) => void;
  onTriggerChanged?: (state: WorkflowTriggerState) => void;
}

function defaultGraph(kind: WorkflowCreatePayload["kind"]): WorkflowDocument["graph"] {
  const start: FlowNode = {
    id: "start",
    type: "start",
    name: "start",
    position: { x: 80, y: 180 },
    config: {},
  };
  const end: FlowNode = {
    id: "end",
    type: "end",
    name: "end",
    position: { x: kind === "sop" ? 80 : 520, y: kind === "sop" ? 420 : 180 },
    config: {},
  };
  return {
    nodes: [start, end],
    edges: [{ id: "start-end", source: "start", target: "end" }],
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
  };
}

function hasWorkspaceNode(document: WorkflowDocument | FlowRevision): boolean {
  return document.graph.nodes.some(({ type }) => type === "agent" || type === "command");
}

export class ExecutionService implements ExecutionProtocol {
  readonly repository: ExecutionRepository;
  readonly engine: ExecutionEngine;
  readonly triggers: ExecutionTriggerService;
  private readonly now: () => number;
  private readonly isWorkspaceTrusted: ExecutionServiceOptions["isWorkspaceTrusted"];
  private readonly getRunningSessionIds: NonNullable<
    ExecutionServiceOptions["getRunningSessionIds"]
  >;
  private readonly subscribeRunningSessions: NonNullable<
    ExecutionServiceOptions["subscribeRunningSessions"]
  >;
  private readonly subscribeWorkspaceEvents: NonNullable<
    ExecutionServiceOptions["subscribeWorkspaceEvents"]
  >;
  private readonly onDefinitionChanged: NonNullable<ExecutionServiceOptions["onDefinitionChanged"]>;
  private initialized = false;
  private runningSessionIds = new Set<string>();

  constructor(options: ExecutionServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? Date.now;
    this.isWorkspaceTrusted = options.isWorkspaceTrusted;
    this.getRunningSessionIds = options.getRunningSessionIds ?? (() => []);
    this.subscribeRunningSessions = options.subscribeRunningSessions ?? (() => undefined);
    this.subscribeWorkspaceEvents = options.subscribeWorkspaceEvents ?? (() => undefined);
    this.onDefinitionChanged = options.onDefinitionChanged ?? (() => undefined);
    this.engine = new ExecutionEngine({
      repository: this.repository,
      ...(options.executors ? { executors: options.executors } : {}),
      now: this.now,
      onRunChanged: options.onRunChanged,
    });
    this.triggers = new ExecutionTriggerService({
      repository: this.repository,
      now: this.now,
      readWorkflow: (workflowId) => this.repository.readDocument(workflowId),
      startRun: (input) =>
        this.startRun({
          workflowId: input.workflowId,
          revisionSource: "published",
          source: input.source,
          triggerId: input.triggerId,
          dedupeKey: input.dedupeKey,
          ...(input.targetWorkspaceId === undefined
            ? {}
            : { targetWorkspaceId: input.targetWorkspaceId }),
          ...(input.input === undefined ? {} : { input: input.input }),
        } as WorkflowRunStartPayload & { triggerId: string; dedupeKey: string }),
      isWorkspaceTrusted: async (workspaceId) => {
        try {
          const workspacePath = await this.repository.workspacePath(workspaceId);
          return this.isWorkspaceTrusted(workspacePath);
        } catch {
          return false;
        }
      },
      onStateChanged: options.onTriggerChanged,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await this.engine.initialize();
    await this.triggers.initialize();
    this.runningSessionIds = new Set(this.getRunningSessionIds());
    this.subscribeRunningSessions((sessionIds) => {
      const next = new Set(sessionIds);
      for (const sessionId of this.runningSessionIds) {
        if (next.has(sessionId)) continue;
        void this.triggers
          .handleInternalEvent(
            "workbench.session.completed",
            `session-completed:${sessionId}:${this.now()}`,
            { sessionId },
          )
          .catch(() => undefined);
      }
      this.runningSessionIds = next;
    });
    this.subscribeWorkspaceEvents((event) => {
      const record =
        typeof event === "object" && event !== null
          ? (event as Record<string, unknown>)
          : ({} as Record<string, unknown>);
      const workspaceId =
        typeof record.workspaceId === "string"
          ? record.workspaceId
          : typeof record.workspace === "object" &&
              record.workspace !== null &&
              typeof (record.workspace as Record<string, unknown>).workspaceId === "string"
            ? ((record.workspace as Record<string, unknown>).workspaceId as string)
            : undefined;
      void this.triggers
        .handleInternalEvent(
          "workbench.workspace.updated",
          `workspace-updated:${workspaceId ?? "catalog"}:${this.now()}`,
          JSON.parse(JSON.stringify(event)) as WorkflowJsonValue,
        )
        .catch(() => undefined);
    });
  }

  private async ready(): Promise<void> {
    await this.initialize();
  }

  private async summary(document: WorkflowDocument): Promise<WorkflowSummary> {
    const states = await this.repository.listTriggerStates(document.id);
    return {
      id: document.id,
      kind: document.kind,
      scope: document.scope,
      name: document.name,
      ...(document.description === undefined ? {} : { description: document.description }),
      draftRevision: document.draftRevision,
      ...(document.publishedRevisionId === undefined
        ? {}
        : { publishedRevisionId: document.publishedRevisionId }),
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      ...(document.archivedAt === undefined ? {} : { archivedAt: document.archivedAt }),
      triggerCount: document.triggers.length,
      enabledTriggerCount: states.filter(({ enabled }) => enabled).length,
    };
  }

  private async changed(document: WorkflowDocument): Promise<void> {
    this.onDefinitionChanged(await this.summary(document));
  }

  private async readValue(document: WorkflowDocument): Promise<WorkflowReadValue> {
    return {
      document,
      triggerStates: await this.repository.listTriggerStates(document.id),
    };
  }

  async list(payload: WorkflowListPayload): Promise<WorkflowListValue> {
    await this.ready();
    const documents = await this.repository.listDocuments(payload.workspaceId);
    const filtered = documents.filter(
      (document) =>
        (!payload.kind || document.kind === payload.kind) &&
        (payload.includeArchived || document.archivedAt === undefined),
    );
    return { items: await Promise.all(filtered.map((document) => this.summary(document))) };
  }

  async read(payload: WorkflowReadPayload): Promise<WorkflowReadValue> {
    await this.ready();
    return this.readValue(
      await this.repository.readDocument(payload.workflowId, payload.workspaceId),
    );
  }

  async create(payload: WorkflowCreatePayload): Promise<WorkflowReadValue> {
    await this.ready();
    if (payload.scope.type === "project")
      await this.repository.workspacePath(payload.scope.workspaceId);
    const time = this.now();
    const document: WorkflowDocument = {
      schemaVersion: 1,
      id: this.repository.createId(),
      kind: payload.kind,
      scope: payload.scope,
      name: payload.name.trim(),
      graph: defaultGraph(payload.kind),
      concurrency: { mode: "queue" },
      triggers: [],
      draftRevision: 0,
      createdAt: time,
      updatedAt: time,
    };
    const saved = await this.repository.createDocument(parseExecutionDocument(document));
    await this.changed(saved);
    return this.readValue(saved);
  }

  async saveDraft(payload: WorkflowSaveDraftPayload): Promise<WorkflowReadValue> {
    await this.ready();
    const parsed = parseExecutionDocument(payload.draft);
    if (parsed.id !== payload.workflowId) throw new TypeError("Workflow ID mismatch.");
    const saved = await this.repository.saveDraft(parsed, payload.baseDraftRevision);
    await this.changed(saved);
    return this.readValue(saved);
  }

  async validate(payload: WorkflowReadPayload): Promise<WorkflowValidationResult> {
    await this.ready();
    return validateExecutionDocument(
      await this.repository.readDocument(payload.workflowId, payload.workspaceId),
    );
  }

  async publish(payload: WorkflowPublishPayload): Promise<WorkflowReadValue> {
    await this.ready();
    const document = await this.repository.readDocument(payload.workflowId);
    if (document.scope.type === "project") {
      const workspacePath = await this.repository.workspacePath(document.scope.workspaceId);
      if (!this.isWorkspaceTrusted(workspacePath)) {
        throw new ExecutionError(
          "workspace-not-trusted",
          "Trust the project before publishing its workflow definition.",
          { workspaceId: document.scope.workspaceId },
        );
      }
    }
    const validation = validateExecutionDocument(document);
    if (!validation.valid) {
      throw new ExecutionError("workflow-invalid", "The workflow cannot be published.", {
        workflowId: document.id,
        issues: validation.issues,
      });
    }
    const plan = compileExecutionDocument(document, this.now());
    const saved = await this.repository.publish(document, plan.revision, payload.baseDraftRevision);
    await this.changed(saved);
    return this.readValue(saved);
  }

  async archive(payload: WorkflowArchivePayload): Promise<WorkflowReadValue> {
    await this.ready();
    const document = await this.repository.readDocument(payload.workflowId);
    const next = parseExecutionDocument({
      ...document,
      ...(payload.archived ? { archivedAt: this.now() } : { archivedAt: undefined }),
    });
    const saved = await this.repository.saveDraft(next, document.draftRevision);
    await this.changed(saved);
    return this.readValue(saved);
  }

  async startRun(
    payload: WorkflowRunStartPayload & { triggerId?: string; dedupeKey?: string },
  ): Promise<WorkflowRunAdmission> {
    await this.ready();
    const document = await this.repository.readDocument(payload.workflowId);
    let revision: FlowRevision;
    if (payload.revisionId) {
      revision = await this.repository.readRevision(document.id, payload.revisionId);
    } else if (payload.revisionSource === "published") {
      if (!document.publishedRevisionId) {
        throw new ExecutionError("workflow-not-published", "The workflow has not been published.", {
          workflowId: document.id,
        });
      }
      revision = await this.repository.readRevision(document.id, document.publishedRevisionId);
    } else {
      revision = compileExecutionDocument(document, this.now()).revision;
      await this.repository.saveRevision(revision);
    }
    compileExecutionRevision(revision);
    const targetWorkspaceId =
      revision.scope.type === "project" ? revision.scope.workspaceId : payload.targetWorkspaceId;
    if (hasWorkspaceNode(revision) && !targetWorkspaceId) {
      throw new ExecutionError(
        "workspace-required",
        "Agent and Command nodes need a target workspace.",
        { workflowId: document.id },
      );
    }
    const workspacePath = targetWorkspaceId
      ? await this.repository.workspacePath(targetWorkspaceId)
      : undefined;
    if (workspacePath && !this.isWorkspaceTrusted(workspacePath)) {
      throw new ExecutionError(
        "workspace-not-trusted",
        "The workflow target workspace is not trusted.",
        { workspaceId: targetWorkspaceId! },
      );
    }
    if (payload.dedupeKey) {
      const duplicate = (
        await this.repository.listRuns({ workflowId: document.id, limit: 1_000 })
      ).find((run) => run.dedupeKey === payload.dedupeKey);
      if (duplicate) return { kind: "started", run: duplicate };
    }
    return this.engine.start({
      revision,
      source: payload.source ?? "manual",
      ...(targetWorkspaceId === undefined ? {} : { targetWorkspaceId }),
      ...(workspacePath === undefined ? {} : { workspacePath }),
      ...(payload.triggerId === undefined ? {} : { triggerId: payload.triggerId }),
      ...(payload.dedupeKey === undefined ? {} : { dedupeKey: payload.dedupeKey }),
      ...(payload.input === undefined ? {} : { input: payload.input }),
    });
  }

  async cancelRun(payload: WorkflowRunCancelPayload) {
    await this.ready();
    return this.engine.cancel(payload.runId);
  }

  async listRuns(payload: WorkflowRunListPayload): Promise<WorkflowRunListValue> {
    await this.ready();
    return { items: await this.repository.listRuns(payload) };
  }

  async readRun(payload: WorkflowRunReadPayload): Promise<WorkflowRunReadValue> {
    await this.ready();
    return this.repository.readRun(payload.runId, payload.afterSeq, payload.limit);
  }

  async resolveApproval(payload: WorkflowResolveApprovalPayload) {
    await this.ready();
    return this.engine.resolveApproval(payload);
  }

  async listTriggers(payload: WorkflowTriggerListPayload): Promise<WorkflowTriggerListValue> {
    const { document, triggerStates } = await this.read({ workflowId: payload.workflowId });
    return { triggers: document.triggers, states: triggerStates };
  }

  async upsertTrigger(payload: WorkflowTriggerUpsertPayload): Promise<WorkflowReadValue> {
    const document = await this.repository.readDocument(payload.workflowId);
    const trigger = parseTriggerSpec(payload.trigger);
    const triggers = document.triggers.filter(({ id }) => id !== trigger.id);
    triggers.push(trigger);
    return this.saveDraft({
      workflowId: document.id,
      baseDraftRevision: payload.baseDraftRevision,
      draft: { ...document, triggers },
    });
  }

  async removeTrigger(payload: WorkflowTriggerRemovePayload): Promise<WorkflowReadValue> {
    const document = await this.repository.readDocument(payload.workflowId);
    await this.triggers.remove(document.id, payload.triggerId);
    return this.saveDraft({
      workflowId: document.id,
      baseDraftRevision: payload.baseDraftRevision,
      draft: {
        ...document,
        triggers: document.triggers.filter(({ id }) => id !== payload.triggerId),
      },
    });
  }

  async setTriggerEnabled(
    payload: WorkflowTriggerSetEnabledPayload,
  ): Promise<WorkflowTriggerState> {
    await this.ready();
    return this.triggers.setEnabled(payload.workflowId, payload.triggerId, payload.enabled);
  }
}
