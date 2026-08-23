import type {
  AppendMessage,
  ExternalThreadQueueAdapter,
  MessageTiming,
  QueueItemState,
  RemoteThreadListAdapter,
  ThreadMessage,
  ThreadUserMessage,
  ToolCallTiming,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";

import { workbenchBrowserStorage, WORKBENCH_STORAGE_PREFIX } from "@/runtime/adapters/history";
import { appendWorkspaceFeedbackContext } from "@/components/right-workspace/feedback/feedback-adapter";
import type { WorkspaceFeedbackStore } from "@/components/right-workspace/feedback/feedback-store";
import {
  parseWorkbenchComposerUserProjection,
  parseWorkbenchComposerCommandResponseDetails,
  parseWorkbenchComposerSubmission,
  WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
  WORKBENCH_COMPOSER_RUN_CONFIG_KEY,
} from "@/runtime/composer-request";

import {
  type PiAssistantMessage,
  type PiEvent,
  type PiQueuedPrompt,
  type PiQueueMode,
  type PiSessionSummary,
  type PiUserMessage,
  type PiWorkspaceSummary,
} from "../../contracts";
import {
  archivePiWorkspaceSession,
  cancelPiRpcSession,
  createPiRpcId,
  createPiRpcSession,
  describePiHost,
  deletePiRpcSession,
  deletePiWorkspace,
  fetchPiRpcSessionHistory,
  forkPiRpcSession,
  listPiArchivedWorkspaceSessions,
  listPiRpcSessions,
  listPiWorkspaces,
  PiApiError,
  promptPiRpcSession,
  renamePiRpcSession,
  replacePiSessionQueue,
  respondPiRpc,
  selectPiRpcSessionModel,
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
  SessionHistoryValue,
  SessionPromptValue,
  SessionQueueAction,
  WorkspaceView,
} from "../../rpc-contracts";
import type {
  HostStreamPayload,
  MuxStreamPayload,
  QueueItem,
  QuestionItem,
  ServerRequest,
} from "../../stream-contracts";
import { PiConnectionController } from "../transport/connections";
import {
  conversationEventFromSessionEvent,
  conversationEventThreadMessage,
} from "../messages/conversation-events";
import {
  applyToolExecutionUpdate,
  appendMessageToPiPrompt,
  coalesceConsecutiveAssistantMessages,
  eventMessage,
  hasRunningWorkbenchCompactCommandResponse,
  optimisticUserMessage,
  piAssistantToThreadMessage,
  piHistoryToThreadMessages,
  reconcileLiveMessagesAfterHistory,
  sameUserPrompt,
  upsertWorkbenchComposerCommandResponse,
  workbenchComposerCommandResponseId,
} from "../messages/messages";
import { draftSessionModelSelection } from "../models/model-selection";
import { PiMessageQueue, queueItemAppendMessage } from "../messages/queue";
import {
  resolveSessionCreateIntent,
  type SessionCreateIntent,
} from "../sessions/session-create-intent";
import { nextForkTitle } from "./fork-title";
import {
  fetchProgressiveSessionHistory,
  SessionHistoryPaginationError,
} from "../sessions/session-history-loader";
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

function livePiUserMessage(
  message: PiUserMessage,
  id: string,
  sequence: number | undefined,
  workbenchComposer: PiUserMessage["workbenchComposer"],
): ThreadUserMessage {
  const appendMessage = queueItemAppendMessage({
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
      },
    },
  };
}

export interface PiSessionSnapshot {
  messages: readonly ThreadMessage[];
  isRunning: boolean;
  runStartedAt?: number;
  autoRetry?: PiAutoRetrySnapshot;
  isLoading: boolean;
  queuePaused: boolean;
  steeringQueueIds: readonly string[];
}

export interface PiThreadListItemSnapshot {
  readonly remoteId: string;
  readonly status: "regular" | "archived";
  readonly title?: string;
  readonly lastMessageAt: Date;
  readonly custom?: Record<string, unknown>;
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

interface StoredPendingInteraction {
  readonly interaction: PiPendingInteraction;
  readonly generation: number;
}

type Listener = () => void;

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
    left.running === right.running
  );
}

