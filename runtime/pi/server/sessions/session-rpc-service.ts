import {
  PI_THINKING_LEVELS,
  type PiAgentMessage,
  type PiModelListResponse,
  type PiQueuedPrompt,
  type PiSessionHistory,
  type PiSessionSummary,
  type PiThinkingLevel,
} from "../../contracts";
import type { SessionAttachmentErrorReason } from "../../attachment-contracts";
import type {
  ModelCatalogFailure,
  ModelProviderGroup,
  ModelSelection,
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
  SessionEvent,
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
  SessionUpdateQueuePayload,
  SessionUpdateQueueValue,
  WorkspaceView,
} from "../../rpc-contracts";
import {
  composerDocumentMatchesCommands,
  hasWorkbenchComposerSemantics,
  type WorkbenchComposerSubmission,
} from "../../../composer-request";
import { ModelService } from "../models/model-service";
import {
  cancelSession,
  compactSessionContext,
  createSession,
  deleteSession,
  forkSession,
  getSessionEventBranches,
  getSessionEvents,
  getSessionHistory,
  getSessionResumeState,
  getSessionContextPolicy,
  listModels,
  listSessionSearchText,
  listSessions,
  type PromptSubmissionResult,
  renameSession,
  regenerateSession,
  resumeSession,
  selectSessionBranch,
  selectSessionModel,
  submitPrompt,
  updateSessionContextPolicy,
  updatePromptQueueItem,
} from "./session-registry";
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
  SessionUpdateQueueValue,
} from "../../rpc-contracts";

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
  internal: Record<string, never>;
}

export type SessionRpcServiceErrorCode = keyof SessionRpcServiceErrorDetails;

export class SessionRpcServiceError<
  Code extends SessionRpcServiceErrorCode = SessionRpcServiceErrorCode,
