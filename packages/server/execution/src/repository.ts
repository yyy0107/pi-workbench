import { randomUUID } from "node:crypto";
import { appendFile, cp, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import type {
  ExecutionThinkingLevel,
  FlowRevision,
  WorkflowAgentResourcesPayload,
  WorkflowAgentResourcesUpdatePayload,
  WorkflowAgentStoredResourcesValue,
  WorkflowDocument,
  WorkflowRunEvent,
  WorkflowRunReadValue,
  WorkflowRunStatus,
  WorkflowRunSummary,
  WorkflowScope,
} from "@workbench/execution-contracts";
import {
  parseExecutionDocument,
  parseExecutionDocumentWithMigration,
  type LegacyWorkflowAgentResource,
} from "@workbench/execution-contracts/schema";
import { ExecutionError } from "./errors";
import {
  atomicReplaceFile,
  withCrossProcessFileLock,
} from "@workbench/server-core/file-persistence";
import { executionRevisionIdForDocument, legacyExecutionRevisionIdForDocument } from "./compiler";

export interface ExecutionWorkspace {
  workspaceId: string;
  path: string;
}

export interface ExecutionRepositoryOptions {
  rootDirectory: string;
  now?: () => number;
  listWorkspaces?: () => Promise<ExecutionWorkspace[]>;
}

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExecutionThinkingLevel(value: unknown): value is ExecutionThinkingLevel {
  return (
    typeof value === "string" &&
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)
  );
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function regularJsonFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(directory, entry.name));
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return [];
    throw error;
  }
}

async function workflowDocumentFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(directory, entry.name, "workflow.json"));
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return [];
    throw error;
  }
}

async function childDirectories(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(directory, entry.name));
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return [];
    throw error;
  }
}

function scopeMatches(scope: WorkflowScope, workspaceId?: string): boolean {
  return !workspaceId || (scope.type === "project" && scope.workspaceId === workspaceId);
}

function safePathSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(value)) {
    throw new TypeError(`${label} must be a safe path segment.`);
  }
  return value;
}

async function textFileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return false;
    throw error;
  }
}

export class ExecutionRepository {
  readonly rootDirectory: string;
  private readonly now: () => number;
  private readonly listWorkspaces: () => Promise<ExecutionWorkspace[]>;
  private readonly runDirectories = new Map<string, string>();

  constructor(options: ExecutionRepositoryOptions) {
    this.rootDirectory = options.rootDirectory;
    this.now = options.now ?? Date.now;
    this.listWorkspaces = options.listWorkspaces ?? (async () => []);
  }

  private personalWorkflowDirectory(workflowId: string): string {
    return path.join(this.rootDirectory, "workflows", safePathSegment(workflowId, "A workflow ID"));
  }

  private async workflowDirectoryForDocument(
    document: Pick<WorkflowDocument, "id" | "scope">,
    resolvedWorkspace?: ExecutionWorkspace,
  ): Promise<string> {
    const workflowId = safePathSegment(document.id, "A workflow ID");
    if (document.scope.type === "personal") return this.personalWorkflowDirectory(workflowId);
    const workspace =
      resolvedWorkspace?.workspaceId === document.scope.workspaceId
        ? resolvedWorkspace
        : await this.resolveWorkspace(document.scope.workspaceId);
    return path.join(workspace.path, ".pi", "workflows", workflowId);
  }

  async workflowDirectory(
    workflow: Pick<WorkflowDocument, "id" | "scope"> | string,
  ): Promise<string> {
    if (typeof workflow !== "string") return this.workflowDirectoryForDocument(workflow);
    try {
      return await this.workflowDirectoryForDocument(await this.readDocument(workflow));
    } catch (error) {
      if (error instanceof ExecutionError && error.code === "workflow-not-found") {
        return this.personalWorkflowDirectory(workflow);
      }
      throw error;
    }
  }

  async agentWorkspaceDirectory(
    workflow: Pick<WorkflowDocument, "id" | "scope"> | string,
    agentId: string,
  ): Promise<string> {
    return path.join(
      await this.workflowDirectory(workflow),
      "agents",
      safePathSegment(agentId, "An agent ID"),
    );
  }

  private async draftFileForDocument(
    document: Pick<WorkflowDocument, "id" | "scope">,
  ): Promise<string> {
    return path.join(await this.workflowDirectoryForDocument(document), "workflow.json");
  }

