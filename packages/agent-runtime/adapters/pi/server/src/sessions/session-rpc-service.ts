import type { PiSessionSummary } from "@workbench/agent-runtime-pi-protocol/messages";
import type { SessionAttachmentErrorReason } from "@workbench/agent-runtime-pi-protocol/attachments";
import type {
  RpcIssue,
  SessionAttachmentPayload,
  SessionAttachmentValue,
  SessionCancelPayload,
  SessionCancelValue,
  SessionCompactValue,
  SessionContextPolicyPayload,
  SessionContextPolicyUpdatePayload,
  SessionContextPolicyValue,
  SessionCreatePayload,
  SessionCreateValue,
  SessionDeletePayload,
  SessionDeleteValue,
  SessionForkPayload,
  SessionForkValue,
  SessionHistoryPayload,
  SessionHistoryValue,
  SessionListPayload,
  SessionListValue,
  SessionModelsPayload,
  SessionModelsValue,
  SessionPromptContent,
  SessionPromptPayload,
  SessionPromptValue,
  SessionRegeneratePayload,
  SessionRegenerateValue,
  SessionResumePayload,
  SessionResumeValue,
  SessionRenamePayload,
  SessionRenameValue,
  SessionSearchPayload,
  SessionSearchValue,
  SessionSelectModelPayload,
  SessionSelectModelValue,
  SessionSelectBranchPayload,
  SessionSelectBranchValue,
  SessionScratchCreatePayload,
  SessionScratchCreateValue,
  SessionScratchPromotePayload,
  SessionScratchPromoteValue,
  SessionScratchReleasePayload,
  SessionScratchReleaseValue,
  SessionUpdateQueuePayload,
  SessionUpdateQueueValue,
  WorkspaceView,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  composerDocumentMatchesCommands,
  hasWorkbenchComposerSemantics,
} from "@workbench/contracts/composer/request";
import {
  AgentExecutionError,
  type AgentExecutionPort,
  type AgentQueueMutation,
} from "@workbench/agent-runtime-server/execution";
import {
  AgentThreadStoreError,
  type AgentThreadStorePort,
  type AgentThreadSummary,
} from "@workbench/agent-runtime-server/threads";
import { RpcDomainError } from "@workbench/server-core/rpc-domain-error";
import {
  PiSessionHistoryServiceError,
  type PiSessionHistoryService,
} from "./pi-session-history-service";
import {
  PiSessionModelContextServiceError,
  type PiSessionModelContextService,
} from "./pi-session-model-context-service";
import { admitInlineAttachments, InlineAttachmentAdmissionError } from "./inline-image-admission";
import { workspaceFromCwd } from "../workspaces/workspace-paths";

export type SessionListInput = SessionListPayload;
export type SessionSearchInput = SessionSearchPayload;
export type SessionCreateInput = SessionCreatePayload;
export type SessionDeleteInput = SessionDeletePayload;
export type SessionHistoryInput = SessionHistoryPayload;
export type SessionModelsInput = SessionModelsPayload;
export type SessionSelectModelInput = SessionSelectModelPayload;
export type SessionRenameInput = SessionRenamePayload;
export type SessionForkInput = SessionForkPayload;
export type SessionPromptInput = SessionPromptPayload;
export type SessionRegenerateInput = SessionRegeneratePayload;
export type SessionResumeInput = SessionResumePayload;
export type SessionSelectBranchInput = SessionSelectBranchPayload;
export type SessionAttachmentInput = SessionAttachmentPayload;
export type SessionUpdateQueueInput = SessionUpdateQueuePayload;
export type SessionCancelInput = SessionCancelPayload;
export type SessionContextPolicyInput = SessionContextPolicyPayload;
export type SessionContextPolicyUpdateInput = SessionContextPolicyUpdatePayload;
export type SessionScratchCreateInput = SessionScratchCreatePayload;
export type SessionScratchPromoteInput = SessionScratchPromotePayload;
export type SessionScratchReleaseInput = SessionScratchReleasePayload;

