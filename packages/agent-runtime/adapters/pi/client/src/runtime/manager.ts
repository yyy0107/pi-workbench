import type {
  AppendMessage,
  ExportedMessageRepository,
  ExternalThreadQueueAdapter,
  MessageTiming,
  QueueItemState,
  RemoteThreadListAdapter,
  ThreadAssistantMessage,
  ThreadMessage,
  ThreadUserMessage,
  ToolCallTiming,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";

import { workbenchBrowserStorage, WORKBENCH_STORAGE_PREFIX } from "@workbench/agent-runtime-client";
import { deriveSessionDisplayTitle } from "@workbench/agent-runtime-pi-shared/sessions";
import {
  isWorkbenchComposerCommandResponseCustomType,
  parseWorkbenchComposerCommandResponseDetails,
  parseWorkbenchComposerUserProjection,
  parseWorkbenchPromptFailureDetails,
  WORKBENCH_PROMPT_FAILURE_CUSTOM_TYPE,
} from "@workbench/contracts/composer/request";
import {
  parseAttachmentRecognitionSnapshot,
  reconcileAttachmentRecognitionSnapshot,
  reduceAttachmentRecognitionSnapshot,
  WORKBENCH_ATTACHMENT_RECOGNITION_CUSTOM_TYPE,
  WORKBENCH_ATTACHMENT_RECOGNITION_DATA_NAME,
  WORKBENCH_IMAGE_RECOGNITION_CUSTOM_TYPE,
  WORKBENCH_IMAGE_RECOGNITION_DATA_NAME,
  type AttachmentRecognitionSnapshot,
} from "@workbench/attachment-understanding-contracts/state-machine";
import type { AutomationSessionOrigin } from "@workbench/automation-contracts";
import {
  appendWorkspaceFeedbackContext,
  type PromptFeedbackClaim,
  type PromptFeedbackPort,
} from "@workbench/agent-runtime-client/prompt-feedback";

import {
  type PiAssistantMessage,
  type PiEvent,
  type PiQueuedPrompt,
  type PiQueueMode,
  type PiRunTiming,
  type PiSessionSummary,
  type PiUserMessage,
  type PiWorkspaceSummary,
} from "@workbench/agent-runtime-pi-protocol/messages";
import {
  recordPiContextTracePromptPresentation,
  WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME,
} from "../context-trace/data-part";
import {
  archivePiWorkspaceSession,
  cancelPiRpcSession,
  createPiRpcId,
  createPiRpcScratchSession,
  createPiRpcSession,
  describePiHost,
  deletePiRpcSession,
  deletePiWorkspace,
  fetchPiRpcSessionHistory,
  fetchPiRpcSessionContextTracePromptParts,
  forkPiRpcSession,
  insertPiSessionBefore,
  insertPiWorkspaceBefore,
  listAvailablePiPackageUpdates,
  listPiArchivedWorkspaceSessions,
  listPiRpcSessions,
  listPiWorkspaces,
  type PiRpcCallOptions,
  PiApiError,
  promptPiRpcSession,
  promotePiRpcScratchSession,
  regeneratePiRpcSession,
  resumePiRpcSession,
  renamePiRpcSession,
  releasePiRpcScratchSession,
  replacePiSessionQueue,
  respondPiRpc,
  selectPiRpcSessionModel,
  selectPiRpcSessionBranch,
  setPiSessionQueuePaused,
  setPiWorkspacePinned,
  setPiWorkspaceSessionPinned,
  unarchivePiWorkspaceSession,
  updatePiRpcSessionQueue,
} from "../transport/api";
import type {
  HostDescription,
  QuestionAnswerItem,
  RpcReceipt,
  SessionContextTraceEventSummary,
  SessionContextTracePromptPart,
  SessionHistoryValue,
  SessionPromptValue,
  SessionQueueAction,
  SessionResumeCheckpoint,
  SessionScratchCreateValue,
  SessionScratchPromoteValue,
  SessionSelectModelPayload,
  SessionSelectModelValue,
  WorkspaceView,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import type {
  HostStreamPayload,
  MuxStreamPayload,
  QueueItem,
  QuestionItem,
  ServerRequest,
} from "@workbench/agent-runtime-pi-protocol/stream";
import { PiConnectionController } from "../transport/connections";
import { snapshotPiClientTransport, type PiClientTransport } from "../transport/client-transport";
import {
  conversationEventFromSessionEvent,
  conversationEventThreadMessage,
} from "../messages/conversation-events";
import {
  applyToolExecutionUpdate,
  appendPiContextTraceAssistantPart,
  appendMessageToPiPrompt,
  attachmentRecognitionSnapshotFromMessage,
  attachmentRecognitionSubmissionIdFromMessage,
  coalesceConsecutiveAssistantMessages,
  eventMessage,
  hasRunningWorkbenchCompactCommandResponse,
  isAttachmentRecognitionOnlyAssistant,
  isAttachmentRecognitionRetrySource,
  isPiContextTraceOnlyAssistant,
  mergePiContextTracePartsFromMessages,
  optimisticUserMessage,
  piAssistantToThreadMessage,
  piHistoryToThreadMessages,
  piUserMessageContent,
  reconcileAttachmentRecognitionAssistantPart,
  reconcileAttachmentRecognitionInMessages,
  reconcilePiContextTraceAssistantParts,
  reconcileLiveMessagesAfterHistory,
  sameUserPrompt,
  upsertAttachmentRecognitionAssistantPart,
  upsertAttachmentRecognitionInMessages,
  upsertWorkbenchComposerCommandResponse,
  upsertWorkbenchPromptFailure,
  withoutAttachmentRecognitionUserParts,
  workbenchComposerCommandResponseId,
} from "../messages/messages";
import { draftSessionModelSelection } from "../models/model-selection";
import { PiModelCatalogInvalidation } from "../models/model-catalog-invalidation";
import { PiMessageQueue, queueItemAppendMessage } from "../messages/queue";
import { createPiPackageUpdatesQuery, type PiPackageUpdatesQuery } from "./package-updates-query";
import { PiResourceCatalogRevision } from "./resource-catalog-revision";
import { PiWorkbenchSettingsClient } from "../settings/workbench-settings-client";
import { PiSessionContextPolicyClient } from "../context-policy/session-context-policy-client";
import {
  resolveSessionCreateIntent,
  type SessionCreateIntent,
} from "../sessions/session-create-intent";
import { nextForkTitle } from "./fork-title";
import {
  fetchProgressiveSessionHistory,
  SessionHistoryPaginationError,
} from "@workbench/agent-runtime-pi-shared/sessions";
import {
  piHistoryFromSessionEvents,
  piPromptContent,
  piSummaryFromSessionListItem,
} from "../sessions/session-rpc-adapter";
import {
  piAutoRetryFromEvent,
  piAutoRetryFromHistory,
  type PiAutoRetrySnapshot,
} from "./auto-retry";

const ARCHIVED_STORAGE_KEY = `${WORKBENCH_STORAGE_PREFIX}pi-archived-sessions`;
const PINNED_STORAGE_KEY = `${WORKBENCH_STORAGE_PREFIX}pi-pinned-sessions`;
const PINNED_WORKSPACES_STORAGE_KEY = "pi-workbench:pinned-workspaces";

export interface PiClientRunTiming extends PiRunTiming {
  /** Monotonic browser timestamp captured when the server timing snapshot arrived. */
  observedAt: number;
}

function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function clientRunTiming(timing: PiRunTiming, current?: PiClientRunTiming): PiClientRunTiming {
  const observedAt = monotonicNow();
  const currentElapsed =
    current?.startedAt === timing.startedAt
      ? current.elapsedMs + Math.max(0, observedAt - current.observedAt)
      : undefined;
  return {
    ...timing,
    elapsedMs: Math.max(timing.elapsedMs, currentElapsed ?? 0),
    observedAt,
  };
}

function rawToolArgsTextFromEvent(event: PiEvent): Readonly<Record<string, string>> | undefined {
  const value: unknown = event.rawToolArgsText;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function isRecognitionDataName(name: string): boolean {
  return (
    name === WORKBENCH_ATTACHMENT_RECOGNITION_DATA_NAME ||
    name === WORKBENCH_IMAGE_RECOGNITION_DATA_NAME
  );
}

function livePiUserMessage(
  message: PiUserMessage,
  id: string,
  sequence: number | undefined,
  workbenchComposer: PiUserMessage["workbenchComposer"],
): ThreadUserMessage {
  const queueAppendMessage = queueItemAppendMessage({
    id,
    placement: "context",
    message: {
      id,
      role: "user",
      content:
        typeof message.content === "string"
          ? [{ type: "text", text: message.content }]
          : message.content.map((part) => ({ ...part })),
      source: { kind: "user" },
    },
  });
  const appendMessage = {
    ...queueAppendMessage,
    content: piUserMessageContent(message.content),
  };
  const projected = optimisticUserMessage(appendMessage, id) as ThreadUserMessage;
  const content = workbenchComposer
    ? [
        { type: "text" as const, text: workbenchComposer.sourceText },
        ...projected.content.filter((part) => part.type === "image" || part.type === "file"),
      ]
    : projected.content;

  return {
    ...projected,
    content,
    createdAt: new Date(message.timestamp ?? Date.now()),
    metadata: {
      ...projected.metadata,
      custom: {
        ...projected.metadata.custom,
        piUserMessageStarted: true,
        piMessageTimestamp: message.timestamp ?? null,
        ...(sequence === undefined ? {} : { piEventSeq: sequence }),
        ...(workbenchComposer?.document === undefined
          ? {}
          : { workbenchComposerDocument: workbenchComposer.document }),
        ...(workbenchComposer === undefined
          ? {}
          : { workbenchComposerSubmissionId: workbenchComposer.submissionId }),
      },
    },
  };
}

export interface PiSessionSnapshot {
  messages: readonly ThreadMessage[];
  messageRepository: ExportedMessageRepository;
  /** User-visible response activity exposed to assistant-ui, excluding post-response host cleanup. */
  isRunning: boolean;
  runTiming?: PiClientRunTiming;
  autoRetry?: PiAutoRetrySnapshot;
  resumeCheckpoint?: SessionResumeCheckpoint;
  isLoading: boolean;
  queuePaused: boolean;
  steeringQueueIds: readonly string[];
  rejectedQueueDraft?: {
    revision: number;
    message: AppendMessage;
  };
}

/** Resolve a durable Pi checkpoint to the assistant-ui row that currently renders its terminal event. */
export function visibleResumeCheckpointTerminalMessageId(
  snapshot: Pick<PiSessionSnapshot, "messages" | "resumeCheckpoint">,
): string | undefined {
  const checkpoint = snapshot.resumeCheckpoint;
  if (!checkpoint) return undefined;

  return (
    snapshot.messages.findLast(
      (message) =>
        message.role === "assistant" &&
        message.metadata.custom.piEventSeq === checkpoint.sourceEventSeq,
    )?.id ?? checkpoint.terminalMessageId
  );
}

export interface PiThreadListItemSnapshot {
  readonly remoteId: string;
  readonly status: "regular" | "archived";
  readonly title?: string;
  readonly lastMessageAt: Date;
  readonly custom?: Record<string, unknown>;
}

export interface PiThreadMetadataSnapshot {
  readonly running: boolean;
  readonly waitingForUserInput: boolean;
  readonly completed: boolean;
  readonly pinned: boolean;
  readonly createdAt?: string;
  readonly workspace?: PiWorkspaceSummary;
  readonly automationOrigin?: AutomationSessionOrigin;
}

export interface PiThreadStateSnapshot {
  readonly thread?: PiThreadListItemSnapshot;
  readonly metadata: PiThreadMetadataSnapshot;
}

interface PiThreadStateBucket {
  readonly listeners: Set<Listener>;
  revision: number;
  managerRevision: number;
  signature: string;
  snapshot: PiThreadStateSnapshot;
}

export interface PiForkSessionResult {
  readonly sessionId: string;
  readonly title: string;
}

export type PendingMuxInteraction =
  | {
      readonly kind: "question";
      readonly rpcId: string;
      readonly sessionId: string;
      readonly questions: readonly QuestionItem[];
    }
  | {
      readonly kind: "approval";
      readonly rpcId: string;
      readonly sessionId: string;
      readonly approvalId: string;
      readonly toolName: string;
      readonly callId?: string;
      readonly reason?: string;
    };

export type PiPendingInteraction = PendingMuxInteraction;

export type PiInteractionResponse =
  | { kind: "question"; answers: readonly QuestionAnswerItem[] }
  | { kind: "approval"; outcome: "allowed-once" | "rejected" }
  | { kind: "cancel"; message?: string };

export type PiSessionContextTraceListener = (event: SessionContextTraceEventSummary) => void;
export type PiHostEventListener = (event: HostStreamPayload) => void;

interface StoredPendingInteraction {
  readonly interaction: PiPendingInteraction;
  readonly generation: number;
}

type Listener = () => void;

const EMPTY_THREAD_STATE_SNAPSHOT: PiThreadStateSnapshot = {
  metadata: {
    running: false,
    waitingForUserInput: false,
    completed: false,
    pinned: false,
  },
};

interface ActiveMessageTiming {
  streamStartTime: number;
  firstTokenTime?: number;
  totalChunks: number;
}

function hasOutputToken(message: PiAssistantMessage): boolean {
  return message.content.some(
    (part) =>
      (part.type === "text" && part.text.length > 0) ||
      (part.type === "thinking" && !part.redacted && part.thinking.length > 0),
  );
}

function countToolCalls(message: PiAssistantMessage): number {
  return message.content.filter((part) => part.type === "toolCall").length;
}

function createClientMessageId(prefix: string): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function browserTimeZone(): string | undefined {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timeZone.length > 0 ? timeZone : undefined;
  } catch {
    return undefined;
  }
}

function automationOriginsEqual(
  left: AutomationSessionOrigin | undefined,
  right: AutomationSessionOrigin | undefined,
): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.version === right.version &&
      left.origin === right.origin &&
      left.automationId === right.automationId &&
      left.automationName === right.automationName &&
      left.source === right.source &&
      left.triggeredAt === right.triggeredAt)
  );
}

function summariesEqual(left: PiSessionSummary | undefined, right: PiSessionSummary): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.cwd === right.cwd &&
    left.workspace.id === right.workspace.id &&
    left.workspace.name === right.workspace.name &&
    left.workspace.cwd === right.workspace.cwd &&
    left.name === right.name &&
    left.created === right.created &&
    left.modified === right.modified &&
    left.messageCount === right.messageCount &&
    left.firstMessage === right.firstMessage &&
    left.transient === right.transient &&
    left.running === right.running &&
    left.waitingForUserInput === right.waitingForUserInput &&
    automationOriginsEqual(left.automationOrigin, right.automationOrigin) &&
    left.runTiming?.startedAt === right.runTiming?.startedAt
  );
}

function workspaceViewsEqual(left: WorkspaceView | undefined, right: WorkspaceView): boolean {
  return (
    left !== undefined &&
    left.workspaceId === right.workspaceId &&
    left.path === right.path &&
    left.title === right.title &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.sessionIds.length === right.sessionIds.length &&
    left.sessionIds.every((sessionId, index) => sessionId === right.sessionIds[index])
  );
}

function sameComposerRetryUser(left: ThreadMessage, right: ThreadMessage): boolean {
  if (left.role !== "user" || right.role !== "user") return false;
  if (
    typeof left.metadata.custom.workbenchComposerSubmissionId !== "string" ||
    typeof right.metadata.custom.workbenchComposerSubmissionId !== "string"
  ) {
    return false;
  }
  return sameUserPrompt(left, right);
}

/** Matches the transient and journal-backed projections of one Pi assistant response. */
function sameAssistantResponse(left: ThreadMessage, right: ThreadMessage): boolean {
  if (left.role !== "assistant" || right.role !== "assistant") return false;

  const leftSequence = left.metadata.custom.piEventSeq;
  const rightSequence = right.metadata.custom.piEventSeq;
  if (
    typeof leftSequence === "number" &&
    Number.isFinite(leftSequence) &&
    typeof rightSequence === "number" &&
    Number.isFinite(rightSequence)
  ) {
    return leftSequence === rightSequence;
  }

  const leftTimestamp = left.metadata.custom.piMessageTimestamp;
  const rightTimestamp = right.metadata.custom.piMessageTimestamp;
  return (
    typeof leftTimestamp === "number" &&
    Number.isFinite(leftTimestamp) &&
    typeof rightTimestamp === "number" &&
    Number.isFinite(rightTimestamp) &&
    leftTimestamp === rightTimestamp
  );
}

export class PiClientSession {
  readonly localId: string;
  readonly runtimeExtras: {
    piQueue: {
      beginEdit(id: string): QueueItemState | undefined;
      clearRejectedDraft(revision: number): void;
      setPaused(paused: boolean): void;
    };
  };
  private readonly manager: PiSessionManager;
  private readonly listeners = new Set<Listener>();
  private remoteIdValue?: string;
  private baseMessages: ThreadMessage[] = [];
  private baseMessageRepository: ExportedMessageRepository = { headId: null, messages: [] };
  private baseMessageRepositoryIndex?: {
    repository: ExportedMessageRepository;
    byId: ReadonlyMap<string, number>;
  };
  private branchLeafByHeadMessageId = new Map<string, string>();
  private branchSwitchTask?: Promise<void>;
  private liveMessages: ThreadMessage[] = [];
  private streamingMessage?: ThreadMessage;
  private activeUserMessageId?: string;
  private activeAssistantMessageId?: string;
  private queueRejectionRevision = 0;
  private readonly authoritativeMessageIdAliases = new Map<string, string>();
  private snapshotValue: PiSessionSnapshot;
  private openTask?: Promise<void>;
  private reloadTask?: Promise<void>;
  private historyRebaselineGeneration = 0;
  private lastSequence = -1;
  private promptRequestPending = false;
  private localRunLeaseActive = false;
  private terminalResponseReceived = false;
  private readonly pendingPromptRpcIds = new Set<string>();
  private readonly attachmentRecognitionSnapshots = new Map<
    string,
    AttachmentRecognitionSnapshot
  >();
  private promptStartTimer?: ReturnType<typeof setTimeout>;
  private activeMessageTiming?: ActiveMessageTiming;
  private messagePublishScheduled = false;
  private disposed = false;
  private readonly messageTimingByTimestamp = new Map<number, MessageTiming>();
  private readonly toolTimingById = new Map<string, ToolCallTiming>();
  private readonly steeringMessageIds = new Map<string, string>();
  private readonly contextTraceIds = new Set<string>();
  private readonly contextTracePromptParts = new Map<string, SessionContextTracePromptPart>();
  private readonly contextTracePromptPresentations = new Map<string, string>();
  private pendingContextTraceEvents: SessionContextTraceEventSummary[] = [];
  private readonly messageQueue: PiMessageQueue;