> extends Error {
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

export interface SessionEngineCreateInput {
  cwd: string;
  sessionId?: string;
  agentPreset?: string;
}

export interface SessionEngineCreateResult {
  id: string;
  agentPreset?: string;
}

export interface SessionPromptProvenance {
  rpcId?: string;
  clientTimeZone?: string;
  composer?: WorkbenchComposerSubmission;
}

export interface SessionRpcDependencies {
  listSessions(): Promise<{ sessions: PiSessionSummary[]; runningSessionIds: string[] }>;
  listSessionSearchText(): Promise<Array<{ sessionId: string; allMessagesText: string }>>;
  createSession(input: SessionEngineCreateInput): Promise<SessionEngineCreateResult>;
  deleteSession(sessionId: string): Promise<void>;
  forkSession(sessionId: string, atSeq?: number): Promise<{ id: string }>;
  getSessionEventBranches(sessionId: string): Promise<SessionHistoryValue["branches"]>;
  getSessionEvents(sessionId: string): Promise<SessionEvent[]>;
  getSessionHistory(sessionId: string): Promise<PiSessionHistory>;
  getSessionResumeState(sessionId: string): Promise<SessionHistoryValue["resume"]>;
  listModels(cwd: string): Promise<PiModelListResponse>;
  renameSession(sessionId: string, title: string): Promise<number | void>;
  regenerateSession(sessionId: string, messageId: string): Promise<void>;
  resumeSession(sessionId: string, checkpointId: string, expectedLeafId: string): Promise<void>;
  selectSessionBranch(sessionId: string, leafId: string): Promise<void>;
  submitPrompt(
    sessionId: string,
    mode: "steer" | "followUp",
    prompt: PiQueuedPrompt,
    provenance?: SessionPromptProvenance,
  ): Promise<PromptSubmissionResult>;
  updateQueueItem(
    sessionId: string,
    itemId: string,
    mutation: { kind: "edit"; prompt: PiQueuedPrompt } | { kind: "remove" } | { kind: "steer" },
  ): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
  selectSessionModel(sessionId: string, selection: ModelSelection): Promise<void>;
  getSessionContextPolicy(sessionId: string): Promise<SessionContextPolicyValue>;
  updateSessionContextPolicy(
    sessionId: string,
    policy: SessionContextPolicyUpdatePayload["policy"],
  ): Promise<SessionContextPolicyValue>;
  compactSessionContext(sessionId: string): Promise<SessionCompactValue>;
  supportsRequestedSessionId: boolean;
  supportsAgentPreset: boolean;
}

export interface SessionModelCatalogService {
  models(): Promise<{ groups: ModelProviderGroup[]; failures: ModelCatalogFailure[] }>;
}

export interface SessionRpcServiceOptions {
  workspaceStore: SessionRpcWorkspaceStore;
  dependencies?: Partial<SessionRpcDependencies>;
  modelServiceFactory?: (cwd: string) => SessionModelCatalogService;
  defaultCwd?: string;
}

interface ErrorContext {
  sessionId?: string;
  provider?: string;
  model?: string;
  cwd?: string;
  itemId?: string;
  operation?: "compact";
}

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

function codePointLength(value: string): number {
  return [...value].length;
}

function textContent(message: PiAgentMessage): string {
  if (message.role !== "user" && message.role !== "assistant") return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
    .join("\n");
}

function historySearchText(history: PiSessionHistory): string {
  return history.context.messages.map(textContent).filter(Boolean).join(" ");
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

function paginateSessionEvents(
  events: readonly SessionEvent[],
  beforeSeq: number | undefined,
  maxMessages: number,
): { events: SessionEvent[]; hasMore: boolean } {
  const window =
    beforeSeq === undefined ? [...events] : events.filter((event) => event.seq < beforeSeq);
  let messageCount = 0;
  let unmatchedMessageEnds = 0;
  let targetEndDepth: number | undefined;
  let cut = 0;

  for (let index = window.length - 1; index >= 0; index -= 1) {
    const event = window[index]!;
    if (event.type === "message") {
      messageCount += 1;
      if (messageCount >= maxMessages) {
        cut = index;
        break;
      }
      continue;
    }
    if (event.type === "message_end") {
      unmatchedMessageEnds += 1;
      messageCount += 1;
      if (messageCount >= maxMessages && targetEndDepth === undefined) {
        targetEndDepth = unmatchedMessageEnds;
      }
      continue;
    }
    if (event.type !== "message_start") continue;
    if (unmatchedMessageEnds > 0) {
      if (targetEndDepth === unmatchedMessageEnds) {
        cut = index;
        break;
      }
      unmatchedMessageEnds -= 1;
      continue;
    }

    // The tail of an in-progress group, or an explicit beforeSeq inside a group,
    // has no message_end in this window. Its message_start still owns the group.
    messageCount += 1;
    if (messageCount >= maxMessages) {
      cut = index;
      break;
    }
  }

  return { events: window.slice(cut), hasMore: cut > 0 };
}

function milliseconds(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isThinkingLevel(value: string): value is PiThinkingLevel {
  return (PI_THINKING_LEVELS as readonly string[]).includes(value);
}

function canonicalTimeZone(value: string): string | undefined {
  if (value !== value.trim() || (value !== "UTC" && !value.includes("/"))) return undefined;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function errorExistingCwd(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("existingCwd" in error)) return undefined;
  return typeof error.existingCwd === "string" ? error.existingCwd : undefined;
}

function manualCompactionUnavailableReason(
  error: unknown,
): SessionRpcServiceErrorDetails["compaction-unavailable"]["reason"] | undefined {
  if (!(error instanceof Error)) return undefined;

  // Pi 0.84 exposes these expected manual-compaction outcomes as plain Errors rather than a
  // public typed error. Normalize them at the server adapter boundary so browser code never has
  // to parse SDK-owned English messages.
  if (error.name === "AbortError" || error.message === "Compaction cancelled") return "cancelled";
  if (error.message === "Already compacted") return "already-compacted";
  if (error.message === "Nothing to compact (session too small)") return "context-too-small";
  return undefined;
}

function defaultDependencies(): SessionRpcDependencies {
  return {
    listSessions,
    listSessionSearchText,
    createSession: async ({ cwd, sessionId }) => {
      const hosted = await createSession(cwd, sessionId);
      return { id: hosted.id };
    },
    deleteSession,
    forkSession: async (sessionId, atSeq) => {
      const hosted = await forkSession(sessionId, atSeq);
      return { id: hosted.id };
    },
    getSessionEventBranches,
    getSessionEvents,
    getSessionHistory,
    getSessionResumeState,
    getSessionContextPolicy,
    listModels,
    renameSession,
    regenerateSession,
    resumeSession,
    selectSessionBranch,
    submitPrompt,
    updateQueueItem: updatePromptQueueItem,
    cancelSession,
    compactSessionContext,
    selectSessionModel,
    updateSessionContextPolicy,
    supportsRequestedSessionId: true,
    supportsAgentPreset: false,
  };
}

export class SessionRpcService {
  private readonly workspaceStore: SessionRpcWorkspaceStore;
  private readonly dependencies: SessionRpcDependencies;
  private readonly modelServiceFactory: (cwd: string) => SessionModelCatalogService;
  private readonly defaultCwd: string;
  private readonly sessionCreateTails = new Map<string, Promise<void>>();

  constructor(options: SessionRpcServiceOptions) {
    this.workspaceStore = options.workspaceStore;
    this.dependencies = { ...defaultDependencies(), ...options.dependencies };
    if (
      options.dependencies?.getSessionEvents &&
      options.dependencies.getSessionEventBranches === undefined
    ) {
      // Tests and alternate engines that replace the linear event source remain compatible until
      // they opt into branch discovery explicitly.
      this.dependencies.getSessionEventBranches = async () => ({ headLeafId: null, items: [] });
    }
    if (
      options.dependencies?.getSessionEvents &&
      options.dependencies.getSessionResumeState === undefined
    ) {
      this.dependencies.getSessionResumeState = async () => ({});
    }
    this.modelServiceFactory = options.modelServiceFactory ?? ((cwd) => new ModelService({ cwd }));
    this.defaultCwd = options.defaultCwd ?? process.cwd();
  }

  private translate(error: unknown, context: ErrorContext = {}): never {
    if (error instanceof SessionRpcServiceError) throw error;
    const code = errorCode(error);
    const compactionUnavailableReason =
      context.operation === "compact" ? manualCompactionUnavailableReason(error) : undefined;
    if (compactionUnavailableReason && context.sessionId) {
      const message =
        compactionUnavailableReason === "context-too-small"
          ? "The session does not contain enough older context to compact."
          : compactionUnavailableReason === "already-compacted"
            ? "The current session context has already been compacted."
            : "The context compaction was cancelled.";
      throw new SessionRpcServiceError(
        "compaction-unavailable",
        message,
        { sessionId: context.sessionId, reason: compactionUnavailableReason },
        { cause: error },
      );
    }
    if (code === "pi_session_not_found" && context.sessionId) {
      throw new SessionRpcServiceError(
        "session-not-found",
        "The session does not exist.",
        { sessionId: context.sessionId },
        { cause: error },
      );
    }
    if (code === "pi_model_not_available" && context.provider && context.model) {
      throw new SessionRpcServiceError(
        "model-unavailable",
        "The requested model is unavailable.",
        { provider: context.provider, model: context.model },
        { cause: error },
      );
    }
    if (code === "pi_model_image_unsupported") {
      if (context.provider && context.model) {
        throw new SessionRpcServiceError(
          "model-unavailable",
          "The requested model cannot represent images already attached to this session.",
          { provider: context.provider, model: context.model },
          { cause: error },
        );
      }
      throw new SessionRpcServiceError(
        "attachment-error",
        "The current model does not support image input.",
        { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" },
        { cause: error },
      );
    }
    if (code === "pi_session_conflict" && context.sessionId && context.cwd !== undefined) {
      const existingCwd = errorExistingCwd(error);
      throw new SessionRpcServiceError(
        "session-conflict",
        "The requested session identifier already belongs to another working directory.",
        {
          sessionId: context.sessionId,
          requestedCwd: context.cwd,
          ...(existingCwd === undefined ? {} : { existingCwd }),
        },
        { cause: error },
      );
    }
    if (code === "pi_session_busy") {
      throw new SessionRpcServiceError(
        "agent-busy",
        "The session agent is busy.",
        { reason: "The active agent cannot accept this prompt." },
        { cause: error },
      );
    }
    if (code === "pi_fork_unavailable" && context.sessionId) {
      throw new SessionRpcServiceError(
        "fork-unavailable",
        "The session cannot be forked at the requested protocol boundary.",
        { sessionId: context.sessionId },
        { cause: error },
      );
    }
    if (code === "pi_branch_not_found" && context.sessionId) {
      throw new SessionRpcServiceError(
        "branch-not-found",
        "The requested conversation branch does not exist.",
        { sessionId: context.sessionId },
        { cause: error },
      );
    }
    if (code === "pi_resume_stale" && context.sessionId) {
      throw new SessionRpcServiceError(
        "resume-unavailable",
        "The recovery checkpoint is no longer on the selected branch.",
        { sessionId: context.sessionId, reason: "stale" },
        { cause: error },
      );
    }
    if (code === "pi_resume_confirmation_required" && context.sessionId) {
      throw new SessionRpcServiceError(
        "resume-unavailable",
        "The interrupted tool state requires confirmation before it can be resumed.",
        { sessionId: context.sessionId, reason: "confirmation-required" },
        { cause: error },
      );
    }
    if (code === "pi_resume_unavailable" && context.sessionId) {
      throw new SessionRpcServiceError(
        "resume-unavailable",
        "The recovery checkpoint cannot be resumed with the current model.",
        { sessionId: context.sessionId, reason: "blocked" },
        { cause: error },
      );
    }
    if (code === "pi_session_not_running" && context.itemId) {
      throw new SessionRpcServiceError(
        "steer-unavailable",
        "The queued item cannot steer an inactive session.",
        { itemId: context.itemId },
        { cause: error },
      );
    }
    if (code === "pi_queue_item_not_found" && context.itemId) {
      throw new SessionRpcServiceError(
        "queue-item-not-found",
        "The queued item is no longer pending.",
        { itemId: context.itemId },
        { cause: error },
      );
    }
    if (code === "pi_steer_unavailable" && context.itemId) {
      throw new SessionRpcServiceError(
        "steer-unavailable",
        "The current turn no longer accepts this queued item as steering.",
        { itemId: context.itemId },
        { cause: error },
      );
    }
    if (
      code === "pi_empty_prompt" ||
      code === "pi_prompt_rejected" ||
      code === "pi_command_not_found" ||
      code === "pi_composer_command_conflict" ||
      code === "pi_composer_command_args_invalid" ||
      code === "pi_skill_read_tool_unavailable"
    ) {
      throw new SessionRpcServiceError(
        "command-error",
        "The prompt command was rejected.",
        {},
        { cause: error },
      );
    }
    if (
      (code === "pi_workspace_path_required" ||
        code === "pi_workspace_not_directory" ||
        code === "pi_workspace_not_found") &&
      context.cwd !== undefined
    ) {
      throw new SessionRpcServiceError(
        "workspace-invalid-path",
        "The workspace path is invalid.",
        { path: context.cwd },
        { cause: error },
      );
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

  private async allSessions(): Promise<PiSessionSummary[]> {
    try {
      return (await this.dependencies.listSessions()).sessions;
    } catch (error) {
      this.translate(error);
    }
  }

  private async requireSession(sessionId: string): Promise<PiSessionSummary> {
    nonEmpty(sessionId, "sessionId");
    const summary = (await this.allSessions()).find((item) => item.id === sessionId);
    if (!summary) {
      throw new SessionRpcServiceError("session-not-found", "The session does not exist.", {
        sessionId,
      });
    }
    return summary;
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
    const sessions = await this.allSessions();
    return {
      items: sessions.map((session) => ({
        sessionId: session.id,
        updatedAt: milliseconds(session.modified),
        running: session.running,
        waitingForUserInput: session.waitingForUserInput === true,
        ...(session.runTiming === undefined ? {} : { runTiming: session.runTiming }),
        blank: session.messageCount === 0,
        ...(session.cwd ? { cwd: session.cwd } : {}),
        projections: {
          asOfSeq: -1,
          values: { [WORKBENCH_SESSION_SUMMARY_PROJECTION]: session },
        },
      })),
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
    let persistedSearchText: Array<{ sessionId: string; allMessagesText: string }>;
    try {
      persistedSearchText = await this.dependencies.listSessionSearchText();
    } catch (error) {
      this.translate(error);
    }
    const searchTextBySessionId = new Map(
      persistedSearchText.map(({ sessionId, allMessagesText }) => [sessionId, allMessagesText]),
    );
    const matches: SessionSearchValue["items"] = [];
    for (const session of await this.allSessions()) {
      let allMessagesText = searchTextBySessionId.get(session.id);
      if (allMessagesText === undefined) {
        try {
          allMessagesText = historySearchText(
            await this.dependencies.getSessionHistory(session.id),
          );
        } catch (error) {
          if (errorCode(error) === "pi_session_not_found") continue;
          this.translate(error, { sessionId: session.id });
        }
      }
      const candidates = [
        allMessagesText,
        session.name,
        session.firstMessage,
        session.cwd,
        session.id,
      ].filter((value): value is string => Boolean(value));
      let snippet: string | undefined;
      for (const candidate of candidates) {
        const match = findCaseInsensitiveMatch(candidate, foldedQuery);
        if (match === undefined) continue;
        snippet = snippetAroundMatch(candidate, match);
        break;
      }
      if (snippet === undefined) continue;
      matches.push({ sessionId: session.id, snippet });
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
      ? (await this.allSessions()).find((item) => item.id === input.sessionId)
      : undefined;
    if (input.sessionId !== undefined && !this.dependencies.supportsRequestedSessionId) {
      throw new SessionRpcServiceError(
        "session-conflict",
        "The requested session identifier cannot be allocated.",
        {
          sessionId: input.sessionId,
          requestedCwd: cwd,
          ...(existing?.cwd ? { existingCwd: existing.cwd } : {}),
        },
      );
    }
    if (input.agentPreset !== undefined && !this.dependencies.supportsAgentPreset) {
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
      const existingCwd = existing.cwd ? workspaceFromCwd(existing.cwd).cwd : undefined;
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
        await this.attachToWorkspace(input.workspaceId, existing.id);
      }
      return { sessionId: existing.id };
    }

    let created: SessionEngineCreateResult;
    try {
      created = await this.dependencies.createSession({
        cwd,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.agentPreset !== undefined ? { agentPreset: input.agentPreset } : {}),
      });
    } catch (error) {
      this.translate(error, { cwd, sessionId: input.sessionId });
    }
    if (!created.id.trim()) this.translate(new Error("The session engine returned an empty id."));
    if (input.sessionId && created.id !== input.sessionId) {
      throw new SessionRpcServiceError(
        "session-conflict",
        "The requested session identifier was not allocated.",
        { sessionId: input.sessionId, requestedCwd: cwd },
      );
    }

    if (input.workspaceId !== undefined) {
      await this.attachToWorkspace(input.workspaceId, created.id);
    }

    return {
      sessionId: created.id,
      ...(created.agentPreset !== undefined ? { agentPreset: created.agentPreset } : {}),
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

    let allEvents: SessionEvent[];
    try {
      allEvents = await this.dependencies.getSessionEvents(input.sessionId);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    const page = paginateSessionEvents(
      allEvents,
      input.beforeSeq,
      input.maxMessages ?? DEFAULT_HISTORY_MESSAGES,
    );
    const isTailPage = input.beforeSeq === undefined;
    let branches: SessionHistoryValue["branches"];
    let resume: SessionHistoryValue["resume"];
    if (isTailPage) {
      try {
        // Resume lookup may repair a legacy/HMR-retained session by appending a checkpoint.
        // Project branches afterwards so both projections observe the same durable leaf.
        resume = await this.dependencies.getSessionResumeState(input.sessionId);
        branches = await this.dependencies.getSessionEventBranches(input.sessionId);
      } catch (error) {
        this.translate(error, { sessionId: input.sessionId });
      }
    }
    return {
      events: page.events.map((event) => ({ event })),
      hasMore: page.hasMore,
      ...(isTailPage ? { projections: { asOfSeq: allEvents.at(-1)?.seq ?? -1, values: {} } } : {}),
      ...(branches?.items.length ? { branches } : {}),
      ...(isTailPage && resume?.checkpoint ? { resume } : {}),
    };
  }

  async regenerate(input: SessionRegenerateInput): Promise<SessionRegenerateValue> {
    nonEmpty(input.sessionId, "sessionId");
    nonEmpty(input.messageId, "messageId");
    try {
      await this.dependencies.regenerateSession(input.sessionId, input.messageId);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    return { accepted: true };
  }

  async resume(input: SessionResumeInput): Promise<SessionResumeValue> {
    nonEmpty(input.sessionId, "sessionId");
    nonEmpty(input.checkpointId, "checkpointId");
    nonEmpty(input.expectedLeafId, "expectedLeafId");
    try {
      await this.dependencies.resumeSession(
        input.sessionId,
        input.checkpointId,
        input.expectedLeafId,
      );
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    return { accepted: true };
  }

  async selectBranch(input: SessionSelectBranchInput): Promise<SessionSelectBranchValue> {
    nonEmpty(input.sessionId, "sessionId");
    nonEmpty(input.leafId, "leafId");
    try {
      await this.dependencies.selectSessionBranch(input.sessionId, input.leafId);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    return { selected: true };
  }

  async models(input: SessionModelsInput): Promise<SessionModelsValue> {
    const summary = await this.requireSession(input.sessionId);
    let history: PiSessionHistory;
    try {
      history = await this.dependencies.getSessionHistory(input.sessionId);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    let catalog: { groups: ModelProviderGroup[]; failures: ModelCatalogFailure[] };
    try {
      catalog = await this.modelServiceFactory(summary.cwd).models();
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }

    let current: ModelSelection | undefined = history.context.model
      ? {
          provider: history.context.model.provider,
          model: history.context.model.modelId,
          ...(history.context.thinkingLevel
            ? { reasoningEffort: history.context.thinkingLevel }
            : {}),
        }
      : undefined;
    if (!current) {
      try {
        const defaults = await this.dependencies.listModels(summary.cwd);
        if (defaults.defaultModel) {
          current = {
            provider: defaults.defaultModel.provider,
            model: defaults.defaultModel.modelId,
          };
        }
      } catch (error) {
        this.translate(error, { sessionId: input.sessionId, cwd: summary.cwd });
      }
    }
    const firstModel = catalog.groups.flatMap((group) =>
      group.models.map((model) => ({ provider: group.id, model: model.id })),
    )[0];
    current ??= firstModel;
    if (!current) this.translate(new Error("The session has no selectable model."));
    const routable = catalog.groups.some(
      (group) =>
        group.id === current.provider && group.models.some((model) => model.id === current.model),
    );
    return { current, routable, groups: catalog.groups, failures: catalog.failures };
  }

  async selectModel(input: SessionSelectModelInput): Promise<SessionSelectModelValue> {
    nonEmpty(input.provider, "provider");
    nonEmpty(input.model, "model");
    if (input.reasoningEffort !== undefined) nonEmpty(input.reasoningEffort, "reasoningEffort");
    const summary = await this.requireSession(input.sessionId);
    let catalog: { groups: ModelProviderGroup[]; failures: ModelCatalogFailure[] };
    try {
      catalog = await this.modelServiceFactory(summary.cwd).models();
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    const model = catalog.groups
      .find((group) => group.id === input.provider)
      ?.models.find((candidate) => candidate.id === input.model);
    const effortAvailable =
      input.reasoningEffort === undefined ||
      model?.reasoning?.efforts.some((effort) => effort.id === input.reasoningEffort);
    if (
      !model ||
      !effortAvailable ||
      (input.reasoningEffort && !isThinkingLevel(input.reasoningEffort))
    ) {
      throw new SessionRpcServiceError(
        "model-unavailable",
        "The requested model or reasoning effort is unavailable.",
        { provider: input.provider, model: input.model },
      );
    }
    const selected: ModelSelection = {
      provider: input.provider,
      model: input.model,
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    };
    try {
      await this.dependencies.selectSessionModel(input.sessionId, selected);
    } catch (error) {
      this.translate(error, {
        sessionId: input.sessionId,
        provider: input.provider,
        model: input.model,
      });
    }
    return { selected };
  }

  async contextPolicy(input: SessionContextPolicyInput): Promise<SessionContextPolicyValue> {
    await this.requireSession(input.sessionId);
    try {
      return await this.dependencies.getSessionContextPolicy(input.sessionId);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
  }

  async updateContextPolicy(
    input: SessionContextPolicyUpdateInput,
  ): Promise<SessionContextPolicyValue> {
    await this.requireSession(input.sessionId);
    try {
      return await this.dependencies.updateSessionContextPolicy(input.sessionId, input.policy);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
  }

  async compactContext(input: SessionContextPolicyInput): Promise<SessionCompactValue> {
    await this.requireSession(input.sessionId);
    try {
      return await this.dependencies.compactSessionContext(input.sessionId);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId, operation: "compact" });
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
    let seq: number | void;
    try {
      seq = await this.dependencies.renameSession(input.sessionId, title);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    if (!Number.isInteger(seq) || (seq ?? -1) < 0) {
      let events: SessionEvent[];
      try {
        events = await this.dependencies.getSessionEvents(input.sessionId);
      } catch (error) {
        this.translate(error, { sessionId: input.sessionId });
      }
      seq = events.at(-1)?.seq;
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
      await this.dependencies.deleteSession(input.sessionId);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    return { deleted: true };
  }

  async fork(input: SessionForkInput): Promise<SessionForkValue> {
    if (input.atSeq !== undefined && (!Number.isInteger(input.atSeq) || input.atSeq < 0)) {
      throw badRequest([issue(["atSeq"], "atSeq must be an integer greater than or equal to 0.")]);
    }
    const source = await this.requireSession(input.sessionId);
    let sourceWorkspace: WorkspaceView | undefined;
    try {
      sourceWorkspace = (await this.workspaceStore.list()).items.find((workspace) =>
        workspace.sessionIds.includes(source.id),
      );
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }

    let forked: { id: string };
    try {
      forked = await this.dependencies.forkSession(input.sessionId, input.atSeq);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    if (!forked.id.trim() || forked.id === input.sessionId) {
      this.translate(new Error("The session engine did not return an independent fork."), {
        sessionId: input.sessionId,
      });
    }
    if (sourceWorkspace) {
      await this.attachToWorkspace(sourceWorkspace.workspaceId, forked.id);
    }
    return { sessionId: forked.id };
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
    const prompt: PiQueuedPrompt = {
      message,
      ...(attachments.images.length ? { images: attachments.images } : {}),
      ...(attachments.documents.length ? { documents: attachments.documents } : {}),
    };
    let admission: PromptSubmissionResult;
    try {
      admission = await this.dependencies.submitPrompt(
        input.sessionId,
        input.mode === "steer" ? "steer" : "followUp",
        prompt,
        {
          ...(context.rpcId === undefined ? {} : { rpcId: context.rpcId }),
          ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
          ...(input.composer === undefined ? {} : { composer: input.composer }),
        },
      );
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    return { accepted: true, ...admission };
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
    let mutation: { kind: "edit"; prompt: PiQueuedPrompt } | { kind: "remove" } | { kind: "steer" };
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
        prompt: {
          message: input.action.content
            .map((part) => (typeof part.text === "string" ? part.text : ""))
            .join(""),
        },
      };
    } else {
      mutation = input.action;
    }
    try {
      await this.dependencies.updateQueueItem(input.sessionId, input.itemId, mutation);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId, itemId: input.itemId });
    }
    return { accepted: true };
  }

  async cancel(input: SessionCancelInput): Promise<SessionCancelValue> {
    await this.requireSession(input.sessionId);
    try {
      await this.dependencies.cancelSession(input.sessionId);
    } catch (error) {
      this.translate(error, { sessionId: input.sessionId });
    }
    return { accepted: true };
  }
}