export type {
  SessionAttachmentValue,
  SessionCancelValue,
  SessionCompactValue,
  SessionContextPolicyValue,
  SessionCreateValue,
  SessionDeleteValue,
  SessionEvent,
  SessionForkValue,
  SessionHistoryValue,
  SessionListValue,
  SessionModelsValue,
  SessionPromptContent,
  SessionPromptValue,
  SessionRegenerateValue,
  SessionResumeValue,
  SessionRenameValue,
  SessionSearchValue,
  SessionSelectModelValue,
  SessionSelectBranchValue,
  SessionScratchCreateValue,
  SessionScratchPromoteValue,
  SessionScratchReleaseValue,
  SessionUpdateQueueValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";

export interface SessionRpcServiceErrorDetails {
  "bad-request": { issues: RpcIssue[] };
  "session-not-found": { sessionId: string };
  "model-unavailable": { provider: string; model: string };
  "session-conflict": { sessionId: string; requestedCwd: string; existingCwd?: string };
  "invalid-time-zone": { value: string };
  "workspace-attach-failed": { sessionId: string; workspaceId: string };
  "workspace-not-found": { workspaceId: string };
  "workspace-invalid-path": { path: string };
  "agent-preset-invalid": { agentPreset: string; reason: string };
  "agent-busy": { reason: string };
  "attachment-error": { reason: SessionAttachmentErrorReason };
  "queue-item-not-found": { itemId: string };
  "steer-unavailable": { itemId: string };
  "command-error": Record<string, never>;
  "title-invalid": { sessionId: string };
  "fork-unavailable": { sessionId: string };
  "branch-not-found": { sessionId: string };
  "compaction-unavailable": {
    sessionId: string;
    reason: "already-compacted" | "cancelled" | "context-too-small";
  };
  "resume-unavailable": {
    sessionId: string;
    reason: "stale" | "blocked" | "confirmation-required";
  };
  unsupported: { capability: SessionAgentCapability };
  internal: Record<string, never>;
}

export type SessionRpcServiceErrorCode = keyof SessionRpcServiceErrorDetails;

export class SessionRpcServiceError<
  Code extends SessionRpcServiceErrorCode = SessionRpcServiceErrorCode,
> extends RpcDomainError<Code, SessionRpcServiceErrorDetails[Code]> {
  readonly code: Code;
  readonly details: SessionRpcServiceErrorDetails[Code];

  constructor(
    code: Code,
    message: string,
    details: SessionRpcServiceErrorDetails[Code],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SessionRpcServiceError";
    this.code = code;
    this.details = details;
  }
}

export interface SessionRpcWorkspaceStore {
  list(): Promise<{ items: WorkspaceView[] }>;
  attachSession(workspaceId: string, sessionId: string): Promise<{ workspace: WorkspaceView }>;
  reconcile(
    sessions: ReadonlyArray<{ id: string; cwd: string }>,
    options?: { importUnknownWorkspaces?: boolean },
  ): Promise<{ items: WorkspaceView[] }>;
}

export interface SessionRpcScratchRecord {
  readonly summary: AgentThreadSummary;
  readonly sourceSessionId: string;
  readonly workspaceId?: string;
  readonly expiresAt: number;
}

export interface SessionRpcScratchStore {
  get(sessionId: string): Promise<SessionRpcScratchRecord | undefined>;
  runningSessionIds?(): Promise<readonly string[]>;
  create(input: {
    sourceSessionId: string;
    atEventRevision?: number;
    workspaceId?: string;
  }): Promise<SessionRpcScratchRecord>;
  release(sessionId: string): Promise<void>;
  promote(
    sessionId: string,
    title?: string,
  ): Promise<{
    summary: AgentThreadSummary;
    sourceSessionId: string;
    workspaceId?: string;
  }>;
}

export interface SessionRpcServiceOptions {
  workspaceStore: SessionRpcWorkspaceStore;
  execution: AgentExecutionPort;
  threads: AgentThreadStorePort;
  history: PiSessionHistoryService;
  modelContext: PiSessionModelContextService;
  scratch?: SessionRpcScratchStore;
  defaultCwd?: string;
}

interface ErrorContext {
  sessionId?: string;
  cwd?: string;
  itemId?: string;
  capability?: SessionAgentCapability;
}

type SessionAgentCapability =
  | "branch-selection"
  | "fork"
  | "queue-mutation"
  | "regeneration"
  | "resume"
  | "thread-search";

const MAX_SEARCH_QUERY_CODE_POINTS = 500;
const MAX_SEARCH_RESULTS = 20;
const MAX_SEARCH_SNIPPET_CODE_POINTS = 240;
const WORKBENCH_SESSION_SUMMARY_PROJECTION = "workbench.piSessionSummary";
const DEFAULT_HISTORY_MESSAGES = 50;

function issue(path: Array<string | number>, message: string, code = "custom"): RpcIssue {
  return { code, path, message };
}

function badRequest(issues: RpcIssue[]): SessionRpcServiceError<"bad-request"> {
  return new SessionRpcServiceError("bad-request", "The request payload is invalid.", { issues });
}

function attachmentError(
  reason: SessionAttachmentErrorReason,
  message: string,
): SessionRpcServiceError<"attachment-error"> {
  return new SessionRpcServiceError("attachment-error", message, { reason });
}

function admitSessionInlineAttachments(
  parts: readonly Extract<SessionPromptContent, { type: "image" | "file" }>[],
) {
  try {
    return admitInlineAttachments(parts);
  } catch (error) {
    if (error instanceof InlineAttachmentAdmissionError) {
      throw attachmentError(error.reason, error.message);
    }
    throw error;
  }
}

function nonEmpty(value: string, path: string): string {
  if (!value.trim()) throw badRequest([issue([path], `${path} must not be empty.`)]);
  return value;
}

function piEventRevisionFromStateToken(token: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(token)) {
    throw new Error("The Agent Runtime returned an invalid Pi event revision token.");
  }
  const revision = Number(token);
  if (!Number.isSafeInteger(revision) || revision < 0 || String(revision) !== token) {
    throw new Error("The Agent Runtime returned an invalid Pi event revision token.");
  }
  return revision;
}

function codePointLength(value: string): number {
  return [...value].length;
}

interface TextMatch {
  start: number;
  end: number;
}

function findCaseInsensitiveMatch(source: string, foldedQuery: string): TextMatch | undefined {
  const sourceCodePoints = [...source];
  let foldedSource = "";
  const originalIndexByCodeUnit: number[] = [];
  for (let index = 0; index < sourceCodePoints.length; index += 1) {
    const foldedCodePoint = sourceCodePoints[index]!.toLocaleLowerCase("en-US");
    for (let unit = 0; unit < foldedCodePoint.length; unit += 1) {
      originalIndexByCodeUnit.push(index);
    }
    foldedSource += foldedCodePoint;
  }
  const foldedStart = foldedSource.indexOf(foldedQuery);
  if (foldedStart < 0) return undefined;
  const foldedEnd = foldedStart + foldedQuery.length - 1;
  return {
    start: originalIndexByCodeUnit[foldedStart] ?? 0,
    end: (originalIndexByCodeUnit[foldedEnd] ?? sourceCodePoints.length - 1) + 1,
  };
}

