import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";

import type {
  FlowRevision,
  WorkflowDocument,
  WorkflowRunEvent,
  WorkflowRunReadValue,
  WorkflowRunStatus,
  WorkflowRunSummary,
  WorkflowScope,
  WorkflowTriggerState,
} from "@/runtime/shared/execution";
import { atomicReplaceFile, withCrossProcessFileLock } from "@/runtime/server/file-persistence";
import { executionRevisionIdForDocument } from "./execution-compiler";
import { ExecutionError } from "./execution-errors";
import { parseExecutionDocument } from "./execution-schema";

interface TriggerStateDocument {
  schemaVersion: 1;
  states: WorkflowTriggerState[];
}

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

function scopeMatches(scope: WorkflowScope, workspaceId?: string): boolean {
  return !workspaceId || (scope.type === "project" && scope.workspaceId === workspaceId);
}

export class ExecutionRepository {
  readonly rootDirectory: string;
  private readonly now: () => number;
  private readonly listWorkspaces: () => Promise<ExecutionWorkspace[]>;

  constructor(options: ExecutionRepositoryOptions) {
    this.rootDirectory = options.rootDirectory;
    this.now = options.now ?? Date.now;
    this.listWorkspaces = options.listWorkspaces ?? (async () => []);
  }

  private draftFile(workflowId: string): string {
    return path.join(this.rootDirectory, "drafts", `${workflowId}.json`);
  }

  private personalDefinitionFile(workflowId: string): string {
    return path.join(this.rootDirectory, "definitions", `${workflowId}.json`);
  }

  private revisionFile(workflowId: string, revisionId: string): string {
    return path.join(this.rootDirectory, "revisions", workflowId, `${revisionId}.json`);
  }

  private runDirectory(runId: string): string {
    return path.join(this.rootDirectory, "runs", runId);
  }

  private runSummaryFile(runId: string): string {
    return path.join(this.runDirectory(runId), "summary.json");
  }

  private runEventsFile(runId: string): string {
    return path.join(this.runDirectory(runId), "events.jsonl");
  }

  executionSessionDirectory(runId: string): string {
    return path.join(this.runDirectory(runId), "sessions");
  }

  artifactDirectory(runId: string): string {
    return path.join(this.runDirectory(runId), "artifacts");
  }