  private messageRepositoryFromHistory(
    sessionId: string,
    history: SessionHistoryValue,
    activeMessages: readonly ThreadMessage[],
  ): {
    repository: ExportedMessageRepository;
    leafByHeadMessageId: Map<string, string>;
    activeMessages: ThreadMessage[];
  } {
    const fallbackMessages = activeMessages.map((message, index) => ({
      message,
      parentId: activeMessages[index - 1]?.id ?? null,
    }));
    const fallback = {
      repository: {
        headId: activeMessages.at(-1)?.id ?? null,
        messages: fallbackMessages,
      },
      leafByHeadMessageId: new Map<string, string>(),
      activeMessages: [...activeMessages],
    };
    if (!history.branches?.items.length) return fallback;

    const repositoryItems = new Map<string, ExportedMessageRepository["messages"][number]>();
    const leafByHeadMessageId = new Map<string, string>();
    const branchScopedMessageIds = new Map<string, string>();
    const activeBranch = history.branches.items.find(
      (branch) => branch.leafId === history.branches?.headLeafId,
    );
    if (!activeBranch) return fallback;
    const orderedBranches = [
      activeBranch,
      ...history.branches.items.filter((branch) => branch !== activeBranch),
    ];
    const scopedMessageId = (leafId: string, messageId: string): string => {
      const key = JSON.stringify([leafId, messageId]);
      const reserved = branchScopedMessageIds.get(key);
      if (reserved) return reserved;

      const base = `pi-branch:${encodeURIComponent(leafId)}:${encodeURIComponent(messageId)}`;
      let candidate = base;
      let suffix = 2;
      while (repositoryItems.has(candidate)) {
        candidate = `${base}:${suffix}`;
        suffix += 1;
      }
      branchScopedMessageIds.set(key, candidate);
      return candidate;
    };
    let headId: string | null = null;
    for (const branch of orderedBranches) {
      const branchHistory = piHistoryFromSessionEvents(sessionId, {
        events: branch.events,
        hasMore: false,
      });
      const projectedBranchMessages =
        branch === activeBranch && activeMessages.length > 0
          ? activeMessages
          : piHistoryToThreadMessages(
              branchHistory,
              this.messageTimingByTimestamp,
              this.toolTimingById,
              [...this.contextTracePromptParts.values()],
            );
      const branchMessages = projectedBranchMessages.map((message) => {
        const alias = this.authoritativeMessageIdAliases.get(message.id);
        return alias ? { ...message, id: alias } : message;
      });
      let effectiveParentId: string | null = null;
      for (const message of branchMessages) {
        let effectiveId = message.id;
        const equivalentComposerRetry = [...repositoryItems.values()].find(
          (item) =>
            item.parentId === effectiveParentId && sameComposerRetryUser(item.message, message),
        );
        if (equivalentComposerRetry) effectiveId = equivalentComposerRetry.message.id;

        const canonical = repositoryItems.get(effectiveId);
        if (canonical && canonical.parentId !== effectiveParentId) {
          if (branch === activeBranch) return fallback;
          effectiveId = scopedMessageId(branch.leafId, message.id);
        }

        if (!repositoryItems.has(effectiveId)) {
          repositoryItems.set(effectiveId, {
            message: effectiveId === message.id ? message : { ...message, id: effectiveId },
            parentId: effectiveParentId,
          });
        }
        effectiveParentId = effectiveId;
      }
      if (effectiveParentId) leafByHeadMessageId.set(effectiveParentId, branch.leafId);
      if (branch === activeBranch) headId = effectiveParentId;
    }

    if (headId === null || !repositoryItems.has(headId)) return fallback;
    for (const message of activeMessages) {
      const item = repositoryItems.get(message.id);
      if (item) item.message = message;
    }
    // Each branch is visited root-to-leaf and an existing node is never reparented, so insertion
    // order is also a valid parent-before-child import order for assistant-ui's repository.
    const repository = { headId, messages: [...repositoryItems.values()] };
    const visibleMessages: ThreadMessage[] = [];
    let cursor: string | null = headId;
    while (cursor) {
      const item = repositoryItems.get(cursor);
      if (!item) break;
      visibleMessages.unshift(item.message);
      cursor = item.parentId;
    }
    return {
      repository,
      leafByHeadMessageId,
      activeMessages: visibleMessages.length ? visibleMessages : [...activeMessages],
    };
  }

  constructor(
    manager: PiSessionManager,
    localId: string,
    remoteId: string | undefined,
    running: boolean,
    runTiming?: PiClientRunTiming,
  ) {
    this.manager = manager;
    this.localId = localId;
    this.remoteIdValue = remoteId;
    this.snapshotValue = {
      messages: [],
      messageRepository: this.baseMessageRepository,
      isRunning: running,
      ...(running && runTiming !== undefined ? { runTiming } : {}),
      isLoading: Boolean(remoteId),
      queuePaused: false,
      steeringQueueIds: [],
    };
    this.messageQueue = new PiMessageQueue({
      isRunning: () => this.snapshotValue.isRunning,
      run: (message) => this.send(message),
      createId: () => createPiRpcId("session.prompt"),
      enqueue: (mode, prompt, rpcId) => this.queuePrompt(mode, prompt, rpcId),
      update: (itemId, action) => this.updateQueue(itemId, action),
      replace: (steering, followUp) => this.replaceQueue(steering, followUp),
      setPaused: (paused, steering, followUp) => this.setQueuePaused(paused, steering, followUp),
      onEnqueueRejected: (message) => {
        this.replaceSnapshot({
          rejectedQueueDraft: {
            revision: ++this.queueRejectionRevision,
            message,
          },
        });
      },
      onSteerRejected: (itemId) => this.rejectOptimisticSteer(itemId),
      onChange: () => this.publishQueueState(),
    });
    this.runtimeExtras = {
      piQueue: {
        beginEdit: (id) => this.messageQueue.beginEdit(id),
        clearRejectedDraft: (revision) => {
          if (this.snapshotValue.rejectedQueueDraft?.revision !== revision) return;
          this.replaceSnapshot({ rejectedQueueDraft: undefined });
        },
        setPaused: (paused) => this.messageQueue.setPaused(paused),
      },
    };
  }

  get remoteId(): string | undefined {
    return this.remoteIdValue;
  }

  get queueAdapter(): ExternalThreadQueueAdapter {
    return this.messageQueue.adapter;
  }

  getSnapshot = (): PiSessionSnapshot => this.snapshotValue;