function snippetAroundMatch(source: string, match: TextMatch): string {
  const points = [...source];
  if (points.length <= MAX_SEARCH_SNIPPET_CODE_POINTS) return source;
  const matchLength = Math.min(match.end - match.start, MAX_SEARCH_SNIPPET_CODE_POINTS);
  const leadingContext = Math.floor((MAX_SEARCH_SNIPPET_CODE_POINTS - matchLength) / 2);
  const maximumStart = points.length - MAX_SEARCH_SNIPPET_CODE_POINTS;
  const start = Math.min(Math.max(0, match.start - leadingContext), maximumStart);
  return points.slice(start, start + MAX_SEARCH_SNIPPET_CODE_POINTS).join("");
}

function milliseconds(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function piSessionSummary(thread: AgentThreadSummary): PiSessionSummary {
  return {
    id: thread.threadId,
    cwd: thread.rootPath,
    workspace: workspaceFromCwd(thread.rootPath),
    ...(thread.title === undefined ? {} : { name: thread.title }),
    created: thread.createdAt,
    modified: thread.updatedAt,
    messageCount: thread.messageCount,
    firstMessage: thread.firstMessage,
    transient: thread.transient,
    running: thread.running,
    ...(thread.waitingForUserInput === undefined
      ? {}
      : { waitingForUserInput: thread.waitingForUserInput }),
    ...(thread.runTiming === undefined ? {} : { runTiming: thread.runTiming }),
    ...(thread.automationOrigin === undefined ? {} : { automationOrigin: thread.automationOrigin }),
    ...(thread.executionOrigin === undefined ? {} : { executionOrigin: thread.executionOrigin }),
  };
}

function canonicalTimeZone(value: string): string | undefined {
  if (value !== value.trim() || (value !== "UTC" && !value.includes("/"))) return undefined;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export class SessionRpcService {
  private readonly workspaceStore: SessionRpcWorkspaceStore;
  private readonly execution: AgentExecutionPort;
  private readonly threads: AgentThreadStorePort;
  private readonly historyService: PiSessionHistoryService;
  private readonly modelContextService: PiSessionModelContextService;
  private readonly scratchStore?: SessionRpcScratchStore;
  private readonly defaultCwd: string;
  private readonly sessionCreateTails = new Map<string, Promise<void>>();

  constructor(options: SessionRpcServiceOptions) {
    this.workspaceStore = options.workspaceStore;
    this.execution = options.execution;
    this.threads = options.threads;
    this.historyService = options.history;
    this.modelContextService = options.modelContext;
    this.scratchStore = options.scratch;
    this.defaultCwd = options.defaultCwd ?? process.cwd();
  }

  private translate(error: unknown, context: ErrorContext = {}): never {
    if (error instanceof SessionRpcServiceError) throw error;
    if (error instanceof AgentThreadStoreError) {
      if (error.code === "unsupported" && context.capability) {
        throw new SessionRpcServiceError(
          "unsupported",
          "The selected Agent Runtime does not support this operation.",
          { capability: context.capability },
          { cause: error },
        );
      }
      if (error.code === "thread-not-found" && context.sessionId) {
        throw new SessionRpcServiceError(
          "session-not-found",
          "The session does not exist.",
          { sessionId: context.sessionId },
          { cause: error },
        );
      }
      if (error.code === "thread-id-conflict" && context.sessionId && context.cwd !== undefined) {
        throw new SessionRpcServiceError(
          "session-conflict",
          "The requested session identifier already belongs to another working directory.",
          {
            sessionId: context.sessionId,
            requestedCwd: context.cwd,
            ...(error.details.existingRootPath === undefined
              ? {}
              : { existingCwd: error.details.existingRootPath }),
          },
          { cause: error },
        );
      }
      if (error.code === "invalid-root" && context.cwd !== undefined) {
        throw new SessionRpcServiceError(
          "workspace-invalid-path",
          "The workspace path is invalid.",
          { path: context.cwd },
          { cause: error },
        );
      }
      if (error.code === "busy") {
        throw new SessionRpcServiceError(
          "agent-busy",
          "The session agent is busy.",
          { reason: "The active agent cannot accept this operation." },
          { cause: error },
        );
      }
      if (error.code === "fork-unavailable" && context.sessionId) {
        throw new SessionRpcServiceError(
          "fork-unavailable",
          "The session cannot be forked at the requested protocol boundary.",
          { sessionId: context.sessionId },
          { cause: error },
        );
      }
    }
    if (error instanceof AgentExecutionError) {
      if (error.code === "unsupported" && context.capability) {
        throw new SessionRpcServiceError(
          "unsupported",
          "The selected Agent Runtime does not support this operation.",
          { capability: context.capability },
          { cause: error },
        );
      }
      if (error.code === "thread-not-found" && context.sessionId) {
        throw new SessionRpcServiceError(
          "session-not-found",
          "The session does not exist.",
          { sessionId: context.sessionId },
          { cause: error },
        );
      }
      if (error.code === "busy") {
        throw new SessionRpcServiceError(
          "agent-busy",
          "The session agent is busy.",
          { reason: "The active agent cannot accept this prompt." },
          { cause: error },
        );
      }
      if (error.code === "branch-not-found" && context.sessionId) {
        throw new SessionRpcServiceError(
          "branch-not-found",
          "The requested conversation branch does not exist.",
          { sessionId: context.sessionId },
          { cause: error },
        );
      }
      if (error.code === "resume-stale" && context.sessionId) {
        throw new SessionRpcServiceError(
          "resume-unavailable",
          "The recovery checkpoint is no longer on the selected branch.",
          { sessionId: context.sessionId, reason: "stale" },
          { cause: error },
        );
      }
      if (error.code === "resume-confirmation-required" && context.sessionId) {
        throw new SessionRpcServiceError(
          "resume-unavailable",
          "The interrupted tool state requires confirmation before it can be resumed.",
          { sessionId: context.sessionId, reason: "confirmation-required" },
          { cause: error },
        );
      }
      if (error.code === "resume-blocked" && context.sessionId) {
        throw new SessionRpcServiceError(
          "resume-unavailable",
          "The recovery checkpoint cannot be resumed with the current model.",
          { sessionId: context.sessionId, reason: "blocked" },
          { cause: error },
        );
      }
      if (error.code === "queue-item-not-found" && context.itemId) {
        throw new SessionRpcServiceError(
          "queue-item-not-found",
          "The queued item is no longer pending.",
          { itemId: context.itemId },
          { cause: error },
        );
      }
      if (error.code === "steer-unavailable" && context.itemId) {
        throw new SessionRpcServiceError(
          "steer-unavailable",
          "The current turn no longer accepts this queued item as steering.",
          { itemId: context.itemId },
          { cause: error },
        );
      }
      if (error.code === "prompt-rejected") {
        throw new SessionRpcServiceError(
          "command-error",
          "The prompt command was rejected.",
          {},
          { cause: error },
        );
      }
      if (error.code === "image-input-unsupported") {
        throw new SessionRpcServiceError(
          "attachment-error",
          "The current model does not support image input.",
          { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" },
          { cause: error },
        );
      }
    }
    if (
      error instanceof PiSessionHistoryServiceError &&
      error.code === "session-not-found" &&
      context.sessionId
    ) {
      throw new SessionRpcServiceError(
        "session-not-found",
        "The session does not exist.",
        { sessionId: context.sessionId },
        { cause: error },
      );
    }
    if (error instanceof PiSessionModelContextServiceError) {
      if (error.code === "session-not-found" && context.sessionId) {
        throw new SessionRpcServiceError(
          "session-not-found",
          "The session does not exist.",
          { sessionId: context.sessionId },
          { cause: error },
        );
      }
      if (error.code === "model-unavailable") {
        throw new SessionRpcServiceError(
          "model-unavailable",
          "The requested model or reasoning effort is unavailable.",
          error.details,
          { cause: error },
        );
      }
      if (error.code === "busy") {
        throw new SessionRpcServiceError(
          "agent-busy",
          "The session agent is busy.",
          { reason: "The active agent cannot accept this operation." },
          { cause: error },
        );
      }
      if (error.code === "compaction-unavailable" && context.sessionId) {
        const message =
          error.details.reason === "context-too-small"
            ? "The session does not contain enough older context to compact."
            : error.details.reason === "already-compacted"
              ? "The current session context has already been compacted."
              : "The context compaction was cancelled.";
        throw new SessionRpcServiceError(
          "compaction-unavailable",
          message,
          { sessionId: context.sessionId, reason: error.details.reason },
          { cause: error },
        );
      }
    }
    throw new SessionRpcServiceError(
      "internal",
      "The session operation failed.",
      {},
      {
        cause: error,
      },
    );
  }

  private async allThreads(): Promise<readonly AgentThreadSummary[]> {
    try {
      return await this.threads.list();
    } catch (error) {
      this.translate(error);
    }
  }

  private async requireSession(sessionId: string): Promise<AgentThreadSummary> {
    nonEmpty(sessionId, "sessionId");
    const summary = (await this.allThreads()).find((item) => item.threadId === sessionId);
    if (summary) return summary;
    const scratch = await this.scratchStore?.get(sessionId);
    if (!scratch) {
      throw new SessionRpcServiceError("session-not-found", "The session does not exist.", {
        sessionId,
      });
    }
    return scratch.summary;
  }

  private async requireScratch(sessionId: string): Promise<SessionRpcScratchRecord> {
    nonEmpty(sessionId, "sessionId");
    const scratch = await this.scratchStore?.get(sessionId);
    if (!scratch) {
      throw new SessionRpcServiceError("session-not-found", "The scratch session does not exist.", {
        sessionId,
      });
    }
    return scratch;
  }

  private async serializeRequestedCreate<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.sessionCreateTails.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.sessionCreateTails.set(sessionId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.sessionCreateTails.get(sessionId) === tail) {
        this.sessionCreateTails.delete(sessionId);
      }
    }
  }

  async list(_input: SessionListInput = {}): Promise<SessionListValue> {
    const [threads, scratchRunningSessionIds] = await Promise.all([
      this.allThreads(),
      this.scratchStore?.runningSessionIds?.() ?? Promise.resolve([]),
    ]);
    return {
      items: threads.map((thread) => ({
        sessionId: thread.threadId,
        updatedAt: milliseconds(thread.updatedAt),
        running: thread.running,
        waitingForUserInput: thread.waitingForUserInput === true,
        ...(thread.runTiming === undefined ? {} : { runTiming: thread.runTiming }),
        blank: thread.messageCount === 0,
        ...(thread.rootPath ? { cwd: thread.rootPath } : {}),
        projections: {
          asOfSeq: -1,
          values: { [WORKBENCH_SESSION_SUMMARY_PROJECTION]: piSessionSummary(thread) },
        },
      })),
      ...(scratchRunningSessionIds.length > 0
        ? { runningSessionIds: [...scratchRunningSessionIds] }
        : {}),
    };
  }

  async search(input: SessionSearchInput): Promise<SessionSearchValue> {
    const query = input.query.trim();
    if (
      codePointLength(query) < 1 ||
      codePointLength(query) > MAX_SEARCH_QUERY_CODE_POINTS ||
      query.includes("\0")
    ) {
      throw badRequest([
        issue(
          ["query"],
          "query must contain 1 to 500 Unicode code points after trimming and must not contain NUL.",
        ),
      ]);
    }

    const foldedQuery = query.toLocaleLowerCase("en-US");
    let persistedSearchText: ReadonlyArray<{ threadId: string; text: string }>;
    const search = this.threads.search;
    if (!search) {
      this.translate(new AgentThreadStoreError("unsupported", "Thread search is not supported."), {
        capability: "thread-search",
      });
    }
    try {
      persistedSearchText = await search.listDocuments();
    } catch (error) {
      this.translate(error, { capability: "thread-search" });
    }
    const searchTextBySessionId = new Map(
      persistedSearchText.map(({ threadId, text }) => [threadId, text]),
    );
    const matches: SessionSearchValue["items"] = [];
    for (const thread of await this.allThreads()) {
      let allMessagesText = searchTextBySessionId.get(thread.threadId);
      if (allMessagesText === undefined) {
        try {
          allMessagesText = await this.historyService.searchText(thread.threadId);
        } catch (error) {
          if (error instanceof PiSessionHistoryServiceError && error.code === "session-not-found") {
            continue;
          }
          this.translate(error, { sessionId: thread.threadId });
        }
      }
      const candidates = [
        allMessagesText,
        thread.title,
        thread.firstMessage,
        thread.rootPath,
        thread.threadId,
      ].filter((value): value is string => Boolean(value));
      let snippet: string | undefined;
      for (const candidate of candidates) {
        const match = findCaseInsensitiveMatch(candidate, foldedQuery);
        if (match === undefined) continue;
        snippet = snippetAroundMatch(candidate, match);
        break;
      }
      if (snippet === undefined) continue;
      matches.push({ sessionId: thread.threadId, snippet });
      if (matches.length > MAX_SEARCH_RESULTS) break;
    }
    return {
      items: matches.slice(0, MAX_SEARCH_RESULTS),
      hasMore: matches.length > MAX_SEARCH_RESULTS,
    };
  }

  async create(input: SessionCreateInput): Promise<SessionCreateValue> {
    if (input.workspaceId !== undefined && input.cwd !== undefined) {
      throw badRequest([
        issue(["workspaceId"], "workspaceId and cwd are mutually exclusive."),
        issue(["cwd"], "workspaceId and cwd are mutually exclusive."),
      ]);
    }
    if (input.workspaceId !== undefined) nonEmpty(input.workspaceId, "workspaceId");
    if (input.sessionId !== undefined) nonEmpty(input.sessionId, "sessionId");

    if (input.sessionId !== undefined) {
      return this.serializeRequestedCreate(input.sessionId, () => this.createResolved(input));
    }
    return this.createResolved(input);
  }

  private async createResolved(input: SessionCreateInput): Promise<SessionCreateValue> {
    let cwd = input.cwd ?? this.defaultCwd;
    if (input.workspaceId !== undefined) {
      let workspaces: { items: WorkspaceView[] };
      try {
        workspaces = await this.workspaceStore.list();
      } catch (error) {
        this.translate(error);
      }
      const workspace = workspaces.items.find((item) => item.workspaceId === input.workspaceId);
      if (!workspace) {
        throw new SessionRpcServiceError("workspace-not-found", "The workspace does not exist.", {
          workspaceId: input.workspaceId,
        });
      }
      cwd = workspace.path;
    }

    const existing = input.sessionId
      ? (await this.allThreads()).find((item) => item.threadId === input.sessionId)
      : undefined;
    if (input.sessionId !== undefined && !this.threads.capabilities.requestedThreadId) {
      throw new SessionRpcServiceError(
        "session-conflict",
        "The requested session identifier cannot be allocated.",
        {
          sessionId: input.sessionId,
          requestedCwd: cwd,
          ...(existing?.rootPath ? { existingCwd: existing.rootPath } : {}),
        },
      );
    }
    if (input.agentPreset !== undefined && !this.threads.capabilities.preset) {
      throw new SessionRpcServiceError(
        "agent-preset-invalid",
        "This host does not support selecting an agent preset at session creation time.",
        {
          agentPreset: input.agentPreset,
          reason: "Agent preset selection is not supported by the active session engine.",
        },
      );
    }

    if (existing && input.sessionId !== undefined) {
      const requestedCwd = workspaceFromCwd(cwd).cwd;
      const existingCwd = existing.rootPath ? workspaceFromCwd(existing.rootPath).cwd : undefined;
      if (existingCwd !== requestedCwd) {
        throw new SessionRpcServiceError(
          "session-conflict",
          "The requested session identifier already belongs to another working directory.",
          {
            sessionId: input.sessionId,
            requestedCwd,
            ...(existingCwd === undefined ? {} : { existingCwd }),
          },
        );
      }
      if (input.workspaceId !== undefined) {
        await this.attachToWorkspace(input.workspaceId, existing.threadId);
      }
      return { sessionId: existing.threadId };
    }

    let created: Awaited<ReturnType<AgentThreadStorePort["create"]>>;
    try {
      created = await this.threads.create({
        rootPath: cwd,
        ...(input.sessionId ? { requestedThreadId: input.sessionId } : {}),
        ...(input.agentPreset !== undefined ? { preset: input.agentPreset } : {}),
      });
    } catch (error) {
      this.translate(error, { cwd, sessionId: input.sessionId });
    }
    if (!created.threadId.trim()) {
      this.translate(new Error("The session engine returned an empty id."));
    }
    if (input.sessionId && created.threadId !== input.sessionId) {
      throw new SessionRpcServiceError(
        "session-conflict",
        "The requested session identifier was not allocated.",
        { sessionId: input.sessionId, requestedCwd: cwd },
      );
    }

    if (input.workspaceId !== undefined) {
      await this.attachToWorkspace(input.workspaceId, created.threadId);
    }

    return {
      sessionId: created.threadId,
      ...(created.preset !== undefined ? { agentPreset: created.preset } : {}),
    };
  }

  private async attachToWorkspace(workspaceId: string, sessionId: string): Promise<void> {
    let attached: { workspace: WorkspaceView };
    try {
      attached = await this.workspaceStore.attachSession(workspaceId, sessionId);
    } catch (error) {
      throw new SessionRpcServiceError(
        "workspace-attach-failed",
        "The session was created but could not be attached to the workspace.",
        { sessionId, workspaceId },
        { cause: error },
      );
    }
    if (!attached.workspace.sessionIds.includes(sessionId)) {
      throw new SessionRpcServiceError(
        "workspace-attach-failed",
        "The session was created but could not be attached to the workspace.",
        { sessionId, workspaceId },
      );
    }
  }

  async history(input: SessionHistoryInput): Promise<SessionHistoryValue> {
    nonEmpty(input.sessionId, "sessionId");
    if (
      input.beforeSeq !== undefined &&
      (!Number.isInteger(input.beforeSeq) || input.beforeSeq < 0)
    ) {
      throw badRequest([
        issue(["beforeSeq"], "beforeSeq must be an integer greater than or equal to 0."),
      ]);
    }
    if (
      input.maxMessages !== undefined &&
      (!Number.isInteger(input.maxMessages) || input.maxMessages <= 0)
    ) {
      throw badRequest([issue(["maxMessages"], "maxMessages must be a positive integer.")]);
    }

    try {
      return await this.historyService.page({
        sessionId: input.sessionId,
        ...(input.beforeSeq === undefined ? {} : { beforeSeq: input.beforeSeq }),
        maxMessages: input.maxMessages ?? DEFAULT_HISTORY_MESSAGES,
      });
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
  }

  async regenerate(input: SessionRegenerateInput): Promise<SessionRegenerateValue> {
    nonEmpty(input.sessionId, "sessionId");
    nonEmpty(input.messageId, "messageId");
    const regeneration = this.execution.regeneration;
    if (!regeneration) {
      this.translate(
        new AgentExecutionError("unsupported", "Prompt regeneration is not supported."),
        { sessionId: input.sessionId, capability: "regeneration" },
      );
    }
    try {
      await regeneration.regenerate({
        threadId: input.sessionId,
        userMessageId: input.messageId,
        ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      });
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId, capability: "regeneration" });
    }
    return { accepted: true };
  }

  async resume(input: SessionResumeInput): Promise<SessionResumeValue> {
    nonEmpty(input.sessionId, "sessionId");
    nonEmpty(input.checkpointId, "checkpointId");
    nonEmpty(input.expectedLeafId, "expectedLeafId");
    const resume = this.execution.resume;
    if (!resume) {
      this.translate(new AgentExecutionError("unsupported", "Run recovery is not supported."), {
        sessionId: input.sessionId,
        capability: "resume",
      });
    }
    try {
      await resume.resume({
        threadId: input.sessionId,
        checkpointId: input.checkpointId,
        expectedStateToken: input.expectedLeafId,
      });
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId, capability: "resume" });
    }
    return { accepted: true };
  }

  async selectBranch(input: SessionSelectBranchInput): Promise<SessionSelectBranchValue> {
    nonEmpty(input.sessionId, "sessionId");
    nonEmpty(input.leafId, "leafId");
    const branches = this.execution.branches;
    if (!branches) {
      this.translate(new AgentExecutionError("unsupported", "Branch selection is not supported."), {
        sessionId: input.sessionId,
        capability: "branch-selection",
      });
    }
    try {
      await branches.select({ threadId: input.sessionId, branchToken: input.leafId });
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId, capability: "branch-selection" });
    }
    return { selected: true };
  }

  async models(input: SessionModelsInput): Promise<SessionModelsValue> {
    const summary = await this.requireSession(input.sessionId);
    try {
      return await this.modelContextService.models({
        sessionId: input.sessionId,
        cwd: summary.rootPath,
      });
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
  }

  async selectModel(input: SessionSelectModelInput): Promise<SessionSelectModelValue> {
    nonEmpty(input.provider, "provider");
    nonEmpty(input.model, "model");
    if (input.reasoningEffort !== undefined) nonEmpty(input.reasoningEffort, "reasoningEffort");
    const summary = await this.requireSession(input.sessionId);
    let selected: SessionSelectModelValue["selected"];
    try {
      selected = await this.modelContextService.selectModel({
        sessionId: input.sessionId,
        cwd: summary.rootPath,
        selection: {
          provider: input.provider,
          model: input.model,
          ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
        },
      });
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    return { selected };
  }

  async contextPolicy(input: SessionContextPolicyInput): Promise<SessionContextPolicyValue> {
    await this.requireSession(input.sessionId);
    try {
      return await this.modelContextService.contextPolicy(input.sessionId);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
  }

  async updateContextPolicy(
    input: SessionContextPolicyUpdateInput,
  ): Promise<SessionContextPolicyValue> {
    await this.requireSession(input.sessionId);
    try {
      return await this.modelContextService.updateContextPolicy(input.sessionId, input.policy);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
  }

  async compactContext(input: SessionContextPolicyInput): Promise<SessionCompactValue> {
    await this.requireSession(input.sessionId);
    try {
      return await this.modelContextService.compactContext(input.sessionId);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
  }

  async rename(input: SessionRenameInput): Promise<SessionRenameValue> {
    await this.requireSession(input.sessionId);
    const title = input.title.trim();
    if (!title) {
      throw new SessionRpcServiceError("title-invalid", "The session title is invalid.", {
        sessionId: input.sessionId,
      });
    }
    let seq: number | undefined;
    try {
      const stateToken = (await this.threads.rename({ threadId: input.sessionId, title }))
        .stateToken;
      seq = stateToken === undefined ? undefined : piEventRevisionFromStateToken(stateToken);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    if (!Number.isInteger(seq) || (seq ?? -1) < 0) {
      try {
        seq = await this.historyService.latestEventRevision(input.sessionId);
      } catch (error) {
        this.translate(error, { sessionId: input.sessionId });
      }
    }
    if (!Number.isInteger(seq) || (seq ?? -1) < 0) {
      this.translate(new Error("The rename operation did not produce a canonical session event."), {
        sessionId: input.sessionId,
      });
    }
    return { title, seq: seq as number };
  }

  async delete(input: SessionDeleteInput): Promise<SessionDeleteValue> {
    await this.requireSession(input.sessionId);
    try {
      await this.threads.delete({ threadId: input.sessionId });
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    return { deleted: true };
  }

  async fork(input: SessionForkInput): Promise<SessionForkValue> {
    if (input.atSeq !== undefined && (!Number.isSafeInteger(input.atSeq) || input.atSeq < 0)) {
      throw badRequest([issue(["atSeq"], "atSeq must be an integer greater than or equal to 0.")]);
    }
    const source = await this.requireSession(input.sessionId);
    let sourceWorkspace: WorkspaceView | undefined;
    try {
      sourceWorkspace = (await this.workspaceStore.list()).items.find((workspace) =>
        workspace.sessionIds.includes(source.threadId),
      );
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }

    const fork = this.threads.fork;
    if (!fork) {
      this.translate(new AgentThreadStoreError("unsupported", "Thread fork is not supported."), {
        sessionId: input.sessionId,
        capability: "fork",
      });
    }
    let forked: { threadId: string };
    try {
      forked = await fork.fork({
        threadId: input.sessionId,
        ...(input.atSeq === undefined ? {} : { atStateToken: String(input.atSeq) }),
      });
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId, capability: "fork" });
    }
    if (!forked.threadId.trim() || forked.threadId === input.sessionId) {
      this.translate(new Error("The session engine did not return an independent fork."), {
        sessionId: input.sessionId,
      });
    }
    if (sourceWorkspace) {
      await this.attachToWorkspace(sourceWorkspace.workspaceId, forked.threadId);
    }
    return { sessionId: forked.threadId };
  }

  async scratchCreate(input: SessionScratchCreateInput): Promise<SessionScratchCreateValue> {
    if (input.atSeq !== undefined && (!Number.isInteger(input.atSeq) || input.atSeq < 0)) {
      throw badRequest([issue(["atSeq"], "atSeq must be an integer greater than or equal to 0.")]);
    }
    const source = await this.requireSession(input.sourceSessionId);
    if (!this.scratchStore) this.translate(new Error("Scratch sessions are unavailable."));

    let workspaceId: string | undefined;
    try {
      workspaceId = (await this.workspaceStore.list()).items.find((workspace) =>
        workspace.sessionIds.includes(source.threadId),
      )?.workspaceId;
      workspaceId ??= (await this.scratchStore.get(source.threadId))?.workspaceId;
    } catch (error) {
      this.translate(error, { sessionId: input.sourceSessionId });
    }

    let created: SessionRpcScratchRecord;
    try {
      created = await this.scratchStore.create({
        sourceSessionId: input.sourceSessionId,
        ...(input.atSeq === undefined ? {} : { atEventRevision: input.atSeq }),
        ...(workspaceId ? { workspaceId } : {}),
      });
    } catch (error) {
      this.translate(error, { sessionId: input.sourceSessionId });
    }
    return {
      sessionId: created.summary.threadId,
      sourceSessionId: created.sourceSessionId,
      expiresAt: created.expiresAt,
    };
  }

  async scratchRelease(input: SessionScratchReleaseInput): Promise<SessionScratchReleaseValue> {
    await this.requireScratch(input.sessionId);
    try {
      await this.scratchStore?.release(input.sessionId);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    return { released: true };
  }

  async scratchPromote(input: SessionScratchPromoteInput): Promise<SessionScratchPromoteValue> {
    const scratch = await this.requireScratch(input.sessionId);
    const title = input.title?.trim();
    if (input.title !== undefined && !title) {
      throw new SessionRpcServiceError("title-invalid", "The session title is invalid.", {
        sessionId: input.sessionId,
      });
    }
    let promoted: Awaited<ReturnType<SessionRpcScratchStore["promote"]>>;
    try {
      promoted = await this.scratchStore!.promote(input.sessionId, title);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    const workspaceId = promoted.workspaceId ?? scratch.workspaceId;
    if (workspaceId) await this.attachToWorkspace(workspaceId, promoted.summary.threadId);
    return {
      sessionId: promoted.summary.threadId,
      sourceSessionId: promoted.sourceSessionId,
    };
  }

  async prompt(
    input: SessionPromptInput,
    context: Readonly<{ rpcId?: string }> = {},
  ): Promise<SessionPromptValue> {
    const clientTimeZone =
      input.clientTimeZone === undefined ? undefined : canonicalTimeZone(input.clientTimeZone);
    if (input.clientTimeZone !== undefined && clientTimeZone === undefined) {
      throw new SessionRpcServiceError("invalid-time-zone", "The client time zone is invalid.", {
        value: input.clientTimeZone,
      });
    }
    await this.requireSession(input.sessionId);
    const message = input.content
      .filter(
        (part): part is Extract<SessionPromptContent, { type: "text" }> => part.type === "text",
      )
      .map((part) => part.text)
      .join("\n\n");
    const attachments = admitSessionInlineAttachments(
      input.content.filter(
        (part): part is Extract<SessionPromptContent, { type: "image" | "file" }> =>
          part.type === "image" || part.type === "file",
      ),
    );
    const composerHasSemantics = Boolean(
      input.composer && hasWorkbenchComposerSemantics(input.composer),
    );
    if (input.composer && !composerDocumentMatchesCommands(input.composer)) {
      throw new SessionRpcServiceError(
        "command-error",
        "The Composer document does not match its command projection.",
        {},
      );
    }
    if (
      !message.trim() &&
      attachments.images.length === 0 &&
      attachments.documents.length === 0 &&
      !composerHasSemantics
    ) {
      throw new SessionRpcServiceError("command-error", "The prompt has no content.", {});
    }
    const executionAttachments = [
      ...attachments.images.map((image) => ({
        kind: "image" as const,
        data: image.data,
        mediaType: image.mimeType,
        ...(image.name === undefined ? {} : { name: image.name }),
      })),
      ...attachments.documents.map((document) => ({
        kind: "document" as const,
        data: document.data,
        mediaType: document.mimeType,
        ...(document.name === undefined ? {} : { name: document.name }),
      })),
    ];
    let admission: Awaited<ReturnType<AgentExecutionPort["submit"]>>;
    try {
      admission = await this.execution.submit({
        threadId: input.sessionId,
        mode: input.mode === "steer" ? "steer" : "follow-up",
        prompt: {
          text: message,
          attachments: executionAttachments,
          ...(input.composer === undefined ? {} : { composer: input.composer }),
        },
        provenance: {
          ...(context.rpcId === undefined ? {} : { requestId: context.rpcId }),
          ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
        },
      });
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    return {
      accepted: true,
      queued: admission.kind === "queued",
      ...(admission.kind === "queued" && admission.queueItemId !== undefined
        ? { queueItemId: admission.queueItemId }
        : {}),
    };
  }

  async attachment(input: SessionAttachmentInput): Promise<SessionAttachmentValue> {
    nonEmpty(input.attachmentId, "attachmentId");
    await this.requireSession(input.sessionId);
    throw new SessionRpcServiceError(
      "attachment-error",
      "The active session engine does not expose persisted attachments by identifier.",
      { reason: "PERSISTED_ATTACHMENT_UNAVAILABLE" },
    );
  }

  async updateQueue(input: SessionUpdateQueueInput): Promise<SessionUpdateQueueValue> {
    nonEmpty(input.itemId, "itemId");
    await this.requireSession(input.sessionId);
    let mutation: AgentQueueMutation;
    if (input.action.kind === "edit") {
      if (
        input.action.content.some((part) => part.type !== "text" || typeof part.text !== "string")
      ) {
        throw new SessionRpcServiceError(
          "attachment-error",
          "Queue edits accept text content only.",
          { reason: "QUEUE_EDIT_NON_TEXT" },
        );
      }
      mutation = {
        kind: "edit",
        text: input.action.content
          .map((part) => (typeof part.text === "string" ? part.text : ""))
          .join(""),
      };
    } else {
      mutation = input.action;
    }
    const queue = this.execution.queue;
    if (!queue) {
      this.translate(new AgentExecutionError("unsupported", "Queue mutation is not supported."), {
        sessionId: input.sessionId,
        itemId: input.itemId,
        capability: "queue-mutation",
      });
    }
    try {
      await queue.update({
        threadId: input.sessionId,
        itemId: input.itemId,
        mutation,
      });
    } catch (error) {
      this.translate(error, {
        sessionId: input.sessionId,
        itemId: input.itemId,
        capability: "queue-mutation",
      });
    }
    return { accepted: true };
  }

  async cancel(input: SessionCancelInput): Promise<SessionCancelValue> {
    await this.requireSession(input.sessionId);
    try {
      await this.execution.cancel({ threadId: input.sessionId });
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    return { accepted: true };
  }
}
