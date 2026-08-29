import type {
  FlowNode,
  FlowRevision,
  WorkflowAgentResourceCatalog,
  WorkflowAgentResourcesPayload,
  WorkflowAgentResourcesUpdatePayload,
  WorkflowAgentResourcesValue,
  WorkflowArchivePayload,
  WorkflowCreatePayload,
  WorkflowDocument,
  WorkflowListPayload,
  WorkflowListValue,
  ExecutionProtocol,
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
  WorkflowSummary,
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
import { parseExecutionDocument } from "./execution-schema";

export interface ExecutionServiceOptions {
  repository: ExecutionRepository;
  executors?: ExecutionNodeExecutorRegistry;
  now?: () => number;
  isWorkspaceTrusted(workspacePath: string): boolean;
  onDefinitionChanged?: (workflow: WorkflowSummary) => void;
  onRunChanged?: (run: WorkflowRunReadValue["run"]) => void;
  onRunRemoved?: (run: WorkflowRunDeleteValue) => void;
  readAgentResourceCatalog?: (input: {
    workflowId: string;
    agentId: string;
    workspacePath: string;
  }) => Promise<WorkflowAgentResourceCatalog>;
}

function defaultGraph(): WorkflowDocument["graph"] {
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
    position: { x: 520, y: 180 },
    config: {},
  };
  return {
    nodes: [start, end],
    edges: [{ id: "start-end", source: "start", target: "end" }],
    editor: { viewport: { x: 0, y: 0, zoom: 1 } },
  };
}

function needsTargetWorkspace(document: WorkflowDocument | FlowRevision): boolean {
  return document.graph.nodes.some(({ type }) => type === "command");
}

function assertValidExecutionDocument(document: WorkflowDocument, message: string): void {
  const validation = validateExecutionDocument(document);
  if (validation.valid) return;
  throw new ExecutionError("workflow-invalid", message, {
    workflowId: document.id,
    issues: validation.issues,
  });
}

export class ExecutionService implements ExecutionProtocol {
  readonly repository: ExecutionRepository;
  readonly engine: ExecutionEngine;
  private readonly now: () => number;
  private readonly isWorkspaceTrusted: ExecutionServiceOptions["isWorkspaceTrusted"];
  private readonly onDefinitionChanged: NonNullable<ExecutionServiceOptions["onDefinitionChanged"]>;
  private readonly onRunRemoved: NonNullable<ExecutionServiceOptions["onRunRemoved"]>;
  private readAgentResourceCatalog: NonNullable<
    ExecutionServiceOptions["readAgentResourceCatalog"]
  >;
  private initialized = false;

  constructor(options: ExecutionServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? Date.now;
    this.isWorkspaceTrusted = options.isWorkspaceTrusted;
    this.onDefinitionChanged = options.onDefinitionChanged ?? (() => undefined);
    this.onRunRemoved = options.onRunRemoved ?? (() => undefined);
    this.readAgentResourceCatalog =
      options.readAgentResourceCatalog ??
      (async ({ workspacePath }) => ({
        skills: [],
        extensions: [],
        catalogAvailable: true,
        projectResourcesTrusted: await this.isWorkspaceTrusted(workspacePath),
      }));
    this.engine = new ExecutionEngine({
      repository: this.repository,
      ...(options.executors ? { executors: options.executors } : {}),
      now: this.now,
      onRunChanged: options.onRunChanged,
    });
  }

  bindAgentResourceCatalog(
    reader: NonNullable<ExecutionServiceOptions["readAgentResourceCatalog"]>,
  ): void {
    this.readAgentResourceCatalog = reader;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await this.engine.initialize();
  }

  private async ready(): Promise<void> {
    await this.initialize();
  }