  private triggerStateFile(): string {
    return path.join(this.rootDirectory, "trigger-state.json");
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

  private async readDocumentFile(file: string): Promise<WorkflowDocument | undefined> {
    const value = await readJson(file);
    if (value === undefined) return undefined;
    try {
      return parseExecutionDocument(value);
    } catch (error) {
      const quarantine = `${file}.corrupt.${this.now()}`;
      await rename(file, quarantine).catch(() => undefined);
      throw error;
    }
  }

  async listDocuments(workspaceId?: string): Promise<WorkflowDocument[]> {
    const documents = new Map<string, WorkflowDocument>();
    for (const file of await regularJsonFiles(path.join(this.rootDirectory, "definitions"))) {
      const document = await this.readDocumentFile(file);
      if (document && scopeMatches(document.scope, workspaceId))
        documents.set(document.id, document);
    }
    const workspaces = await this.listWorkspaces();
    for (const workspace of workspaces) {
      if (workspaceId && workspace.workspaceId !== workspaceId) continue;
      const directory = path.join(workspace.path, ".pi", "workflows");
      for (const file of await regularJsonFiles(directory)) {
        const document = await this.readDocumentFile(file);
        if (
          document &&
          document.scope.type === "project" &&
          document.scope.workspaceId === workspace.workspaceId
        ) {
          documents.set(document.id, document);
        }
      }
    }
    for (const file of await regularJsonFiles(path.join(this.rootDirectory, "drafts"))) {
      const document = await this.readDocumentFile(file);
      if (document && scopeMatches(document.scope, workspaceId))
        documents.set(document.id, document);
    }
    return [...documents.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async readDocument(workflowId: string, workspaceId?: string): Promise<WorkflowDocument> {
    const draft = await this.readDocumentFile(this.draftFile(workflowId));
    if (draft && scopeMatches(draft.scope, workspaceId)) return draft;
    const personal = await this.readDocumentFile(this.personalDefinitionFile(workflowId));
    if (personal && scopeMatches(personal.scope, workspaceId)) return personal;
    for (const workspace of await this.listWorkspaces()) {
      if (workspaceId && workspace.workspaceId !== workspaceId) continue;
      const document = await this.readDocumentFile(
        path.join(workspace.path, ".pi", "workflows", `${workflowId}.json`),
      );
      if (document) return document;
    }
    throw new ExecutionError("workflow-not-found", "The workflow does not exist.", { workflowId });
  }

  async createDocument(document: WorkflowDocument): Promise<WorkflowDocument> {
    const file = this.draftFile(document.id);
    return withCrossProcessFileLock({ lockDirectory: `${file}.lock` }, async () => {
      if ((await readJson(file)) !== undefined) {
        throw new ExecutionError("workflow-conflict", "The workflow already exists.", {
          workflowId: document.id,
          currentDraftRevision: document.draftRevision,
        });
      }
      await atomicReplaceFile(file, json(document));
      return structuredClone(document);
    });
  }

  async saveDraft(
    requested: WorkflowDocument,
    baseDraftRevision: number,
  ): Promise<WorkflowDocument> {
    const file = this.draftFile(requested.id);
    return withCrossProcessFileLock({ lockDirectory: `${file}.lock` }, async () => {
      const current = await this.readDocumentFile(file);
      if (!current) {
        throw new ExecutionError("workflow-not-found", "The workflow does not exist.", {
          workflowId: requested.id,
        });
      }
      if (current.draftRevision !== baseDraftRevision) {
        throw new ExecutionError("workflow-conflict", "The workflow draft changed elsewhere.", {
          workflowId: requested.id,
          currentDraftRevision: current.draftRevision,
        });
      }
      if (
        requested.id !== current.id ||
        requested.kind !== current.kind ||
        JSON.stringify(requested.scope) !== JSON.stringify(current.scope) ||
        requested.createdAt !== current.createdAt
      ) {
        throw new TypeError("Immutable workflow identity fields cannot be changed.");
      }
      const next = parseExecutionDocument({
        ...requested,
        draftRevision: baseDraftRevision + 1,
        publishedRevisionId: current.publishedRevisionId,
        updatedAt: this.now(),
      });
      await atomicReplaceFile(file, json(next));
      return next;
    });
  }

  async publish(
    requested: WorkflowDocument,
    revision: FlowRevision,
    baseDraftRevision: number,
  ): Promise<WorkflowDocument> {
    const draftFile = this.draftFile(requested.id);
    return withCrossProcessFileLock({ lockDirectory: `${draftFile}.lock` }, async () => {
      const current = await this.readDocumentFile(draftFile);
      if (!current) {
        throw new ExecutionError("workflow-not-found", "The workflow does not exist.", {
          workflowId: requested.id,
        });
      }
      if (current.draftRevision !== baseDraftRevision) {
        throw new ExecutionError("workflow-conflict", "The workflow draft changed elsewhere.", {
          workflowId: requested.id,
          currentDraftRevision: current.draftRevision,
        });
      }
      const definitionFile =
        current.scope.type === "personal"
          ? this.personalDefinitionFile(current.id)
          : await this.projectDefinitionFile(current.scope, current.id);
      if (current.scope.type === "project") {
        const published = await this.readDocumentFile(definitionFile);
        const publishedContentRevisionId = published
          ? executionRevisionIdForDocument(published)
          : undefined;
        if (
          published?.publishedRevisionId !== current.publishedRevisionId ||
          publishedContentRevisionId !== published?.publishedRevisionId
        ) {
          throw new ExecutionError(
            "revision-conflict",
            "The published project workflow changed outside Workbench.",
            {
              workflowId: current.id,
              ...(published?.publishedRevisionId === undefined
                ? {}
                : { publishedRevisionId: published.publishedRevisionId }),
            },
          );
        }
      }
      const next = parseExecutionDocument({
        ...current,
        draftRevision: baseDraftRevision + 1,
        publishedRevisionId: revision.revisionId,
        updatedAt: this.now(),
      });
      await atomicReplaceFile(this.revisionFile(current.id, revision.revisionId), json(revision));
      await atomicReplaceFile(definitionFile, json(next), {
        fileMode: current.scope.type === "project" ? 0o644 : 0o600,
      });
      await atomicReplaceFile(draftFile, json(next));
      return next;
    });
  }

  async readRevision(workflowId: string, revisionId: string): Promise<FlowRevision> {
    const value = await readJson(this.revisionFile(workflowId, revisionId));
    if (!value) {
      throw new ExecutionError("revision-not-found", "The workflow revision does not exist.", {
        workflowId,
        revisionId,
      });
    }
    return structuredClone(value as FlowRevision);
  }

  async saveRevision(revision: FlowRevision): Promise<void> {
    await atomicReplaceFile(
      this.revisionFile(revision.workflowId, revision.revisionId),
      json(revision),
    );
  }

  async createRun(run: WorkflowRunSummary): Promise<WorkflowRunSummary> {
    const directory = this.runDirectory(run.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await atomicReplaceFile(this.runSummaryFile(run.id), json(run));
    await appendFile(
      this.runEventsFile(run.id),
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
    await atomicReplaceFile(this.runSummaryFile(run.id), json(next));
    return next;
  }

  async readRunSummary(runId: string): Promise<WorkflowRunSummary> {
    const value = await readJson(this.runSummaryFile(runId));
    if (!value)
      throw new ExecutionError("run-not-found", "The workflow run does not exist.", { runId });
    return structuredClone(value as WorkflowRunSummary);
  }

  async updateRun(
    run: WorkflowRunSummary,
    event: Omit<WorkflowRunEvent, "seq" | "time" | "runId">,
  ): Promise<WorkflowRunSummary> {
    const summaryFile = this.runSummaryFile(run.id);
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
      await appendFile(this.runEventsFile(run.id), `${JSON.stringify(record)}\n`, {
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
    let entries: string[];
    try {
      entries = (await readdir(path.join(this.rootDirectory, "runs"), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") return [];
      throw error;
    }
    const summaries = (
      await Promise.all(
        entries.map(async (runId) => {
          try {
            return await this.readRunSummary(runId);
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
    let content = "";
    try {
      content = await readFile(this.runEventsFile(runId), "utf8");
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

  async listTriggerStates(workflowId?: string): Promise<WorkflowTriggerState[]> {
    const value = await readJson(this.triggerStateFile());
    const states = (value as TriggerStateDocument | undefined)?.states ?? [];
    return states
      .filter((state) => !workflowId || state.workflowId === workflowId)
      .map((state) => structuredClone(state));
  }

  async saveTriggerState(state: WorkflowTriggerState): Promise<WorkflowTriggerState> {
    const file = this.triggerStateFile();
    return withCrossProcessFileLock({ lockDirectory: `${file}.lock` }, async () => {
      const states = await this.listTriggerStates();
      const next = states.filter(
        (item) => item.workflowId !== state.workflowId || item.triggerId !== state.triggerId,
      );
      next.push(state);
      await atomicReplaceFile(
        file,
        json({ schemaVersion: 1, states: next } satisfies TriggerStateDocument),
      );
      return structuredClone(state);
    });
  }

  async removeTriggerState(workflowId: string, triggerId: string): Promise<void> {
    const file = this.triggerStateFile();
    await withCrossProcessFileLock({ lockDirectory: `${file}.lock` }, async () => {
      const states = (await this.listTriggerStates()).filter(
        (item) => item.workflowId !== workflowId || item.triggerId !== triggerId,
      );
      await atomicReplaceFile(
        file,
        json({ schemaVersion: 1, states } satisfies TriggerStateDocument),
      );
    });
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
