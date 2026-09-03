import type {
  AppendMessage,
  ExportedMessageRepository,
  ExternalThreadQueueAdapter,
  QueueItemState,
  ThreadMessage as AssistantUiThreadMessage,
} from "@assistant-ui/react";

import type {
  ConversationNode,
  ConversationSnapshot,
} from "@workbench/agent-runtime-contracts/conversation";
import type {
  ConversationActions,
  ConversationSession,
  HostObservable,
} from "@workbench/agent-runtime-core";
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
import { appendWorkspaceFeedbackContext } from "@workbench/agent-runtime-client/prompt-feedback";

import type {
  PiAssistantMessage,
  PiEvent,
  PiQueuedPrompt,
  PiQueueMode,
  PiRunTiming,
  PiSessionSummary,
  PiUserMessage,
} from "@workbench/agent-runtime-pi-protocol/messages";
import {
  recordPiContextTracePromptPresentation,
  WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME,
} from "../context-trace/data-part";
import {
  cancelPiRpcSession,
  createPiRpcId,
  fetchPiRpcSessionContextTracePromptParts,
  fetchPiRpcSessionHistory,
  PiApiError,
  promptPiRpcSession,
  regeneratePiRpcSession,
  replacePiSessionQueue,
  resumePiRpcSession,
  selectPiRpcSessionBranch,
  setPiSessionQueuePaused,
  updatePiRpcSessionQueue,
} from "../transport/api";
import type {
  SessionContextTraceEventSummary,
  SessionContextTracePromptPart,
  SessionHistoryValue,
  SessionPromptValue,
  SessionQueueAction,
  SessionResumeCheckpoint,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import type { QueueItem } from "@workbench/agent-runtime-pi-protocol/stream";
import {
  conversationEventFromSessionEvent,
  conversationEventThreadMessage,
} from "../messages/conversation-events";
import {
  applyToolExecutionUpdate,
  appendMessageToPiPrompt,
  appendPiContextTraceAssistantPart,
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
  reconcileLiveMessagesAfterHistory,
  reconcilePiContextTraceAssistantParts,
  sameUserPrompt,
  upsertAttachmentRecognitionAssistantPart,
  upsertAttachmentRecognitionInMessages,
  upsertWorkbenchComposerCommandResponse,
  upsertWorkbenchPromptFailure,
  withoutAttachmentRecognitionUserParts,
  workbenchComposerCommandResponseId,
} from "../messages/messages";
import { PiMessageQueue, queueItemAppendMessage } from "../messages/queue";
import { draftSessionModelSelection } from "../models/model-selection";
import {
  fetchProgressiveSessionHistory,
  SessionHistoryPaginationError,
} from "@workbench/agent-runtime-pi-shared/sessions";
import { piHistoryFromSessionEvents, piPromptContent } from "../sessions/session-rpc-adapter";
import {
  piAutoRetryFromEvent,
  piAutoRetryFromHistory,
  type PiAutoRetrySnapshot,
} from "./auto-retry";
import { assistantUiMessagesFromPiConversation } from "../assistant-ui/conversation-projection";
import {
  PiConversationAssembler,
  type ConversationPublication,
} from "../conversation/conversation-assembler";
import type {
  PiConversationAssistantMessage as ThreadAssistantMessage,
  PiConversationMessage as ThreadMessage,
  PiConversationUserMessage as ThreadUserMessage,
  PiMessageTiming as MessageTiming,
  PiToolCallTiming as ToolCallTiming,
} from "../conversation/pi-conversation-message";
import type { PiSessionManager } from "./manager";

type Listener = () => void;

export interface PiClientRunTiming extends PiRunTiming {
  /** Monotonic browser timestamp captured when the server timing snapshot arrived. */
  observedAt: number;
}

function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export function clientRunTiming(
  timing: PiRunTiming,
  current?: PiClientRunTiming,
): PiClientRunTiming {
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
  messages: readonly AssistantUiThreadMessage[];
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

export function createClientMessageId(prefix: string): string {
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

export class PiClientSession implements ConversationSession {
  readonly id: string;
  readonly localId: string;
  readonly snapshot: HostObservable<ConversationSnapshot>;
  readonly actions: Readonly<Partial<ConversationActions>>;
  readonly runtimeExtras: {
    piQueue: {
      beginEdit(id: string): QueueItemState | undefined;
      clearRejectedDraft(revision: number): void;
      setPaused(paused: boolean): void;
    };
  };
  private readonly manager: PiSessionManager;
  private readonly conversationAssembler: PiConversationAssembler;
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
  private conversationMessages: readonly ThreadMessage[] = [];
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
    this.id = localId;
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
    this.conversationAssembler = new PiConversationAssembler(localId);
    this.snapshot = this.conversationAssembler.snapshot;
    this.conversationAssembler.update({
      messages: this.conversationMessages,
      isLoading: this.snapshotValue.isLoading,
      isRunning: this.snapshotValue.isRunning,
    });
    this.actions = Object.freeze({
      cancel: () => this.cancel(),
      retry: (nodeKey) => this.retry(nodeKey, undefined),
      loadOlder: () => this.reload(),
    });
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

  node(key: string): HostObservable<ConversationNode | undefined> {
    return this.conversationAssembler.node(key);
  }

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
    this.conversationMessages = [];
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
    this.conversationAssembler.dispose();
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
      this.publishMessages({ autoRetry, resumeCheckpoint: value.resume?.checkpoint }, "microtask");
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
      this.replaceSnapshot(
        {
          ...this.conversationPatch(messages),
          isRunning: false,
          runTiming: undefined,
          autoRetry: undefined,
        },
        "immediate",
      );
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
        this.replaceSnapshot({ autoRetry: undefined, runTiming: undefined }, "immediate");
      }
      if (notifyManager && this.remoteIdValue) {
        this.manager.updateRunningFromSession(this.remoteIdValue, running, this, runTiming);
      }
      return;
    }
    this.replaceSnapshot(
      {
        isRunning: running,
        runTiming:
          running && runTiming !== undefined
            ? clientRunTiming(runTiming, this.snapshotValue.runTiming)
            : running
              ? this.snapshotValue.runTiming
              : undefined,
        ...(running ? {} : { autoRetry: undefined }),
      },
      "immediate",
    );
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
    publication: ConversationPublication = "immediate",
  ): void {
    if (this.disposed) return;
    const messages = this.currentMessages();
    this.replaceSnapshot({ ...this.conversationPatch(messages), ...patch }, publication);
  }

  private publishMessagesAndSetRunning(running: boolean, notifyManager = true): void {
    if (this.disposed) return;
    const messages = this.currentMessages();
    this.replaceSnapshot(
      {
        ...this.conversationPatch(messages),
        isRunning: running,
        ...(running ? {} : { runTiming: undefined }),
        autoRetry: undefined,
      },
      "immediate",
    );
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
      messagePatch = this.conversationPatch(messages);
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
      // This callback is already the streaming animation-frame boundary; publishing the
      // assembler immediately here avoids adding a second frame of visible latency.
      this.publishMessages();
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(publish);
    } else {
      queueMicrotask(publish);
    }
  }

  private conversationPatch(
    messages: readonly ThreadMessage[],
  ): Pick<PiSessionSnapshot, "messages" | "messageRepository"> {
    this.conversationMessages = messages;
    return {
      messages: assistantUiMessagesFromPiConversation(messages),
      messageRepository: this.currentMessageRepository(messages),
    };
  }

  private replaceSnapshot(
    patch: Partial<PiSessionSnapshot>,
    publication: ConversationPublication = "microtask",
  ): void {
    if (this.disposed) return;
    this.snapshotValue = { ...this.snapshotValue, ...patch };
    this.conversationAssembler.update(
      {
        messages: this.conversationMessages,
        isLoading: this.snapshotValue.isLoading,
        isRunning: this.snapshotValue.isRunning,
      },
      publication,
    );
    for (const listener of this.listeners) listener();
  }
}