  private summary(document: WorkflowDocument): WorkflowSummary {
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
    };
  }

  private changed(document: WorkflowDocument): void {
    this.onDefinitionChanged(this.summary(document));
  }

  private async readValue(document: WorkflowDocument): Promise<WorkflowReadValue> {
    return {
      document,
      workflowDirectory: await this.repository.workflowDirectory(document),
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
    return { items: filtered.map((document) => this.summary(document)) };
  }

  async read(payload: WorkflowReadPayload): Promise<WorkflowReadValue> {
    await this.ready();
    return this.readValue(
      await this.repository.readDocument(payload.workflowId, payload.workspaceId),
    );
  }

  async readAgentResources(
    payload: WorkflowAgentResourcesPayload,
  ): Promise<WorkflowAgentResourcesValue> {
    await this.ready();
    const stored = await this.repository.readAgentResources(payload);
    const catalog = await this.readAgentResourceCatalog({
      workflowId: payload.workflowId,
      agentId: payload.agentId,
      workspacePath: await this.repository.agentWorkspaceDirectory(
        payload.workflowId,
        payload.agentId,
      ),
    });
    return { ...stored, ...catalog };
  }

  async updateAgentResources(
    payload: WorkflowAgentResourcesUpdatePayload,
  ): Promise<WorkflowAgentResourcesValue> {
    await this.ready();
    await this.repository.updateAgentResources(payload);
    return this.readAgentResources(payload);
  }

  async create(payload: WorkflowCreatePayload): Promise<WorkflowReadValue> {
    await this.ready();
    if (payload.scope.type === "project")
      await this.repository.workspacePath(payload.scope.workspaceId);
    const time = this.now();
    const document: WorkflowDocument = {
      schemaVersion: 3,
      id: this.repository.createId(),
      kind: payload.kind,
      scope: payload.scope,
      name: payload.name.trim(),
      agents: [],
      graph: defaultGraph(),
      concurrency: { mode: "queue" },
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
    assertValidExecutionDocument(document, "The workflow cannot be published.");
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

  async startRun(payload: WorkflowRunStartPayload): Promise<WorkflowRunAdmission> {
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
      assertValidExecutionDocument(document, "The workflow cannot be run.");
      revision = compileExecutionDocument(document, this.now()).revision;
      await this.repository.saveRevision(revision);
    }
    compileExecutionRevision(revision);
    let untrustedAgentNode: Extract<FlowNode, { type: "agent" }> | undefined;
    for (const node of revision.graph.nodes) {
      if (
        node.type === "agent" &&
        !this.isWorkspaceTrusted(
          await this.repository.agentWorkspaceDirectory(document, node.config.agentId),
        )
      ) {
        untrustedAgentNode = node;
        break;
      }
    }
    if (untrustedAgentNode?.type === "agent") {
      throw new ExecutionError(
        "agent-workspace-not-trusted",
        "Trust the workflow before loading Agent-local Pi resources.",
        { agentId: untrustedAgentNode.config.agentId },
      );
    }
    const targetWorkspaceId =
      revision.scope.type === "project" ? revision.scope.workspaceId : payload.targetWorkspaceId;
    if (needsTargetWorkspace(revision) && !targetWorkspaceId) {
      throw new ExecutionError("workspace-required", "This execution needs a target workspace.", {
        workflowId: document.id,
      });
    }
    const workspacePath = targetWorkspaceId
      ? await this.repository.workspacePath(targetWorkspaceId)
      : undefined;
    if (workspacePath && !this.isWorkspaceTrusted(workspacePath)) {
      throw new ExecutionError(
        "workspace-not-trusted",
        "The execution target workspace is not trusted.",
        { workspaceId: targetWorkspaceId! },
      );
    }
    return this.engine.start({
      revision,
      source: payload.source ?? "manual",
      ...(targetWorkspaceId === undefined ? {} : { targetWorkspaceId }),
      ...(workspacePath === undefined ? {} : { workspacePath }),
      ...(payload.input === undefined ? {} : { input: payload.input }),
    });
  }

  async cancelRun(payload: WorkflowRunCancelPayload) {
    await this.ready();
    return this.engine.cancel(payload.runId);
  }

  async deleteRun(payload: WorkflowRunDeletePayload): Promise<WorkflowRunDeleteValue> {
    await this.ready();
    const run = await this.repository.readRunSummary(payload.runId);
    if (["queued", "running", "waiting-for-approval"].includes(run.status)) {
      throw new ExecutionError("run-active", "An active workflow run cannot be deleted.", {
        runId: run.id,
        status: run.status,
      });
    }
    await this.repository.deleteRun(run.id);
    const deleted = { deleted: true, runId: run.id, workflowId: run.workflowId } as const;
    this.onRunRemoved(deleted);
    return deleted;
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
}