  subscribe = (listener: Listener): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.historyRebaselineGeneration += 1;
    if (this.promptStartTimer) clearTimeout(this.promptStartTimer);
    this.promptStartTimer = undefined;
    if (this.remoteIdValue) this.manager.connections.closeSession(this.remoteIdValue);
    this.remoteIdValue = undefined;
    this.messageQueue.dispose();
    this.baseMessages = [];
    this.baseMessageRepository = { headId: null, messages: [] };
    this.branchLeafByHeadMessageId.clear();
    this.liveMessages = [];
    this.streamingMessage = undefined;
    this.activeUserMessageId = undefined;
    this.activeAssistantMessageId = undefined;
    this.lastSequence = -1;
    this.promptRequestPending = false;
    this.localRunLeaseActive = false;
    this.terminalResponseReceived = false;
    this.messagePublishScheduled = false;
    this.authoritativeMessageIdAliases.clear();
    this.openTask = undefined;
    this.reloadTask = undefined;
    this.branchSwitchTask = undefined;
    this.pendingPromptRpcIds.clear();
    this.attachmentRecognitionSnapshots.clear();
    this.activeMessageTiming = undefined;
    this.messageTimingByTimestamp.clear();
    this.toolTimingById.clear();
    this.steeringMessageIds.clear();
    this.contextTraceIds.clear();
    this.contextTracePromptParts.clear();
    this.contextTracePromptPresentations.clear();
    this.pendingContextTraceEvents = [];
    this.snapshotValue = {
      messages: [],
      messageRepository: this.baseMessageRepository,
      isRunning: false,
      isLoading: false,
      queuePaused: false,
      steeringQueueIds: [],
    };
    const listeners = [...this.listeners];
    this.listeners.clear();
    for (const listener of listeners) listener();
  }

  bindRemote(summary: PiSessionSummary): void {
    if (this.disposed) return;
    this.remoteIdValue = summary.id;
    if (summary.running) this.setRunningFromManager(true, summary.runTiming);
  }

  open(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.openTask) return this.openTask;
    if (!this.remoteIdValue) {
      this.replaceSnapshot({ isLoading: false });
      return Promise.resolve();
    }

    // History plus the journal-backed Prompt Part projection can render an idle conversation.
    // Opening an event stream starts the full Pi runtime on the server, so only running sessions
    // connect (via connectIfRunning) and that connection must never block history paint.
    this.connectIfRunning();
    this.openTask = this.reload(true).finally(() => {
      this.replaceSnapshot({ isLoading: false });
    });
    return this.openTask;
  }

  async reload(hydrateContextTracePromptParts = false): Promise<void> {
    if (this.disposed) return;
    if (!this.remoteIdValue) return;
    if (this.reloadTask) return this.reloadTask;
    const remoteId = this.remoteIdValue;
    const liveMessageIdsAtStart = new Set(this.liveMessages.map((message) => message.id));
    const baseMessageIdsAtStart = new Set(this.baseMessages.map((message) => message.id));
    // A stream rebaseline can win the race with prompt persistence. Keep the
    // submitted user turn visible until history contains its authoritative copy.
    const preserveUnpersistedOptimisticTurn =
      this.snapshotValue.isRunning || this.localRunLeaseActive;
    const streamingMessageAtStart = this.streamingMessage;
    const hasPublishedBaseHistory = this.baseMessages.length > 0;
    const applyHistory = (value: SessionHistoryValue) => {
      if (this.disposed || this.remoteIdValue !== remoteId) return;
      const history = piHistoryFromSessionEvents(remoteId, value);
      const previousMessages = [
        ...this.baseMessages,
        ...this.liveMessages,
        ...(this.streamingMessage ? [this.streamingMessage] : []),
      ];
      const projectedBaseMessages = mergePiContextTracePartsFromMessages(
        this.stabilizeAuthoritativeMessageIds(
          this.mergeAttachmentRecognitionHistory(
            piHistoryToThreadMessages(history, this.messageTimingByTimestamp, this.toolTimingById, [
              ...this.contextTracePromptParts.values(),
            ]),
          ),
          baseMessageIdsAtStart,
        ),
        previousMessages,
      );
      const authoritativeStreamingMessage =
        streamingMessageAtStart?.role === "assistant"
          ? projectedBaseMessages.find((message) =>
              sameAssistantResponse(streamingMessageAtStart, message),
            )
          : undefined;
      const branchState = this.messageRepositoryFromHistory(remoteId, value, projectedBaseMessages);
      const baseMessages = branchState.activeMessages;
      this.baseMessages = baseMessages;
      this.baseMessageRepository = branchState.repository;
      this.branchLeafByHeadMessageId = branchState.leafByHeadMessageId;
      this.liveMessages = reconcileLiveMessagesAfterHistory(this.liveMessages, baseMessages, {
        liveMessageIdsAtStart,
        baseMessageIdsAtStart,
        preserveUnpersistedOptimisticUsers: preserveUnpersistedOptimisticTurn,
      });
      // Retain the in-memory placeholder while history has no completed copy. If journal history
      // wins the race against the event stream, let its authoritative response take over with the
      // aliased live id; keeping both copies would reshape Parts and remount the streaming text.
      if (
        this.streamingMessage === streamingMessageAtStart &&
        (!preserveUnpersistedOptimisticTurn || authoritativeStreamingMessage)
      ) {
        this.streamingMessage = undefined;
        if (authoritativeStreamingMessage) {
          this.activeAssistantMessageId = undefined;
          this.terminalResponseReceived = true;
        }
      }
      const historySequence = value.events.at(-1)?.event.seq ?? -1;
      if (!preserveUnpersistedOptimisticTurn || historySequence >= this.lastSequence) {
        this.lastSequence = historySequence;
      }
      const autoRetry =
        this.snapshotValue.isRunning && historySequence >= this.lastSequence
          ? piAutoRetryFromHistory(value)
          : this.snapshotValue.autoRetry;
      this.publishMessages({ autoRetry, resumeCheckpoint: value.resume?.checkpoint });
      if (authoritativeStreamingMessage?.status?.type === "complete") {
        this.setRunning(false, false);
      }
    };
    const promptPartsTask = hydrateContextTracePromptParts
      ? fetchPiRpcSessionContextTracePromptParts(
          { sessionId: remoteId },
          this.manager.rpcTransportOptions,
        )
          .then((value) => {
            if (this.disposed || this.remoteIdValue !== remoteId) return;
            for (const part of value.parts) {
              if (part.event.sessionId !== remoteId || part.event.kind !== "prompt-composition") {
                continue;
              }
              this.contextTracePromptParts.set(part.event.traceId, part);
              if (part.assistantMessageTimestamp === undefined) {
                this.applyContextTraceEvent(part.event);
              } else {
                this.contextTraceIds.add(part.event.traceId);
                recordPiContextTracePromptPresentation(
                  part.event,
                  this.contextTracePromptPresentations,
                );
              }
            }
          })
          .catch((error: unknown) => {
            console.error("[workbench-pi] context trace prompt hydration failed", error);
          })
      : Promise.resolve();
    const historyTask = fetchProgressiveSessionHistory(
      remoteId,
      (payload) => fetchPiRpcSessionHistory(payload, this.manager.rpcTransportOptions),
      {
        onInitialPage: (history) => {
          if (this.disposed) return;
          // A paginated first page is only a tail of the conversation. It is useful for the
          // initial paint, but replacing an already-published history with that tail briefly
          // removes every older row and collapses the scroll range until backfill completes.
          // Keep the complete, visible history during refreshes and swap in the new complete
          // snapshot atomically once pagination finishes.
          if (!hasPublishedBaseHistory || !history.hasMore) applyHistory(history);
          if (this.snapshotValue.isLoading) this.replaceSnapshot({ isLoading: false });
        },
      },
    );
    this.reloadTask = Promise.all([historyTask, promptPartsTask])
      .then(([history]) => {
        // The initial page paints without waiting for journal replay. Reapply the final history
        // once prompt summaries are ready so only durable prompt-composition Parts are hydrated.
        applyHistory(history);
      })
      .catch((error) => {
        if (error instanceof SessionHistoryPaginationError) {
          throw new PiApiError("pi_rpc_invalid_response", 200, {
            method: "session.history",
          });
        }
        throw error;
      })
      .finally(() => {
        this.reloadTask = undefined;
      });
    return this.reloadTask;
  }

  async send(message: AppendMessage): Promise<void> {
    if (this.disposed) return;
    await this.branchSwitchTask;
    if (this.disposed) return;
    const optimisticUserId = createClientMessageId("pi-user");
    const optimisticAssistantId = createClientMessageId("pi-assistant");
    const promptRpcId = createPiRpcId("session.prompt");
    this.liveMessages.push(optimisticUserMessage(message, optimisticUserId, promptRpcId));
    this.activeAssistantMessageId = optimisticAssistantId;
    const optimisticAssistant = piAssistantToThreadMessage(
      { role: "assistant", content: [] },
      optimisticAssistantId,
      {
        optimistic: true,
        streaming: true,
        createdAt: message.createdAt.getTime(),
      },
    );
    this.streamingMessage = {
      ...optimisticAssistant,
      metadata: {
        ...optimisticAssistant.metadata,
        custom: {
          ...optimisticAssistant.metadata.custom,
          workbenchPromptRpcId: promptRpcId,
        },
      },
    };
    this.promptRequestPending = true;
    this.localRunLeaseActive = true;
    this.terminalResponseReceived = false;
    // A running external-store snapshot is a complete turn: user and assistant rows are both
    // present from its first observable frame and keep the same ids for the whole stream. Establish
    // the local lease before publishing so synchronous subscribers cannot observe an unprotected
    // running snapshot and reconcile it against a stale idle manager summary.
    this.publishMessagesAndSetRunning(true);

    const prompt = appendMessageToPiPrompt(message);
    const workspaceFeedbackClaim = this.manager.claimPromptFeedback(
      this.localId,
      this.remoteIdValue,
    );
    let remoteId: string | undefined;
    try {
      const promptText = appendWorkspaceFeedbackContext(
        prompt.text,
        workspaceFeedbackClaim?.items ?? [],
      );
      const draftModel = draftSessionModelSelection(this.remoteIdValue, message);
      const summary = await this.manager.ensureRemote(this);
      if (this.disposed) {
        this.manager.releasePromptFeedback(workspaceFeedbackClaim);
        return;
      }
      const submittedRemoteId = summary.id;
      remoteId = submittedRemoteId;
      await this.manager.connections.ensureSessionEvents(submittedRemoteId, this.handleEvent);
      if (this.disposed) {
        this.manager.releasePromptFeedback(workspaceFeedbackClaim);
        return;
      }

      if (draftModel) {
        await this.manager.selectSessionModel({ sessionId: submittedRemoteId, ...draftModel });
        if (this.disposed) {
          this.manager.releasePromptFeedback(workspaceFeedbackClaim);
          return;
        }
      }

      const clientTimeZone = browserTimeZone();
      this.pendingPromptRpcIds.add(promptRpcId);
      await promptPiRpcSession(
        {
          sessionId: submittedRemoteId,
          mode: "queue",
          content: piPromptContent(promptText, prompt.images, prompt.documents),
          ...(prompt.composer === undefined ? {} : { composer: prompt.composer }),
          ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
        },
        promptRpcId,
        this.manager.rpcTransportOptions,
      );
      if (this.disposed) {
        this.manager.releasePromptFeedback(workspaceFeedbackClaim);
        return;
      }
      this.manager.commitPromptFeedback(workspaceFeedbackClaim);
      this.manager.notePrompt(submittedRemoteId, prompt.text, this.snapshotValue.isRunning);
      if (this.promptRequestPending) {
        this.promptStartTimer = setTimeout(() => {
          this.promptRequestPending = false;
          this.localRunLeaseActive = false;
          this.pendingPromptRpcIds.clear();
          if (!this.manager.isRunning(submittedRemoteId)) this.setRunningFromManager(false);
        }, 15_000);
      }
    } catch (error) {
      this.manager.releasePromptFeedback(workspaceFeedbackClaim);
      this.liveMessages = this.liveMessages.filter(
        (candidate) => candidate.id !== optimisticUserId,
      );
      if (this.streamingMessage?.id === optimisticAssistantId) {
        this.streamingMessage = undefined;
      }
      if (this.activeAssistantMessageId === optimisticAssistantId) {
        this.activeAssistantMessageId = undefined;
      }
      this.clearLocalRunLease();
      this.publishMessagesAndSetRunning(false);
      if (remoteId) this.manager.connections.scheduleSessionClose(remoteId);
      throw error;
    }
  }

  async retry(parentId: string | null, _runConfig: AppendMessage["runConfig"]): Promise<void> {
    if (this.disposed) return;
    await this.branchSwitchTask;
    if (this.disposed) return;
    const messages = this.snapshotValue.messages;
    const parentIndex =
      parentId === null ? messages.length - 1 : messages.findIndex(({ id }) => id === parentId);
    const searchEnd = parentIndex < 0 ? messages.length - 1 : parentIndex;
    let source: Extract<ThreadMessage, { role: "user" }> | undefined;

    for (let index = searchEnd; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === "user") {
        source = message;
        break;
      }
    }

    if (!source) throw new PiApiError("pi_empty_prompt", 400);

    if (!this.remoteIdValue) throw new PiApiError("pi_session_not_found", 404);
    await this.manager.waitForPendingSessionModelSelection(this.remoteIdValue);
    if (this.disposed) return;
    const attachmentRetryRpcId = isAttachmentRecognitionRetrySource(source)
      ? createPiRpcId("session.regenerate-attachment")
      : undefined;
    const resolvedEntryId = source.metadata.custom.piResolvedEntryId;
    const sourceEntryId = typeof resolvedEntryId === "string" ? resolvedEntryId : source.id;
    const sourceSequence = source.metadata.custom.piEventSeq;
    const optimisticAssistantId = createClientMessageId("pi-assistant");
    const sourceIndex = messages.findIndex((message) => message.id === source.id);
    const currentRepository = this.currentMessageRepository(messages);
    const retainedMessages = messages.slice(0, sourceIndex + 1);
    this.baseMessages = retainedMessages;
    this.baseMessageRepository = currentRepository.messages.some(
      ({ message }) => message.id === source.id,
    )
      ? { ...currentRepository, headId: source.id }
      : {
          headId: source.id,
          messages: retainedMessages.map((message, index) => ({
            message,
            parentId: retainedMessages[index - 1]?.id ?? null,
          })),
        };
    this.liveMessages = [];
    this.activeAssistantMessageId = optimisticAssistantId;
    this.streamingMessage = piAssistantToThreadMessage(
      { role: "assistant", content: [] },
      optimisticAssistantId,
      { optimistic: true, streaming: true, createdAt: Date.now() },
    );
    if (attachmentRetryRpcId) {
      this.streamingMessage = {
        ...this.streamingMessage,
        metadata: {
          ...this.streamingMessage.metadata,
          custom: {
            ...this.streamingMessage.metadata.custom,
            workbenchPromptRpcId: attachmentRetryRpcId,
          },
        },
      };
    }
    if (typeof sourceSequence === "number") this.lastSequence = sourceSequence;
    this.promptRequestPending = true;
    this.localRunLeaseActive = true;
    this.terminalResponseReceived = false;
    this.publishMessagesAndSetRunning(true);

    try {
      await this.manager.connections.ensureSessionEvents(this.remoteIdValue, this.handleEvent);
      if (this.disposed) return;
      await regeneratePiRpcSession(
        {
          sessionId: this.remoteIdValue,
          messageId: sourceEntryId,
          ...(attachmentRetryRpcId === undefined ? {} : { requestId: attachmentRetryRpcId }),
        },
        this.manager.rpcTransportOptions,
      );
    } catch (error) {
      if (this.streamingMessage?.id === optimisticAssistantId) this.streamingMessage = undefined;
      if (this.activeAssistantMessageId === optimisticAssistantId) {
        this.activeAssistantMessageId = undefined;
      }
      this.clearLocalRunLease();
      this.publishMessagesAndSetRunning(false);
      await this.reload().catch(() => undefined);
      throw error;
    }
  }

  async resume(checkpointId: string, expectedLeafId: string): Promise<void> {
    if (this.disposed) return;
    await this.branchSwitchTask;
    if (this.disposed) return;
    if (!this.remoteIdValue) throw new PiApiError("pi_session_not_found", 404);
    const checkpoint = this.snapshotValue.resumeCheckpoint;
    if (
      checkpoint?.checkpointId !== checkpointId ||
      checkpoint.branchLeafId !== expectedLeafId ||
      checkpoint.capability !== "ready"
    ) {
      throw new PiApiError("pi_resume_stale", 409);
    }

    const sessionId = this.remoteIdValue;
    this.promptRequestPending = true;
    this.localRunLeaseActive = true;
    this.terminalResponseReceived = false;
    this.publishMessagesAndSetRunning(true);
    try {
      await this.manager.connections.ensureSessionEvents(sessionId, this.handleEvent);
      if (this.disposed) return;
      await resumePiRpcSession(
        { sessionId, checkpointId, expectedLeafId },
        this.manager.rpcTransportOptions,
      );
      if (this.promptRequestPending) {
        this.promptStartTimer = setTimeout(() => {
          this.promptRequestPending = false;
          this.localRunLeaseActive = false;
          if (!this.manager.isRunning(sessionId)) this.setRunningFromManager(false);
        }, 15_000);
      }
    } catch (error) {
      this.clearLocalRunLease();
      this.publishMessagesAndSetRunning(false);
      await this.reload().catch(() => undefined);
      throw error;
    }
  }

  async resumeLatest(terminalMessageId: string): Promise<void> {
    if (this.disposed) return;
    let checkpoint = this.snapshotValue.resumeCheckpoint;
    let visibleTerminalMessageId = visibleResumeCheckpointTerminalMessageId(this.snapshotValue);
    if (
      (checkpoint?.terminalMessageId !== terminalMessageId &&
        visibleTerminalMessageId !== terminalMessageId) ||
      checkpoint?.capability !== "ready"
    ) {
      await this.reload();
      checkpoint = this.snapshotValue.resumeCheckpoint;
      visibleTerminalMessageId = visibleResumeCheckpointTerminalMessageId(this.snapshotValue);
    }
    if (
      !checkpoint ||
      (checkpoint.terminalMessageId !== terminalMessageId &&
        visibleTerminalMessageId !== terminalMessageId)
    ) {
      throw new PiApiError("pi_resume_stale", 409);
    }
    if (checkpoint.capability !== "ready") {
      throw new PiApiError(
        checkpoint.capability === "confirmation-required"
          ? "pi_resume_confirmation_required"
          : "pi_resume_unavailable",
        409,
      );
    }
    await this.resume(checkpoint.checkpointId, checkpoint.branchLeafId);
  }

  selectBranch(headMessageId: string): void {
    if (this.disposed) return;
    const leafId = this.branchLeafByHeadMessageId.get(headMessageId);
    if (!leafId || !this.remoteIdValue) return;
    const sessionId = this.remoteIdValue;
    const task = selectPiRpcSessionBranch({ sessionId, leafId }, this.manager.rpcTransportOptions)
      .then(() => this.reload())
      .catch(async (error) => {
        // assistant-ui switches its local repository optimistically before this
        // RPC runs. Re-publish the authoritative server branch on failure so a
        // rejected switch cannot leave the visible conversation on a branch
        // that Pi never selected.
        await this.reload().catch(() => this.publishMessages());
        throw error;
      })
      .finally(() => {
        if (this.branchSwitchTask === task) this.branchSwitchTask = undefined;
      });
    this.branchSwitchTask = task;
    void task.catch((error) => console.error("[workbench-pi] branch selection failed", error));
  }

  async cancel(): Promise<void> {
    if (this.disposed) return;
    if (!this.remoteIdValue) return;
    await cancelPiRpcSession({ sessionId: this.remoteIdValue }, this.manager.rpcTransportOptions);
  }

  private async queuePrompt(
    mode: PiQueueMode,
    prompt: PiQueuedPrompt,
    rpcId: string,
  ): Promise<SessionPromptValue> {
    if (this.disposed) throw new Error("PiClientSession has been disposed");
    if (!this.remoteIdValue) throw new PiApiError("pi_session_not_found", 404);
    await this.manager.connections.ensureSessionEvents(this.remoteIdValue, this.handleEvent);
    if (this.disposed) throw new Error("PiClientSession has been disposed");
    const clientTimeZone = browserTimeZone();
    const workspaceFeedbackClaim = this.manager.claimPromptFeedback(
      this.localId,
      this.remoteIdValue,
    );
    try {
      const admission = await promptPiRpcSession(
        {
          sessionId: this.remoteIdValue,
          mode: mode === "steer" ? "steer" : "queue",
          content: piPromptContent(
            appendWorkspaceFeedbackContext(prompt.message, workspaceFeedbackClaim?.items ?? []),
            prompt.images,
            prompt.documents,
          ),
          ...(prompt.composer === undefined ? {} : { composer: prompt.composer }),
          ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
        },
        rpcId,
        this.manager.rpcTransportOptions,
      );
      if (this.disposed) {
        this.manager.releasePromptFeedback(workspaceFeedbackClaim);
        return admission;
      }
      this.manager.commitPromptFeedback(workspaceFeedbackClaim);
      return admission;
    } catch (error) {
      this.manager.releasePromptFeedback(workspaceFeedbackClaim);
      throw error;
    }
  }

  private async updateQueue(itemId: string, action: SessionQueueAction): Promise<void> {
    if (this.disposed) return;
    if (!this.remoteIdValue) throw new PiApiError("pi_session_not_found", 404);
    await this.manager.connections.ensureSessionEvents(this.remoteIdValue, this.handleEvent);
    if (this.disposed) return;
    await updatePiRpcSessionQueue(
      { sessionId: this.remoteIdValue, itemId, action },
      this.manager.rpcTransportOptions,
    );
  }

  private async setQueuePaused(
    paused: boolean,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    if (this.disposed) return;
    if (!this.remoteIdValue) throw new PiApiError("pi_session_not_found", 404);
    await setPiSessionQueuePaused(
      this.remoteIdValue,
      paused,
      steering,
      followUp,
      this.manager.rpcTransportOptions,
    );
  }

  private async replaceQueue(
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    if (this.disposed) return;
    if (!this.remoteIdValue) throw new PiApiError("pi_session_not_found", 404);
    await replacePiSessionQueue(
      this.remoteIdValue,
      steering,
      followUp,
      this.manager.rpcTransportOptions,
    );
  }

  applyQueueSnapshot(items: readonly QueueItem[]): void {
    if (this.disposed) return;
    this.messageQueue.replaceAuthoritative(items);
  }

  applyContextTraceEvent(event: SessionContextTraceEventSummary): void {
    if (event.kind !== "prompt-composition") return;
    if (
      this.disposed ||
      event.sessionId !== this.remoteIdValue ||
      this.contextTraceIds.has(event.traceId)
    ) {
      return;
    }
    this.contextTraceIds.add(event.traceId);
    if (!recordPiContextTracePromptPresentation(event, this.contextTracePromptPresentations)) {
      return;
    }

    if (this.streamingMessage?.role === "assistant") {
      this.streamingMessage = appendPiContextTraceAssistantPart(this.streamingMessage, event);
      this.scheduleMessagesPublish();
      return;
    }

    // Prompt composition is emitted before a model call. Without an active assistant, the event
    // belongs to the next response, never the previous completed message.
    this.pendingContextTraceEvents.push(event);
  }

  acknowledgePrompt(rpcId: string): void {
    if (this.disposed) return;
    // Admission only confirms that the host accepted the RPC. Its running summary can still
    // report the previous idle state until agent_start (or another session event) arrives.
    // Keep the local run-start lease across that interval so a stale `running: false` cannot
    // remove the optimistic assistant row and create a visible blank frame.
    this.pendingPromptRpcIds.delete(rpcId);
  }

  connectIfRunning(): void {
    if (this.disposed) return;
    if (!this.remoteIdValue || !this.snapshotValue.isRunning) return;
    void this.manager.connections.ensureSessionEvents(this.remoteIdValue, this.handleEvent);
  }

  setRunningFromManager(
    running: boolean,
    runTiming?: PiRunTiming,
    authoritativeBaseline = false,
  ): void {
    if (this.disposed) return;
    if (running && this.terminalResponseReceived) return;
    if (!running && this.localRunLeaseActive) {
      // Live host and mux frames can cross on their independent sockets, so an idle host frame
      // cannot end a locally submitted run before its durable terminal event arrives. A unary
      // rebaseline after reconnect is different: once prompt admission has completed it is the
      // authoritative recovery path when message_end/agent_settled was missed.
      if (!authoritativeBaseline || this.promptRequestPending) return;
      this.clearLocalRunLease();
    }
    const wasRunning = this.snapshotValue.isRunning;
    if (!running && this.discardEmptyOptimisticAssistant()) {
      const messages = this.currentMessages();
      this.replaceSnapshot({
        messages,
        messageRepository: this.currentMessageRepository(messages),
        isRunning: false,
        runTiming: undefined,
        autoRetry: undefined,
      });
    } else {
      this.setRunning(running, false, runTiming);
    }
    if (running) this.connectIfRunning();
    else if (this.remoteIdValue) {
      this.manager.connections.scheduleSessionClose(this.remoteIdValue);
      if (wasRunning) {
        void this.reload().catch((error) =>
          console.error("[workbench-pi] background history refresh failed", error),
        );
      }
    }
  }

  private readonly handleEvent = (event: PiEvent): void => {
    if (this.disposed) return;
    const sequence = typeof event.sequence === "number" ? event.sequence : undefined;
    if (event.type === "subscribed") {
      if (sequence === undefined) return;
      const previousSequence = this.lastSequence;
      this.lastSequence = sequence;
      if (previousSequence !== sequence) this.requestHistoryRebaseline();
      return;
    }
    if (sequence !== undefined && sequence <= this.lastSequence) return;
    if (sequence !== undefined) this.lastSequence = sequence;

    if (event.runTiming !== undefined && this.snapshotValue.isRunning) {
      this.replaceSnapshot({
        runTiming: clientRunTiming(event.runTiming, this.snapshotValue.runTiming),
      });
    }

    if (event.type === "connected") {
      this.reconcileQueue(event);
      this.setRunningFromManager(event.isRunning === true);
      return;
    }
    if (event.type === "queue_update") {
      this.reconcileQueue(event);
      return;
    }
    if (event.type === "agent_start") {
      this.markPromptStarted();
      this.resumeVisibleResponse(event.runTiming);
      this.setRunning(true, true, event.runTiming);
      return;
    }
    if (event.type === "auto_retry_start") {
      const autoRetry = piAutoRetryFromEvent(event);
      if (!autoRetry) return;
      this.discardRetryingAssistant();
      this.pendingContextTraceEvents = [];
      this.contextTracePromptPresentations.clear();
      this.publishMessages({ autoRetry });
      return;
    }
    if (event.type === "auto_retry_end") {
      // Keep the retry presentation mounted until agent_settled closes the complete run. Clearing
      // it here creates a brief, misleading Pi Working frame after the final retry response.
      return;
    }

    const customMessage =
      event.type === "message" && event.role === "custom"
        ? event
        : event.type === "message_end" && eventMessage(event)?.role === "custom"
          ? eventMessage(event)
          : undefined;

    if (
      customMessage?.role === "custom" &&
      isWorkbenchComposerCommandResponseCustomType(customMessage.customType)
    ) {
      const response = parseWorkbenchComposerCommandResponseDetails(customMessage.details);
      if (response) {
        if (response.status === "running") this.markPromptStarted();
        this.applyComposerCommandResponse(
          response,
          typeof customMessage.timestamp === "number" && Number.isFinite(customMessage.timestamp)
            ? customMessage.timestamp
            : Date.now(),
        );
      }
      return;
    }

    if (
      customMessage?.role === "custom" &&
      customMessage.customType === WORKBENCH_PROMPT_FAILURE_CUSTOM_TYPE
    ) {
      const failure = parseWorkbenchPromptFailureDetails(customMessage.details);
      if (failure) {
        this.markPromptStarted();
        this.applyPromptFailure(
          failure,
          typeof customMessage.timestamp === "number" && Number.isFinite(customMessage.timestamp)
            ? customMessage.timestamp
            : Date.now(),
        );
      }
      return;
    }

    if (
      customMessage?.role === "custom" &&
      (customMessage.customType === WORKBENCH_ATTACHMENT_RECOGNITION_CUSTOM_TYPE ||
        customMessage.customType === WORKBENCH_IMAGE_RECOGNITION_CUSTOM_TYPE)
    ) {
      const snapshot = parseAttachmentRecognitionSnapshot(customMessage.details);
      if (snapshot) {
        this.markPromptStarted();
        this.applyAttachmentRecognitionSnapshot(snapshot);
      }
      return;
    }

    const conversationEvent = conversationEventFromSessionEvent(event.type, event);
    if (conversationEvent) {
      if (
        conversationEvent.kind === "compaction" &&
        hasRunningWorkbenchCompactCommandResponse([...this.baseMessages, ...this.liveMessages])
      ) {
        return;
      }
      this.liveMessages.push(
        conversationEventThreadMessage(
          conversationEvent,
          sequence === undefined
            ? createClientMessageId("pi-conversation-event")
            : `pi-event-${sequence}:conversation-event`,
          Date.now(),
        ),
      );
      this.publishMessages();
      return;
    }

    if (event.type === "message_start") {
      this.markPromptStarted();
      this.resumeVisibleResponse(event.runTiming);
      const message = eventMessage(event);
      if (message?.role === "user") {
        this.publishLiveUserMessage(message, sequence, undefined, false);
      } else if (message?.role === "assistant") {
        this.activeMessageTiming = {
          streamStartTime: Date.now(),
          totalChunks: 0,
        };
        const assistantMessageId =
          this.activeAssistantMessageId ??
          this.streamingMessage?.id ??
          createClientMessageId("pi-assistant");
        this.activeAssistantMessageId = assistantMessageId;
        this.streamingMessage = this.preserveActiveAssistantRecognition(
          piAssistantToThreadMessage(message as PiAssistantMessage, assistantMessageId, {
            optimistic: true,
            streaming: true,
            timing: this.currentMessageTiming(message as PiAssistantMessage),
            toolTimingById: this.toolTimingById,
          }),
        );
        this.scheduleMessagesPublish();
      }
      return;
    }

    if (event.type === "message_update") {
      this.markPromptStarted();
      const message = eventMessage(event);
      if (message?.role === "assistant") {
        const assistantMessage = message as PiAssistantMessage;
        if (this.activeMessageTiming) {
          this.activeMessageTiming.totalChunks += 1;
          if (
            this.activeMessageTiming.firstTokenTime === undefined &&
            hasOutputToken(assistantMessage)
          ) {
            this.activeMessageTiming.firstTokenTime =
              Date.now() - this.activeMessageTiming.streamStartTime;
          }
        }
        const assistantMessageId =
          this.activeAssistantMessageId ??
          this.streamingMessage?.id ??
          createClientMessageId("pi-assistant");
        this.activeAssistantMessageId = assistantMessageId;
        this.streamingMessage = this.preserveActiveAssistantRecognition(
          piAssistantToThreadMessage(assistantMessage, assistantMessageId, {
            optimistic: true,
            streaming: true,
            timing: this.currentMessageTiming(assistantMessage),
            toolTimingById: this.toolTimingById,
            rawToolArgsText: rawToolArgsTextFromEvent(event),
          }),
        );
        this.scheduleMessagesPublish();
      }
      return;
    }

    if (event.type === "tool_execution_start") {
      this.markPromptStarted();
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
      const toolTiming = toolCallId ? this.startToolTiming(toolCallId) : undefined;
      if (
        toolCallId &&
        this.updateToolExecution({
          state: "running",
          toolCallId,
          startedAt: toolTiming?.startedAt,
        })
      ) {
        this.scheduleMessagesPublish();
      }
      return;
    }

    if (event.type === "tool_execution_update") {
      this.markPromptStarted();
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
      const toolTiming = toolCallId ? this.startToolTiming(toolCallId) : undefined;
      if (
        toolCallId &&
        this.updateToolExecution({
          state: "running",
          toolCallId,
          partialResult: event.partialResult,
          startedAt: toolTiming?.startedAt,
        })
      ) {
        this.scheduleMessagesPublish();
      }
      return;
    }

    if (event.type === "tool_execution_end") {
      this.markPromptStarted();
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
      const toolTiming = toolCallId ? this.completeToolTiming(toolCallId) : undefined;
      if (
        toolCallId &&
        this.updateToolExecution({
          state: "complete",
          toolCallId,
          result: event.result,
          isError: event.isError === true,
          completedAt: toolTiming?.completedAt,
        })
      ) {
        this.scheduleMessagesPublish();
      }
      return;
    }

    if (event.type === "message_end") {
      this.markPromptStarted();
      const message = eventMessage(event);
      if (message?.role === "user") {
        const workbenchComposer = parseWorkbenchComposerUserProjection(event.workbenchComposer);
        this.publishLiveUserMessage(message, sequence, workbenchComposer, true);
        return;
      }
      if (message?.role === "assistant") {
        const assistantMessage = message as PiAssistantMessage;
        const timing = this.completeMessageTiming(assistantMessage);
        if (timing && assistantMessage.timestamp !== undefined) {
          this.messageTimingByTimestamp.set(assistantMessage.timestamp, timing);
        }
        const assistantMessageId =
          this.activeAssistantMessageId ??
          this.streamingMessage?.id ??
          createClientMessageId("pi-assistant");
        this.insertCompletedAssistantMessage(
          this.preserveActiveAssistantRecognition(
            piAssistantToThreadMessage(assistantMessage, assistantMessageId, {
              optimistic: true,
              timing,
              toolTimingById: this.toolTimingById,
              eventSeq: sequence,
            }),
          ),
        );
        this.activeMessageTiming = undefined;
        this.activeAssistantMessageId = undefined;
        this.streamingMessage = undefined;
        if (assistantMessage.stopReason === "stop") {
          // Pi has completed the user-visible response. AgentSession may remain busy while
          // agent_settled extension handlers finish, but assistant-ui must not keep this run open.
          // The manager retains the authoritative host-running state until agent_settled.
          this.terminalResponseReceived = true;
          this.publishMessagesAndSetRunning(false, false);
        } else this.publishMessages();
      }
      return;
    }

    if (
      event.type === "agent_settled" ||
      event.type === "command_done" ||
      event.type === "command_error"
    ) {
      this.clearLocalRunLease();
      this.activeMessageTiming = undefined;
      if (this.discardEmptyOptimisticAssistant()) {
        this.publishMessagesAndSetRunning(false);
      } else {
        this.setRunning(false);
      }
      if (this.remoteIdValue) this.manager.connections.scheduleSessionClose(this.remoteIdValue);
      void this.reload()
        .then(() => this.manager.refreshMetadata())
        .catch((error) => console.error("[workbench-pi] history refresh failed", error));
    }
  };

  private requestHistoryRebaseline(): void {
    if (this.disposed) return;
    const generation = ++this.historyRebaselineGeneration;
    const currentReload = this.reloadTask;
    void Promise.resolve(currentReload)
      .catch(() => undefined)
      .then(async () => {
        if (this.disposed || generation !== this.historyRebaselineGeneration) return;
        await this.reload();
      })
      .catch((error) => console.error("[workbench-pi] stream rebaseline failed", error));
  }

  private preserveActiveAssistantRecognition(message: ThreadMessage): ThreadMessage {
    if (message.role !== "assistant") return message;

    const previous =
      this.streamingMessage?.role === "assistant" ? this.streamingMessage : undefined;
    let projected: ThreadAssistantMessage = message;
    if (previous) {
      const promptRpcId = previous.metadata.custom.workbenchPromptRpcId;
      const submissionId = attachmentRecognitionSubmissionIdFromMessage(previous);
      projected = {
        ...message,
        metadata: {
          ...message.metadata,
          custom: {
            ...message.metadata.custom,
            ...(typeof promptRpcId === "string" ? { workbenchPromptRpcId: promptRpcId } : {}),
            ...(typeof submissionId === "string"
              ? { workbenchAttachmentRecognitionSubmissionId: submissionId }
              : {}),
          },
        },
      };
      projected = reconcilePiContextTraceAssistantParts(projected, previous);
      const recognition = attachmentRecognitionSnapshotFromMessage(previous);
      if (recognition) {
        projected = upsertAttachmentRecognitionAssistantPart(projected, recognition);
      }
    }
    if (this.pendingContextTraceEvents.length > 0) {
      for (const event of this.pendingContextTraceEvents) {
        projected = appendPiContextTraceAssistantPart(projected, event);
      }
      this.pendingContextTraceEvents = [];
    }
    return projected;
  }

  private publishLiveUserMessage(
    message: PiUserMessage,
    sequence: number | undefined,
    workbenchComposer: PiUserMessage["workbenchComposer"],
    completed: boolean,
  ): void {
    const generatedId =
      sequence === undefined ? createClientMessageId("pi-user") : `pi-event-${sequence}`;
    const activeIndex = this.activeUserMessageId
      ? this.liveMessages.findIndex((candidate) => candidate.id === this.activeUserMessageId)
      : -1;
    const rawUserMessage = livePiUserMessage(message, generatedId, sequence, undefined);
    const projectedUserMessage = livePiUserMessage(
      message,
      generatedId,
      sequence,
      workbenchComposer,
    );
    const optimisticIndex =
      activeIndex >= 0
        ? activeIndex
        : this.liveMessages.findIndex(
            (candidate): candidate is ThreadUserMessage =>
              candidate.role === "user" &&
              candidate.metadata.custom.piOptimistic === true &&
              candidate.metadata.custom.piUserMessageStarted !== true &&
              (attachmentRecognitionSnapshotFromMessage(candidate)?.submissionId ===
                workbenchComposer?.submissionId ||
                sameUserPrompt(candidate, rawUserMessage) ||
                sameUserPrompt(candidate, projectedUserMessage)),
          );

    let publishedId = generatedId;
    if (optimisticIndex < 0) {
      const alreadyPublished = this.liveMessages.some(
        (candidate) =>
          candidate.role === "user" && candidate.metadata.custom.piEventSeq === sequence,
      );
      const alreadyAuthoritative = this.baseMessages.some(
        (candidate) =>
          candidate.role === "user" && candidate.metadata.custom.piEventSeq === sequence,
      );
      if (!alreadyPublished && !alreadyAuthoritative) {
        this.liveMessages.push(projectedUserMessage);
      }
    } else {
      const optimistic = this.liveMessages[optimisticIndex] as ThreadUserMessage;
      publishedId = optimistic.id;
      const authoritativeContent =
        activeIndex >= 0 || workbenchComposer ? projectedUserMessage.content : optimistic.content;
      const authoritativeAttachments = new Set(
        authoritativeContent.flatMap((part) =>
          part.type === "image"
            ? [`image:${part.image}`]
            : part.type === "file"
              ? [`file:${part.mimeType}:${part.data}`]
              : [],
        ),
      );
      const optimisticDisplayAttachments = optimistic.content.filter(
        (part) =>
          (part.type === "image" && !authoritativeAttachments.has(`image:${part.image}`)) ||
          (part.type === "file" &&
            !authoritativeAttachments.has(`file:${part.mimeType}:${part.data}`)),
      );
      this.liveMessages[optimisticIndex] = {
        ...optimistic,
        content: [
          ...authoritativeContent.filter(
            (part) => part.type !== "data" || !isRecognitionDataName(part.name),
          ),
          ...optimisticDisplayAttachments,
        ],
        createdAt: projectedUserMessage.createdAt,
        metadata: {
          ...optimistic.metadata,
          custom: {
            ...optimistic.metadata.custom,
            ...projectedUserMessage.metadata.custom,
          },
        },
      };
    }

    this.activeUserMessageId = completed ? undefined : publishedId;
    this.publishMessages();
  }

  private updateToolExecution(update: Parameters<typeof applyToolExecutionUpdate>[1]): boolean {
    if (this.streamingMessage) {
      const messages = [this.streamingMessage];
      if (applyToolExecutionUpdate(messages, update)) {
        this.streamingMessage = messages[0];
        return true;
      }
    }
    if (applyToolExecutionUpdate(this.liveMessages, update)) return true;
    return applyToolExecutionUpdate(this.baseMessages, update);
  }

  private applyComposerCommandResponse(
    response: NonNullable<ReturnType<typeof parseWorkbenchComposerCommandResponseDetails>>,
    timestamp: number,
  ): void {
    const responseId = workbenchComposerCommandResponseId(response);
    if (this.baseMessages.some((message) => message.id === responseId)) {
      this.baseMessages = upsertWorkbenchComposerCommandResponse(
        this.baseMessages,
        response,
        timestamp,
      );
    } else {
      this.liveMessages = upsertWorkbenchComposerCommandResponse(
        this.liveMessages,
        response,
        timestamp,
      );
    }
    this.publishMessages();
  }

  private applyPromptFailure(
    failure: NonNullable<ReturnType<typeof parseWorkbenchPromptFailureDetails>>,
    timestamp: number,
  ): void {
    this.bindPromptFailureUserEntry(failure);
    const preferredId =
      failure.rpcId !== undefined &&
      this.streamingMessage?.metadata.custom.workbenchPromptRpcId === failure.rpcId
        ? this.streamingMessage.id
        : undefined;
    const hasPersistedFailure = this.baseMessages.some(
      (message) =>
        parseWorkbenchPromptFailureDetails(message.metadata.custom.workbenchPromptFailure)
          ?.submissionId === failure.submissionId,
    );
    if (hasPersistedFailure) {
      this.baseMessages = upsertWorkbenchPromptFailure(
        this.baseMessages,
        failure,
        timestamp,
        preferredId,
      );
    } else {
      this.liveMessages = upsertWorkbenchPromptFailure(
        this.liveMessages,
        failure,
        timestamp,
        preferredId,
      );
    }
    this.activeMessageTiming = undefined;
    this.activeAssistantMessageId = undefined;
    this.streamingMessage = undefined;
    this.terminalResponseReceived = true;
    this.clearLocalRunLease();
    this.publishMessagesAndSetRunning(false);
    if (this.remoteIdValue) this.manager.connections.scheduleSessionClose(this.remoteIdValue);
  }

  private bindPromptFailureUserEntry(
    failure: NonNullable<ReturnType<typeof parseWorkbenchPromptFailureDetails>>,
  ): void {
    if (failure.rpcId === undefined || failure.userEntryId === undefined) return;
    const bind = (messages: ThreadMessage[]) => {
      const index = messages.findLastIndex(
        (message) =>
          message.role === "user" && message.metadata.custom.workbenchPromptRpcId === failure.rpcId,
      );
      if (index < 0) return false;
      const current = messages[index];
      if (!current || current.role !== "user") return false;
      const updated = [...messages];
      updated[index] = {
        ...current,
        metadata: {
          ...current.metadata,
          custom: {
            ...current.metadata.custom,
            piResolvedEntryId: failure.userEntryId,
          },
        },
      };
      if (messages === this.liveMessages) this.liveMessages = updated;
      else this.baseMessages = updated;
      return true;
    };
    if (!bind(this.liveMessages)) bind(this.baseMessages);
  }

  private applyAttachmentRecognitionSnapshot(incoming: AttachmentRecognitionSnapshot): void {
    const current = this.attachmentRecognitionSnapshots.get(incoming.operationId);
    let next = incoming;
    if (current) {
      try {
        next = reduceAttachmentRecognitionSnapshot(current, incoming);
      } catch {
        return;
      }
      if (next === current) return;
    }
    this.attachmentRecognitionSnapshots.set(next.operationId, next);
    this.baseMessages = withoutAttachmentRecognitionUserParts(this.baseMessages);
    this.liveMessages = withoutAttachmentRecognitionUserParts(this.liveMessages);
    const streamingRecognition = this.streamingMessage
      ? attachmentRecognitionSnapshotFromMessage(this.streamingMessage)
      : undefined;
    const streamingPromptRpcId = this.streamingMessage?.metadata.custom.workbenchPromptRpcId;
    const streamingSubmissionId = this.streamingMessage
      ? attachmentRecognitionSubmissionIdFromMessage(this.streamingMessage)
      : undefined;
    const belongsToStreamingAssistant =
      this.streamingMessage?.role === "assistant" &&
      (streamingRecognition?.operationId === next.operationId ||
        (next.rpcId !== undefined && streamingPromptRpcId === next.rpcId) ||
        streamingSubmissionId === next.submissionId);
    if (belongsToStreamingAssistant && this.streamingMessage?.role === "assistant") {
      this.streamingMessage = upsertAttachmentRecognitionAssistantPart(this.streamingMessage, next);
    } else {
      const baseMessageIds = new Set(this.baseMessages.map((message) => message.id));
      const projectedBaseMessages = upsertAttachmentRecognitionInMessages(this.baseMessages, next);
      const detachedBaseStatus = projectedBaseMessages.find(
        (message) =>
          !baseMessageIds.has(message.id) && isAttachmentRecognitionOnlyAssistant(message),
      );
      const projectedLiveMessages = upsertAttachmentRecognitionInMessages(this.liveMessages, next);
      const liveStatus = projectedLiveMessages.find(
        (message) =>
          message.role === "assistant" &&
          attachmentRecognitionSnapshotFromMessage(message)?.operationId === next.operationId,
      );
      if (detachedBaseStatus && (!liveStatus || isAttachmentRecognitionOnlyAssistant(liveStatus))) {
        // A status projected from an older base user has to remain interleaved with that base
        // history. Moving it into liveMessages puts it after every base turn, where consecutive
        // assistant coalescing can incorrectly attach it to the currently streaming response.
        this.baseMessages = projectedBaseMessages;
        this.liveMessages = projectedLiveMessages.filter(
          (message) =>
            !isAttachmentRecognitionOnlyAssistant(message) ||
            attachmentRecognitionSnapshotFromMessage(message)?.operationId !== next.operationId,
        );
      } else {
        this.baseMessages = projectedBaseMessages.filter((message) =>
          baseMessageIds.has(message.id),
        );
        this.liveMessages = projectedLiveMessages;
      }
    }
    this.publishMessages();
  }

  private mergeAttachmentRecognitionHistory(messages: readonly ThreadMessage[]): ThreadMessage[] {
    for (const message of messages) {
      const incoming = attachmentRecognitionSnapshotFromMessage(message);
      if (!incoming) continue;
      const current = this.attachmentRecognitionSnapshots.get(incoming.operationId);
      if (!current) {
        this.attachmentRecognitionSnapshots.set(incoming.operationId, incoming);
        continue;
      }
      try {
        const next = reconcileAttachmentRecognitionSnapshot(current, incoming);
        if (next !== current) this.attachmentRecognitionSnapshots.set(next.operationId, next);
      } catch {
        // Keep the last valid live snapshot when persisted history conflicts at one revision.
      }
    }

    let reconciled = withoutAttachmentRecognitionUserParts(messages);
    for (const snapshot of this.attachmentRecognitionSnapshots.values()) {
      const streamingRecognition = this.streamingMessage
        ? attachmentRecognitionSnapshotFromMessage(this.streamingMessage)
        : undefined;
      const streamingPromptRpcId = this.streamingMessage?.metadata.custom.workbenchPromptRpcId;
      const streamingSubmissionId = this.streamingMessage
        ? attachmentRecognitionSubmissionIdFromMessage(this.streamingMessage)
        : undefined;
      const belongsToStreamingAssistant =
        this.streamingMessage?.role === "assistant" &&
        (streamingRecognition?.operationId === snapshot.operationId ||
          (snapshot.rpcId !== undefined && streamingPromptRpcId === snapshot.rpcId) ||
          streamingSubmissionId === snapshot.submissionId);
      if (belongsToStreamingAssistant && this.streamingMessage?.role === "assistant") {
        this.streamingMessage = reconcileAttachmentRecognitionAssistantPart(
          this.streamingMessage,
          snapshot,
        );
        reconciled = reconciled.filter(
          (message) =>
            !isAttachmentRecognitionOnlyAssistant(message) ||
            attachmentRecognitionSnapshotFromMessage(message)?.operationId !== snapshot.operationId,
        );
      } else {
        reconciled = reconcileAttachmentRecognitionInMessages(reconciled, snapshot);
      }
    }
    return reconciled;
  }

  private startToolTiming(toolCallId: string): ToolCallTiming {
    const existing = this.toolTimingById.get(toolCallId);
    if (existing) return existing;

    const timing = { startedAt: Date.now() };
    this.toolTimingById.set(toolCallId, timing);
    return timing;
  }

  private completeToolTiming(toolCallId: string): ToolCallTiming {
    const existing = this.toolTimingById.get(toolCallId);
    const completedAt = Date.now();
    const timing = {
      startedAt: existing?.startedAt ?? completedAt,
      completedAt,
    };
    this.toolTimingById.set(toolCallId, timing);
    return timing;
  }

  private currentMessageTiming(
    message: PiAssistantMessage,
    totalStreamTime?: number,
  ): MessageTiming | undefined {
    const active = this.activeMessageTiming;
    if (!active) return undefined;
    const tokenCount = message.usage?.output;

    return {
      streamStartTime: active.streamStartTime,
      ...(active.firstTokenTime === undefined ? {} : { firstTokenTime: active.firstTokenTime }),
      ...(totalStreamTime === undefined ? {} : { totalStreamTime }),
      ...(tokenCount === undefined ? {} : { tokenCount }),
      ...(tokenCount === undefined || totalStreamTime === undefined || totalStreamTime <= 0
        ? {}
        : { tokensPerSecond: tokenCount / (totalStreamTime / 1000) }),
      totalChunks: active.totalChunks,
      toolCallCount: countToolCalls(message),
    };
  }

  private completeMessageTiming(message: PiAssistantMessage): MessageTiming | undefined {
    const active = this.activeMessageTiming;
    if (!active) return undefined;
    const totalStreamTime = Math.max(0, Date.now() - active.streamStartTime);
    if (active.firstTokenTime === undefined && hasOutputToken(message)) {
      active.firstTokenTime = totalStreamTime;
    }
    return this.currentMessageTiming(message, totalStreamTime);
  }

  private setRunning(running: boolean, notifyManager = true, runTiming?: PiRunTiming): void {
    if (this.snapshotValue.isRunning === running) {
      if (running && runTiming !== undefined) {
        this.replaceSnapshot({
          runTiming: clientRunTiming(runTiming, this.snapshotValue.runTiming),
        });
      } else if (!running && (this.snapshotValue.autoRetry || this.snapshotValue.runTiming)) {
        this.replaceSnapshot({ autoRetry: undefined, runTiming: undefined });
      }
      if (notifyManager && this.remoteIdValue) {
        this.manager.updateRunningFromSession(this.remoteIdValue, running, this, runTiming);
      }
      return;
    }
    this.replaceSnapshot({
      isRunning: running,
      runTiming:
        running && runTiming !== undefined
          ? clientRunTiming(runTiming, this.snapshotValue.runTiming)
          : running
            ? this.snapshotValue.runTiming
            : undefined,
      ...(running ? {} : { autoRetry: undefined }),
    });
    if (notifyManager && this.remoteIdValue) {
      this.manager.updateRunningFromSession(this.remoteIdValue, running, this, runTiming);
    }
  }

  private reconcileQueue(event: PiEvent): void {
    if (typeof event.queuePaused === "boolean") {
      this.messageQueue.setPausedFromServer(event.queuePaused);
    }
  }

  private markPromptStarted(): void {
    this.promptRequestPending = false;
    this.pendingPromptRpcIds.clear();
    if (this.promptStartTimer) clearTimeout(this.promptStartTimer);
    this.promptStartTimer = undefined;
  }

  private clearLocalRunLease(): void {
    this.localRunLeaseActive = false;
    this.markPromptStarted();
  }

  private resumeVisibleResponse(runTiming?: PiRunTiming): void {
    if (!this.terminalResponseReceived) return;
    this.terminalResponseReceived = false;
    this.setRunning(true, false, runTiming);
  }

  private discardRetryingAssistant(): void {
    const discard = (messages: ThreadMessage[]) => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role === "user") return false;
        if (message?.role !== "assistant") continue;
        if (message.status.type !== "incomplete" || message.status.reason !== "error") return false;
        messages.splice(index, 1);
        return true;
      }
      return false;
    };
    if (!discard(this.liveMessages)) discard(this.baseMessages);
  }

  private discardEmptyOptimisticAssistant(): boolean {
    const message = this.streamingMessage;
    const recognition = message ? attachmentRecognitionSnapshotFromMessage(message) : undefined;
    const recognitionOnly =
      message?.role === "assistant" &&
      recognition !== undefined &&
      message.content.every(
        (part) =>
          (part.type === "text" && part.text === "") ||
          (part.type === "data" && isRecognitionDataName(part.name)),
      );
    if (
      message?.role === "assistant" &&
      recognitionOnly &&
      recognition?.status === "skipped" &&
      recognition.method === "native"
    ) {
      this.streamingMessage = undefined;
      if (this.activeAssistantMessageId === message.id) {
        this.activeAssistantMessageId = undefined;
      }
      return true;
    }
    if (message?.role === "assistant" && recognitionOnly && recognition !== undefined) {
      this.insertCompletedAssistantMessage({
        ...message,
        content: message.content.filter(
          (part) => part.type === "data" && isRecognitionDataName(part.name),
        ),
        status: { type: "complete", reason: "unknown" },
        metadata: {
          ...message.metadata,
          custom: {
            ...message.metadata.custom,
            workbenchAttachmentRecognitionOnly: true,
          },
        },
      });
      this.streamingMessage = undefined;
      if (this.activeAssistantMessageId === message.id) {
        this.activeAssistantMessageId = undefined;
      }
      return true;
    }
    if (message?.role === "assistant" && isPiContextTraceOnlyAssistant(message)) {
      this.insertCompletedAssistantMessage({
        ...message,
        content: message.content.filter(
          (part) => part.type === "data" && part.name === WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME,
        ),
        status: { type: "complete", reason: "unknown" },
      });
      this.streamingMessage = undefined;
      if (this.activeAssistantMessageId === message.id) {
        this.activeAssistantMessageId = undefined;
      }
      return true;
    }
    if (
      message?.role !== "assistant" ||
      message.status.type !== "running" ||
      message.content.length !== 1 ||
      message.content[0]?.type !== "text" ||
      message.content[0].text !== ""
    ) {
      return false;
    }

    this.streamingMessage = undefined;
    if (this.activeAssistantMessageId === message.id) {
      this.activeAssistantMessageId = undefined;
    }
    return true;
  }

  private publishMessages(
    patch: Pick<Partial<PiSessionSnapshot>, "autoRetry" | "resumeCheckpoint"> = {},
  ): void {
    if (this.disposed) return;
    const messages = this.currentMessages();
    this.replaceSnapshot({
      messages,
      messageRepository: this.currentMessageRepository(messages),
      ...patch,
    });
  }

  private publishMessagesAndSetRunning(running: boolean, notifyManager = true): void {
    if (this.disposed) return;
    const messages = this.currentMessages();
    this.replaceSnapshot({
      messages,
      messageRepository: this.currentMessageRepository(messages),
      isRunning: running,
      ...(running ? {} : { runTiming: undefined }),
      autoRetry: undefined,
    });
    if (notifyManager && this.remoteIdValue) {
      this.manager.updateRunningFromSession(this.remoteIdValue, running, this);
    }
  }

  private currentMessages(): readonly ThreadMessage[] {
    const liveMessages = [...this.liveMessages];
    if (this.streamingMessage) {
      const pendingSteerIndex = this.firstPendingSteeringMessageIndex(liveMessages);
      if (pendingSteerIndex < 0) liveMessages.push(this.streamingMessage);
      else liveMessages.splice(pendingSteerIndex, 0, this.streamingMessage);
    }
    // History is already coalesced when it becomes the base. A live assistant can only merge
    // with the final base turn, so keep every older turn referentially stable while streaming.
    const baseTailStart =
      liveMessages.length === 0 || liveMessages[0]?.role === "user"
        ? this.baseMessages.length
        : Math.max(
            0,
            this.baseMessages.findLastIndex((message) => message.role === "user"),
          );
    const messages = this.baseMessages.slice(0, baseTailStart);
    messages.push(
      ...coalesceConsecutiveAssistantMessages([
        ...this.baseMessages.slice(baseTailStart),
        ...liveMessages,
      ]),
    );
    for (let index = Math.max(0, baseTailStart - 1); index < messages.length; index += 1) {
      const message = messages[index];
      const nextMessage = messages[index + 1];
      if (
        message?.role !== "assistant" ||
        nextMessage?.role !== "user" ||
        nextMessage.metadata.custom.piSteering !== true
      ) {
        continue;
      }

      messages[index] = {
        ...message,
        metadata: {
          ...message.metadata,
          custom: {
            ...message.metadata.custom,
            piSteerInterrupted: true,
            workbenchSteerInterrupted: true,
          },
        },
      };
    }
    return messages;
  }

  private currentMessageRepository(
    currentMessages: readonly ThreadMessage[],
  ): ExportedMessageRepository {
    const baseRepository = this.baseMessageRepository;
    let baseIndex = this.baseMessageRepositoryIndex;
    if (baseIndex?.repository !== baseRepository) {
      baseIndex = {
        repository: baseRepository,
        byId: new Map(baseRepository.messages.map((item, index) => [item.message.id, index])),
      };
      this.baseMessageRepositoryIndex = baseIndex;
    }
    let messages: ExportedMessageRepository["messages"] | undefined;
    const appendedIndexes = new Map<string, number>();
    let parentId: string | null = null;

    // assistant-ui treats messageRepository as authoritative when both repository and
    // messages are supplied. Project the active branch from the same coalesced messages
    // used by the flat snapshot so one Pi agent turn does not render every internal
    // model/tool cycle as a separate completed assistant response.
    for (const message of currentMessages) {
      const item = { message, parentId };
      const existingIndex = baseIndex.byId.get(message.id) ?? appendedIndexes.get(message.id);
      const existing =
        existingIndex === undefined
          ? undefined
          : (messages ?? baseRepository.messages)[existingIndex];
      if (existingIndex !== undefined && existing) {
        if (existing.message !== message || existing.parentId !== parentId) {
          messages ??= [...baseRepository.messages];
          messages[existingIndex] = { ...existing, ...item };
        }
      } else {
        messages ??= [...baseRepository.messages];
        appendedIndexes.set(message.id, messages.length);
        messages.push(item);
      }
      parentId = message.id;
    }
    if (!messages && baseRepository.headId === parentId) return baseRepository;
    return { headId: parentId, messages: messages ?? baseRepository.messages };
  }

  private firstPendingSteeringMessageIndex(messages: readonly ThreadMessage[]): number {
    return messages.findIndex(
      (message) =>
        message.role === "user" &&
        message.metadata.custom.piSteering === true &&
        message.metadata.custom.piUserMessageStarted !== true,
    );
  }

  private insertCompletedAssistantMessage(message: ThreadMessage): void {
    const pendingSteerIndex = this.firstPendingSteeringMessageIndex(this.liveMessages);
    if (pendingSteerIndex < 0) this.liveMessages.push(message);
    else this.liveMessages.splice(pendingSteerIndex, 0, message);
  }

  private stabilizeAuthoritativeMessageIds(
    messages: readonly ThreadMessage[],
    baseMessageIdsAtStart: ReadonlySet<string>,
  ): ThreadMessage[] {
    const unmatchedOptimisticUsers = this.liveMessages.filter(
      (message): message is ThreadUserMessage =>
        message.role === "user" && message.metadata.custom.piOptimistic === true,
    );
    const unmatchedOptimisticAssistants = coalesceConsecutiveAssistantMessages([
      ...this.liveMessages,
      ...(this.streamingMessage ? [this.streamingMessage] : []),
    ]).filter(
      (message): message is ThreadAssistantMessage =>
        message.role === "assistant" && message.metadata.isOptimistic === true,
    );

    return messages.map((message) => {
      const existingAlias = this.authoritativeMessageIdAliases.get(message.id);
      if (existingAlias) return { ...message, id: existingAlias };
      if (baseMessageIdsAtStart.has(message.id)) return message;

      if (message.role === "assistant") {
        const optimisticIndex = unmatchedOptimisticAssistants.findIndex((candidate) =>
          sameAssistantResponse(candidate, message),
        );
        if (optimisticIndex < 0) return message;

        const [optimistic] = unmatchedOptimisticAssistants.splice(optimisticIndex, 1);
        if (!optimistic) return message;
        this.authoritativeMessageIdAliases.set(message.id, optimistic.id);
        return { ...message, id: optimistic.id };
      }

      if (message.role !== "user") return message;

      const optimisticIndex = unmatchedOptimisticUsers.findIndex((candidate) =>
        sameUserPrompt(candidate, message),
      );
      if (optimisticIndex < 0) return message;

      const [optimistic] = unmatchedOptimisticUsers.splice(optimisticIndex, 1);
      if (!optimistic) return message;
      this.authoritativeMessageIdAliases.set(message.id, optimistic.id);
      return { ...message, id: optimistic.id };
    });
  }

  private publishQueueState(): void {
    if (this.disposed) return;
    let messagesChanged = false;
    for (const item of this.messageQueue.steeringItems) {
      if (this.steeringMessageIds.has(item.id)) continue;
      const messageId = `pi-steer-${item.id}`;
      this.steeringMessageIds.set(item.id, messageId);
      const steeringMessage = optimisticUserMessage(
        queueItemAppendMessage(item),
        messageId,
      ) as ThreadUserMessage;
      this.liveMessages.push({
        ...steeringMessage,
        metadata: {
          ...steeringMessage.metadata,
          custom: {
            ...steeringMessage.metadata.custom,
            piSteering: true,
          },
        },
      });
      messagesChanged = true;
    }
    let messagePatch: Partial<Pick<PiSessionSnapshot, "messages" | "messageRepository">> = {};
    if (messagesChanged) {
      const messages = this.currentMessages();
      messagePatch = {
        messages,
        messageRepository: this.currentMessageRepository(messages),
      };
    }
    this.replaceSnapshot({
      queuePaused: this.messageQueue.isPaused,
      steeringQueueIds: this.messageQueue.steeringItems.map((item) => item.id),
      ...messagePatch,
    });
  }

  private rejectOptimisticSteer(itemId: string): void {
    const messageId = this.steeringMessageIds.get(itemId);
    if (!messageId) return;
    this.steeringMessageIds.delete(itemId);
    this.liveMessages = this.liveMessages.filter((message) => message.id !== messageId);
  }

  private scheduleMessagesPublish(): void {
    if (this.disposed) return;
    if (this.messagePublishScheduled) return;
    this.messagePublishScheduled = true;
    const publish = () => {
      this.messagePublishScheduled = false;
      if (this.disposed) return;
      this.publishMessages();
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(publish);
    } else {
      queueMicrotask(publish);
    }
  }

  private replaceSnapshot(patch: Partial<PiSessionSnapshot>): void {
    if (this.disposed) return;
    this.snapshotValue = { ...this.snapshotValue, ...patch };
    for (const listener of this.listeners) listener();
  }
}