function stringSetsEqual(left: ReadonlySet<string>, right: readonly string[]): boolean {
  return left.size === right.length && right.every((value) => left.has(value));
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

export class PiClientSession {
  readonly localId: string;
  readonly runtimeExtras: {
    piQueue: {
      beginEdit(id: string): QueueItemState | undefined;
      setPaused(paused: boolean): void;
    };
  };
  private readonly manager: PiSessionManager;
  private readonly listeners = new Set<Listener>();
  private remoteIdValue?: string;
  private baseMessages: ThreadMessage[] = [];
  private liveMessages: ThreadMessage[] = [];
  private streamingMessage?: ThreadMessage;
  private activeUserMessageId?: string;
  private activeAssistantMessageId?: string;
  private runStartedAtValue?: number;
  private readonly authoritativeMessageIdAliases = new Map<string, string>();
  private snapshotValue: PiSessionSnapshot;
  private openTask?: Promise<void>;
  private reloadTask?: Promise<void>;
  private historyRebaselineGeneration = 0;
  private lastSequence = -1;
  private promptRequestPending = false;
  private localRunLeaseActive = false;
  private readonly pendingPromptRpcIds = new Set<string>();
  private promptStartTimer?: ReturnType<typeof setTimeout>;
  private activeMessageTiming?: ActiveMessageTiming;
  private messagePublishScheduled = false;
  private readonly messageTimingByTimestamp = new Map<number, MessageTiming>();
  private readonly toolTimingById = new Map<string, ToolCallTiming>();
  private readonly steeringMessageIds = new Map<string, string>();
  private readonly messageQueue: PiMessageQueue;

  constructor(
    manager: PiSessionManager,
    localId: string,
    remoteId: string | undefined,
    running: boolean,
  ) {
    this.manager = manager;
    this.localId = localId;
    this.remoteIdValue = remoteId;
    this.runStartedAtValue = running ? Date.now() : undefined;
    this.snapshotValue = {
      messages: [],
      isRunning: running,
      runStartedAt: this.runStartedAtValue,
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
      onSteerRejected: (itemId) => this.rejectOptimisticSteer(itemId),
      onChange: () => this.publishQueueState(),
    });
    this.runtimeExtras = {
      piQueue: {
        beginEdit: (id) => this.messageQueue.beginEdit(id),
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
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  bindRemote(summary: PiSessionSummary): void {
    this.remoteIdValue = summary.id;
    if (summary.running) this.setRunningFromManager(true);
  }

  open(): Promise<void> {
    if (this.openTask) return this.openTask;
    if (!this.remoteIdValue) {
      this.replaceSnapshot({ isLoading: false });
      return Promise.resolve();
    }

    // History is enough to render an idle conversation. Opening an event stream
    // starts the full Pi runtime on the server, so only running sessions connect
    // (via connectIfRunning) and that connection must never block history paint.
    this.connectIfRunning();
    this.openTask = this.reload().finally(() => {
      this.replaceSnapshot({ isLoading: false });
    });
    return this.openTask;
  }

  async reload(): Promise<void> {
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
    let initialPage: SessionHistoryValue | undefined;
    const applyHistory = (value: SessionHistoryValue) => {
      if (this.remoteIdValue !== remoteId) return;
      const history = piHistoryFromSessionEvents(remoteId, value);
      const baseMessages = this.stabilizeAuthoritativeMessageIds(
        piHistoryToThreadMessages(history, this.messageTimingByTimestamp, this.toolTimingById),
        baseMessageIdsAtStart,
      );
      this.baseMessages = baseMessages;
      this.liveMessages = reconcileLiveMessagesAfterHistory(this.liveMessages, baseMessages, {
        liveMessageIdsAtStart,
        baseMessageIdsAtStart,
        preserveUnpersistedOptimisticUsers: preserveUnpersistedOptimisticTurn,
      });
      // Running history intentionally excludes an assistant message until its message_end event.
      // A stream rebaseline must therefore retain the in-memory assistant placeholder; removing it
      // creates a user-only snapshot until message_start arrives and makes waiting UI blink.
      if (!preserveUnpersistedOptimisticTurn && this.streamingMessage === streamingMessageAtStart) {
        this.streamingMessage = undefined;
      }
      const historySequence = value.events.at(-1)?.event.seq ?? -1;
      const autoRetry =
        this.snapshotValue.isRunning && historySequence >= this.lastSequence
          ? piAutoRetryFromHistory(value)
          : this.snapshotValue.autoRetry;
      this.publishMessages({ autoRetry });
    };
    this.reloadTask = fetchProgressiveSessionHistory(remoteId, fetchPiRpcSessionHistory, {
      onInitialPage: (history) => {
        initialPage = history;
        // A paginated first page is only a tail of the conversation. It is useful for the
        // initial paint, but replacing an already-published history with that tail briefly
        // removes every older row and collapses the scroll range until backfill completes.
        // Keep the complete, visible history during refreshes and swap in the new complete
        // snapshot atomically once pagination finishes.
        if (!hasPublishedBaseHistory || !history.hasMore) applyHistory(history);
        if (this.snapshotValue.isLoading) this.replaceSnapshot({ isLoading: false });
      },
    })
      .then((history) => {
        if (history !== initialPage) applyHistory(history);
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
    const optimisticUserId = createClientMessageId("pi-user");
    const optimisticAssistantId = createClientMessageId("pi-assistant");
    this.liveMessages.push(optimisticUserMessage(message, optimisticUserId));
    this.activeAssistantMessageId = optimisticAssistantId;
    this.streamingMessage = piAssistantToThreadMessage(
      { role: "assistant", content: [] },
      optimisticAssistantId,
      {
        optimistic: true,
        streaming: true,
        createdAt: message.createdAt.getTime(),
      },
    );
    this.promptRequestPending = true;
    this.localRunLeaseActive = true;
    const submittedAt = message.createdAt.getTime();
    this.runStartedAtValue = Number.isFinite(submittedAt) ? submittedAt : Date.now();
    // A running external-store snapshot is a complete turn: user and assistant rows are both
    // present from its first observable frame and keep the same ids for the whole stream. Establish
    // the local lease before publishing so synchronous subscribers cannot observe an unprotected
    // running snapshot and reconcile it against a stale idle manager summary.
    this.publishMessagesAndSetRunning(true);

    const prompt = appendMessageToPiPrompt(message);
    const workspaceFeedback = this.manager.getWorkspaceFeedback(this.localId, this.remoteIdValue);
    const promptText = appendWorkspaceFeedbackContext(prompt.text, workspaceFeedback);
    const draftModel = draftSessionModelSelection(this.remoteIdValue, message);
    let remoteId: string | undefined;
    try {
      const summary = await this.manager.ensureRemote(this);
      const submittedRemoteId = summary.id;
      remoteId = submittedRemoteId;
      await this.manager.connections.ensureSessionEvents(submittedRemoteId, this.handleEvent);

      if (draftModel) {
        await selectPiRpcSessionModel({ sessionId: submittedRemoteId, ...draftModel });
      }

      const clientTimeZone = browserTimeZone();
      const promptRpcId = createPiRpcId("session.prompt");
      this.pendingPromptRpcIds.add(promptRpcId);
      await promptPiRpcSession(
        {
          sessionId: submittedRemoteId,
          mode: "queue",
          content: piPromptContent(promptText, prompt.images),
          ...(prompt.composer === undefined ? {} : { composer: prompt.composer }),
          ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
        },
        promptRpcId,
      );
      this.manager.commitWorkspaceFeedback(workspaceFeedback.map((feedback) => feedback.id));
      this.manager.notePrompt(submittedRemoteId, prompt.text);
      if (this.promptRequestPending) {
        this.promptStartTimer = setTimeout(() => {
          this.promptRequestPending = false;
          this.localRunLeaseActive = false;
          this.pendingPromptRpcIds.clear();
          if (!this.manager.isRunning(submittedRemoteId)) this.setRunningFromManager(false);
        }, 15_000);
      }
    } catch (error) {
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

  async retry(parentId: string | null, runConfig: AppendMessage["runConfig"]): Promise<void> {
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

    const persistedComposer = parseWorkbenchComposerSubmission(
      source.metadata.custom.workbenchComposerSubmission,
    );
    const retryRunConfig = persistedComposer
      ? {
          ...runConfig,
          custom: {
            ...runConfig?.custom,
            [WORKBENCH_COMPOSER_RUN_CONFIG_KEY]: persistedComposer,
          },
        }
      : runConfig;

    await this.send({
      role: "user",
      content: source.content,
      attachments: source.attachments ?? [],
      createdAt: new Date(),
      metadata: { custom: {} },
      parentId: null,
      sourceId: null,
      runConfig: retryRunConfig,
    });
  }

  async cancel(): Promise<void> {
    if (!this.remoteIdValue) return;
    await cancelPiRpcSession({ sessionId: this.remoteIdValue });
  }

  private async queuePrompt(
    mode: PiQueueMode,
    prompt: PiQueuedPrompt,
    rpcId: string,
  ): Promise<SessionPromptValue> {
    if (!this.remoteIdValue) throw new PiApiError("pi_session_not_found", 404);
    await this.manager.connections.ensureSessionEvents(this.remoteIdValue, this.handleEvent);
    const clientTimeZone = browserTimeZone();
    const workspaceFeedback = this.manager.getWorkspaceFeedback(this.localId, this.remoteIdValue);
    const admission = await promptPiRpcSession(
      {
        sessionId: this.remoteIdValue,
        mode: mode === "steer" ? "steer" : "queue",
        content: piPromptContent(
          appendWorkspaceFeedbackContext(prompt.message, workspaceFeedback),
          prompt.images,
        ),
        ...(prompt.composer === undefined ? {} : { composer: prompt.composer }),
        ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
      },
      rpcId,
    );
    this.manager.commitWorkspaceFeedback(workspaceFeedback.map((feedback) => feedback.id));
    return admission;
  }

  private async updateQueue(itemId: string, action: SessionQueueAction): Promise<void> {
    if (!this.remoteIdValue) throw new PiApiError("pi_session_not_found", 404);
    await this.manager.connections.ensureSessionEvents(this.remoteIdValue, this.handleEvent);
    await updatePiRpcSessionQueue({ sessionId: this.remoteIdValue, itemId, action });
  }

  private async setQueuePaused(
    paused: boolean,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    if (!this.remoteIdValue) throw new PiApiError("pi_session_not_found", 404);
    await setPiSessionQueuePaused(this.remoteIdValue, paused, steering, followUp);
  }

  private async replaceQueue(
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    if (!this.remoteIdValue) throw new PiApiError("pi_session_not_found", 404);
    await replacePiSessionQueue(this.remoteIdValue, steering, followUp);
  }

  applyQueueSnapshot(items: readonly QueueItem[]): void {
    this.messageQueue.replaceAuthoritative(items);
  }

  acknowledgePrompt(rpcId: string): void {
    // Admission only confirms that the host accepted the RPC. Its running summary can still
    // report the previous idle state until agent_start (or another session event) arrives.
    // Keep the local run-start lease across that interval so a stale `running: false` cannot
    // remove the optimistic assistant row and create a visible blank frame.
    this.pendingPromptRpcIds.delete(rpcId);
  }

  connectIfRunning(): void {
    if (!this.remoteIdValue || !this.snapshotValue.isRunning) return;
    void this.manager.connections.ensureSessionEvents(this.remoteIdValue, this.handleEvent);
  }

  setRunningFromManager(running: boolean): void {
    if (!running && this.localRunLeaseActive) return;
    const wasRunning = this.snapshotValue.isRunning;
    if (!running && this.discardEmptyOptimisticAssistant()) {
      this.replaceSnapshot({ messages: this.currentMessages(), isRunning: false });
    } else {
      this.setRunning(running, false);
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
      this.setRunning(true);
      return;
    }
    if (event.type === "auto_retry_start") {
      const autoRetry = piAutoRetryFromEvent(event);
      if (autoRetry) this.replaceSnapshot({ autoRetry });
      return;
    }
    if (event.type === "auto_retry_end") {
      // Keep the retry presentation mounted until agent_settled closes the complete run. Clearing
      // it here creates a brief, misleading Pi Working frame after the final retry response.
      return;
    }

    if (
      event.type === "message" &&
      event.role === "custom" &&
      event.customType === WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE
    ) {
      const response = parseWorkbenchComposerCommandResponseDetails(event.details);
      if (response) {
        if (response.status === "running") this.markPromptStarted();
        this.applyComposerCommandResponse(
          response,
          typeof event.timestamp === "number" && Number.isFinite(event.timestamp)
            ? event.timestamp
            : Date.now(),
        );
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
        this.streamingMessage = piAssistantToThreadMessage(
          message as PiAssistantMessage,
          assistantMessageId,
          {
            optimistic: true,
            streaming: true,
            timing: this.currentMessageTiming(message as PiAssistantMessage),
            toolTimingById: this.toolTimingById,
          },
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
        this.streamingMessage = piAssistantToThreadMessage(assistantMessage, assistantMessageId, {
          optimistic: true,
          streaming: true,
          timing: this.currentMessageTiming(assistantMessage),
          toolTimingById: this.toolTimingById,
        });
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
          piAssistantToThreadMessage(assistantMessage, assistantMessageId, {
            optimistic: true,
            timing,
            toolTimingById: this.toolTimingById,
            eventSeq: sequence,
          }),
        );
        this.activeMessageTiming = undefined;
        this.activeAssistantMessageId = undefined;
        this.streamingMessage = undefined;
        this.publishMessages();
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
    const generation = ++this.historyRebaselineGeneration;
    const currentReload = this.reloadTask;
    void Promise.resolve(currentReload)
      .catch(() => undefined)
      .then(async () => {
        if (generation !== this.historyRebaselineGeneration) return;
        await this.reload();
      })
      .catch((error) => console.error("[workbench-pi] stream rebaseline failed", error));
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
              (sameUserPrompt(candidate, rawUserMessage) ||
                sameUserPrompt(candidate, projectedUserMessage)),
          );

    let publishedId = generatedId;
    let isSteering = false;
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
      isSteering = optimistic.metadata.custom.piSteering === true;
      publishedId = optimistic.id;
      this.liveMessages[optimisticIndex] = {
        ...optimistic,
        ...(activeIndex >= 0 || workbenchComposer ? { content: projectedUserMessage.content } : {}),
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
    if (!completed && !isSteering) {
      const messageStartedAt = message.timestamp ?? Date.now();
      this.runStartedAtValue = Number.isFinite(messageStartedAt) ? messageStartedAt : Date.now();
    }
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

  private setRunning(running: boolean, notifyManager = true): void {
    if (this.snapshotValue.isRunning === running) {
      if (!running && this.snapshotValue.autoRetry !== undefined) {
        this.replaceSnapshot({ autoRetry: undefined });
      }
      if (notifyManager && this.remoteIdValue) {
        this.manager.updateRunningFromSession(this.remoteIdValue, running, this);
      }
      return;
    }
    this.runStartedAtValue = running ? (this.runStartedAtValue ?? Date.now()) : undefined;
    this.replaceSnapshot({
      isRunning: running,
      runStartedAt: this.runStartedAtValue,
      ...(running ? {} : { autoRetry: undefined }),
    });
    if (notifyManager && this.remoteIdValue) {
      this.manager.updateRunningFromSession(this.remoteIdValue, running, this);
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

  private discardEmptyOptimisticAssistant(): boolean {
    const message = this.streamingMessage;
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

  private publishMessages(patch: Pick<Partial<PiSessionSnapshot>, "autoRetry"> = {}): void {
    this.replaceSnapshot({
      messages: this.currentMessages(),
      runStartedAt: this.runStartedAtValue,
      ...patch,
    });
  }

  private publishMessagesAndSetRunning(running: boolean): void {
    this.runStartedAtValue = running ? (this.runStartedAtValue ?? Date.now()) : undefined;
    this.replaceSnapshot({
      messages: this.currentMessages(),
      isRunning: running,
      runStartedAt: this.runStartedAtValue,
      autoRetry: undefined,
    });
    if (this.remoteIdValue) {
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
    return coalesceConsecutiveAssistantMessages([...this.baseMessages, ...liveMessages]);
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

    return messages.map((message) => {
      const existingAlias = this.authoritativeMessageIdAliases.get(message.id);
      if (existingAlias) return { ...message, id: existingAlias };
      if (message.role !== "user" || baseMessageIdsAtStart.has(message.id)) return message;

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
    this.replaceSnapshot({
      queuePaused: this.messageQueue.isPaused,
      steeringQueueIds: this.messageQueue.steeringItems.map((item) => item.id),
      ...(messagesChanged
        ? {
            messages: this.currentMessages(),
          }
        : {}),
    });
  }

  private rejectOptimisticSteer(itemId: string): void {
    const messageId = this.steeringMessageIds.get(itemId);
    if (!messageId) return;
    this.steeringMessageIds.delete(itemId);
    this.liveMessages = this.liveMessages.filter((message) => message.id !== messageId);
  }

  private scheduleMessagesPublish(): void {
    if (this.messagePublishScheduled) return;
    this.messagePublishScheduled = true;
    const publish = () => {
      this.messagePublishScheduled = false;
      this.publishMessages();
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(publish);
    } else {
      queueMicrotask(publish);
    }
  }

  private replaceSnapshot(patch: Partial<PiSessionSnapshot>): void {
    this.snapshotValue = { ...this.snapshotValue, ...patch };
    for (const listener of this.listeners) listener();
  }
}

export class PiSessionManager {
  readonly connections: PiConnectionController;
  private readonly listeners = new Set<Listener>();
  private readonly threadListListeners = new Set<Listener>();
  private readonly activeSessionListeners = new Set<Listener>();
  private readonly summaries = new Map<string, PiSessionSummary>();
  private readonly workspaces = new Map<string, WorkspaceView>();
  private readonly sessions = new Map<string, PiClientSession>();
  private readonly aliases = new Map<string, string>();
  private readonly initializeTasks = new Map<string, Promise<PiSessionSummary>>();
  private readonly requestedSessionIntents = new Map<string, SessionCreateIntent>();
  private readonly draftWorkspaces = new Map<string, PiWorkspaceSummary>();
  private readonly pendingQueues = new Map<string, readonly QueueItem[]>();
  private readonly pendingInteractions = new Map<string, StoredPendingInteraction>();
  private readonly archived = new Set<string>();
  private readonly pinned = new Set<string>();
  private readonly pinnedWorkspaces = new Set<string>();
  private readonly completed = new Set<string>();
  private running = new Set<string>();
  private activeLocalId?: string;
  private activeRemoteId?: string;
  private startTask?: Promise<void>;
  private hostDescriptionValue?: HostDescription;
  private hostDescriptionTask?: Promise<void>;
  private metadataRefreshTask?: Promise<void>;
  private metadataMutations?: Map<string, PiSessionSummary | null>;
  private metadataRunningMutations?: Map<string, boolean>;
  private workspaceGeneration = 0;
  private connectionGeneration = 0;
  private realtimeRefreshRequested = false;
  private realtimeRefreshTask?: Promise<void>;
  private forkTaskTail: Promise<void> = Promise.resolve();
  private revision = 0;
  private readonly workspaceFeedback?: WorkspaceFeedbackStore;

  constructor(options: Readonly<{ workspaceFeedback?: WorkspaceFeedbackStore }> = {}) {
    this.workspaceFeedback = options.workspaceFeedback;
    this.connections = new PiConnectionController({
      onMuxFrame: (frame, generation) => this.handleMuxFrame(frame, generation),
      onHostFrame: (payload, generation) => this.handleHostFrame(payload, generation),
      onGenerationReady: (generation) => this.handleGenerationReady(generation),
    });
  }

  getSnapshot = (): number => this.revision;

  getActiveSessionId = (): string | undefined => this.activeRemoteId;

  getHostDescription = (): HostDescription | undefined => this.hostDescriptionValue;

  subscribeActiveSession = (listener: Listener): (() => void) => {
    this.activeSessionListeners.add(listener);
    return () => this.activeSessionListeners.delete(listener);
  };

  getWorkspaceFeedback(localId: string, remoteId?: string) {
    return this.workspaceFeedback?.forThread([localId, ...(remoteId ? [remoteId] : [])]) ?? [];
  }

  commitWorkspaceFeedback(ids: readonly string[]): void {
    if (ids.length) this.workspaceFeedback?.clear(ids);
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
    const receipt = await respondPiRpc({ type: "client-response", rpcId, result });
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
      title: summary.name || summary.firstMessage || undefined,
      lastMessageAt: new Date(summary.modified),
      custom: this.getThreadCustom(summary.id),
    }));
  }

  getThreadListItemSnapshot(threadId: string | undefined): PiThreadListItemSnapshot | undefined {
    if (!threadId) return undefined;
    const remoteId = this.aliases.get(threadId) ?? threadId;
    const summary = this.summaries.get(remoteId);
    if (!summary) return undefined;
    return {
      status: this.archived.has(remoteId) ? "archived" : "regular",
      remoteId,
      title: summary.name || summary.firstMessage || undefined,
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
      piWorkspaceId: workspace?.workspaceId ?? summary.workspace.id,
      piWorkspaceName: workspace?.title ?? summary.workspace.name,
      piWorkspaceCwd: workspace?.path ?? summary.workspace.cwd,
    };
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeThreadList = (listener: Listener): (() => void) => {
    this.threadListListeners.add(listener);
    return () => this.threadListListeners.delete(listener);
  };

  start(): Promise<void> {
    this.startTask ??= this.loadInitialMetadata();
    return this.startTask.then(() => {
      this.connections.startRunningEvents(this.applyRunningSnapshot);
    });
  }

  private async loadInitialMetadata(): Promise<void> {
    const [, legacyPinnedSessionIds, legacyPinnedWorkspaceIds] = await Promise.all([
      this.loadArchiveState(),
      this.loadLegacyPinnedIds(PINNED_STORAGE_KEY),
      this.loadLegacyPinnedIds(PINNED_WORKSPACES_STORAGE_KEY),
    ]);
    const legacyArchived = [...this.archived];
    await Promise.all([this.refreshMetadata(), this.refreshHostDescription()]);
    for (const sessionId of legacyArchived) {
      if (!this.summaries.has(sessionId) || this.archived.has(sessionId)) continue;
      try {
        await this.archiveSessionMetadata(sessionId);
      } catch {
        // The server list remains authoritative if a one-time local migration fails.
      }
    }
    await this.migrateLegacyPinnedState(legacyPinnedSessionIds, legacyPinnedWorkspaceIds);
    await this.saveArchiveState();
  }

  dispose(): void {
    this.connections.dispose();
    this.activeSessionListeners.clear();
  }

  private readonly handleGenerationReady = (generation: number): void => {
    if (generation < this.connectionGeneration) return;
    this.connectionGeneration = generation;
    let pendingChanged = false;
    for (const [key, pending] of this.pendingInteractions) {
      if (pending.generation >= generation) continue;
      this.pendingInteractions.delete(key);
      pendingChanged = true;
    }
    if (pendingChanged) this.notify();
    // The first socket generation starts only after loadInitialMetadata has completed, so its
    // unary baseline is already current. Revalidating it immediately duplicated the two most
    // expensive list requests on every page load; later generations still rebaseline reconnects.
    if (generation === 1) return;
    void this.refreshHostDescription()
      .catch((error) => console.error("[workbench-pi] host rebaseline failed", error))
      .finally(() => {
        if (generation === this.connectionGeneration) this.requestRealtimeRefresh();
      });
  };

  private refreshHostDescription(): Promise<void> {
    if (this.hostDescriptionTask) return this.hostDescriptionTask;
    const task = describePiHost()
      .then((description) => {
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
    if (generation < this.connectionGeneration) return;
    this.connectionGeneration = generation;
    const payload = frame.payload;
    if (payload.type === "session/prompt-accepted") {
      this.sessions.get(payload.sessionId)?.acknowledgePrompt(frame.rpcId);
      this.updateRunning(payload.sessionId, payload.running);
      return;
    }
    if (payload.type === "session/queue") {
      const items = payload.items.map((item) => structuredClone(item));
      this.pendingQueues.set(payload.sessionId, items);
      this.sessions.get(payload.sessionId)?.applyQueueSnapshot(items);
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
    if (generation < this.connectionGeneration) return;
    this.connectionGeneration = generation;

    if (payload.type === "host/workspace-changed") {
      this.workspaceGeneration += 1;
      this.workspaces.set(payload.workspace.workspaceId, payload.workspace);
      this.notify();
      return;
    }
    if (payload.type === "host/workspace-removed") {
      this.workspaceGeneration += 1;
      this.workspaces.delete(payload.workspaceId);
      this.pinnedWorkspaces.delete(payload.workspaceId);
      this.notify();
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
      void this.saveArchiveState();
      if (changed) this.notify();
      this.notifyThreadList();
      return;
    }
    if (payload.type === "host/session-pinned-changed") {
      this.workspaceGeneration += 1;
      const changed = payload.pinned
        ? !this.pinned.has(payload.sessionId)
        : this.pinned.has(payload.sessionId);
      if (payload.pinned) this.pinned.add(payload.sessionId);
      else this.pinned.delete(payload.sessionId);
      if (changed) this.notify();
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
      const summaryChanged = this.setSummary(payload.summary);
      if (workspaceChanged || runningChanged || summaryChanged) this.notify();
      return;
    }
    if (payload.type === "host/session-changed") {
      if (payload.summary.id !== payload.sessionId) return;
      const runningChanged = this.applySummaryRunning(payload.summary);
      const summaryChanged = this.setSummary(payload.summary);
      if (runningChanged || summaryChanged) this.notify();
      return;
    }
    if (payload.type === "host/session-removed") {
      this.removeSessionMetadata(payload.sessionId);
      this.notify();
      return;
    }
    if (payload.type === "host/agent-error") {
      console.error(`[workbench-pi] session ${payload.sessionId} failed: ${payload.message}`);
    } else if (payload.type === "stream/error") {
      console.error(`[workbench-pi] host stream failed: ${payload.error.message}`);
    }
  };

  private requestRealtimeRefresh(): void {
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
    const resolvedRemoteId = remoteId ?? this.aliases.get(localId);
    const existing =
      (resolvedRemoteId ? this.sessions.get(resolvedRemoteId) : undefined) ??
      this.sessions.get(localId);
    if (existing) return existing;

    const running = resolvedRemoteId ? this.running.has(resolvedRemoteId) : false;
    const session = new PiClientSession(this, localId, resolvedRemoteId, running);
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
    if (session.remoteId) {
      const summary = this.summaries.get(session.remoteId);
      if (summary) return summary;
      await this.refreshMetadata();
      const refreshed = this.summaries.get(session.remoteId);
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
      const { sessionId } = await createPiRpcSession({
        workspaceId: intent.workspaceId,
        sessionId: intent.sessionId,
      });
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
    if (this.metadataRefreshTask) return this.metadataRefreshTask;

    // A create/rename/status mutation can land while the list request is in
    // flight. Replaying those local facts over the response prevents an older
    // list snapshot from temporarily removing the just-created thread.
    const mutations = new Map<string, PiSessionSummary | null>();
    const runningMutations = new Map<string, boolean>();
    this.metadataMutations = mutations;
    this.metadataRunningMutations = runningMutations;
    const workspaceGeneration = ++this.workspaceGeneration;
    const task = Promise.all([
      listPiRpcSessions(),
      listPiWorkspaces(),
      listPiArchivedWorkspaceSessions(),
    ])
      .then(([response, workspaceResponse, archivedResponse]) => {
        const summaries = response.items.map(piSummaryFromSessionListItem);
        const next = new Map(summaries.map((summary) => [summary.id, summary]));
        for (const [id, summary] of mutations) {
          if (summary) next.set(id, summary);
          else next.delete(id);
        }
        this.summaries.clear();
        for (const summary of next.values()) this.summaries.set(summary.id, summary);
        for (const sessionId of this.pendingQueues.keys()) {
          if (next.has(sessionId)) continue;
          this.pendingQueues.delete(sessionId);
          this.connections.closeSession(sessionId);
        }
        for (const [key, stored] of this.pendingInteractions) {
          if (!next.has(stored.interaction.sessionId)) this.pendingInteractions.delete(key);
        }
        if (workspaceGeneration === this.workspaceGeneration) {
          this.applyWorkspaceSnapshot(workspaceResponse, archivedResponse);
        } else {
          // A host frame landed while this unary snapshot was in flight. Fetch
          // again so changes missed during the disconnected window are not lost.
          this.requestRealtimeRefresh();
        }
        const nextRunning = new Set(
          response.items.filter((item) => item.running).map((item) => item.sessionId),
        );
        for (const [id, running] of runningMutations) {
          if (running) nextRunning.add(id);
          else nextRunning.delete(id);
        }
        this.connections.replaceRunningBaseline([...nextRunning]);
        this.applyRunningSnapshot([...nextRunning]);
        this.notify();
      })
      .finally(() => {
        if (this.metadataRefreshTask === task) this.metadataRefreshTask = undefined;
        if (this.metadataMutations === mutations) this.metadataMutations = undefined;
        if (this.metadataRunningMutations === runningMutations) {
          this.metadataRunningMutations = undefined;
        }
      });
    this.metadataRefreshTask = task;
    return task;
  }

  private async refreshWorkspaces(): Promise<void> {
    const generation = ++this.workspaceGeneration;
    const [response, archivedResponse] = await Promise.all([
      listPiWorkspaces(),
      listPiArchivedWorkspaceSessions(),
    ]);
    if (generation !== this.workspaceGeneration) {
      this.requestRealtimeRefresh();
      return;
    }
    this.applyWorkspaceSnapshot(response, archivedResponse);
    this.notify();
  }

  private applyWorkspaceSnapshot(
    response: Awaited<ReturnType<typeof listPiWorkspaces>>,
    archivedResponse: Awaited<ReturnType<typeof listPiArchivedWorkspaceSessions>>,
  ): void {
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
        .map((summary) => summary.name || summary.firstMessage)
        .filter((candidate): candidate is string => Boolean(candidate)),
    );

    const forked = await forkPiRpcSession({ sessionId: source.id, atSeq: input.atSeq });
    await renamePiRpcSession({ sessionId: forked.sessionId, title });

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
    void this.refreshMetadata().catch((error) =>
      console.error("[workbench-pi] fork metadata refresh failed", error),
    );
    return { sessionId: forked.sessionId, title };
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    this.workspaceGeneration += 1;
    await deletePiWorkspace(workspaceId);
    this.workspaceGeneration += 1;
    this.workspaces.delete(workspaceId);
    this.pinnedWorkspaces.delete(workspaceId);
    this.notify();
  }

  async setWorkspacePinned(workspaceId: string, pinned: boolean): Promise<void> {
    this.workspaceGeneration += 1;
    const result = await setPiWorkspacePinned(workspaceId, pinned);
    this.workspaceGeneration += 1;
    const changed = result.pinned
      ? !this.pinnedWorkspaces.has(result.workspaceId)
      : this.pinnedWorkspaces.has(result.workspaceId);
    if (result.pinned) this.pinnedWorkspaces.add(result.workspaceId);
    else this.pinnedWorkspaces.delete(result.workspaceId);
    if (changed) this.notify();
  }

  private async setSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
    this.workspaceGeneration += 1;
    const result = await setPiWorkspaceSessionPinned(sessionId, pinned);
    this.workspaceGeneration += 1;
    const changed = result.pinned
      ? !this.pinned.has(result.sessionId)
      : this.pinned.has(result.sessionId);
    if (result.pinned) this.pinned.add(result.sessionId);
    else this.pinned.delete(result.sessionId);
    if (changed) this.notify();
  }

  private async archiveSessionMetadata(sessionId: string): Promise<void> {
    return this.setSessionArchivedMetadata(sessionId, true);
  }

  private async setSessionArchivedMetadata(sessionId: string, archived: boolean): Promise<void> {
    if (archived) await archivePiWorkspaceSession(sessionId);
    else await unarchivePiWorkspaceSession(sessionId);
  }

  createThreadListAdapter(): RemoteThreadListAdapter {
    return {
      list: async () => {
        await this.start();
        return {
          threads: this.getThreadListSnapshot().map((thread) => ({
            ...thread,
            externalId: thread.remoteId,
          })),
        };
      },
      fetch: async (threadId) => {
        await this.start();
        let summary = this.summaries.get(threadId);
        if (!summary) {
          await this.refreshMetadata();
          summary = this.summaries.get(threadId);
        }
        if (!summary) throw new Error("pi_session_not_found");
        return {
          status: this.archived.has(threadId) ? "archived" : "regular",
          remoteId: threadId,
          externalId: threadId,
          title: summary.name || summary.firstMessage || undefined,
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
        await this.setSessionPinned(remoteId, pinned);
      },
      rename: async (remoteId, newTitle) => {
        await renamePiRpcSession({ sessionId: remoteId, title: newTitle });
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
        await deletePiRpcSession({ sessionId: remoteId });
        this.removeSessionMetadata(remoteId);
        await this.saveArchiveState();
        this.notify();
      },
      generateTitle: async (remoteId, messages) => {
        const title = this.titleFromMessages(messages);
        if (title) await renamePiRpcSession({ sessionId: remoteId, title });
        const summary = this.summaries.get(remoteId);
        if (summary && title && this.setSummary({ ...summary, name: title })) this.notify();
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
      this.draftWorkspaces.set(localId, workspace);
      return;
    }
    const session = this.sessions.get(localId);
    if (session && !session.remoteId && session.getSnapshot().messages.length > 0) return;
    this.draftWorkspaces.delete(localId);
  }

  isCompleted(threadId: string): boolean {
    return this.completed.has(this.aliases.get(threadId) ?? threadId);
  }

  isRunning(threadId: string): boolean {
    return this.running.has(this.aliases.get(threadId) ?? threadId);
  }

  notePrompt(remoteId: string, text: string): void {
    const summary = this.summaries.get(remoteId);
    if (!summary) return;
    const changed = this.setSummary({
      ...summary,
      firstMessage: summary.firstMessage || text.trim(),
      modified: new Date().toISOString(),
      running: true,
    });
    if (changed) this.notify();
  }

  updateRunningFromSession(remoteId: string, running: boolean, source: PiClientSession): void {
    this.updateRunning(remoteId, running, source);
  }

  private bindSession(
    localId: string,
    session: PiClientSession,
    summary: PiSessionSummary,
    workspaceId?: string,
  ): void {
    this.aliases.set(localId, summary.id);
    this.sessions.set(summary.id, session);
    if (this.activeLocalId === localId && this.activeRemoteId !== summary.id) {
      this.activeRemoteId = summary.id;
      for (const listener of this.activeSessionListeners) listener();
    }
    this.setSummary(summary);
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
  }

  private readonly applyRunningSnapshot = (sessionIds: string[]): void => {
    const next = new Set(sessionIds);
    const all = new Set([...this.running, ...next]);
    for (const id of all) this.updateRunning(id, next.has(id));
  };

  private updateRunning(remoteId: string, running: boolean, source?: PiClientSession): void {
    this.metadataRunningMutations?.set(remoteId, running);
    const wasRunning = this.running.has(remoteId);
    if (running) this.running.add(remoteId);
    else this.running.delete(remoteId);

    const summary = this.summaries.get(remoteId);
    if (summary && summary.running !== running) {
      this.setSummary({ ...summary, running });
    }

    const session = this.sessions.get(remoteId);
    if (session && session !== source) session.setRunningFromManager(running);
    if (wasRunning && !running && this.activeRemoteId !== remoteId) this.completed.add(remoteId);
    if (running) this.completed.delete(remoteId);
    if (wasRunning !== running) this.notify();
  }

  private titleFromMessages(messages: readonly ThreadMessage[]): string {
    const firstUser = messages.find((message) => message.role === "user");
    if (!firstUser) return "";
    const text = firstUser.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  }

  private applySummaryRunning(summary: PiSessionSummary): boolean {
    const wasRunning = this.running.has(summary.id);
    if (summary.running) this.running.add(summary.id);
    else this.running.delete(summary.id);
    const session = this.sessions.get(summary.id);
    session?.setRunningFromManager(summary.running);
    if (wasRunning && !summary.running && this.activeRemoteId !== summary.id) {
      this.completed.add(summary.id);
    }
    if (summary.running) this.completed.delete(summary.id);
    return wasRunning !== summary.running;
  }

  private setSummary(summary: PiSessionSummary): boolean {
    const changed = !summariesEqual(this.summaries.get(summary.id), summary);
    this.summaries.set(summary.id, summary);
    this.metadataMutations?.set(summary.id, summary);
    return changed;
  }

  private replaceArchived(sessionIds: readonly string[]): boolean {
    if (stringSetsEqual(this.archived, sessionIds)) return false;
    this.archived.clear();
    for (const sessionId of sessionIds) this.archived.add(sessionId);
    return true;
  }

  private deleteSummary(remoteId: string): void {
    this.summaries.delete(remoteId);
    this.metadataMutations?.set(remoteId, null);
  }

  private removeSessionMetadata(sessionId: string): void {
    this.connections.closeSession(sessionId);
    this.deleteSummary(sessionId);
    this.running.delete(sessionId);
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

  private saveArchiveState(): Promise<void> {
    return workbenchBrowserStorage.setItem(
      ARCHIVED_STORAGE_KEY,
      JSON.stringify([...this.archived]),
    );
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
        await this.setSessionPinned(sessionId, true);
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
    this.revision++;
    for (const listener of this.listeners) listener();
  }

  private notifyThreadList(): void {
    for (const listener of this.threadListListeners) listener();
  }
}
