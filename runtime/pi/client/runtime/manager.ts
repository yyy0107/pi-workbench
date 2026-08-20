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
  type PiAssistantMessage,
  type PiEvent,
  type PiQueuedPrompt,
  type PiQueueMode,
  type PiSessionSummary,
  type PiWorkspaceSummary,
} from "../../contracts";
import {
  archivePiWorkspaceSession,
  cancelPiRpcSession,
  createPiRpcId,
  createPiRpcSession,
  describePiHost,
  deletePiWorkspace,
  fetchPiRpcSessionHistory,
  listPiRpcSessions,
  listPiWorkspaces,
  PiApiError,
  promptPiRpcSession,
  renamePiRpcSession,
  respondPiRpc,
  selectPiRpcSessionModel,
  setPiSessionQueuePaused,
  updatePiRpcSessionQueue,
} from "../transport/api";
import type {
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
  optimisticUserMessage,
  piAssistantToThreadMessage,
  piHistoryToThreadMessages,
  reconcileLiveMessagesAfterHistory,
  sameUserPrompt,
} from "../messages/messages";
import { draftSessionModelSelection } from "../models/model-selection";
import { PiMessageQueue } from "../messages/queue";
import {
  resolveSessionCreateIntent,
  type SessionCreateIntent,
} from "../sessions/session-create-intent";
import {
  fetchProgressiveSessionHistory,
  SessionHistoryPaginationError,
} from "../sessions/session-history-loader";
import {
  piHistoryFromSessionEvents,
  piPromptContent,
  piSummaryFromSessionListItem,
} from "../sessions/session-rpc-adapter";

const ARCHIVED_STORAGE_KEY = `${WORKBENCH_STORAGE_PREFIX}pi-archived-sessions`;
const PINNED_STORAGE_KEY = `${WORKBENCH_STORAGE_PREFIX}pi-pinned-sessions`;