export interface PiSessionTitleFallbacks {
  readonly attachment: string;
  readonly image: string;
}

export interface PiSessionManagerOptions {
  readonly promptFeedback?: PromptFeedbackPort;
  readonly titleFallbacks?: PiSessionTitleFallbacks;
  readonly transport?: PiClientTransport;
}

/**
 * Fast Refresh preserves React refs while replacing this module. Managers created by an older
 * module evaluation may therefore be missing newly added client-session methods. The provider
 * compares this generation token and replaces those retained managers before exposing them again.
 */
export const PI_CLIENT_RUNTIME_IMPLEMENTATION_TOKEN = Object.freeze({
  scope: "pi-client-runtime",
});

export class PiSessionManager {
  readonly implementationToken = PI_CLIENT_RUNTIME_IMPLEMENTATION_TOKEN;
  readonly connections: PiConnectionController;
  readonly modelCatalogInvalidation = new PiModelCatalogInvalidation();
  readonly resourceCatalogRevision = new PiResourceCatalogRevision();
  readonly packageUpdatesQuery: PiPackageUpdatesQuery;
  readonly workbenchSettings: PiWorkbenchSettingsClient;
  readonly contextPolicies: PiSessionContextPolicyClient;
  readonly rpcTransportOptions: Readonly<Pick<PiRpcCallOptions, "invalidation" | "transport">>;
  private readonly listeners = new Set<Listener>();
  private readonly threadListListeners = new Set<Listener>();
  private readonly activeSessionListeners = new Set<Listener>();
  private readonly contextTraceListeners = new Set<PiSessionContextTraceListener>();
  private readonly hostEventListeners = new Set<PiHostEventListener>();
  private readonly connectionReadyListeners = new Set<Listener>();
  private readonly threadStateBuckets = new Map<string, PiThreadStateBucket>();
  private readonly summaries = new Map<string, PiSessionSummary>();
  private readonly workspaces = new Map<string, WorkspaceView>();
  private readonly sessions = new Map<string, PiClientSession>();
  private readonly scratchSessions = new Map<string, SessionScratchCreateValue>();
  private readonly aliases = new Map<string, string>();
  private readonly initializeTasks = new Map<string, Promise<PiSessionSummary>>();
  private readonly requestedSessionIntents = new Map<string, SessionCreateIntent>();
  private readonly draftWorkspaces = new Map<string, PiWorkspaceSummary>();
  private readonly pendingQueues = new Map<string, readonly QueueItem[]>();
  private readonly pendingInteractions = new Map<string, StoredPendingInteraction>();
  private readonly waitingForUserInput = new Set<string>();
  private readonly archived = new Set<string>();
  private readonly pinned = new Set<string>();
  private readonly pinnedWorkspaces = new Set<string>();
  private readonly completed = new Set<string>();
  private readonly pendingModelSelections = new Map<string, Promise<SessionSelectModelValue>>();
  private readonly runTimings = new Map<string, PiClientRunTiming>();
  private running = new Set<string>();
  private activeLocalId?: string;
  private activeRemoteId?: string;
  private startTask?: Promise<void>;
  private hostDescriptionValue?: HostDescription;
  private hostDescriptionTask?: Promise<void>;
  private metadataRefreshTask?: Promise<void>;
  private metadataMutations?: Map<string, PiSessionSummary | null>;
  private metadataRunningMutations?: Map<
    string,
    { readonly running: boolean; readonly runTiming?: PiRunTiming }
  >;
  private metadataWaitingForUserInputMutations?: Map<string, boolean>;
  private workspaceGeneration = 0;
  private connectionGeneration = 0;
  private realtimeRefreshRequested = false;
  private realtimeRefreshTask?: Promise<void>;
  private forkTaskTail: Promise<void> = Promise.resolve();
  private revision = 0;
  private threadListRevision = 0;
  private threadListStructureKey = "[]";
  private threadListBaselineReady = false;
  private disposed = false;
  private readonly promptFeedback?: PromptFeedbackPort;
  private titleFallbacks?: PiSessionTitleFallbacks;