  private legacyDraftFile(workflowId: string): string {
    return path.join(this.rootDirectory, "drafts", `${workflowId}.json`);
  }

  private personalDefinitionFile(workflowId: string): string {
    return path.join(this.rootDirectory, "definitions", `${workflowId}.json`);
  }

  private async revisionFileForDocument(
    document: Pick<WorkflowDocument, "id" | "scope">,
    revisionId: string,
  ): Promise<string> {
    return path.join(
      await this.workflowDirectoryForDocument(document),
      "revisions",
      `${safePathSegment(revisionId, "A workflow revision ID")}.json`,
    );
  }

  private legacyRevisionFile(workflowId: string, revisionId: string): string {
    return path.join(this.rootDirectory, "revisions", workflowId, `${revisionId}.json`);
  }

  private legacyRunDirectory(runId: string): string {
    return path.join(this.rootDirectory, "runs", safePathSegment(runId, "A workflow run ID"));
  }

  private workflowRunDirectory(workflowDirectory: string, runId: string): string {
    return path.join(workflowDirectory, "runs", safePathSegment(runId, "A workflow run ID"));
  }

  private runDirectory(runId: string): string {
    return this.runDirectories.get(runId) ?? this.legacyRunDirectory(runId);
  }

  private runSummaryFile(directory: string): string {
    return path.join(directory, "summary.json");
  }

  private runEventsFile(directory: string): string {
    return path.join(directory, "events.jsonl");
  }

  private async locateRunDirectory(runId: string): Promise<string> {
    const cached = this.runDirectories.get(runId);
    if (cached) return cached;
    const legacy = this.legacyRunDirectory(runId);
    if (await textFileExists(this.runSummaryFile(legacy))) {
      this.runDirectories.set(runId, legacy);
      return legacy;
    }
    for (const workflowDirectory of await this.workflowDirectories()) {
      const candidate = this.workflowRunDirectory(workflowDirectory, runId);
      if (await textFileExists(this.runSummaryFile(candidate))) {
        this.runDirectories.set(runId, candidate);
        return candidate;
      }
    }
    return legacy;
  }

  private async workflowDirectories(): Promise<string[]> {
    const directories = await childDirectories(path.join(this.rootDirectory, "workflows"));
    for (const workspace of await this.listWorkspaces()) {
      directories.push(...(await childDirectories(path.join(workspace.path, ".pi", "workflows"))));
    }
    return [...new Set(directories)];
  }

  executionSessionDirectory(runId: string): string {
    return path.join(this.runDirectory(runId), "sessions");
  }

  artifactDirectory(runId: string): string {
    return path.join(this.runDirectory(runId), "artifacts");
  }

  private async resolveWorkspace(workspaceId: string): Promise<ExecutionWorkspace> {
    const workspace = (await this.listWorkspaces()).find(
      (item) => item.workspaceId === workspaceId,
    );
    if (!workspace) {
      throw new ExecutionError("workspace-not-found", "The workflow workspace no longer exists.", {
        workspaceId,
      });
    }
    return workspace;
  }

  async workspacePath(workspaceId: string): Promise<string> {
    return (await this.resolveWorkspace(workspaceId)).path;
  }

  private async projectDefinitionFile(scope: WorkflowScope, workflowId: string): Promise<string> {
    if (scope.type !== "project") {
      throw new TypeError("A project definition file requires project scope.");
    }
    const workspace = await this.resolveWorkspace(scope.workspaceId);
    return path.join(workspace.path, ".pi", "workflows", `${workflowId}.json`);
  }

  private migrationLockDirectory(workflowId: string): string {
    return path.join(
      this.rootDirectory,
      "workflow-migrations",
      `${safePathSegment(workflowId, "A workflow ID")}.lock`,
    );
  }