export interface PiSessionSnapshot {
  messages: readonly ThreadMessage[];
  isRunning: boolean;
  isLoading: boolean;
  queuePaused: boolean;
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
  private activeAssistantMessageId?: string;
  private readonly authoritativeMessageIdAliases = new Map<string, string>();
  private snapshotValue: PiSessionSnapshot;
  private openTask?: Promise<void>;
  private reloadTask?: Promise<void>;
  private historyRebaselineGeneration = 0;
  private lastSequence = -1;
  private promptRequestPending = false;
  private localRunLeaseActive = false;
  private promptStartTimer?: ReturnType<typeof setTimeout>;
  private activeMessageTiming?: ActiveMessageTiming;
  private messagePublishScheduled = false;
  private readonly messageTimingByTimestamp = new Map<number, MessageTiming>();
  private readonly toolTimingById = new Map<string, ToolCallTiming>();
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
    this.snapshotValue = {
      messages: [],
      isRunning: running,
      isLoading: Boolean(remoteId),
      queuePaused: false,
    };
    this.messageQueue = new PiMessageQueue({
      isRunning: () => this.snapshotValue.isRunning,
      run: (message) => this.send(message),
      createId: () => createPiRpcId("session.prompt"),
      enqueue: (mode, prompt, rpcId) => this.queuePrompt(mode, prompt, rpcId),
      update: (itemId, action) => this.updateQueue(itemId, action),
      setPaused: (paused, steering, followUp) => this.setQueuePaused(paused, steering, followUp),
      onChange: () => this.replaceSnapshot({ queuePaused: this.messageQueue.isPaused }),
      onSteerRejected: () => {},
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
      this.publishMessages();
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
      await promptPiRpcSession({
        sessionId: submittedRemoteId,
        mode: "queue",
        content: piPromptContent(promptText, prompt.images),
        ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
      });
      this.manager.commitWorkspaceFeedback(workspaceFeedback.map((feedback) => feedback.id));
      this.manager.notePrompt(submittedRemoteId, prompt.text);
      if (this.promptRequestPending) {
        this.promptStartTimer = setTimeout(() => {
          this.promptRequestPending = false;
          this.localRunLeaseActive = false;
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

    await this.send({
      role: "user",
      content: source.content,
      attachments: source.attachments ?? [],
      createdAt: new Date(),
      metadata: { custom: {} },
      parentId: null,
      sourceId: null,
      runConfig,
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
        ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
      },
      rpcId,
    );
    this.manager.commitWorkspaceFeedback(workspaceFeedback.map((feedback) => feedback.id));
    return admission;
  }

  private async updateQueue(itemId: string, action: SessionQueueAction): Promise<void> {
    if (!this.remoteIdValue) throw new PiApiError("pi_session_not_found", 404);
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

  applyQueueSnapshot(items: readonly QueueItem[]): void {
    this.messageQueue.replaceAuthoritative(items);
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

    const conversationEvent = conversationEventFromSessionEvent(event.type, event);
    if (conversationEvent) {
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
      if (message?.role === "assistant") {
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
        this.liveMessages.push(
          piAssistantToThreadMessage(assistantMessage, assistantMessageId, {
            optimistic: true,
            timing,
            toolTimingById: this.toolTimingById,
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
      if (notifyManager && this.remoteIdValue) {
        this.manager.updateRunningFromSession(this.remoteIdValue, running, this);
      }
      return;
    }
    this.replaceSnapshot({ isRunning: running });
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

  private publishMessages(): void {
    this.replaceSnapshot({ messages: this.currentMessages() });
  }

  private publishMessagesAndSetRunning(running: boolean): void {
    this.replaceSnapshot({ messages: this.currentMessages(), isRunning: running });
    if (this.remoteIdValue) {
      this.manager.updateRunningFromSession(this.remoteIdValue, running, this);
    }
  }

  private currentMessages(): readonly ThreadMessage[] {
    return coalesceConsecutiveAssistantMessages([
      ...this.baseMessages,
      ...this.liveMessages,
      ...(this.streamingMessage ? [this.streamingMessage] : []),
    ]);
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
  private readonly completed = new Set<string>();
  private running = new Set<string>();
  private activeLocalId?: string;
  private activeRemoteId?: string;
  private startTask?: Promise<void>;
  private metadataRefreshTask?: Promise<void>;
  private metadataMutations?: Map<string, PiSessionSummary | null>;
  private metadataRunningMutations?: Map<string, boolean>;
  private workspaceGeneration = 0;
  private connectionGeneration = 0;
  private realtimeRefreshRequested = false;
  private realtimeRefreshTask?: Promise<void>;
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
    return undefined;
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
      piWorkspaceId: workspace?.workspaceId,
      piWorkspaceName: workspace?.title,
      piWorkspaceCwd: workspace?.path,
    };
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): Promise<void> {
    this.startTask ??= this.loadInitialMetadata();
    return this.startTask.then(() => {
      this.connections.startRunningEvents(this.applyRunningSnapshot);
    });
  }

  private async loadInitialMetadata(): Promise<void> {
    await Promise.all([this.loadArchiveState(), this.loadPinnedState()]);
    const legacyArchived = [...this.archived];
    await this.refreshMetadata();
    for (const sessionId of legacyArchived) {
      if (!this.summaries.has(sessionId) || this.archived.has(sessionId)) continue;
      try {
        await this.archiveSessionMetadata(sessionId);
      } catch {
        // The server list remains authoritative if a one-time local migration fails.
      }
    }
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
    void describePiHost()
      .catch((error) => console.error("[workbench-pi] host rebaseline failed", error))
      .finally(() => {
        if (generation === this.connectionGeneration) this.requestRealtimeRefresh();
      });
  };

  private readonly handleMuxFrame = (
    frame: ServerRequest<MuxStreamPayload>,
    generation: number,
  ): void => {
    if (generation < this.connectionGeneration) return;
    this.connectionGeneration = generation;
    const payload = frame.payload;
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
    if (payload.type === "host/archived-sessions-changed") {
      this.workspaceGeneration += 1;
      this.archived.clear();
      for (const sessionId of payload.archivedSessionIds) this.archived.add(sessionId);
      void this.saveArchiveState();
      this.notify();
      return;
    }
    if (payload.type === "host/session-added") {
      this.requestRealtimeRefresh();
      return;
    }
    if (payload.type === "host/session-removed") {
      this.connections.closeSession(payload.sessionId);
      this.deleteSummary(payload.sessionId);
      this.running.delete(payload.sessionId);
      this.completed.delete(payload.sessionId);
      this.archived.delete(payload.sessionId);
      this.pendingQueues.delete(payload.sessionId);
      for (const [key, stored] of this.pendingInteractions) {
        if (stored.interaction.sessionId === payload.sessionId) {
          this.pendingInteractions.delete(key);
        }
      }
      this.workspaceGeneration += 1;
      for (const [workspaceId, workspace] of this.workspaces) {
        if (!workspace.sessionIds.includes(payload.sessionId)) continue;
        this.workspaces.set(workspaceId, {
          ...workspace,
          sessionIds: workspace.sessionIds.filter((id) => id !== payload.sessionId),
        });
      }
      this.notify();
      this.requestRealtimeRefresh();
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

    let existingTask = this.initializeTasks.get(session.localId);
    if (existingTask) return existingTask;
    const workspace = this.draftWorkspaces.get(session.localId);
    if (!workspace) throw new PiApiError("pi_invalid_workspace", 400);
    await this.start();
    existingTask = this.initializeTasks.get(session.localId);
    if (existingTask) return existingTask;
    const intent = resolveSessionCreateIntent(
      this.requestedSessionIntents.get(session.localId),
      workspace.id,
      () => createClientMessageId("pi-session"),
    );
    this.requestedSessionIntents.set(session.localId, intent);
    const task = createPiRpcSession({
      workspaceId: intent.workspaceId,
      sessionId: intent.sessionId,
    })
      .then(async ({ sessionId }) => {
        const previousRefresh = this.metadataRefreshTask;
        if (previousRefresh) await previousRefresh.catch(() => undefined);
        let metadataRefreshed = false;
        try {
          await this.refreshMetadata();
          metadataRefreshed = true;
        } catch {
          // Fall back to an optimistic summary; realtime refresh will reconcile it.
        }
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
        if (!metadataRefreshed) {
          try {
            await this.refreshWorkspaces();
          } catch {
            // The created session remains usable; realtime refresh will reconcile it.
          }
        }
        return summary;
      })
      .finally(() => this.initializeTasks.delete(session.localId));
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
    const task = Promise.all([listPiRpcSessions(), listPiWorkspaces()])
      .then(([response, workspaceResponse]) => {
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
          this.applyWorkspaceSnapshot(workspaceResponse);
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
    const response = await listPiWorkspaces();
    if (generation !== this.workspaceGeneration) {
      this.requestRealtimeRefresh();
      return;
    }
    this.applyWorkspaceSnapshot(response);
    this.notify();
  }

  private applyWorkspaceSnapshot(response: Awaited<ReturnType<typeof listPiWorkspaces>>): void {
    this.workspaces.clear();
    for (const workspace of response.items) this.workspaces.set(workspace.workspaceId, workspace);
    this.archived.clear();
    for (const sessionId of response.archivedSessionIds) this.archived.add(sessionId);
  }

  refreshWorkspaceMetadata(): Promise<void> {
    return this.refreshWorkspaces();
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    this.workspaceGeneration += 1;
    await deletePiWorkspace(workspaceId);
    this.workspaceGeneration += 1;
    this.workspaces.delete(workspaceId);
    this.notify();
  }

  private async archiveSessionMetadata(sessionId: string): Promise<void> {
    const generation = ++this.workspaceGeneration;
    const result = await archivePiWorkspaceSession(sessionId);
    if (generation !== this.workspaceGeneration) {
      await this.refreshWorkspaces();
      return;
    }
    this.workspaceGeneration += 1;
    this.archived.clear();
    for (const archivedId of result.archivedSessionIds) this.archived.add(archivedId);
    this.notify();
  }

  createThreadListAdapter(): RemoteThreadListAdapter {
    return {
      list: async () => {
        await this.start();
        return {
          threads: this.orderedSummaries().map((summary) => ({
            status: this.archived.has(summary.id) ? ("archived" as const) : ("regular" as const),
            remoteId: summary.id,
            externalId: summary.id,
            title: summary.name || summary.firstMessage || undefined,
            lastMessageAt: new Date(summary.modified),
            custom: this.getThreadCustom(summary.id),
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
        if (pinned) this.pinned.add(remoteId);
        else this.pinned.delete(remoteId);
        await this.savePinnedState();
        this.notify();
      },
      rename: async (remoteId, newTitle) => {
        await renamePiRpcSession({ sessionId: remoteId, title: newTitle });
        const summary = this.summaries.get(remoteId);
        if (summary) this.setSummary({ ...summary, name: newTitle });
        this.notify();
      },
      archive: async (remoteId) => {
        await this.archiveSessionMetadata(remoteId);
        await this.saveArchiveState();
      },
      unarchive: async (remoteId) => {
        this.archived.delete(remoteId);
        await this.saveArchiveState();
        this.notify();
      },
      delete: async (remoteId) => {
        await this.archiveSessionMetadata(remoteId);
        await this.saveArchiveState();
      },
      generateTitle: async (remoteId, messages) => {
        const title = this.titleFromMessages(messages);
        if (title) await renamePiRpcSession({ sessionId: remoteId, title });
        const summary = this.summaries.get(remoteId);
        if (summary && title) this.setSummary({ ...summary, name: title });
        this.notify();
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
    this.setSummary({
      ...summary,
      firstMessage: summary.firstMessage || text.trim(),
      modified: new Date().toISOString(),
      running: true,
    });
    this.notify();
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
        sessionIds: [...workspace.sessionIds, summary.id],
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
      this.setSummary({ ...summary, running, modified: new Date().toISOString() });
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

  private setSummary(summary: PiSessionSummary): void {
    this.summaries.set(summary.id, summary);
    this.metadataMutations?.set(summary.id, summary);
  }

  private deleteSummary(remoteId: string): void {
    this.summaries.delete(remoteId);
    this.metadataMutations?.set(remoteId, null);
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

  private async loadPinnedState(): Promise<void> {
    const value = await workbenchBrowserStorage.getItem(PINNED_STORAGE_KEY);
    if (!value) return;
    try {
      const ids = JSON.parse(value) as unknown;
      if (Array.isArray(ids)) {
        for (const id of ids) if (typeof id === "string") this.pinned.add(id);
      }
    } catch {
      // Ignore damaged local presentation metadata.
    }
  }

  private savePinnedState(): Promise<void> {
    return workbenchBrowserStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify([...this.pinned]));
  }

  private notify(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
}