  constructor(options: Readonly<PiSessionManagerOptions> = {}) {
    const transport = snapshotPiClientTransport(options.transport);
    this.promptFeedback = options.promptFeedback;
    this.titleFallbacks = options.titleFallbacks;
    this.rpcTransportOptions = Object.freeze({
      ...(transport.http === undefined ? {} : { transport: transport.http }),
      invalidation: {
        invalidateModelCatalog: this.modelCatalogInvalidation.invalidate,
        invalidateSessionModelSelection: this.modelCatalogInvalidation.invalidateSessionSelection,
      },
    });
    this.packageUpdatesQuery = createPiPackageUpdatesQuery({
      load: (target) => listAvailablePiPackageUpdates({ target }, this.rpcTransportOptions),
    });
    this.workbenchSettings = new PiWorkbenchSettingsClient(this.rpcTransportOptions);
    this.contextPolicies = new PiSessionContextPolicyClient(this.rpcTransportOptions);
    this.connections = new PiConnectionController({
      webSocketFactory: transport.webSocketFactory,
      onMuxFrame: (frame, generation) => this.handleMuxFrame(frame, generation),
      onHostFrame: (payload, generation) => this.handleHostFrame(payload, generation),
      onGenerationReady: (generation) => this.handleGenerationReady(generation),
      onConnectionRecoveringChange: () => this.notify(),
    });
  }

  getSnapshot = (): number => this.revision;

  getThreadListRevision = (): number => this.threadListRevision;

  setTitleFallbacks(fallbacks: PiSessionTitleFallbacks): void {
    this.titleFallbacks = fallbacks;
  }

  async waitForPendingSessionModelSelection(sessionId: string): Promise<void> {
    while (true) {
      const pending = this.pendingModelSelections.get(sessionId);
      if (!pending) return;
      await pending;
    }
  }

  async selectSessionModel(payload: SessionSelectModelPayload): Promise<SessionSelectModelValue> {
    const request = selectPiRpcSessionModel(payload, this.rpcTransportOptions);
    this.pendingModelSelections.set(payload.sessionId, request);
    try {
      return await request;
    } finally {
      if (this.pendingModelSelections.get(payload.sessionId) === request) {
        this.pendingModelSelections.delete(payload.sessionId);
      }
    }
  }

  getActiveSessionId = (): string | undefined => this.activeRemoteId;

  getHostDescription = (): HostDescription | undefined => this.hostDescriptionValue;

  subscribeActiveSession = (listener: Listener): (() => void) => {
    if (this.disposed) return () => undefined;
    this.activeSessionListeners.add(listener);
    return () => this.activeSessionListeners.delete(listener);
  };

  claimPromptFeedback(localId: string, remoteId?: string): PromptFeedbackClaim | undefined {
    return this.promptFeedback?.claimForThreads([localId, ...(remoteId ? [remoteId] : [])]);
  }

  commitPromptFeedback(claim: PromptFeedbackClaim | undefined): void {
    if (claim) this.promptFeedback?.commit(claim.token);
  }

  releasePromptFeedback(claim: PromptFeedbackClaim | undefined): void {
    if (claim) this.promptFeedback?.release(claim.token);
  }

  getWorkspaces(): readonly PiWorkspaceSummary[] {
    return [...this.workspaces.values()].map((workspace) => ({
      id: workspace.workspaceId,
      name: workspace.title,
      cwd: workspace.path,
      pinned: this.pinnedWorkspaces.has(workspace.workspaceId),
    }));
  }

  getPendingInteractions(sessionId?: string): readonly PiPendingInteraction[] {
    return [...this.pendingInteractions.values()]
      .map(({ interaction }) => interaction)
      .filter((interaction) => sessionId === undefined || interaction.sessionId === sessionId);
  }

  async respondInteraction(rpcId: string, response: PiInteractionResponse): Promise<RpcReceipt> {
    const pending = [...this.pendingInteractions.values()]
      .map(({ interaction }) => interaction)
      .find((interaction) => interaction.rpcId === rpcId);
    if (!pending) throw new PiApiError("pi_interaction_not_found", 404, { rpcId });
    if (response.kind !== "cancel" && response.kind !== pending.kind) {
      throw new PiApiError("pi_interaction_kind_mismatch", 400, {
        rpcId,
        expected: pending.kind,
        received: response.kind,
      });
    }
    const result =
      response.kind === "cancel"
        ? {
            ok: false as const,
            error: {
              code: "cancelled" as const,
              message: response.message ?? "The interaction was cancelled.",
              details: {},
            },
          }
        : pending.kind === "question" && response.kind === "question"
          ? {
              ok: true as const,
              value: {
                sessionId: pending.sessionId,
                answer: {
                  answers: response.answers.map((answer) => ({
                    id: answer.id,
                    selected: [...answer.selected],
                    ...(answer.custom === undefined ? {} : { custom: answer.custom }),
                  })),
                },
              },
            }
          : {
              ok: true as const,
              value: {
                sessionId: pending.sessionId,
                approvalId: (pending as Extract<PiPendingInteraction, { kind: "approval" }>)
                  .approvalId,
                outcome: (response as Extract<PiInteractionResponse, { kind: "approval" }>).outcome,
              },
            };
    const receipt = await respondPiRpc(
      { type: "client-response", rpcId, result },
      this.rpcTransportOptions,
    );
    if (receipt.accepted || receipt.reason === "not-pending") {
      for (const [key, stored] of this.pendingInteractions) {
        if (stored.interaction.rpcId === rpcId) this.pendingInteractions.delete(key);
      }
      this.notify();
    }
    return receipt;
  }

  private workspaceForSession(sessionId: string): WorkspaceView | undefined {
    for (const workspace of this.workspaces.values()) {
      if (workspace.sessionIds.includes(sessionId)) return workspace;
    }
    const summary = this.summaries.get(sessionId);
    return summary
      ? [...this.workspaces.values()].find((workspace) => workspace.path === summary.cwd)
      : undefined;
  }