  private rebaseRunDirectories(source: string, destination: string): void {
    for (const [runId, directory] of this.runDirectories) {
      const relative = path.relative(source, directory);
      if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) continue;
      this.runDirectories.set(runId, path.join(destination, relative));
    }
  }

  private async migrateProjectWorkflowDirectory(document: WorkflowDocument): Promise<void> {
    if (document.scope.type !== "project") return;
    const workspaceId = document.scope.workspaceId;
    const source = this.personalWorkflowDirectory(document.id);
    const sourceDraft = path.join(source, "workflow.json");
    const destination = await this.workflowDirectoryForDocument(document);
    const destinationDraft = path.join(destination, "workflow.json");
    if (source === destination || !(await textFileExists(sourceDraft))) return;

    await withCrossProcessFileLock(
      { lockDirectory: this.migrationLockDirectory(document.id) },
      async () => {
        if (!(await textFileExists(sourceDraft))) return;
        if (await textFileExists(destinationDraft)) return;
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        try {
          await rename(source, destination);
        } catch (error) {
          if (["EEXIST", "ENOTEMPTY"].includes(nodeErrorCode(error) ?? "")) {
            if (await textFileExists(destinationDraft)) return;
            throw new ExecutionError(
              "workflow-conflict",
              "The project workflow directory already exists and cannot be migrated safely.",
              { workflowId: document.id, currentDraftRevision: document.draftRevision },
            );
          }
          if (nodeErrorCode(error) !== "EXDEV") throw error;
          const staging = `${destination}.migrating.${process.pid}.${randomUUID()}`;
          try {
            await cp(source, staging, { recursive: true, force: false, errorOnExist: true });
            const stagedValue = await readJson(path.join(staging, "workflow.json"));
            if (stagedValue === undefined) {
              throw new TypeError("The migrated project workflow is missing workflow.json.");
            }
            const staged = parseExecutionDocumentWithMigration(stagedValue).document;
            if (
              staged.id !== document.id ||
              staged.scope.type !== "project" ||
              staged.scope.workspaceId !== workspaceId
            ) {
              throw new TypeError("The migrated project workflow identity does not match.");
            }
            await rename(staging, destination);
            await rm(source, { recursive: true });
          } finally {
            await rm(staging, { recursive: true, force: true });
          }
        }
        this.rebaseRunDirectories(source, destination);
      },
    );
  }

  private async readDocumentFile(
    file: string,
    resolvedWorkspace?: ExecutionWorkspace,
  ): Promise<WorkflowDocument | undefined> {
    const value = await readJson(file);
    if (value === undefined) return undefined;
    if (isPlainRecord(value) && typeof value.kind === "string" && value.kind !== "workflow") {
      return undefined;
    }
    let parsed: ReturnType<typeof parseExecutionDocumentWithMigration>;
    try {
      parsed = parseExecutionDocumentWithMigration(value);
    } catch (error) {
      const quarantine = `${file}.corrupt.${this.now()}`;
      await rename(file, quarantine).catch(() => undefined);
      throw error;
    }
    if (
      parsed.document.scope.type === "project" &&
      path.resolve(file) ===
        path.resolve(path.join(this.personalWorkflowDirectory(parsed.document.id), "workflow.json"))
    ) {
      await this.migrateProjectWorkflowDirectory(parsed.document);
    }
    await this.ensureAgentWorkspaces(
      parsed.document,
      parsed.legacyAgentResources,
      resolvedWorkspace,
    );
    return parsed.document;
  }

  private async ensureAgentWorkspaces(
    document: WorkflowDocument,
    legacyResources: readonly LegacyWorkflowAgentResource[] = [],
    resolvedWorkspace?: ExecutionWorkspace,
  ): Promise<void> {
    const resources = new Map(legacyResources.map((resource) => [resource.agentId, resource]));
    const workflowDirectory = await this.workflowDirectoryForDocument(document, resolvedWorkspace);
    await Promise.all(
      document.agents.map(async (agent) => {
        const workspace = path.join(
          workflowDirectory,
          "agents",
          safePathSegment(agent.id, "An agent ID"),
        );
        const piDirectory = path.join(workspace, ".pi");
        const promptsDirectory = path.join(piDirectory, "prompts");
        await mkdir(promptsDirectory, { recursive: true, mode: 0o700 });
        const appendSystemFile = path.join(piDirectory, "APPEND_SYSTEM.md");
        if (!(await textFileExists(appendSystemFile))) {
          await atomicReplaceFile(
            appendSystemFile,
            `You are ${agent.name || agent.id}, a stable agent in a Workbench workflow.\n\nComplete only the workflow step supplied in the current prompt. Submit the final machine-readable result with \`submit_workflow_output\`.\n`,
            { fileMode: 0o600 },
          );
        }
        const legacy = resources.get(agent.id);
        const promptFile = path.join(promptsDirectory, "default.md");
        if (!(await textFileExists(promptFile))) {
          await atomicReplaceFile(
            promptFile,
            legacy?.prompt?.trim()
              ? `${legacy.prompt.trim()}\n`
              : "Complete the supplied workflow step and submit its structured result.\n",
            { fileMode: 0o600 },
          );
        }
        if (legacy?.model) {
          const settingsFile = path.join(piDirectory, "settings.json");
          if (!(await textFileExists(settingsFile))) {
            await atomicReplaceFile(
              settingsFile,
              json({
                defaultProvider: legacy.model.provider,
                defaultModel: legacy.model.modelId,
                ...(legacy.model.thinkingLevel
                  ? { defaultThinkingLevel: legacy.model.thinkingLevel }
                  : {}),
              }),
              { fileMode: 0o600 },
            );
          }
        }
      }),
    );
  }

  private async promptTemplateFile(
    document: WorkflowDocument,
    agentId: string,
    promptTemplate: string,
  ): Promise<string> {
    return path.join(
      await this.agentWorkspaceDirectory(document, agentId),
      ".pi",
      "prompts",
      `${safePathSegment(promptTemplate, "A prompt template name")}.md`,
    );
  }

  private async assertWorkflowAgent(
    workflowId: string,
    agentId: string,
  ): Promise<WorkflowDocument> {
    const document = await this.readDocument(workflowId);
    if (!document.agents.some((agent) => agent.id === agentId)) {
      throw new ExecutionError("agent-not-found", "The workflow agent does not exist.", {
        workflowId,
        agentId,
      });
    }
    return document;
  }

  async readAgentResources(
    payload: WorkflowAgentResourcesPayload,
  ): Promise<WorkflowAgentStoredResourcesValue> {
    const document = await this.assertWorkflowAgent(payload.workflowId, payload.agentId);
    const promptFile = await this.promptTemplateFile(
      document,
      payload.agentId,
      payload.promptTemplate,
    );
    let prompt: string;
    try {
      prompt = await readFile(promptFile, "utf8");
    } catch (error) {
      if (nodeErrorCode(error) !== "ENOENT") throw error;
      throw new ExecutionError(
        "prompt-template-not-found",
        "The workflow agent prompt template does not exist.",
        { agentId: payload.agentId, promptTemplate: payload.promptTemplate },
      );
    }
    const workspace = await this.agentWorkspaceDirectory(document, payload.agentId);
    const settings = await readJson(path.join(workspace, ".pi", "settings.json"));
    const record = isPlainRecord(settings) ? settings : {};
    const provider =
      typeof record.defaultProvider === "string" ? record.defaultProvider : undefined;
    const modelId = typeof record.defaultModel === "string" ? record.defaultModel : undefined;
    const thinkingLevel = isExecutionThinkingLevel(record.defaultThinkingLevel)
      ? record.defaultThinkingLevel
      : undefined;
    return {
      agentId: payload.agentId,
      promptTemplate: payload.promptTemplate,
      prompt,
      ...(provider && modelId
        ? {
            model: {
              provider,
              modelId,
              ...(thinkingLevel ? { thinkingLevel } : {}),
            },
          }
        : {}),
    };
  }

  async updateAgentResources(
    payload: WorkflowAgentResourcesUpdatePayload,
  ): Promise<WorkflowAgentStoredResourcesValue> {
    const document = await this.assertWorkflowAgent(payload.workflowId, payload.agentId);
    await this.ensureAgentWorkspaces(document);
    const promptFile = await this.promptTemplateFile(
      document,
      payload.agentId,
      payload.promptTemplate,
    );
    await atomicReplaceFile(promptFile, `${payload.prompt.trim()}\n`, { fileMode: 0o600 });
    if (payload.model) {
      const settingsFile = path.join(
        await this.agentWorkspaceDirectory(document, payload.agentId),
        ".pi",
        "settings.json",
      );
      const current = await readJson(settingsFile);
      if (current !== undefined && !isPlainRecord(current)) {
        throw new TypeError("Agent settings.json must contain a JSON object.");
      }
      const next = {
        ...current,
        defaultProvider: payload.model.provider,
        defaultModel: payload.model.modelId,
      } as Record<string, unknown>;
      if (payload.model.thinkingLevel) {
        next.defaultThinkingLevel = payload.model.thinkingLevel;
      } else {
        delete next.defaultThinkingLevel;
      }
      await atomicReplaceFile(settingsFile, json(next), { fileMode: 0o600 });
    }
    return this.readAgentResources(payload);
  }

  async listDocuments(workspaceId?: string): Promise<WorkflowDocument[]> {
    const documents = new Map<string, WorkflowDocument>();
    const canonicalIds = new Set<string>();
    const workspaces = await this.listWorkspaces();
    for (const workspace of workspaces) {
      if (workspaceId && workspace.workspaceId !== workspaceId) continue;
      const directory = path.join(workspace.path, ".pi", "workflows");
      for (const file of await workflowDocumentFiles(directory)) {
        const document = await this.readDocumentFile(file, workspace);
        if (!document) continue;
        canonicalIds.add(document.id);
        if (
          document.scope.type === "project" &&
          document.scope.workspaceId === workspace.workspaceId
        ) {
          documents.set(document.id, document);
        }
      }
    }
    for (const file of await workflowDocumentFiles(path.join(this.rootDirectory, "workflows"))) {
      const workflowId = path.basename(path.dirname(file));
      if (canonicalIds.has(workflowId)) continue;
      const document = await this.readDocumentFile(file);
      if (!document) continue;
      canonicalIds.add(document.id);
      if (scopeMatches(document.scope, workspaceId)) documents.set(document.id, document);
    }
    for (const file of await regularJsonFiles(path.join(this.rootDirectory, "definitions"))) {
      const document = await this.readDocumentFile(file);
      if (document && !canonicalIds.has(document.id) && scopeMatches(document.scope, workspaceId))
        documents.set(document.id, document);
    }
    for (const workspace of workspaces) {
      if (workspaceId && workspace.workspaceId !== workspaceId) continue;
      const directory = path.join(workspace.path, ".pi", "workflows");
      for (const file of await regularJsonFiles(directory)) {
        const document = await this.readDocumentFile(file, workspace);
        if (
          document &&
          !canonicalIds.has(document.id) &&
          document.scope.type === "project" &&
          document.scope.workspaceId === workspace.workspaceId
        ) {
          documents.set(document.id, document);
        }
      }
    }
    for (const file of await regularJsonFiles(path.join(this.rootDirectory, "drafts"))) {
      const document = await this.readDocumentFile(file);
      if (document && !canonicalIds.has(document.id) && scopeMatches(document.scope, workspaceId))
        documents.set(document.id, document);
    }
    return [...documents.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async readDocument(workflowId: string, workspaceId?: string): Promise<WorkflowDocument> {
    const safeWorkflowId = safePathSegment(workflowId, "A workflow ID");
    const workspaces = await this.listWorkspaces();
    for (const workspace of workspaces) {
      if (workspaceId && workspace.workspaceId !== workspaceId) continue;
      const document = await this.readDocumentFile(
        path.join(workspace.path, ".pi", "workflows", safeWorkflowId, "workflow.json"),
        workspace,
      );
      if (
        document?.scope.type === "project" &&
        document.scope.workspaceId === workspace.workspaceId
      ) {
        return document;
      }
    }
    const draft = await this.readDocumentFile(
      path.join(this.personalWorkflowDirectory(safeWorkflowId), "workflow.json"),
    );
    if (draft && scopeMatches(draft.scope, workspaceId)) return draft;
    const legacyDraft = await this.readDocumentFile(this.legacyDraftFile(safeWorkflowId));
    if (legacyDraft && scopeMatches(legacyDraft.scope, workspaceId)) return legacyDraft;
    const personal = await this.readDocumentFile(this.personalDefinitionFile(safeWorkflowId));
    if (personal && scopeMatches(personal.scope, workspaceId)) return personal;
    for (const workspace of workspaces) {
      if (workspaceId && workspace.workspaceId !== workspaceId) continue;
      const document = await this.readDocumentFile(
        path.join(workspace.path, ".pi", "workflows", `${safeWorkflowId}.json`),
        workspace,
      );
      if (document) return document;
    }
    throw new ExecutionError("workflow-not-found", "The workflow does not exist.", { workflowId });
  }

  async createDocument(document: WorkflowDocument): Promise<WorkflowDocument> {
    const file = await this.draftFileForDocument(document);
    return withCrossProcessFileLock({ lockDirectory: `${file}.lock` }, async () => {
      if (
        (await readJson(file)) !== undefined ||
        (await readJson(this.legacyDraftFile(document.id))) !== undefined ||
        (document.scope.type === "project" &&
          (await readJson(
            path.join(this.personalWorkflowDirectory(document.id), "workflow.json"),
          )) !== undefined)
      ) {
        throw new ExecutionError("workflow-conflict", "The workflow already exists.", {
          workflowId: document.id,
          currentDraftRevision: document.draftRevision,
        });
      }
      await this.ensureAgentWorkspaces(document);
      await atomicReplaceFile(file, json(document));
      return structuredClone(document);
    });
  }

  async saveDraft(
    requested: WorkflowDocument,
    baseDraftRevision: number,
  ): Promise<WorkflowDocument> {
    const located = await this.readDocument(requested.id);
    const file = await this.draftFileForDocument(located);
    return withCrossProcessFileLock({ lockDirectory: `${file}.lock` }, async () => {
      const current = await this.readDocumentFile(file);
      const effectiveCurrent =
        current ?? (await this.readDocumentFile(this.legacyDraftFile(requested.id))) ?? located;
      if (!effectiveCurrent) {
        throw new ExecutionError("workflow-not-found", "The workflow does not exist.", {
          workflowId: requested.id,
        });
      }
      if (effectiveCurrent.draftRevision !== baseDraftRevision) {
        throw new ExecutionError("workflow-conflict", "The workflow draft changed elsewhere.", {
          workflowId: requested.id,
          currentDraftRevision: effectiveCurrent.draftRevision,
        });
      }
      if (
        requested.id !== effectiveCurrent.id ||
        requested.kind !== effectiveCurrent.kind ||
        JSON.stringify(requested.scope) !== JSON.stringify(effectiveCurrent.scope) ||
        requested.createdAt !== effectiveCurrent.createdAt
      ) {
        throw new TypeError("Immutable workflow identity fields cannot be changed.");
      }
      const next = parseExecutionDocument({
        ...requested,
        draftRevision: baseDraftRevision + 1,
        publishedRevisionId: effectiveCurrent.publishedRevisionId,
        updatedAt: this.now(),
      });
      await this.ensureAgentWorkspaces(next);
      await atomicReplaceFile(file, json(next));
      return next;
    });
  }

  async publish(
    requested: WorkflowDocument,
    revision: FlowRevision,
    baseDraftRevision: number,
  ): Promise<WorkflowDocument> {
    const located = await this.readDocument(requested.id);
    const draftFile = await this.draftFileForDocument(located);
    return withCrossProcessFileLock({ lockDirectory: `${draftFile}.lock` }, async () => {
      const current = await this.readDocumentFile(draftFile);
      const effectiveCurrent =
        current ?? (await this.readDocumentFile(this.legacyDraftFile(requested.id))) ?? located;
      if (!effectiveCurrent) {
        throw new ExecutionError("workflow-not-found", "The workflow does not exist.", {
          workflowId: requested.id,
        });
      }
      if (effectiveCurrent.draftRevision !== baseDraftRevision) {
        throw new ExecutionError("workflow-conflict", "The workflow draft changed elsewhere.", {
          workflowId: requested.id,
          currentDraftRevision: effectiveCurrent.draftRevision,
        });
      }
      const definitionFile =
        effectiveCurrent.scope.type === "personal"
          ? this.personalDefinitionFile(effectiveCurrent.id)
          : await this.projectDefinitionFile(effectiveCurrent.scope, effectiveCurrent.id);
      if (effectiveCurrent.scope.type === "project") {
        const publishedValue = await readJson(definitionFile);
        const published =
          publishedValue === undefined ? undefined : parseExecutionDocument(publishedValue);
        const publishedContentRevisionId = published
          ? executionRevisionIdForDocument(published)
          : undefined;
        const legacyPublishedContentRevisionId =
          published &&
          isPlainRecord(publishedValue) &&
          publishedValue.schemaVersion === 2 &&
          Array.isArray(publishedValue.triggers)
            ? legacyExecutionRevisionIdForDocument(published, publishedValue.triggers)
            : undefined;
        if (
          published?.publishedRevisionId !== effectiveCurrent.publishedRevisionId ||
          (publishedContentRevisionId !== published?.publishedRevisionId &&
            legacyPublishedContentRevisionId !== published?.publishedRevisionId)
        ) {
          throw new ExecutionError(
            "revision-conflict",
            "The published project workflow changed outside Workbench.",
            {
              workflowId: effectiveCurrent.id,
              ...(published?.publishedRevisionId === undefined
                ? {}
                : { publishedRevisionId: published.publishedRevisionId }),
            },
          );
        }
      }
      const next = parseExecutionDocument({
        ...effectiveCurrent,
        draftRevision: baseDraftRevision + 1,
        publishedRevisionId: revision.revisionId,
        updatedAt: this.now(),
      });
      await this.ensureAgentWorkspaces(next);
      await atomicReplaceFile(
        await this.revisionFileForDocument(effectiveCurrent, revision.revisionId),
        json(revision),
      );
      await atomicReplaceFile(definitionFile, json(next), {
        fileMode: effectiveCurrent.scope.type === "project" ? 0o644 : 0o600,
      });
      await atomicReplaceFile(draftFile, json(next));
      return next;
    });
  }

  async readRevision(workflowId: string, revisionId: string): Promise<FlowRevision> {
    const document = await this.readDocument(workflowId);
    const value =
      (await readJson(await this.revisionFileForDocument(document, revisionId))) ??
      (await readJson(this.legacyRevisionFile(workflowId, revisionId)));
    if (!value) {
      throw new ExecutionError("revision-not-found", "The workflow revision does not exist.", {
        workflowId,
        revisionId,
      });
    }
    const revision = value as
      | FlowRevision
      | (Omit<FlowRevision, "schemaVersion"> & {
          schemaVersion: 2;
          triggers?: unknown[];
        })
      | (Omit<FlowRevision, "schemaVersion" | "agents"> & {
          schemaVersion: 1;
          triggers?: unknown[];
        });
    if (revision.schemaVersion === 3) {
      return structuredClone(revision);
    }
    if (revision.schemaVersion === 2) {
      const { triggers: _legacyTriggers, ...previousRevision } = revision;
      return structuredClone({ ...previousRevision, schemaVersion: 3 });
    }
    const migrated = parseExecutionDocumentWithMigration({
      schemaVersion: 1,
      id: revision.workflowId,
      kind: revision.kind,
      scope: revision.scope,
      name: revision.name,
      ...(revision.description === undefined ? {} : { description: revision.description }),
      graph: revision.graph,
      concurrency: revision.concurrency,
      ...(revision.triggers === undefined ? {} : { triggers: revision.triggers }),
      draftRevision: 0,
      publishedRevisionId: revision.revisionId,
      createdAt: revision.publishedAt,
      updatedAt: revision.publishedAt,
    });
    await this.ensureAgentWorkspaces(migrated.document, migrated.legacyAgentResources);
    const { triggers: _legacyTriggers, ...legacyRevision } = revision;
    return {
      ...legacyRevision,
      schemaVersion: 3,
      agents: migrated.document.agents,
      graph: migrated.document.graph,
    };
  }

  async saveRevision(revision: FlowRevision): Promise<void> {
    await this.ensureAgentWorkspaces({
      ...revision,
      id: revision.workflowId,
      draftRevision: 0,
      publishedRevisionId: revision.revisionId,
      createdAt: revision.publishedAt,
      updatedAt: revision.publishedAt,
    });
    await atomicReplaceFile(
      await this.revisionFileForDocument(
        { id: revision.workflowId, scope: revision.scope },
        revision.revisionId,
      ),
      json(revision),
    );
  }

  async createRun(
    run: WorkflowRunSummary,
    workflow?: Pick<WorkflowDocument, "id" | "scope">,
  ): Promise<WorkflowRunSummary> {
    const directory = this.workflowRunDirectory(
      await this.workflowDirectory(workflow ?? run.workflowId),
      run.id,
    );
    this.runDirectories.set(run.id, directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await atomicReplaceFile(this.runSummaryFile(directory), json(run));
    await appendFile(
      this.runEventsFile(directory),
      `${JSON.stringify({
        seq: 1,
        time: run.createdAt,
        type: "run-created",
        runId: run.id,
        status: run.status,
      } satisfies WorkflowRunEvent)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    const next = { ...run, lastSeq: 1 };
    await atomicReplaceFile(this.runSummaryFile(directory), json(next));
    return next;
  }

  async readRunSummary(runId: string): Promise<WorkflowRunSummary> {
    const directory = await this.locateRunDirectory(runId);
    const value = await readJson(this.runSummaryFile(directory));
    if (!value)
      throw new ExecutionError("run-not-found", "The workflow run does not exist.", { runId });
    return structuredClone(value as WorkflowRunSummary);
  }

  async updateRun(
    run: WorkflowRunSummary,
    event: Omit<WorkflowRunEvent, "seq" | "time" | "runId">,
  ): Promise<WorkflowRunSummary> {
    const directory = await this.locateRunDirectory(run.id);
    const summaryFile = this.runSummaryFile(directory);
    return withCrossProcessFileLock({ lockDirectory: `${summaryFile}.lock` }, async () => {
      const current = await this.readRunSummary(run.id);
      const seq = current.lastSeq + 1;
      const next = { ...run, lastSeq: seq, updatedAt: this.now() };
      const record: WorkflowRunEvent = {
        ...event,
        seq,
        time: this.now(),
        runId: run.id,
      };
      await appendFile(this.runEventsFile(directory), `${JSON.stringify(record)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await atomicReplaceFile(summaryFile, json(next));
      return next;
    });
  }

  async listRuns(options: {
    workflowId?: string;
    status?: WorkflowRunStatus;
    limit?: number;
  }): Promise<WorkflowRunSummary[]> {
    const directories: string[] = [];
    try {
      directories.push(
        ...(await readdir(path.join(this.rootDirectory, "runs"), { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(this.rootDirectory, "runs", entry.name)),
      );
    } catch (error) {
      if (nodeErrorCode(error) !== "ENOENT") throw error;
    }
    let workflowDirectories: string[];
    if (options.workflowId) {
      workflowDirectories = [
        await this.workflowDirectory(safePathSegment(options.workflowId, "A workflow ID")),
      ];
    } else {
      workflowDirectories = await this.workflowDirectories();
    }
    for (const workflowDirectory of workflowDirectories) {
      const directory = path.join(workflowDirectory, "runs");
      try {
        directories.push(
          ...(await readdir(directory, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(directory, entry.name)),
        );
      } catch (error) {
        if (nodeErrorCode(error) !== "ENOENT") throw error;
      }
    }
    const summaries = (
      await Promise.all(
        directories.map(async (directory) => {
          try {
            const value = await readJson(this.runSummaryFile(directory));
            if (!value) return undefined;
            const run = value as WorkflowRunSummary;
            this.runDirectories.set(run.id, directory);
            return structuredClone(run);
          } catch {
            return undefined;
          }
        }),
      )
    ).filter((run): run is WorkflowRunSummary => Boolean(run));
    return summaries
      .filter(
        (run) =>
          (!options.workflowId || run.workflowId === options.workflowId) &&
          (!options.status || run.status === options.status),
      )
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, options.limit ?? 100);
  }

  async readRun(runId: string, afterSeq = 0, limit = 200): Promise<WorkflowRunReadValue> {
    const run = await this.readRunSummary(runId);
    const directory = await this.locateRunDirectory(runId);
    let content = "";
    try {
      content = await readFile(this.runEventsFile(directory), "utf8");
    } catch (error) {
      if (nodeErrorCode(error) !== "ENOENT") throw error;
    }
    const all = content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as WorkflowRunEvent)
      .filter((event) => event.seq > afterSeq);
    const events = all.slice(0, Math.max(1, Math.min(limit, 1_000)));
    const last = events.at(-1)?.seq;
    return {
      run,
      events,
      ...(last !== undefined && all.length > events.length ? { nextSeq: last } : {}),
    };
  }

  async deleteRun(runId: string): Promise<WorkflowRunSummary> {
    const directory = await this.locateRunDirectory(runId);
    return withCrossProcessFileLock({ lockDirectory: `${directory}.delete.lock` }, async () => {
      const run = await this.readRunSummary(runId);
      await rm(directory, { recursive: true });
      this.runDirectories.delete(runId);
      return run;
    });
  }

  async markInterruptedRuns(): Promise<WorkflowRunSummary[]> {
    const active = await this.listRuns({ limit: Number.MAX_SAFE_INTEGER });
    const changed: WorkflowRunSummary[] = [];
    for (const run of active) {
      if (!["queued", "running", "waiting-for-approval"].includes(run.status)) continue;
      const next = await this.updateRun(
        {
          ...run,
          status: "interrupted",
          completedAt: this.now(),
          errorCode: "application-restarted",
          errorMessage: "Workbench stopped before the run completed.",
        },
        { type: "run-status-changed", status: "interrupted" },
      );
      changed.push(next);
    }
    return changed;
  }

  createId(): string {
    return randomUUID();
  }

  async projectDefinitionStat(
    document: WorkflowDocument,
  ): Promise<{ mtimeMs: number } | undefined> {
    if (document.scope.type !== "project") return undefined;
    try {
      const value = await stat(await this.projectDefinitionFile(document.scope, document.id));
      return { mtimeMs: value.mtimeMs };
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }
}