  private orderedSummaries(): PiSessionSummary[] {
    const ordered: PiSessionSummary[] = [];
    const included = new Set<string>();
    for (const workspace of this.workspaces.values()) {
      for (const sessionId of workspace.sessionIds) {
        const summary = this.summaries.get(sessionId);
        if (!summary || included.has(sessionId)) continue;
        ordered.push(summary);
        included.add(sessionId);
      }
    }
    for (const summary of this.summaries.values()) {
      if (!included.has(summary.id)) ordered.push(summary);
    }
    return [
      ...ordered.filter((summary) => this.pinned.has(summary.id)),
      ...ordered.filter((summary) => !this.pinned.has(summary.id)),
    ];
  }

  getThreadListSnapshot(): readonly PiThreadListItemSnapshot[] {
    return this.orderedSummaries().map((summary) => ({
      status: this.archived.has(summary.id) ? "archived" : "regular",
      remoteId: summary.id,
      title: this.summaryTitle(summary) || undefined,
      lastMessageAt: new Date(summary.modified),
      custom: this.getThreadCustom(summary.id),
    }));
  }

  private createThreadListStructureKey(
    items: readonly PiThreadListItemSnapshot[] = this.getThreadListSnapshot(),
  ): string {
    return JSON.stringify(items.map(({ remoteId, status }) => [remoteId, status]));
  }

  private acknowledgeThreadListStructure(
    items: readonly PiThreadListItemSnapshot[] = this.getThreadListSnapshot(),
  ): void {
    this.threadListStructureKey = this.createThreadListStructureKey(items);
  }

  private notifyThreadListIfStructureChanged(): void {
    if (this.disposed) return;
    const nextKey = this.createThreadListStructureKey();
    if (!this.threadListBaselineReady) {
      this.threadListStructureKey = nextKey;
      return;
    }
    if (nextKey === this.threadListStructureKey) return;
    this.threadListStructureKey = nextKey;
    this.threadListRevision += 1;
    for (const listener of this.threadListListeners) listener();
  }

  getThreadListItemSnapshot(threadId: string | undefined): PiThreadListItemSnapshot | undefined {
    if (!threadId) return undefined;
    const remoteId = this.aliases.get(threadId) ?? threadId;
    const summary = this.summaries.get(remoteId);
    if (!summary) return undefined;
    return {
      status: this.archived.has(remoteId) ? "archived" : "regular",
      remoteId,
      title: this.summaryTitle(summary) || undefined,
      lastMessageAt: new Date(summary.modified),
      custom: this.getThreadCustom(remoteId),
    };
  }

  getThreadCustom(threadId: string): Record<string, unknown> | undefined {
    const remoteId = this.aliases.get(threadId) ?? threadId;
    const summary = this.summaries.get(remoteId);
    if (!summary) {
      const workspace = this.draftWorkspaces.get(threadId);
      if (!workspace) return undefined;
      return {
        piRunning: false,
        piPinned: false,
        piWorkspaceId: workspace.id,
        piWorkspaceName: workspace.name,
        piWorkspaceCwd: workspace.cwd,
      };
    }
    const workspace = this.workspaceForSession(remoteId);
    return {
      piRunning: summary.running,
      piPinned: this.pinned.has(remoteId),
      piCreatedAt: summary.created,
      piWorkspaceId: workspace?.workspaceId ?? summary.workspace.id,
      piWorkspaceName: workspace?.title ?? summary.workspace.name,
      piWorkspaceCwd: workspace?.path ?? summary.workspace.cwd,
    };
  }

  getThreadStateSnapshot(threadId: string | undefined): PiThreadStateSnapshot {
    if (!threadId || this.disposed) return EMPTY_THREAD_STATE_SNAPSHOT;
    const bucket = this.threadStateBuckets.get(threadId);
    if (!bucket) return this.createThreadStateSnapshot(threadId);
    this.refreshThreadStateBucket(threadId, bucket, false);
    return bucket.snapshot;
  }

  getThreadRevision(threadId: string | undefined): number {
    if (!threadId || this.disposed) return 0;
    const bucket = this.threadStateBuckets.get(threadId);
    if (!bucket) return this.revision;
    this.refreshThreadStateBucket(threadId, bucket, false);
    return bucket.revision;
  }

  subscribeThread = (threadId: string | undefined, listener: Listener): (() => void) => {
    if (!threadId || this.disposed) return () => undefined;
    const bucket = this.ensureThreadStateBucket(threadId);
    this.refreshThreadStateBucket(threadId, bucket, false);
    bucket.listeners.add(listener);
    return () => {
      bucket.listeners.delete(listener);
      if (bucket.listeners.size === 0 && this.threadStateBuckets.get(threadId) === bucket) {
        this.threadStateBuckets.delete(threadId);
      }
    };
  };

  private ensureThreadStateBucket(threadId: string): PiThreadStateBucket {
    const existing = this.threadStateBuckets.get(threadId);
    if (existing) return existing;
    const snapshot = this.createThreadStateSnapshot(threadId);
    const bucket: PiThreadStateBucket = {
      listeners: new Set(),
      revision: this.revision,
      managerRevision: this.revision,
      signature: this.threadStateSignature(snapshot),
      snapshot,
    };
    this.threadStateBuckets.set(threadId, bucket);
    return bucket;
  }

  private createThreadStateSnapshot(threadId: string): PiThreadStateSnapshot {
    const remoteId = this.aliases.get(threadId) ?? threadId;
    const summary = this.summaries.get(remoteId);
    if (!summary) {
      const workspace = this.draftWorkspaces.get(threadId);
      return workspace
        ? {
            metadata: {
              running: false,
              waitingForUserInput: false,
              completed: false,
              pinned: false,
              workspace: { ...workspace },
            },
          }
        : EMPTY_THREAD_STATE_SNAPSHOT;
    }

    const workspaceView = this.workspaceForSession(remoteId);
    const workspace: PiWorkspaceSummary = workspaceView
      ? {
          id: workspaceView.workspaceId,
          name: workspaceView.title,
          cwd: workspaceView.path,
          pinned: this.pinnedWorkspaces.has(workspaceView.workspaceId),
        }
      : {
          ...summary.workspace,
          pinned: this.pinnedWorkspaces.has(summary.workspace.id),
        };
    return {
      thread: this.getThreadListItemSnapshot(remoteId),
      metadata: {
        running: this.running.has(remoteId),
        waitingForUserInput: this.waitingForUserInput.has(remoteId),
        completed: this.completed.has(remoteId),
        pinned: this.pinned.has(remoteId),
        createdAt: summary.created,
        workspace,
        ...(summary.automationOrigin === undefined
          ? {}
          : { automationOrigin: summary.automationOrigin }),
      },
    };
  }

  private threadStateSignature(snapshot: PiThreadStateSnapshot): string {
    const { thread, metadata } = snapshot;
    return JSON.stringify([
      thread?.remoteId ?? null,
      thread?.status ?? null,
      thread?.title ?? null,
      thread?.lastMessageAt.toISOString() ?? null,
      thread?.custom ?? null,
      metadata.running,
      metadata.waitingForUserInput,
      metadata.completed,
      metadata.pinned,
      metadata.createdAt ?? null,
      metadata.workspace?.id ?? null,
      metadata.workspace?.name ?? null,
      metadata.workspace?.cwd ?? null,
      metadata.workspace?.pinned ?? null,
      metadata.automationOrigin ?? null,
    ]);
  }

  private refreshThreadStateBucket(
    threadId: string,
    bucket: PiThreadStateBucket,
    publish: boolean,
  ): void {
    if (bucket.managerRevision === this.revision) return;
    const snapshot = this.createThreadStateSnapshot(threadId);
    const signature = this.threadStateSignature(snapshot);
    bucket.managerRevision = this.revision;
    if (signature === bucket.signature) return;
    bucket.signature = signature;
    bucket.snapshot = snapshot;
    bucket.revision += 1;
    if (publish) {
      for (const listener of bucket.listeners) listener();
    }
  }

  private refreshSubscribedThreadStates(): void {
    for (const [threadId, bucket] of this.threadStateBuckets) {
      if (bucket.listeners.size > 0) this.refreshThreadStateBucket(threadId, bucket, true);
    }
  }

  subscribe = (listener: Listener): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeThreadList = (listener: Listener): (() => void) => {
    if (this.disposed) return () => undefined;
    this.threadListListeners.add(listener);
    return () => this.threadListListeners.delete(listener);
  };

  /** Subscribe to lightweight live summaries; use the context-trace unary RPCs for baseline/detail. */
  subscribeSessionContextTrace = (listener: PiSessionContextTraceListener): (() => void) => {
    if (this.disposed) return () => undefined;
    this.contextTraceListeners.add(listener);
    return () => this.contextTraceListeners.delete(listener);
  };

  /** Subscribe to validated lightweight host deltas owned by feature-scoped clients. */
  subscribeHostEvents = (listener: PiHostEventListener): (() => void) => {
    if (this.disposed) return () => undefined;
    this.hostEventListeners.add(listener);
    return () => this.hostEventListeners.delete(listener);
  };

  /** Re-fetch feature baselines after each paired host/mux reconnect generation becomes ready. */
  subscribeConnectionReady = (listener: Listener): (() => void) => {
    if (this.disposed) return () => undefined;
    this.connectionReadyListeners.add(listener);
    return () => this.connectionReadyListeners.delete(listener);
  };

  start(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    // Realtime transport is independent from the unary catalog. Starting it first lets the host
    // deliver active-session changes while the initial list baseline is still loading; the
    // refresh mutation overlay below keeps those frames from being overwritten by an older list.
    this.connections.startRunningEvents(this.applyRunningSnapshot);
    this.startTask ??= this.loadInitialMetadata();
    return this.startTask;
  }

  private async loadInitialMetadata(): Promise<void> {
    const [, legacyPinnedSessionIds, legacyPinnedWorkspaceIds] = await Promise.all([
      this.loadArchiveState(),
      this.loadLegacyPinnedIds(PINNED_STORAGE_KEY),
      this.loadLegacyPinnedIds(PINNED_WORKSPACES_STORAGE_KEY),
    ]);
    const legacyArchived = [...this.archived];
    await Promise.all([
      this.refreshMetadata().then(() => globalThis.performance?.mark("workbench:catalog-ready")),
      this.refreshHostDescription(),
    ]);
    for (const sessionId of legacyArchived) {
      if (!this.summaries.has(sessionId) || this.archived.has(sessionId)) continue;
      try {
        await this.archiveSessionMetadata(sessionId);
      } catch {
        // The server list remains authoritative if a one-time local migration fails.
      }
    }
    await this.migrateLegacyPinnedState(legacyPinnedSessionIds, legacyPinnedWorkspaceIds);
    await workbenchBrowserStorage.removeItem(ARCHIVED_STORAGE_KEY);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const session of new Set(this.sessions.values())) session.dispose();
    this.connections.dispose();
    this.sessions.clear();
    this.aliases.clear();
    this.initializeTasks.clear();
    this.requestedSessionIntents.clear();
    this.draftWorkspaces.clear();
    this.pendingQueues.clear();
    this.pendingInteractions.clear();
    this.waitingForUserInput.clear();
    this.summaries.clear();
    this.workspaces.clear();
    this.archived.clear();
    this.pinned.clear();
    this.pinnedWorkspaces.clear();
    this.completed.clear();
    this.pendingModelSelections.clear();
    this.runTimings.clear();
    this.running.clear();
    this.activeLocalId = undefined;
    this.activeRemoteId = undefined;
    this.startTask = undefined;
    this.hostDescriptionValue = undefined;
    this.hostDescriptionTask = undefined;
    this.metadataRefreshTask = undefined;
    this.metadataMutations = undefined;
    this.metadataRunningMutations = undefined;
    this.metadataWaitingForUserInputMutations = undefined;
    this.realtimeRefreshRequested = false;
    this.realtimeRefreshTask = undefined;
    this.listeners.clear();
    this.threadListListeners.clear();
    this.activeSessionListeners.clear();
    this.contextTraceListeners.clear();
    this.hostEventListeners.clear();
    this.connectionReadyListeners.clear();
    this.threadStateBuckets.clear();
  }

  private readonly handleGenerationReady = (generation: number): void => {
    if (this.disposed) return;
    if (generation < this.connectionGeneration) return;
    this.connectionGeneration = generation;
    for (const listener of this.connectionReadyListeners) listener();
    let pendingChanged = false;
    for (const [key, pending] of this.pendingInteractions) {
      if (pending.generation >= generation) continue;
      this.pendingInteractions.delete(key);
      pendingChanged = true;
    }
    if (pendingChanged) this.notify();
    // The first socket generation shares startup with the in-flight unary baseline. Revalidating
    // it immediately would duplicate the list requests; later generations still rebaseline real
    // reconnects after that initial task has settled.
    if (generation === 1) return;
    void this.refreshHostDescription()
      .catch((error) => console.error("[workbench-pi] host rebaseline failed", error))
      .finally(() => {
        if (generation === this.connectionGeneration) this.requestRealtimeRefresh();
      });
  };

  private refreshHostDescription(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.hostDescriptionTask) return this.hostDescriptionTask;
    const task = describePiHost(this.rpcTransportOptions)
      .then((description) => {
        if (this.disposed) return;
        this.hostDescriptionValue = description;
        this.notify();
      })
      .finally(() => {
        if (this.hostDescriptionTask === task) this.hostDescriptionTask = undefined;
      });
    this.hostDescriptionTask = task;
    return task;
  }

  private readonly handleMuxFrame = (
    frame: ServerRequest<MuxStreamPayload>,
    generation: number,
  ): void => {
    if (this.disposed) return;
    if (generation < this.connectionGeneration) return;
    this.connectionGeneration = generation;
    const payload = frame.payload;
    if (payload.type === "session/prompt-accepted") {
      this.sessions.get(payload.sessionId)?.acknowledgePrompt(frame.rpcId);
      this.updateRunning(payload.sessionId, payload.running, undefined, payload.runTiming);
      return;
    }
    if (payload.type === "session/queue") {
      const items = payload.items.map((item) => structuredClone(item));
      this.pendingQueues.set(payload.sessionId, items);
      this.sessions.get(payload.sessionId)?.applyQueueSnapshot(items);
      return;
    }
    if (payload.type === "session/context-trace") {
      const event = structuredClone(payload.event);
      this.sessions.get(payload.sessionId)?.applyContextTraceEvent(event);
      for (const listener of this.contextTraceListeners) listener(structuredClone(event));
      return;
    }
    if (payload.type === "question/requested") {
      this.pendingInteractions.set(`q:${frame.rpcId}`, {
        generation,
        interaction: {
          kind: "question",
          rpcId: frame.rpcId,
          sessionId: payload.sessionId,
          questions: payload.questions.map((question) => structuredClone(question)),
        },
      });
      this.notify();
      return;
    }
    if (payload.type === "question/resolved") {
      this.pendingInteractions.delete(`q:${payload.questionRpcId}`);
      this.notify();
      return;
    }
    if (payload.type === "approval/requested") {
      this.pendingInteractions.set(`a:${payload.sessionId}:${payload.approvalId}`, {
        generation,
        interaction: {
          kind: "approval",
          rpcId: frame.rpcId,
          sessionId: payload.sessionId,
          approvalId: payload.approvalId,
          toolName: payload.toolName,
          ...(payload.callId === undefined ? {} : { callId: payload.callId }),
          ...(payload.reason === undefined ? {} : { reason: payload.reason }),
        },
      });
      this.notify();
      return;
    }
    if (payload.type === "approval/resolved") {
      this.pendingInteractions.delete(`a:${payload.sessionId}:${payload.approvalId}`);
      this.notify();
      return;
    }
    if (payload.type === "stream/error") {
      console.error(`[workbench-pi] mux stream failed: ${payload.error.message}`);
    }
  };

  private readonly handleHostFrame = (payload: HostStreamPayload, generation: number): void => {
    if (this.disposed) return;
    if (generation < this.connectionGeneration) return;
    this.connectionGeneration = generation;
    for (const listener of this.hostEventListeners) {
      try {
        listener(payload);
      } catch {
        // Feature listeners are isolated from the shared transport reducer.
      }
    }

    if (payload.type === "host/session-status") {
      this.updateRunning(payload.sessionId, payload.running, undefined, payload.runTiming);
      return;
    }
    if (payload.type === "host/session-interaction-status") {
      this.updateWaitingForUserInput(payload.sessionId, payload.waitingForUserInput);
      return;
    }

    if (payload.type === "host/workspace-changed") {
      this.workspaceGeneration += 1;
      this.workspaces.set(payload.workspace.workspaceId, payload.workspace);
      this.notify();
      this.notifyThreadListIfStructureChanged();
      return;
    }
    if (payload.type === "host/workspace-removed") {
      this.workspaceGeneration += 1;
      this.workspaces.delete(payload.workspaceId);
      this.pinnedWorkspaces.delete(payload.workspaceId);
      this.notify();
      this.notifyThreadListIfStructureChanged();
      return;
    }
    if (payload.type === "host/workspace-order-changed") {
      this.workspaceGeneration += 1;
      const reordered = new Map<string, WorkspaceView>();
      for (const workspaceId of payload.workspaceIds) {
        const workspace = this.workspaces.get(workspaceId);
        if (workspace) reordered.set(workspaceId, workspace);
      }
      for (const [workspaceId, workspace] of this.workspaces) {
        if (!reordered.has(workspaceId)) reordered.set(workspaceId, workspace);
      }
      this.workspaces.clear();
      for (const [workspaceId, workspace] of reordered) {
        this.workspaces.set(workspaceId, workspace);
      }
      this.notify();
      this.notifyThreadListIfStructureChanged();
      return;
    }
    if (payload.type === "host/workspace-pinned-changed") {
      this.workspaceGeneration += 1;
      const changed = payload.pinned
        ? !this.pinnedWorkspaces.has(payload.workspaceId)
        : this.pinnedWorkspaces.has(payload.workspaceId);
      if (payload.pinned) this.pinnedWorkspaces.add(payload.workspaceId);
      else this.pinnedWorkspaces.delete(payload.workspaceId);
      if (changed) this.notify();
      return;
    }
    if (payload.type === "host/session-archive-changed") {
      this.workspaceGeneration += 1;
      const wasArchived = this.archived.has(payload.sessionId);
      if (payload.archived) this.archived.add(payload.sessionId);
      else this.archived.delete(payload.sessionId);
      let changed = wasArchived !== payload.archived;
      if (
        payload.workspace &&
        !workspaceViewsEqual(this.workspaces.get(payload.workspace.workspaceId), payload.workspace)
      ) {
        this.workspaces.set(payload.workspace.workspaceId, payload.workspace);
        changed = true;
      }
      if (changed) this.notify();
      this.notifyThreadListIfStructureChanged();
      return;
    }
    if (payload.type === "host/session-pinned-changed") {
      this.workspaceGeneration += 1;
      const changed = payload.pinned
        ? !this.pinned.has(payload.sessionId)
        : this.pinned.has(payload.sessionId);
      if (payload.pinned) this.pinned.add(payload.sessionId);
      else this.pinned.delete(payload.sessionId);
      if (changed) {
        this.notify();
        this.notifyThreadListIfStructureChanged();
      }
      return;
    }
    if (payload.type === "host/session-added") {
      if (payload.summary.id !== payload.sessionId) return;
      if (
        [...this.requestedSessionIntents.values()].some(
          (intent) => intent.sessionId === payload.sessionId,
        )
      ) {
        return;
      }
      const workspace = [...this.workspaces.values()].find(
        (candidate) => candidate.path === payload.summary.cwd,
      );
      let workspaceChanged = false;
      if (workspace && !workspace.sessionIds.includes(payload.sessionId)) {
        this.workspaceGeneration += 1;
        this.workspaces.set(workspace.workspaceId, {
          ...workspace,
          sessionIds: [payload.sessionId, ...workspace.sessionIds],
        });
        workspaceChanged = true;
      }
      const runningChanged = this.applySummaryRunning(payload.summary);
      const waitingForUserInputChanged = this.applySummaryWaitingForUserInput(payload.summary);
      const summaryChanged = this.setSummary(payload.summary);
      if (workspaceChanged || runningChanged || waitingForUserInputChanged || summaryChanged) {
        this.notify();
        this.notifyThreadListIfStructureChanged();
      }
      return;
    }
    if (payload.type === "host/session-changed") {
      if (payload.summary.id !== payload.sessionId) return;
      const runningChanged = this.applySummaryRunning(payload.summary);
      const waitingForUserInputChanged = this.applySummaryWaitingForUserInput(payload.summary);
      const summaryChanged = this.setSummary(payload.summary);
      if (runningChanged || waitingForUserInputChanged || summaryChanged) {
        this.notify();
        this.notifyThreadListIfStructureChanged();
      }
      return;
    }
    if (payload.type === "host/session-removed") {
      this.removeSessionMetadata(payload.sessionId);
      this.notify();
      this.notifyThreadListIfStructureChanged();
      return;
    }
    if (payload.type === "host/agent-error") {
      console.error(`[workbench-pi] session ${payload.sessionId} failed: ${payload.message}`);
    } else if (payload.type === "stream/error") {
      console.error(`[workbench-pi] host stream failed: ${payload.error.message}`);
    }
  };

  private requestRealtimeRefresh(): void {
    if (this.disposed) return;
    this.realtimeRefreshRequested = true;
    if (this.realtimeRefreshTask) return;
    const task = (async () => {
      while (this.realtimeRefreshRequested) {
        this.realtimeRefreshRequested = false;
        const currentRefresh = this.metadataRefreshTask;
        if (currentRefresh) await currentRefresh.catch(() => undefined);
        await this.refreshMetadata().catch((error) =>
          console.error("[workbench-pi] realtime metadata refresh failed", error),
        );
      }
    })().finally(() => {
      if (this.realtimeRefreshTask === task) this.realtimeRefreshTask = undefined;
      if (this.realtimeRefreshRequested) this.requestRealtimeRefresh();
    });
    this.realtimeRefreshTask = task;
  }

  getSession(localId: string, remoteId?: string): PiClientSession {
    if (this.disposed) throw new Error("PiSessionManager has been disposed");
    const resolvedRemoteId = remoteId ?? this.aliases.get(localId);
    const existing =
      (resolvedRemoteId ? this.sessions.get(resolvedRemoteId) : undefined) ??
      this.sessions.get(localId);
    if (existing) return existing;

    const summary = resolvedRemoteId ? this.summaries.get(resolvedRemoteId) : undefined;
    const running = resolvedRemoteId ? this.running.has(resolvedRemoteId) : false;
    const runTiming = resolvedRemoteId
      ? (this.runTimings.get(resolvedRemoteId) ??
        (summary?.runTiming
          ? this.observeRunTiming(resolvedRemoteId, summary.runTiming)
          : undefined))
      : undefined;
    const session = new PiClientSession(this, localId, resolvedRemoteId, running, runTiming);
    this.sessions.set(localId, session);
    if (resolvedRemoteId) this.sessions.set(resolvedRemoteId, session);
    if (resolvedRemoteId) {
      const queue = this.pendingQueues.get(resolvedRemoteId);
      if (queue) session.applyQueueSnapshot(queue);
    }
    session.connectIfRunning();
    return session;
  }

  async ensureRemote(session: PiClientSession): Promise<PiSessionSummary> {
    if (this.disposed) throw new Error("PiSessionManager has been disposed");
    if (session.remoteId) {
      const summary = this.summaries.get(session.remoteId) ?? this.scratchSummary(session.remoteId);
      if (summary) return summary;
      await this.refreshMetadata();
      const refreshed =
        this.summaries.get(session.remoteId) ?? this.scratchSummary(session.remoteId);
      if (refreshed) return refreshed;
    }

    const existingTask = this.initializeTasks.get(session.localId);
    if (existingTask) return existingTask;
    const workspace = this.draftWorkspaces.get(session.localId);
    if (!workspace) throw new PiApiError("pi_invalid_workspace", 400);
    let task: Promise<PiSessionSummary>;
    task = (async () => {
      await this.start();
      const intent = resolveSessionCreateIntent(
        this.requestedSessionIntents.get(session.localId),
        workspace.id,
        () => createClientMessageId("pi-session"),
      );
      this.requestedSessionIntents.set(session.localId, intent);
      const { sessionId } = await createPiRpcSession(
        {
          workspaceId: intent.workspaceId,
          sessionId: intent.sessionId,
        },
        this.rpcTransportOptions,
      );
      const authoritative = this.summaries.get(sessionId);
      const canonicalWorkspace = this.workspaceForSession(sessionId);
      const summaryWorkspace = canonicalWorkspace
        ? {
            id: canonicalWorkspace.workspaceId,
            name: canonicalWorkspace.title,
            cwd: canonicalWorkspace.path,
          }
        : workspace;
      const now = new Date().toISOString();
      const summary: PiSessionSummary = authoritative ?? {
        id: sessionId,
        cwd: summaryWorkspace.cwd,
        workspace: summaryWorkspace,
        created: now,
        modified: now,
        messageCount: 0,
        firstMessage: "",
        transient: false,
        running: false,
      };
      this.draftWorkspaces.delete(session.localId);
      if (this.requestedSessionIntents.get(session.localId) === intent) {
        this.requestedSessionIntents.delete(session.localId);
      }
      this.bindSession(
        session.localId,
        session,
        summary,
        canonicalWorkspace?.workspaceId ?? workspace.id,
      );
      return summary;
    })().finally(() => {
      if (this.initializeTasks.get(session.localId) === task) {
        this.initializeTasks.delete(session.localId);
      }
    });
    this.initializeTasks.set(session.localId, task);
    return task;
  }

  async initialize(localId: string): Promise<{ remoteId: string; externalId: string }> {
    const session = this.getSession(localId);
    const summary = await this.ensureRemote(session);
    return { remoteId: summary.id, externalId: summary.id };
  }

  refreshMetadata(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.metadataRefreshTask) return this.metadataRefreshTask;

    // A create/rename/status mutation can land while the list request is in
    // flight. Replaying those local facts over the response prevents an older
    // list snapshot from temporarily removing the just-created thread.
    const mutations = new Map<string, PiSessionSummary | null>();
    const runningMutations = new Map<
      string,
      { readonly running: boolean; readonly runTiming?: PiRunTiming }
    >();
    const waitingForUserInputMutations = new Map<string, boolean>();
    this.metadataMutations = mutations;
    this.metadataRunningMutations = runningMutations;
    this.metadataWaitingForUserInputMutations = waitingForUserInputMutations;
    const workspaceGeneration = ++this.workspaceGeneration;
    const task = Promise.all([
      listPiRpcSessions({}, this.rpcTransportOptions),
      listPiWorkspaces(this.rpcTransportOptions),
      listPiArchivedWorkspaceSessions(this.rpcTransportOptions),
    ])
      .then(([response, workspaceResponse, archivedResponse]) => {
        if (this.disposed) return;
        const summaries = response.items.map(piSummaryFromSessionListItem);
        const next = new Map(summaries.map((summary) => [summary.id, summary]));
        for (const [id, summary] of mutations) {
          if (summary) next.set(id, summary);
          else next.delete(id);
        }
        for (const [id, mutation] of runningMutations) {
          const summary = next.get(id);
          if (!summary) continue;
          next.set(id, {
            ...summary,
            running: mutation.running,
            runTiming: mutation.running ? (mutation.runTiming ?? summary.runTiming) : undefined,
          });
        }
        for (const [id, waitingForUserInput] of waitingForUserInputMutations) {
          const summary = next.get(id);
          if (summary) next.set(id, { ...summary, waitingForUserInput });
        }
        for (const existingId of this.summaries.keys()) {
          if (next.has(existingId)) continue;
          this.disposeCachedSession(existingId);
          this.running.delete(existingId);
          this.runTimings.delete(existingId);
          this.waitingForUserInput.delete(existingId);
          this.completed.delete(existingId);
          this.archived.delete(existingId);
          this.pinned.delete(existingId);
        }
        this.summaries.clear();
        for (const summary of next.values()) {
          this.summaries.set(summary.id, summary);
          if (summary.running && summary.runTiming) {
            this.observeRunTiming(summary.id, summary.runTiming);
          } else if (!summary.running) {
            this.runTimings.delete(summary.id);
          }
        }
        const scratchWaitingForUserInput = [...this.scratchSessions.keys()].filter((sessionId) =>
          this.waitingForUserInput.has(sessionId),
        );
        this.waitingForUserInput.clear();
        for (const summary of next.values()) {
          if (summary.waitingForUserInput) this.waitingForUserInput.add(summary.id);
        }
        for (const sessionId of scratchWaitingForUserInput) {
          this.waitingForUserInput.add(sessionId);
        }
        for (const sessionId of this.pendingQueues.keys()) {
          if (next.has(sessionId) || this.scratchSessions.has(sessionId)) continue;
          this.pendingQueues.delete(sessionId);
          this.connections.deleteSession(sessionId);
        }
        for (const [key, stored] of this.pendingInteractions) {
          if (
            !next.has(stored.interaction.sessionId) &&
            !this.scratchSessions.has(stored.interaction.sessionId)
          ) {
            this.pendingInteractions.delete(key);
          }
        }
        if (workspaceGeneration === this.workspaceGeneration) {
          this.applyWorkspaceSnapshot(workspaceResponse, archivedResponse);
        } else {
          // A host frame landed while this unary snapshot was in flight. Fetch
          // again so changes missed during the disconnected window are not lost.
          this.requestRealtimeRefresh();
        }
        const nextRunning = new Set([
          ...[...next.values()].filter((summary) => summary.running).map((summary) => summary.id),
          ...(response.runningSessionIds ?? []),
        ]);
        this.connections.replaceRunningBaseline([...nextRunning]);
        this.applyRunningSnapshot([...nextRunning], true);
        this.notify();
        this.notifyThreadListIfStructureChanged();
      })
      .finally(() => {
        if (this.metadataRefreshTask === task) this.metadataRefreshTask = undefined;
        if (this.metadataMutations === mutations) this.metadataMutations = undefined;
        if (this.metadataRunningMutations === runningMutations) {
          this.metadataRunningMutations = undefined;
        }
        if (this.metadataWaitingForUserInputMutations === waitingForUserInputMutations) {
          this.metadataWaitingForUserInputMutations = undefined;
        }
      });
    this.metadataRefreshTask = task;
    return task;
  }

  private async refreshWorkspaces(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.workspaceGeneration;
    const [response, archivedResponse] = await Promise.all([
      listPiWorkspaces(this.rpcTransportOptions),
      listPiArchivedWorkspaceSessions(this.rpcTransportOptions),
    ]);
    if (this.disposed) return;
    if (generation !== this.workspaceGeneration) {
      this.requestRealtimeRefresh();
      return;
    }
    this.applyWorkspaceSnapshot(response, archivedResponse);
    this.notify();
    this.notifyThreadListIfStructureChanged();
  }

  private applyWorkspaceSnapshot(
    response: Awaited<ReturnType<typeof listPiWorkspaces>>,
    archivedResponse: Awaited<ReturnType<typeof listPiArchivedWorkspaceSessions>>,
  ): void {
    if (this.disposed) return;
    this.workspaces.clear();
    for (const workspace of response.items) this.workspaces.set(workspace.workspaceId, workspace);
    this.pinnedWorkspaces.clear();
    for (const workspaceId of response.pinnedWorkspaceIds ?? []) {
      this.pinnedWorkspaces.add(workspaceId);
    }
    this.pinned.clear();
    for (const sessionId of response.pinnedSessionIds ?? []) this.pinned.add(sessionId);
    this.archived.clear();
    for (const sessionId of archivedResponse.sessionIds) this.archived.add(sessionId);
  }

  refreshWorkspaceMetadata(): Promise<void> {
    return this.refreshWorkspaces();
  }

  acceptCreatedWorkspace(workspace: PiWorkspaceSummary): void {
    // The create RPC result is authoritative for identity/path/title even if the host event or a
    // follow-up workspace.list has not arrived yet. Advancing the generation also prevents a list
    // request started before create from erasing this accepted result when it eventually resolves.
    this.workspaceGeneration += 1;
    const existing = this.workspaces.get(workspace.id);
    const now = new Date().toISOString();
    const accepted: WorkspaceView = existing
      ? { ...existing, path: workspace.cwd, title: workspace.name }
      : {
          workspaceId: workspace.id,
          path: workspace.cwd,
          title: workspace.name,
          sessionIds: [],
          createdAt: now,
          updatedAt: now,
        };
    const workspaceChanged = !workspaceViewsEqual(existing, accepted);
    this.workspaces.set(workspace.id, accepted);

    const wasPinned = this.pinnedWorkspaces.has(workspace.id);
    if (workspace.pinned === true) this.pinnedWorkspaces.add(workspace.id);
    else if (workspace.pinned === false) this.pinnedWorkspaces.delete(workspace.id);
    const pinnedChanged = wasPinned !== this.pinnedWorkspaces.has(workspace.id);
    if (workspaceChanged || pinnedChanged) this.notify();
  }

  forkSessionAt(input: {
    sessionId: string;
    atSeq: number;
    sourceTitle: string;
  }): Promise<PiForkSessionResult> {
    const task = this.forkTaskTail.then(() => this.performSessionFork(input));
    this.forkTaskTail = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async createScratchSession(input: {
    sourceSessionId: string;
    atSeq?: number;
  }): Promise<SessionScratchCreateValue> {
    await this.start();
    const scratch = await createPiRpcScratchSession(
      {
        sourceSessionId: input.sourceSessionId,
        ...(input.atSeq === undefined ? {} : { atSeq: input.atSeq }),
      },
      this.rpcTransportOptions,
    );
    this.scratchSessions.set(scratch.sessionId, scratch);
    return scratch;
  }

  /**
   * Re-adopt a server-owned scratch identity retained by a live SideChat Surface. Fast Refresh
   * can replace the client manager while preserving the React workspace tree; the Surface params
   * are the durable in-memory lease needed to bind that hidden session again.
   */
  restoreScratchSession(scratch: SessionScratchCreateValue): boolean {
    if (this.disposed || scratch.expiresAt <= Date.now()) return false;
    const current = this.scratchSessions.get(scratch.sessionId);
    if (current && current.sourceSessionId !== scratch.sourceSessionId) return false;
    this.scratchSessions.set(scratch.sessionId, scratch);
    return true;
  }

  async releaseScratchSession(sessionId: string): Promise<void> {
    try {
      await releasePiRpcScratchSession({ sessionId }, this.rpcTransportOptions);
    } finally {
      this.forgetEphemeralSession(sessionId);
    }
  }

  async promoteScratchSession(input: {
    sessionId: string;
    title?: string;
  }): Promise<SessionScratchPromoteValue> {
    const promoted = await promotePiRpcScratchSession(
      {
        sessionId: input.sessionId,
        ...(input.title === undefined ? {} : { title: input.title }),
      },
      this.rpcTransportOptions,
    );
    this.forgetEphemeralSession(input.sessionId);
    await Promise.all([this.refreshMetadata(), this.refreshWorkspaces()]);
    this.notify();
    this.notifyThreadListIfStructureChanged();
    return promoted;
  }

  private async performSessionFork(input: {
    sessionId: string;
    atSeq: number;
    sourceTitle: string;
  }): Promise<PiForkSessionResult> {
    await this.start();
    let source = this.summaries.get(input.sessionId);
    if (!source) {
      await this.refreshMetadata();
      source = this.summaries.get(input.sessionId);
    }
    if (!source) throw new PiApiError("pi_session_not_found", 404);

    const sourceTitle = input.sourceTitle.trim();
    if (!sourceTitle) throw new PiApiError("pi_fork_title_unavailable", 409);
    const workspace = this.workspaceForSession(source.id);
    const siblingSummaries = workspace
      ? workspace.sessionIds.flatMap((sessionId) => {
          const summary = this.summaries.get(sessionId);
          return summary ? [summary] : [];
        })
      : [...this.summaries.values()];
    const title = nextForkTitle(
      sourceTitle,
      siblingSummaries
        .map((summary) => this.summaryTitle(summary))
        .filter((candidate): candidate is string => Boolean(candidate)),
    );

    const forked = await forkPiRpcSession(
      { sessionId: source.id, atSeq: input.atSeq },
      this.rpcTransportOptions,
    );
    await renamePiRpcSession({ sessionId: forked.sessionId, title }, this.rpcTransportOptions);

    const now = new Date().toISOString();
    const child = this.summaries.get(forked.sessionId);
    this.setSummary({
      ...(child ?? source),
      id: forked.sessionId,
      name: title,
      created: child?.created ?? now,
      modified: now,
      running: false,
      transient: child?.transient ?? false,
    });
    const currentWorkspace = workspace && this.workspaces.get(workspace.workspaceId);
    if (currentWorkspace && !currentWorkspace.sessionIds.includes(forked.sessionId)) {
      this.workspaceGeneration += 1;
      this.workspaces.set(currentWorkspace.workspaceId, {
        ...currentWorkspace,
        sessionIds: [forked.sessionId, ...currentWorkspace.sessionIds],
      });
    }
    this.notify();
    this.notifyThreadListIfStructureChanged();
    void this.refreshMetadata().catch((error) =>
      console.error("[workbench-pi] fork metadata refresh failed", error),
    );
    return { sessionId: forked.sessionId, title };
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    this.workspaceGeneration += 1;
    await deletePiWorkspace(workspaceId, this.rpcTransportOptions);
    this.workspaceGeneration += 1;
    this.workspaces.delete(workspaceId);
    this.pinnedWorkspaces.delete(workspaceId);
    this.notify();
    this.notifyThreadListIfStructureChanged();
  }

  async moveWorkspaceBefore(workspaceId: string, beforeWorkspaceId?: string): Promise<void> {
    this.workspaceGeneration += 1;
    const result = await insertPiWorkspaceBefore(
      workspaceId,
      beforeWorkspaceId,
      this.rpcTransportOptions,
    );
    this.workspaceGeneration += 1;
    const reordered = new Map<string, WorkspaceView>();
    for (const reorderedWorkspaceId of result.workspaceIds) {
      const workspace = this.workspaces.get(reorderedWorkspaceId);
      if (workspace) reordered.set(reorderedWorkspaceId, workspace);
    }
    for (const [existingWorkspaceId, workspace] of this.workspaces) {
      if (!reordered.has(existingWorkspaceId)) reordered.set(existingWorkspaceId, workspace);
    }
    const currentIds = [...this.workspaces.keys()];
    const nextIds = [...reordered.keys()];
    if (currentIds.every((id, index) => id === nextIds[index])) return;
    this.workspaces.clear();
    for (const [reorderedWorkspaceId, workspace] of reordered) {
      this.workspaces.set(reorderedWorkspaceId, workspace);
    }
    this.notify();
    this.notifyThreadListIfStructureChanged();
  }

  async moveWorkspaceSessionBefore(
    workspaceId: string,
    sessionId: string,
    beforeSessionId?: string,
  ): Promise<void> {
    const remoteSessionId = this.aliases.get(sessionId) ?? sessionId;
    const remoteBeforeSessionId = beforeSessionId
      ? (this.aliases.get(beforeSessionId) ?? beforeSessionId)
      : undefined;
    this.workspaceGeneration += 1;
    const result = await insertPiSessionBefore(
      workspaceId,
      remoteSessionId,
      remoteBeforeSessionId,
      this.rpcTransportOptions,
    );
    this.workspaceGeneration += 1;
    const current = this.workspaces.get(workspaceId);
    if (workspaceViewsEqual(current, result.workspace)) return;
    this.workspaces.set(workspaceId, result.workspace);
    this.notify();
    this.notifyThreadListIfStructureChanged();
  }

  async setWorkspacePinned(workspaceId: string, pinned: boolean): Promise<void> {
    this.workspaceGeneration += 1;
    const result = await setPiWorkspacePinned(workspaceId, pinned, this.rpcTransportOptions);
    this.workspaceGeneration += 1;
    const changed = result.pinned
      ? !this.pinnedWorkspaces.has(result.workspaceId)
      : this.pinnedWorkspaces.has(result.workspaceId);
    if (result.pinned) this.pinnedWorkspaces.add(result.workspaceId);
    else this.pinnedWorkspaces.delete(result.workspaceId);
    if (changed) this.notify();
  }

  async setThreadPinned(threadId: string, pinned: boolean): Promise<void> {
    const sessionId = this.aliases.get(threadId) ?? threadId;
    this.workspaceGeneration += 1;
    const result = await setPiWorkspaceSessionPinned(sessionId, pinned, this.rpcTransportOptions);
    this.workspaceGeneration += 1;
    const changed = result.pinned
      ? !this.pinned.has(result.sessionId)
      : this.pinned.has(result.sessionId);
    if (result.pinned) this.pinned.add(result.sessionId);
    else this.pinned.delete(result.sessionId);
    if (changed) {
      this.notify();
      this.notifyThreadListIfStructureChanged();
    }
  }

  private async archiveSessionMetadata(sessionId: string): Promise<void> {
    return this.setSessionArchivedMetadata(sessionId, true);
  }

  private async setSessionArchivedMetadata(sessionId: string, archived: boolean): Promise<void> {
    if (archived) await archivePiWorkspaceSession(sessionId, this.rpcTransportOptions);
    else await unarchivePiWorkspaceSession(sessionId, this.rpcTransportOptions);
  }

  createThreadListAdapter(): RemoteThreadListAdapter {
    return {
      list: async () => {
        await this.start();
        const threads = this.getThreadListSnapshot();
        this.acknowledgeThreadListStructure(threads);
        this.threadListBaselineReady = true;
        return {
          threads: threads.map((thread) => ({
            ...thread,
            externalId: thread.remoteId,
          })),
        };
      },
      fetch: async (threadId) => {
        let summary = this.summaries.get(threadId);
        if (!summary) {
          // Fetching the route-selected thread only needs the catalog baseline. Do not wait for
          // host description or one-time legacy preference migrations owned by start().
          await this.refreshMetadata();
          summary = this.summaries.get(threadId);
        }
        if (!summary) throw new Error("pi_session_not_found");
        return {
          status: this.archived.has(threadId) ? "archived" : "regular",
          remoteId: threadId,
          externalId: threadId,
          title: this.summaryTitle(summary) || undefined,
          lastMessageAt: new Date(summary.modified),
          custom: this.getThreadCustom(summary.id),
        };
      },
      initialize: (threadId) => this.initialize(threadId),
      // Workspace metadata is derived from the canonical session summary. The
      // pinned flag is the one user-editable presentation field in custom data.
      updateCustom: async (remoteId, custom) => {
        const pinned = custom?.piPinned === true;
        const changed = pinned ? !this.pinned.has(remoteId) : this.pinned.has(remoteId);
        if (!changed) return;
        await this.setThreadPinned(remoteId, pinned);
      },
      rename: async (remoteId, newTitle) => {
        await renamePiRpcSession(
          { sessionId: remoteId, title: newTitle },
          this.rpcTransportOptions,
        );
        const summary = this.summaries.get(remoteId);
        if (summary && this.setSummary({ ...summary, name: newTitle })) this.notify();
      },
      archive: async (remoteId) => {
        await this.archiveSessionMetadata(remoteId);
      },
      unarchive: async (remoteId) => {
        await this.setSessionArchivedMetadata(remoteId, false);
      },
      delete: async (remoteId) => {
        await deletePiRpcSession({ sessionId: remoteId }, this.rpcTransportOptions);
        this.removeSessionMetadata(remoteId);
        this.notify();
        this.notifyThreadListIfStructureChanged();
      },
      generateTitle: async (remoteId, messages) => {
        const summary = this.summaries.get(remoteId);
        const hasExistingName = Boolean(summary?.name?.trim());
        const title = hasExistingName
          ? deriveSessionDisplayTitle(summary?.name)
          : this.titleFromMessages(messages);
        if (!hasExistingName && title) {
          await renamePiRpcSession({ sessionId: remoteId, title }, this.rpcTransportOptions);
          if (summary && this.setSummary({ ...summary, name: title })) this.notify();
        }
        return createAssistantStream((controller) => {
          if (title) controller.appendText(title);
        });
      },
    };
  }

  setActive(localId: string | undefined, remoteId: string | undefined): void {
    this.activeLocalId = localId;
    const nextActiveRemoteId = remoteId ?? (localId ? this.aliases.get(localId) : undefined);
    const activeSessionChanged = this.activeRemoteId !== nextActiveRemoteId;
    this.activeRemoteId = nextActiveRemoteId;
    if (activeSessionChanged) {
      for (const listener of this.activeSessionListeners) listener();
    }
    if (this.activeRemoteId && this.completed.delete(this.activeRemoteId)) this.notify();
  }

  setDraftWorkspace(localId: string, workspace: PiWorkspaceSummary | undefined): void {
    if (workspace) {
      const current = this.draftWorkspaces.get(localId);
      if (
        current?.id === workspace.id &&
        current.name === workspace.name &&
        current.cwd === workspace.cwd &&
        current.pinned === workspace.pinned
      ) {
        return;
      }
      this.draftWorkspaces.set(localId, workspace);
      this.notify();
      return;
    }
    const session = this.sessions.get(localId);
    if (session && !session.remoteId && session.getSnapshot().messages.length > 0) return;
    if (this.draftWorkspaces.delete(localId)) this.notify();
  }

  isCompleted(threadId: string): boolean {
    return this.completed.has(this.aliases.get(threadId) ?? threadId);
  }

  isRunning(threadId: string): boolean {
    return this.running.has(this.aliases.get(threadId) ?? threadId);
  }

  isWaitingForUserInput(threadId: string): boolean {
    return this.waitingForUserInput.has(this.aliases.get(threadId) ?? threadId);
  }

  notePrompt(remoteId: string, text: string, running = true): void {
    const summary = this.summaries.get(remoteId);
    if (!summary) return;
    const changed = this.setSummary({
      ...summary,
      firstMessage: summary.firstMessage || deriveSessionDisplayTitle(text),
      modified: new Date().toISOString(),
      running,
    });
    if (changed) this.notify();
  }

  updateRunningFromSession(
    remoteId: string,
    running: boolean,
    source: PiClientSession,
    runTiming?: PiRunTiming,
  ): void {
    this.updateRunning(remoteId, running, source, runTiming);
  }

  private bindSession(
    localId: string,
    session: PiClientSession,
    summary: PiSessionSummary,
    workspaceId?: string,
  ): void {
    if (this.disposed) {
      session.dispose();
      return;
    }
    this.aliases.set(localId, summary.id);
    this.sessions.set(summary.id, session);
    if (this.activeLocalId === localId && this.activeRemoteId !== summary.id) {
      this.activeRemoteId = summary.id;
      for (const listener of this.activeSessionListeners) listener();
    }
    this.setSummary(summary);
    this.applySummaryWaitingForUserInput(summary);
    const workspace = workspaceId ? this.workspaces.get(workspaceId) : undefined;
    if (workspaceId && workspace && !workspace.sessionIds.includes(summary.id)) {
      this.workspaceGeneration += 1;
      this.workspaces.set(workspaceId, {
        ...workspace,
        sessionIds: [summary.id, ...workspace.sessionIds],
      });
    }
    session.bindRemote(summary);
    const queue = this.pendingQueues.get(summary.id);
    if (queue) session.applyQueueSnapshot(queue);
    this.notify();
    // RemoteThreadListAdapter.initialize() owns the local-to-remote promotion. Record the
    // resulting structure without pulling it back into the list as a duplicate remote item.
    this.acknowledgeThreadListStructure();
  }

  private readonly applyRunningSnapshot = (
    sessionIds: string[],
    authoritativeBaseline = false,
  ): void => {
    if (this.disposed) return;
    const next = new Set(sessionIds);
    const all = new Set([...this.running, ...next]);
    // A live host idle frame may have already removed the manager-level running bit while the
    // session correctly retained its local lease awaiting the ordered mux terminal boundary.
    // Include those locally-running sessions so a later unary rebaseline can repair the split.
    for (const session of this.sessions.values()) {
      const remoteId = session.remoteId;
      if (remoteId && session.getSnapshot().isRunning) all.add(remoteId);
    }
    for (const id of all) {
      const running = next.has(id);
      this.updateRunning(
        id,
        running,
        undefined,
        running ? this.summaries.get(id)?.runTiming : undefined,
        authoritativeBaseline,
      );
    }
  };

  private updateRunning(
    remoteId: string,
    running: boolean,
    source?: PiClientSession,
    runTiming?: PiRunTiming,
    authoritativeBaseline = false,
  ): void {
    if (this.disposed) return;
    if (running && runTiming !== undefined) this.observeRunTiming(remoteId, runTiming);
    else if (!running) this.runTimings.delete(remoteId);
    this.metadataRunningMutations?.set(remoteId, {
      running,
      ...(runTiming === undefined ? {} : { runTiming }),
    });
    const wasRunning = this.running.has(remoteId);
    if (running) this.running.add(remoteId);
    else this.running.delete(remoteId);

    const summary = this.summaries.get(remoteId);
    if (
      summary &&
      (summary.running !== running ||
        runTiming !== undefined ||
        (!running && summary.runTiming !== undefined))
    ) {
      this.setSummary({
        ...summary,
        running,
        runTiming: running ? (runTiming ?? summary.runTiming) : undefined,
      });
    }

    const session = this.sessions.get(remoteId);
    if (session && session !== source) {
      session.setRunningFromManager(running, runTiming, authoritativeBaseline);
    }
    if (wasRunning && !running && this.activeRemoteId !== remoteId) this.completed.add(remoteId);
    if (running) this.completed.delete(remoteId);
    if (wasRunning !== running) this.notify();
  }

  private updateWaitingForUserInput(remoteId: string, waitingForUserInput: boolean): void {
    if (this.disposed) return;
    this.metadataWaitingForUserInputMutations?.set(remoteId, waitingForUserInput);
    const wasWaitingForUserInput = this.waitingForUserInput.has(remoteId);
    if (waitingForUserInput) this.waitingForUserInput.add(remoteId);
    else this.waitingForUserInput.delete(remoteId);

    const summary = this.summaries.get(remoteId);
    if (summary && summary.waitingForUserInput !== waitingForUserInput) {
      this.setSummary({ ...summary, waitingForUserInput });
    }
    if (wasWaitingForUserInput !== waitingForUserInput) this.notify();
  }

  private titleFromMessages(messages: readonly ThreadMessage[]): string {
    const firstUser = messages.find((message) => message.role === "user");
    if (!firstUser) return "";
    const text = firstUser.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join(" ");
    const hasFile =
      firstUser.content.some((part) => part.type === "file") ||
      firstUser.attachments?.some((attachment) => attachment.type !== "image");
    const hasImage =
      firstUser.content.some((part) => part.type === "image") ||
      firstUser.attachments?.some((attachment) => attachment.type === "image");
    const fallback = hasFile
      ? this.titleFallbacks?.attachment
      : hasImage
        ? this.titleFallbacks?.image
        : undefined;
    return deriveSessionDisplayTitle(text, { fallback });
  }

  private summaryTitle(summary: PiSessionSummary): string {
    return (
      deriveSessionDisplayTitle(summary.name) || deriveSessionDisplayTitle(summary.firstMessage)
    );
  }

  private scratchSummary(sessionId: string): PiSessionSummary | undefined {
    const scratch = this.scratchSessions.get(sessionId);
    if (!scratch || scratch.expiresAt <= Date.now()) return undefined;
    const source = this.summaries.get(scratch.sourceSessionId);
    if (!source) return undefined;
    const now = new Date().toISOString();
    return {
      ...source,
      id: scratch.sessionId,
      name: undefined,
      created: now,
      modified: now,
      transient: true,
      running: this.running.has(scratch.sessionId),
    };
  }

  private applySummaryRunning(summary: PiSessionSummary): boolean {
    const wasRunning = this.running.has(summary.id);
    if (summary.running) this.running.add(summary.id);
    else this.running.delete(summary.id);
    if (summary.running && summary.runTiming) this.observeRunTiming(summary.id, summary.runTiming);
    else if (!summary.running) this.runTimings.delete(summary.id);
    const session = this.sessions.get(summary.id);
    session?.setRunningFromManager(summary.running, summary.runTiming);
    if (wasRunning && !summary.running && this.activeRemoteId !== summary.id) {
      this.completed.add(summary.id);
    }
    if (summary.running) this.completed.delete(summary.id);
    return wasRunning !== summary.running;
  }

  private applySummaryWaitingForUserInput(summary: PiSessionSummary): boolean {
    const wasWaitingForUserInput = this.waitingForUserInput.has(summary.id);
    if (summary.waitingForUserInput) this.waitingForUserInput.add(summary.id);
    else this.waitingForUserInput.delete(summary.id);
    return wasWaitingForUserInput !== this.waitingForUserInput.has(summary.id);
  }

  private observeRunTiming(remoteId: string, timing: PiRunTiming): PiClientRunTiming {
    const observed = clientRunTiming(timing, this.runTimings.get(remoteId));
    this.runTimings.set(remoteId, observed);
    return observed;
  }

  private setSummary(summary: PiSessionSummary): boolean {
    if (this.disposed) return false;
    const { name: _name, ...summaryWithoutName } = summary;
    const name = deriveSessionDisplayTitle(summary.name);
    const sanitized = {
      ...summaryWithoutName,
      ...(name ? { name } : {}),
      firstMessage: deriveSessionDisplayTitle(summary.firstMessage),
    };
    const changed = !summariesEqual(this.summaries.get(summary.id), sanitized);
    this.summaries.set(summary.id, sanitized);
    this.metadataMutations?.set(summary.id, sanitized);
    return changed;
  }

  private deleteSummary(remoteId: string): void {
    this.summaries.delete(remoteId);
    this.runTimings.delete(remoteId);
    this.waitingForUserInput.delete(remoteId);
    this.metadataMutations?.set(remoteId, null);
  }

  private disposeCachedSession(sessionId: string): void {
    const remoteId = this.aliases.get(sessionId) ?? sessionId;
    const matchedSessions = new Set<PiClientSession>();
    for (const [key, session] of this.sessions) {
      if (
        key === sessionId ||
        key === remoteId ||
        session.localId === sessionId ||
        session.remoteId === remoteId
      ) {
        matchedSessions.add(session);
      }
    }

    const localIds = new Set([...matchedSessions].map((session) => session.localId));
    for (const [key, session] of this.sessions) {
      if (matchedSessions.has(session)) this.sessions.delete(key);
    }
    for (const [localId, aliasRemoteId] of this.aliases) {
      if (
        localId === sessionId ||
        localIds.has(localId) ||
        aliasRemoteId === remoteId ||
        aliasRemoteId === sessionId
      ) {
        this.aliases.delete(localId);
      }
    }
    for (const localId of localIds) {
      this.initializeTasks.delete(localId);
      this.requestedSessionIntents.delete(localId);
      this.draftWorkspaces.delete(localId);
    }
    for (const [localId, intent] of this.requestedSessionIntents) {
      if (intent.sessionId === remoteId) this.requestedSessionIntents.delete(localId);
    }
    for (const session of matchedSessions) session.dispose();
    this.connections.deleteSession(remoteId);

    const activeChanged =
      this.activeRemoteId === remoteId ||
      this.activeLocalId === sessionId ||
      (this.activeLocalId !== undefined && localIds.has(this.activeLocalId));
    if (activeChanged) {
      this.activeLocalId = undefined;
      this.activeRemoteId = undefined;
      for (const listener of this.activeSessionListeners) listener();
    }
  }

  private removeSessionMetadata(sessionId: string): void {
    this.disposeCachedSession(sessionId);
    this.deleteSummary(sessionId);
    this.running.delete(sessionId);
    this.waitingForUserInput.delete(sessionId);
    this.completed.delete(sessionId);
    this.archived.delete(sessionId);
    this.pinned.delete(sessionId);
    this.pendingQueues.delete(sessionId);
    for (const [key, stored] of this.pendingInteractions) {
      if (stored.interaction.sessionId === sessionId) this.pendingInteractions.delete(key);
    }
    this.workspaceGeneration += 1;
    for (const [workspaceId, workspace] of this.workspaces) {
      if (!workspace.sessionIds.includes(sessionId)) continue;
      this.workspaces.set(workspaceId, {
        ...workspace,
        sessionIds: workspace.sessionIds.filter((id) => id !== sessionId),
      });
    }
  }

  /** Forget a Runtime-only identity without treating it as a catalog deletion. */
  private forgetEphemeralSession(sessionId: string): void {
    this.scratchSessions.delete(sessionId);
    this.removeSessionMetadata(sessionId);
    this.notify();
  }

  private async loadArchiveState(): Promise<void> {
    const value = await workbenchBrowserStorage.getItem(ARCHIVED_STORAGE_KEY);
    if (!value) return;
    try {
      const ids = JSON.parse(value) as unknown;
      if (Array.isArray(ids)) {
        for (const id of ids) if (typeof id === "string") this.archived.add(id);
      }
    } catch {
      // Ignore damaged local presentation metadata.
    }
  }

  private async loadLegacyPinnedIds(key: string): Promise<string[]> {
    const value = await workbenchBrowserStorage.getItem(key);
    if (!value) return [];
    try {
      const ids = JSON.parse(value) as unknown;
      if (Array.isArray(ids)) {
        return ids.filter((id): id is string => typeof id === "string");
      }
    } catch {
      // Ignore damaged local presentation metadata.
    }
    return [];
  }

  private async migrateLegacyPinnedState(
    sessionIds: readonly string[],
    workspaceIds: readonly string[],
  ): Promise<void> {
    let sessionsMigrated = true;
    for (const sessionId of sessionIds) {
      if (!this.summaries.has(sessionId) || this.pinned.has(sessionId)) continue;
      try {
        await this.setThreadPinned(sessionId, true);
      } catch {
        sessionsMigrated = false;
      }
    }
    if (sessionsMigrated) await workbenchBrowserStorage.removeItem(PINNED_STORAGE_KEY);

    let workspacesMigrated = true;
    for (const workspaceId of workspaceIds) {
      if (!this.workspaces.has(workspaceId) || this.pinnedWorkspaces.has(workspaceId)) continue;
      try {
        await this.setWorkspacePinned(workspaceId, true);
      } catch {
        workspacesMigrated = false;
      }
    }
    if (workspacesMigrated) {
      await workbenchBrowserStorage.removeItem(PINNED_WORKSPACES_STORAGE_KEY);
    }
  }

  private notify(): void {
    if (this.disposed) return;
    this.revision++;
    this.refreshSubscribedThreadStates();
    for (const listener of this.listeners) listener();
  }
}
