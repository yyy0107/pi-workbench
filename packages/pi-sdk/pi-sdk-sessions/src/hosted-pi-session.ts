import { getComposerAttachmentStore } from "./composer-text-attachments";
import { randomUUID } from "node:crypto";

import {
  type AgentSession,
  AgentSessionRuntime,
  detectCacheMiss,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";

import type {
  PiAssistantMessage,
  PiEvent,
  PiImageContent,
  PiModelSelection,
  PiQueuedPrompt,
  PiQueueMode,
  PiRunTiming,
  PiSessionHistory,
  PiSessionSummary,
  PiThinkingLevel,
  PiToolCallTiming,
} from "@workbench/pi-rpc-contracts/messages";
import {
  hasWorkbenchComposerDocument,
  hasWorkbenchComposerSemantics,
  isWorkbenchComposerUserCustomType,
  LEGACY_WORKBENCH_COMPOSER_USER_CUSTOM_TYPE,
  WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
  WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE,
  WORKBENCH_COMPOSER_USER_CUSTOM_TYPE,
  WORKBENCH_PROMPT_FAILURE_CUSTOM_TYPE,
  parseWorkbenchComposerUserDetails,
  type WorkbenchComposerCommandResponse,
  type WorkbenchComposerCommandResponseDetails,
  type WorkbenchPromptFailureDetails,
  type WorkbenchComposerResolutionDetails,
  type WorkbenchComposerSubmission,
  type WorkbenchComposerUserProjection,
} from "@workbench/core-contracts/composer/request";
import {
  compilePiComposerPrompt,
  compilePiComposerTransportPrompt,
  PI_COMPOSER_MODEL_INPUT_CUSTOM_TYPE,
} from "@workbench/pi-runtime-adapters/composer-prompt";
import { PI_MODEL_CHANGED_EVENT } from "@workbench/pi-rpc-contracts/messages";
import { PI_CANCEL_INTENT_CUSTOM_TYPE } from "@workbench/pi-runtime-adapters/messages";
import type {
  SessionCompactValue,
  SessionContextPolicy,
  SessionContextPolicyValue,
  SessionEvent,
} from "@workbench/pi-rpc-contracts/rpc";
import {
  missingSessionResumeCheckpointFromBranch,
  parseStoredSessionResumeCheckpoint,
  resumeReasonFromAssistantMessage,
  SESSION_RESUME_ATTEMPT_CUSTOM_TYPE,
  SESSION_RESUME_CHECKPOINT_CUSTOM_TYPE,
  sessionResumeStateFromBranch,
} from "./session-resume";
import {
  effectiveSessionContextBudget,
  normalizeSessionContextPolicy,
  policyFromSessionEntries,
  SESSION_CONTEXT_POLICY_CUSTOM_TYPE,
  sessionContextPolicyMarker,
} from "./session-context-policy";

import {
  applySessionMessageDelta,
  copyPiAssistantMessage,
} from "@workbench/pi-runtime-adapters/messages";
import {
  createSessionMessageChunkData,
  createSessionEventPayload,
  createSessionMessageSnapshotPayload,
} from "@workbench/pi-rpc-contracts/stream";
import { preflightPlanWorkbenchComposerCommands } from "@workbench/pi-sdk-resources/composer-command-planner";

import { PiServerError } from "@workbench/pi-sdk-ports/errors";
import { getInteractiveResponseRegistry as getInteractiveRegistry } from "./interactive-response-registry";
import { estimateSessionContextBreakdown } from "./session-context-breakdown";
import { releaseSessionContextTrace, type SessionContextTrace } from "./session-context-trace";
import {
  appendSessionClientMutation,
  appendSessionEventJournal,
  createCanonicalSessionEvent,
  findSessionClientMutation,
  initializeSessionEventJournal,
  readSessionEventJournal,
} from "./session-event-journal";
import { SessionQueueProjection } from "../lib/session-queue";
import { reconcileInterruptedSession } from "./session-interruption";
import { resolveConversationReferenceContexts } from "../lib/composer-conversation-context";
import { resolveWorkspaceFileReferenceContexts } from "../lib/composer-workspace-file-context";

import { SerializedSessionMutations } from "./session-mutations";

import { HostedSessionLifecycle } from "./hosted-session-lifecycle";
import type { PiSessionRuntimeDependencies } from "./session-runtime-dependencies";
import {
  PROMPT_SOURCE_CUSTOM_TYPE,
  type PromptSubmissionProvenance,
  type PromptSubmissionResult,
  type SessionEventListener,
  type PromptQueueSnapshot,
  type ActiveAssistantStream,
  type ReadonlyPromptQueueSnapshot,
  type ResolveWorkbenchComposerCommandsOptions,
  type ResolvedWorkbenchComposerRequest,
  type PromptQueueMutation,
  type ComposerSubmissionReplay,
} from "./session-types";
import {
  agentMessageText,
  assistantUpdateHasOutput,
  assistantMessageHasOutput,
  assistantMessageMetadata,
  appendPackedAssistantUpdate,
  customMessageMatchesEntry,
  isNativeImageAttachment,
  jsonEqual,
  compactAssistantMessageUpdate,
  copyQueueSnapshot,
  copyQueuedPrompts,
  hasUnmanagedImages,
  imageUnsupported,
  legacySessionEventsFromManager,
  managedFileTrailingText,
  managedImageTrailingText,
  nativeImagesForModel,
  promptsHaveImages,
  resumeStateFromManager,
  sessionManagerInfo,
  sessionManagerSummary,
  textOnlyModelContext,
  isRecord,
  historyFromManager,
  firstUserText,
  TOOL_TIMING_CUSTOM_TYPE,
  storedCanonicalEvent,
} from "./session-projections";
import { appendSessionTitleOrigin, persistGeneratedSessionTitle } from "./session-title";

export interface HostedPiSessionPorts {
  readHistory(sessionId: string): Promise<PiSessionHistory>;
  workspaceFiles():
    | import("@workbench/agent-runtime-contracts/runtime-capabilities").WorkspaceFileReader
    | undefined;
  getPublisher: PiSessionRuntimeDependencies["getPublisher"];
  interactiveResponses(): Pick<
    ReturnType<typeof getInteractiveRegistry>,
    "isSessionWaitingForUserInput" | "clearSession"
  >;
  announceChanged(host: HostedPiSession): void;
  modelProviderRevision(provider: string): number;
  resolveComposerCommands(
    session: Pick<
      AgentSession,
      | "compact"
      | "extensionRunner"
      | "getActiveToolNames"
      | "prompt"
      | "promptTemplates"
      | "reload"
      | "resourceLoader"
      | "sessionManager"
    >,
    submission: WorkbenchComposerSubmission,
    options?: ResolveWorkbenchComposerCommandsOptions,
  ): Promise<ResolvedWorkbenchComposerRequest>;
}
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const ASSISTANT_CHUNK_FLUSH_MS = 100;
const BRANCH_SELECTION_CUSTOM_TYPE = "workbench.branch-selection.v1";
export class HostedPiSession {
  private readonly ports: HostedPiSessionPorts;
  readonly session: AgentSession;
  readonly workbenchToolSources: ReadonlyMap<string, string>;
  private readonly lifecycle: HostedSessionLifecycle;
  private readonly listeners = new Set<SessionEventListener>();
  private readonly onRunningChanged: () => void;
  private readonly contextTrace: SessionContextTrace;
  private readonly unsubscribeAgent: () => void;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private promptTask: Promise<void> | undefined;
  private submissionLeaseActive = false;
  private activePromptHasImages = false;
  private sequence = -1;
  private activeAssistantStream: ActiveAssistantStream | undefined;
  private runStartedAtValue: number | undefined;
  private visibleResponseCompleted = false;
  private assistantMessageActive = false;
  private assistantFirstTokenAt: number | undefined;
  private readonly canonicalEventsValue: SessionEvent[];
  private journalWritable = true;
  private journalFailureReported = false;
  private suppressQueueUpdates = 0;
  private pausedQueue?: PromptQueueSnapshot;
  private readonly toolStartedAtById = new Map<string, number>();
  private readonly queueProjection = new SessionQueueProjection();
  private readonly mutations = new SerializedSessionMutations();
  private readonly modelProviderRevisions = new Map<string, number>();
  private readonly pendingComposerUserProjections: Array<{
    promptText?: string;
    projection: WorkbenchComposerUserProjection;
  }> = [];
  private readonly cancelledQueueItemIds = new Set<string>();
  private contextPolicy: SessionContextPolicy;
  private readonly modelContextCapacities = new Map<string, number>();
  private readonly contextualModelObjects = new WeakSet<object>();

  constructor(
    ports: HostedPiSessionPorts,
    sessionRuntime: AgentSessionRuntime,
    contextTrace: SessionContextTrace,
    onRunningChanged: () => void,
    onDestroyed: () => void,
    contextPolicy: SessionContextPolicy,
    workbenchToolSources: ReadonlyMap<string, string>,
  ) {
    this.ports = ports;
    this.session = sessionRuntime.session;
    this.workbenchToolSources = workbenchToolSources;
    const session = this.session;
    this.contextTrace = contextTrace;
    this.onRunningChanged = onRunningChanged;
    this.lifecycle = new HostedSessionLifecycle(async () => {
      try {
        await sessionRuntime.dispose();
      } finally {
        await releaseSessionContextTrace(this.id, contextTrace);
        onDestroyed();
      }
    });
    this.contextPolicy = contextPolicy;
    this.applyContextPolicyToCurrentModel();
    const initializedJournal = initializeSessionEventJournal(
      session.sessionManager,
      legacySessionEventsFromManager(session.sessionManager),
    );
    this.canonicalEventsValue = initializedJournal.events;
    this.sequence = initializedJournal.events.at(-1)?.seq ?? -1;
    if (initializedJournal.error !== undefined) this.journalWritable = false;
    this.reconcileQueueProjection();
    this.unsubscribeAgent = session.subscribe((event) => {
      const eventTime = Date.now();
      this.contextTrace.observeAgentEvent(event);
      const transientMessageUpdate = event.type === "message_update";
      if (
        event.type === "message_end" &&
        isRecord(event.message) &&
        event.message.role === "user"
      ) {
        try {
          const manager = this.session.sessionManager;
          persistGeneratedSessionTitle(
            manager,
            firstUserText(manager.buildSessionContext().messages) ||
              agentMessageText(event.message),
          );
        } catch (error) {
          console.error("[workbench-pi] first-message session title persistence failed", error);
        }
      }
      if (!transientMessageUpdate) this.touch();
      if (event.type === "tool_execution_start") {
        this.toolStartedAtById.set(event.toolCallId, eventTime);
      } else if (event.type === "tool_execution_update") {
        if (!this.toolStartedAtById.has(event.toolCallId)) {
          this.toolStartedAtById.set(event.toolCallId, eventTime);
        }
      } else if (event.type === "tool_execution_end") {
        const startedAt = this.toolStartedAtById.get(event.toolCallId) ?? eventTime;
        this.toolStartedAtById.delete(event.toolCallId);
        try {
          this.session.sessionManager.appendCustomEntry(TOOL_TIMING_CUSTOM_TYPE, {
            toolCallId: event.toolCallId,
            startedAt,
            completedAt: eventTime,
          } satisfies PiToolCallTiming);
        } catch {
          // Timing persistence must not interrupt the active agent session.
        }
      }
      if (event.type === "queue_update" && this.suppressQueueUpdates === 0) {
        this.reconcileQueueProjection(event.steering, event.followUp);
        this.publish(
          this.pausedQueue
            ? {
                ...(event as PiEvent),
                followUp: this.pausedQueue.followUp.map((prompt) => prompt.message),
                queuePaused: true,
              }
            : (event as PiEvent),
          eventTime,
        );
        this.publishQueueSnapshot();
      } else if (event.type !== "queue_update") {
        const cacheMiss =
          event.type === "message_end" &&
          event.message.role === "assistant" &&
          this.session.settingsManager.getShowCacheMissNotices()
            ? detectCacheMiss(
                this.session.sessionManager.getBranch(),
                event.message,
                this.session.modelRuntime,
              )
            : undefined;
        // Annotate only the journal projection; the model's message stays untouched.
        this.publish(
          cacheMiss && event.type === "message_end"
            ? ({
                ...event,
                message: { ...event.message, workbenchCacheMiss: cacheMiss },
              } as PiEvent)
            : (event as PiEvent),
          eventTime,
        );
      }
      if (!transientMessageUpdate) this.notifyRunningChanged(eventTime);
    });
    if (initializedJournal.error !== undefined) {
      this.reportJournalFailure(initializedJournal.error);
    }
    this.touch();
  }

  get id(): string {
    return this.session.sessionId;
  }

  get isAlive(): boolean {
    return this.lifecycle.isAlive;
  }

  /** Pi-authoritative run state; do not fold Workbench-owned cleanup or preprocessing into it. */
  get isRunning(): boolean {
    return this.session.isStreaming;
  }

  /** Workbench-owned activity that must finish before mutating or releasing this host. */
  get isBusy(): boolean {
    return this.submissionLeaseActive || this.hasActiveAgentRun;
  }

  get runTiming(): PiRunTiming | undefined {
    if (!this.isRunning) return undefined;
    const now = Date.now();
    const startedAt = (this.runStartedAtValue ??= now);
    return {
      startedAt,
      elapsedMs: Math.max(0, now - startedAt),
    };
  }

  private get hasActiveAgentRun(): boolean {
    return this.promptTask !== undefined || this.session.isStreaming;
  }

  private notifyRunningChanged(time = Date.now()): void {
    this.runStartedAtValue = this.isRunning ? (this.runStartedAtValue ?? time) : undefined;
    if (!this.isRunning) this.visibleResponseCompleted = false;
    this.onRunningChanged();
  }

  get streamingMessage(): unknown {
    return this.session.state.streamingMessage;
  }

  get currentSequence(): number {
    return this.sequence;
  }

  get canonicalEvents(): readonly SessionEvent[] {
    return this.canonicalEventsValue;
  }

  get steeringMessages(): readonly string[] {
    return this.session.getSteeringMessages();
  }

  get followUpMessages(): readonly string[] {
    return this.pausedQueue
      ? this.pausedQueue.followUp.map((prompt) => prompt.message)
      : this.session.getFollowUpMessages();
  }

  get queuePaused(): boolean {
    return this.pausedQueue !== undefined;
  }

  subscribe(listener: SessionEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyLegacyListeners(event: PiEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A disconnected or faulty legacy SSE listener must not interrupt the agent event loop.
      }
    }
  }

  private legacyEvent(canonical: SessionEvent, includeSequence: boolean): PiEvent {
    const data =
      typeof canonical.data === "object" &&
      canonical.data !== null &&
      !Array.isArray(canonical.data)
        ? (canonical.data as Record<string, unknown>)
        : { data: canonical.data };
    return {
      type: canonical.type,
      ...data,
      ...(includeSequence ? { sequence: canonical.seq } : {}),
    };
  }

  private reportJournalFailure(error: unknown): void {
    if (this.journalFailureReported) return;
    this.journalFailureReported = true;
    try {
      this.ports.getPublisher().publishHost({
        type: "host/agent-error",
        sessionId: this.id,
        message:
          error instanceof Error
            ? `Session event journal is unavailable: ${error.message}`
            : "Session event journal is unavailable.",
      });
    } catch {
      // Unary history will surface the missing canonical journal after reconnect.
    }
  }

  private projectComposerUserEvent(event: PiEvent): PiEvent {
    if (event.type !== "message_end") return event;
    const message = isRecord(event.message) ? event.message : undefined;
    if (message?.role !== "user") return event;
    const promptText = agentMessageText(message);
    let index = this.pendingComposerUserProjections.findIndex(
      (candidate) => candidate.promptText === promptText,
    );
    if (index < 0) {
      index = this.pendingComposerUserProjections.findIndex(
        (candidate) => candidate.promptText === undefined,
      );
    }
    if (index < 0) return event;
    const [candidate] = this.pendingComposerUserProjections.splice(index, 1);
    return candidate ? { ...event, workbenchComposer: candidate.projection } : event;
  }

  private queueComposerUserProjection(
    projection: WorkbenchComposerUserProjection,
    promptText?: string,
  ): () => void {
    const candidate = {
      ...(promptText === undefined ? {} : { promptText }),
      projection,
    };
    this.pendingComposerUserProjections.push(candidate);
    return () => {
      const index = this.pendingComposerUserProjections.indexOf(candidate);
      if (index >= 0) this.pendingComposerUserProjections.splice(index, 1);
    };
  }

  private composerUserEntryId(submissionId: string): string | undefined {
    return this.session.sessionManager.getBranch().findLast((entry) => {
      if (entry.type !== "custom_message" || !isWorkbenchComposerUserCustomType(entry.customType)) {
        return false;
      }
      return parseWorkbenchComposerUserDetails(entry.details)?.submissionId === submissionId;
    })?.id;
  }

  private async persistImageUnsupportedPromptFailure(
    submissionId: string,
    rpcId?: string,
  ): Promise<boolean> {
    const userEntryId = this.composerUserEntryId(submissionId);
    if (!userEntryId) return false;
    const failure: WorkbenchPromptFailureDetails = {
      version: 1,
      submissionId,
      code: "image-input-unsupported",
      ...(rpcId === undefined ? {} : { rpcId }),
      userEntryId,
    };
    await this.session.sendCustomMessage(
      {
        customType: WORKBENCH_PROMPT_FAILURE_CUSTOM_TYPE,
        content: "",
        display: false,
        details: failure,
      },
      { triggerTurn: false },
    );
    return true;
  }

  private projectAssistantMessageTiming(event: PiEvent, time: number): PiEvent {
    const message = isRecord(event.message) ? event.message : undefined;
    if (event.type === "message_start") {
      this.assistantMessageActive = message?.role === "assistant";
      this.assistantFirstTokenAt = undefined;
      return event;
    }
    if (event.type === "message_update") {
      if (
        this.assistantMessageActive &&
        this.assistantFirstTokenAt === undefined &&
        assistantUpdateHasOutput(event)
      ) {
        this.assistantFirstTokenAt = time;
      }
      return event;
    }
    if (event.type !== "message_end" || message?.role !== "assistant") return event;

    const firstTokenAt =
      this.assistantFirstTokenAt ?? (assistantMessageHasOutput(message) ? time : undefined);
    this.assistantMessageActive = false;
    this.assistantFirstTokenAt = undefined;
    return firstTokenAt === undefined ? event : { ...event, workbenchTiming: { firstTokenAt } };
  }

  private beginAssistantMessageStream(
    message: unknown,
    startSeq: number,
    time: number,
  ): ActiveAssistantStream | undefined {
    if (!assistantMessageMetadata(message)) return undefined;
    const assistantMessage = message as PiAssistantMessage;
    this.clearAssistantMessageStream();
    const stream = {
      id: randomUUID(),
      startSeq,
      revision: 0,
      message: copyPiAssistantMessage(assistantMessage),
      toolCallJson: new Map<number, string>(),
    } satisfies ActiveAssistantStream;
    this.activeAssistantStream = stream;
    try {
      this.ports
        .getPublisher()
        .setSessionMessageSnapshot(
          createSessionMessageSnapshotPayload(
            this.id,
            stream.id,
            0,
            stream.startSeq,
            time,
            stream.message,
          ),
        );
    } catch {
      // The first compact delta will replace this optional pre-token bootstrap state.
    }
    return stream;
  }

  private clearAssistantMessageStream(): void {
    const stream = this.activeAssistantStream;
    this.activeAssistantStream = undefined;
    if (!stream) return;
    if (stream.flushTimer) clearTimeout(stream.flushTimer);
    try {
      this.ports.getPublisher().clearSessionMessageSnapshot(this.id, stream.id);
    } catch {
      // A reconnect without the stale snapshot still converges through durable history.
    }
  }

  private appendCanonicalEvent(sourceEvent: PiEvent, time: number): SessionEvent | undefined {
    let canonical: SessionEvent;
    try {
      canonical = createCanonicalSessionEvent(sourceEvent, this.sequence + 1, time);
    } catch (error) {
      this.reportJournalFailure(error);
      return undefined;
    }
    if (!this.journalWritable) return undefined;

    try {
      canonical = appendSessionEventJournal(this.session.sessionManager, canonical);
    } catch (error) {
      // SessionManager mutates its in-memory branch before attempting the filesystem append.
      // Freeze the canonical prefix so this process cannot allocate a duplicate sequence.
      this.journalWritable = false;
      this.reportJournalFailure(error);
      return undefined;
    }

    this.sequence = canonical.seq;
    this.canonicalEventsValue.push(canonical);
    return canonical;
  }

  private flushAssistantMessageChunk(stream = this.activeAssistantStream): void {
    if (!stream) return;
    if (stream.flushTimer) clearTimeout(stream.flushTimer);
    stream.flushTimer = undefined;
    const pending = stream.pendingChunk;
    stream.pendingChunk = undefined;
    if (!pending || !this.journalWritable) return;

    let chunk: ReturnType<typeof createSessionMessageChunkData>;
    try {
      chunk = createSessionMessageChunkData(
        stream.id,
        pending.firstRevision,
        stream.revision,
        stream.startSeq,
        pending.message,
        pending.updates,
      );
    } catch (error) {
      this.reportJournalFailure(error);
      return;
    }
    const canonical = this.appendCanonicalEvent({ type: "message_update", ...chunk }, pending.time);
    if (!canonical) return;

    const toolCallJson =
      stream.toolCallJson.size === 0
        ? undefined
        : Object.fromEntries(
            [...stream.toolCallJson].map(([contentIndex, json]) => [String(contentIndex), json]),
          );
    try {
      const hub = this.ports.getPublisher();
      hub.setSessionMessageSnapshot(
        createSessionMessageSnapshotPayload(
          this.id,
          stream.id,
          stream.revision,
          stream.startSeq,
          pending.time,
          stream.message,
          toolCallJson,
        ),
      );
      hub.publishMux(createSessionEventPayload(this.id, canonical, this.runTiming));
    } catch {
      // The persisted chunk remains recoverable through session.history after reconnect.
    }
  }

  private publishMessageUpdate(event: PiEvent, time: number): void {
    const { sequence: _sequence, ...legacyEvent } = event;
    this.notifyLegacyListeners(legacyEvent);
    if (!this.journalWritable) return;
    const metadata = assistantMessageMetadata(event.message);
    if (!metadata) return;
    const stream =
      this.activeAssistantStream ??
      this.beginAssistantMessageStream(event.message, this.sequence, time);
    if (!stream) return;
    const update = compactAssistantMessageUpdate(event);
    if (!update) return;
    const message: PiAssistantMessage = {
      ...stream.message,
      ...metadata,
      role: "assistant",
      content: stream.message.content,
    };
    const nextMessage = applySessionMessageDelta(message, stream.toolCallJson, update);
    if (!nextMessage) return;

    stream.message = nextMessage;
    const revision = ++stream.revision;
    stream.pendingChunk ??= {
      firstRevision: revision,
      updates: [],
      message: metadata,
      time,
    };
    appendPackedAssistantUpdate(stream.pendingChunk.updates, update);
    stream.pendingChunk.message = metadata;
    stream.pendingChunk.time = time;
    stream.flushTimer ??= setTimeout(
      () => this.flushAssistantMessageChunk(stream),
      ASSISTANT_CHUNK_FLUSH_MS,
    );
  }

  private publish(sourceEvent: PiEvent, time = Date.now()): void {
    const event = this.projectAssistantMessageTiming(
      this.projectComposerUserEvent(sourceEvent),
      time,
    );
    const eventMessage = isRecord(event.message) ? event.message : undefined;
    if (
      this.visibleResponseCompleted &&
      (event.type === "agent_start" ||
        (event.type === "message_start" && eventMessage?.role === "user"))
    ) {
      this.runStartedAtValue = time;
      this.visibleResponseCompleted = false;
    }
    if (event.type === "message_update") {
      this.publishMessageUpdate(event, time);
      return;
    }
    this.flushAssistantMessageChunk();
    const endsAssistantStream =
      event.type === "agent_settled" ||
      (event.type === "message_end" && assistantMessageMetadata(event.message) !== undefined);
    const canonical = this.appendCanonicalEvent(event, time);
    if (!canonical) {
      if (endsAssistantStream) this.clearAssistantMessageStream();
      this.notifyLegacyListeners(event);
      return;
    }
    const canonicalData = isRecord(canonical.data) ? canonical.data : undefined;
    const canonicalMessage = canonicalData?.message;
    const canonicalAssistantMetadata = assistantMessageMetadata(canonicalMessage);
    if (canonical.type === "message_start" && canonicalAssistantMetadata) {
      this.beginAssistantMessageStream(canonicalMessage, canonical.seq, canonical.time);
    } else if (endsAssistantStream) {
      this.clearAssistantMessageStream();
    }
    if (canonical.type === "message_end" && canonicalAssistantMetadata?.stopReason === "stop") {
      this.visibleResponseCompleted = true;
    } else if (canonical.type === "agent_settled") {
      this.visibleResponseCompleted = false;
    }
    this.notifyLegacyListeners(this.legacyEvent(canonical, true));
    try {
      this.ports
        .getPublisher()
        .publishMux(createSessionEventPayload(this.id, canonical, this.runTiming));
    } catch {
      // The persisted event remains recoverable through unary history after reconnect.
    }
    if (canonical.type === "agent_settled") this.persistResumeCheckpoint(canonical.time);
    if (canonical.type === "message_end" || canonical.type === "session_info_changed") {
      this.ports.announceChanged(this);
    }
  }

  private currentResumeModel(): { provider: string; model: string } | undefined {
    const model = this.session.sessionManager.buildSessionContext().model;
    return model ? { provider: model.provider, model: model.modelId } : undefined;
  }

  private persistResumeCheckpoint(createdAt: number): void {
    const manager = this.session.sessionManager;
    const candidate = missingSessionResumeCheckpointFromBranch(
      manager.getBranch(),
      this.canonicalEventsValue,
      this.currentResumeModel(),
    );
    if (!candidate) return;
    // The lifecycle event's timestamp is authoritative. `createdAt` remains an explicit parameter
    // so callers cannot accidentally invoke checkpoint persistence outside a settled boundary.
    if (candidate.value.createdAt !== createdAt) return;
    try {
      manager.appendCustomEntry(SESSION_RESUME_CHECKPOINT_CUSTOM_TYPE, candidate.value);
      this.ports.announceChanged(this);
    } catch (error) {
      try {
        this.ports.getPublisher().publishHost({
          type: "host/agent-error",
          sessionId: this.id,
          message:
            error instanceof Error ? error.message : "The recovery checkpoint could not be saved.",
        });
      } catch {
        // The original terminal message remains readable even when checkpoint persistence fails.
      }
    }
  }

  private publishQueueUpdate(): void {
    this.reconcileQueueProjection();
    this.publish({
      type: "queue_update",
      steering: this.steeringMessages,
      followUp: this.followUpMessages,
      queuePaused: this.queuePaused,
    });
    this.publishQueueSnapshot();
  }

  private reconcileQueueProjection(
    steering: readonly string[] = this.session.getSteeringMessages(),
    followUp: readonly string[] = this.session.getFollowUpMessages(),
  ): void {
    this.queueProjection.reconcile(
      steering.map((message) => ({ message })),
      this.pausedQueue ? this.pausedQueue.followUp : followUp.map((message) => ({ message })),
    );
  }

  publishQueueSnapshot(): void {
    this.ports.getPublisher().publishMux({
      type: "session/queue",
      sessionId: this.id,
      items: this.queueProjection.items(),
    });
  }

  private runQueueMutation<Value>(mutation: () => Promise<Value>): Promise<Value> {
    return this.mutations.run(() => {
      if (!this.lifecycle.isAlive) throw new PiServerError("pi_session_not_found", 404);
      return mutation();
    });
  }

  private modelContextKey(model: { provider: string; id: string }): string {
    return `${model.provider}\u0000${model.id}`;
  }

  private contextualizeModel<Model extends { provider: string; id: string; contextWindow: number }>(
    model: Model,
  ): Model {
    const key = this.modelContextKey(model);
    if (!this.contextualModelObjects.has(model)) {
      this.modelContextCapacities.set(key, model.contextWindow);
    }
    const capacity = this.modelContextCapacities.get(key) ?? model.contextWindow;
    const contextWindow = effectiveSessionContextBudget(this.contextPolicy, capacity);
    if (model.contextWindow === contextWindow) return model;
    const contextualModel = { ...model, contextWindow };
    this.contextualModelObjects.add(contextualModel);
    return contextualModel;
  }

  private applyContextPolicyToCurrentModel(): void {
    const current = this.session.model;
    if (!current || !Number.isInteger(current.contextWindow) || current.contextWindow < 1) return;
    const contextualModel = this.contextualizeModel(current);
    if (contextualModel !== current) {
      this.session.agent.state.model = contextualModel;
    }
  }

  private applyContextCompactionOverrides(): void {
    if (this.contextPolicy.mode === "inherit") return;
    const compaction = {
      ...(this.contextPolicy.mode === "auto" ? { enabled: true } : {}),
      ...this.contextPolicy.compaction,
    };
    if (Object.keys(compaction).length > 0) {
      this.session.settingsManager.applyOverrides({ compaction });
    }
  }

  private async replaceContextPolicy(policy: SessionContextPolicy): Promise<void> {
    const previousMode = this.contextPolicy.mode;
    this.contextPolicy = policy;
    if (policy.mode === "inherit" || previousMode !== "inherit") {
      await this.session.settingsManager.reload();
    }
    this.applyContextCompactionOverrides();
    this.applyContextPolicyToCurrentModel();
  }

  private async syncContextPolicyFromBranch(): Promise<void> {
    await this.replaceContextPolicy(
      policyFromSessionEntries(this.session.sessionManager.getBranch()),
    );
  }

  contextPolicyValue(): SessionContextPolicyValue {
    this.applyContextCompactionOverrides();
    this.applyContextPolicyToCurrentModel();
    const model = this.session.model;
    const compaction = this.session.settingsManager.getCompactionSettings();
    const usage = this.session.getContextUsage();
    const key = model ? this.modelContextKey(model) : undefined;
    const capacity = key ? this.modelContextCapacities.get(key) : undefined;
    const effectiveBudget = model?.contextWindow;
    const thresholdTokens =
      effectiveBudget === undefined
        ? undefined
        : Math.max(0, effectiveBudget - compaction.reserveTokens);
    const breakdown = estimateSessionContextBreakdown(this.session, usage?.tokens ?? null);
    const contextTokens = breakdown.totalTokens;
    return {
      policy: structuredClone(this.contextPolicy),
      overridden: this.contextPolicy.mode !== "inherit",
      ...(model && capacity !== undefined && effectiveBudget !== undefined
        ? {
            model: {
              provider: model.provider,
              model: model.id,
              name: model.name || model.id,
              capacity,
              effectiveBudget,
            },
          }
        : {}),
      compaction: {
        ...compaction,
        ...(thresholdTokens === undefined ? {} : { thresholdTokens }),
      },
      usage: {
        tokens: contextTokens,
        percent: !effectiveBudget ? null : (contextTokens / effectiveBudget) * 100,
      },
      breakdown,
      nearingCompaction:
        compaction.enabled &&
        thresholdTokens !== undefined &&
        contextTokens >= thresholdTokens * 0.9,
    };
  }

  async refreshContextPolicyValue(): Promise<SessionContextPolicyValue> {
    return this.runQueueMutation(async () => {
      const current = this.session.model;
      if (current && !this.isBusy) {
        await this.refreshChangedModelProvider(current.provider);
        const refreshedModel = this.session.modelRuntime
          .getAvailableSnapshot()
          .find(
            (candidate) => candidate.provider === current.provider && candidate.id === current.id,
          );
        if (refreshedModel) {
          this.session.agent.state.model = this.contextualizeModel(refreshedModel);
        }
      }
      return this.contextPolicyValue();
    });
  }

  updateContextPolicy(policy: SessionContextPolicy): Promise<SessionContextPolicyValue> {
    return this.runQueueMutation(async () => {
      if (this.isBusy) throw new PiServerError("pi_session_busy", 409);
      const normalized = normalizeSessionContextPolicy(policy);
      if (!normalized) throw new PiServerError("pi_invalid_context_policy", 400);
      this.session.sessionManager.appendCustomEntry(
        SESSION_CONTEXT_POLICY_CUSTOM_TYPE,
        sessionContextPolicyMarker(normalized),
      );
      await this.replaceContextPolicy(normalized);
      this.touch();
      this.ports.announceChanged(this);
      return this.contextPolicyValue();
    });
  }

  compactContextNow(): Promise<SessionCompactValue> {
    return this.runQueueMutation(async () => {
      if (this.isBusy) throw new PiServerError("pi_session_busy", 409);
      this.applyContextCompactionOverrides();
      this.applyContextPolicyToCurrentModel();
      await this.session.compact();
      this.touch();
      this.ports.announceChanged(this);
      return { compacted: true, context: this.contextPolicyValue() };
    });
  }

  private async refreshChangedModelProvider(provider: string): Promise<void> {
    const revision = this.ports.modelProviderRevision(provider);
    if ((this.modelProviderRevisions.get(provider) ?? 0) >= revision) return;
    await this.session.modelRuntime.refresh({ allowNetwork: false, providers: [provider] });
    this.modelProviderRevisions.set(provider, revision);
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!this.lifecycle.isAlive) return;
    this.idleTimer = setTimeout(() => {
      const hasPausedPrompts = Boolean(
        this.pausedQueue &&
        (this.pausedQueue.steering.length > 0 || this.pausedQueue.followUp.length > 0),
      );
      if (this.isBusy || hasPausedPrompts) {
        this.touch();
        return;
      }
      void this.shutdown();
    }, SESSION_IDLE_TIMEOUT_MS);
    this.idleTimer.unref?.();
  }

  private requireModelImageCompatibility(
    model: { input: readonly string[] } | undefined,
    incomingImages = false,
  ): void {
    if (model?.input.includes("image")) return;
    if (
      incomingImages ||
      this.activePromptHasImages ||
      promptsHaveImages(this.queueProjection.prompts())
    ) {
      throw imageUnsupported();
    }
  }

  private prepareModelContext(model: { input: readonly string[] } | undefined): void {
    const durableMessages = this.session.sessionManager.buildSessionContext().messages;
    this.session.agent.state.messages = (
      model?.input.includes("image") ? durableMessages : textOnlyModelContext(durableMessages)
    ) as typeof this.session.agent.state.messages;
  }

  private async promptNow(
    message: string,
    images?: PiImageContent[],
    selection?: PiModelSelection,
    cancellationSignal?: AbortSignal,
  ): Promise<boolean> {
    if (!this.lifecycle.isAlive || cancellationSignal?.aborted) return false;
    if (this.hasActiveAgentRun) throw new PiServerError("pi_session_busy", 409);
    this.applyContextCompactionOverrides();

    if (selection) {
      await this.applyPromptSelection(selection);
    } else if (this.session.model) {
      await this.refreshChangedModelProvider(this.session.model.provider);
      const refreshedModel = this.session.modelRuntime
        .getAvailableSnapshot()
        .find(
          (candidate) =>
            candidate.provider === this.session.model?.provider &&
            candidate.id === this.session.model.id,
        );
      if (!refreshedModel) throw new PiServerError("pi_model_not_available", 400);
      const contextualModel = this.contextualizeModel(refreshedModel);
      this.requireModelImageCompatibility(contextualModel, Boolean(images?.length));
      if (contextualModel !== this.session.model) {
        this.session.agent.state.model = contextualModel;
      }
    }

    this.requireModelImageCompatibility(this.session.model, Boolean(images?.length));
    this.prepareModelContext(this.session.model);
    if (!this.lifecycle.isAlive || cancellationSignal?.aborted) return false;

    let reportPreflight: ((accepted: boolean) => void) | undefined;
    const preflight = new Promise<boolean>((resolvePreflight) => {
      reportPreflight = resolvePreflight;
    });

    const run = this.session.prompt(message, {
      ...(images?.length ? { images } : {}),
      source: "rpc",
      preflightResult: (accepted) => reportPreflight?.(accepted),
    });
    this.promptTask = run;
    this.activePromptHasImages = Boolean(images?.length);
    this.touch();
    this.notifyRunningChanged();

    void run
      .then(() => this.publish({ type: "command_done" }))
      .catch((error: unknown) => {
        this.publish({ type: "command_error", code: "pi_prompt_failed" });
        try {
          this.ports.getPublisher().publishHost({
            type: "host/agent-error",
            sessionId: this.id,
            message: error instanceof Error ? error.message : "The agent command failed.",
          });
        } catch {
          // The session event above remains available to connected session listeners.
        }
      })
      .finally(() => {
        if (this.promptTask === run) {
          this.promptTask = undefined;
          this.activePromptHasImages = false;
        }
        this.touch();
        this.notifyRunningChanged();
      });

    const accepted = await Promise.race([
      preflight,
      run.then(
        () => true,
        () => false,
      ),
    ]);
    if (!accepted) {
      if (cancellationSignal?.aborted) return false;
      throw new PiServerError("pi_prompt_rejected", 400);
    }
    return true;
  }

  /** Applies a direct-prompt model selection before image routing inspects model capabilities. */
  private async applyPromptSelection(selection: PiModelSelection): Promise<void> {
    await this.refreshChangedModelProvider(selection.provider);
    const model = this.session.modelRuntime
      .getAvailableSnapshot()
      .find(
        (candidate) =>
          candidate.provider === selection.provider && candidate.id === selection.modelId,
      );
    if (!model) throw new PiServerError("pi_model_not_available", 400);
    const contextualModel = this.contextualizeModel(model);
    this.requireModelImageCompatibility(contextualModel);
    if (
      this.session.model?.provider !== contextualModel.provider ||
      this.session.model?.id !== contextualModel.id
    ) {
      const previousModel = this.session.model;
      const hadConversation = this.session.sessionManager.buildSessionContext().messages.length > 0;
      await this.session.setModel(contextualModel);
      if (hadConversation) {
        this.publish({
          type: PI_MODEL_CHANGED_EVENT,
          provider: contextualModel.provider,
          model: contextualModel.id,
          ...(previousModel
            ? {
                previousProvider: previousModel.provider,
                previousModel: previousModel.id,
              }
            : {}),
        });
      }
    } else if (this.session.model !== contextualModel) {
      this.session.agent.state.model = contextualModel;
    }
    this.prepareModelContext(contextualModel);
    if (selection.thinkingLevel) this.session.setThinkingLevel(selection.thinkingLevel);
  }

  private async prepareContinuationModel(): Promise<void> {
    this.applyContextCompactionOverrides();
    if (this.session.model) {
      await this.refreshChangedModelProvider(this.session.model.provider);
      const refreshedModel = this.session.modelRuntime
        .getAvailableSnapshot()
        .find(
          (candidate) =>
            candidate.provider === this.session.model?.provider &&
            candidate.id === this.session.model.id,
        );
      if (!refreshedModel) throw new PiServerError("pi_model_not_available", 400);
      const contextualModel = this.contextualizeModel(refreshedModel);
      this.requireModelImageCompatibility(contextualModel);
      if (contextualModel !== this.session.model) this.session.agent.state.model = contextualModel;
    }
    this.prepareModelContext(this.session.model);
  }

  private startAgentContinuation(): void {
    if (!this.lifecycle.isAlive) throw new PiServerError("pi_session_not_found", 404);
    const run = this.session.agent.continue();
    this.promptTask = run;
    this.activePromptHasImages = false;
    this.touch();
    this.notifyRunningChanged();
    void run
      .then(() => {
        // Agent.continue() is the Pi core primitive and does not emit AgentSession's high-level
        // settled event. Persist the same durable boundary used by ordinary prompt runs.
        this.contextTrace.observeAgentEvent({ type: "agent_settled" });
        this.publish({ type: "agent_settled" });
        this.publish({ type: "command_done" });
      })
      .catch((error: unknown) => {
        this.contextTrace.observeAgentEvent({ type: "agent_settled" });
        this.publish({ type: "agent_settled" });
        this.publish({ type: "command_error", code: "pi_prompt_failed" });
        try {
          this.ports.getPublisher().publishHost({
            type: "host/agent-error",
            sessionId: this.id,
            message: error instanceof Error ? error.message : "The agent command failed.",
          });
        } catch {
          // The durable command_error event remains available through history.
        }
      })
      .finally(() => {
        if (this.promptTask === run) this.promptTask = undefined;
        this.touch();
        this.notifyRunningChanged();
        this.ports.announceChanged(this);
      });
  }

  private activateBranch(leafId: string | null, persistSelection: boolean): void {
    const manager = this.session.sessionManager;
    if (leafId === null) manager.resetLeaf();
    else {
      if (!manager.getEntry(leafId)) throw new PiServerError("pi_branch_not_found", 404);
      manager.branch(leafId);
    }
    if (persistSelection) {
      if (leafId === null) throw new PiServerError("pi_branch_not_found", 404);
      manager.appendCustomEntry(BRANCH_SELECTION_CUSTOM_TYPE, { selectedLeafId: leafId });
    }
    this.session.agent.state.messages = manager.buildSessionContext().messages;
    const events = readSessionEventJournal(manager);
    this.canonicalEventsValue.splice(0, this.canonicalEventsValue.length, ...events);
    this.sequence = events.at(-1)?.seq ?? -1;
    this.clearAssistantMessageStream();
    this.assistantMessageActive = false;
    this.assistantFirstTokenAt = undefined;
    this.toolStartedAtById.clear();
    try {
      // Branch-local journal sequences restart from the shared prefix. Reset every connected
      // client's watermark before any events from the selected branch can be published.
      this.ports.getPublisher().publishMux({
        type: "session/subscribed",
        sessionId: this.id,
        lastSeq: this.sequence,
      });
    } catch {
      // Unary branch history remains authoritative after reconnect.
    }
    this.ports.announceChanged(this);
  }

  selectBranch(leafId: string): Promise<void> {
    return this.runQueueMutation(async () => {
      if (this.isBusy) throw new PiServerError("pi_session_busy", 409);
      this.activateBranch(leafId, true);
      await this.syncContextPolicyFromBranch();
    });
  }

  private async retryComposerSubmission(
    userEntryId: string,
    submissionId: string,
    prompt: PiQueuedPrompt,
    composer: WorkbenchComposerSubmission,
    rpcId: string,
  ): Promise<void> {
    const retryModel = this.session.model
      ? { provider: this.session.model.provider, modelId: this.session.model.id }
      : undefined;
    const retryThinkingLevel = this.session.thinkingLevel;

    this.activateBranch(userEntryId, false);
    await this.syncContextPolicyFromBranch();

    // Model selection is branch-local in Pi. The selector has already updated the live AgentSession,
    // but branching back to the failed user marker would otherwise discard its durable model marker.
    const branchContext = this.session.sessionManager.buildSessionContext();
    if (
      retryModel &&
      (branchContext.model?.provider !== retryModel.provider ||
        branchContext.model.modelId !== retryModel.modelId)
    ) {
      this.session.sessionManager.appendModelChange(retryModel.provider, retryModel.modelId);
    }
    if (branchContext.thinkingLevel !== retryThinkingLevel) {
      this.session.sessionManager.appendThinkingLevelChange(retryThinkingLevel);
    }

    this.submissionLeaseActive = true;
    this.notifyRunningChanged();
    try {
      let resolvedPrompt = await this.resolveComposerSubmission(prompt, composer, rpcId, {
        submissionId,
      });
      if (resolvedPrompt) {
        try {
          await this.promptNow(
            resolvedPrompt.message,
            nativeImagesForModel(
              resolvedPrompt.images,
              this.session.model,
              resolvedPrompt.imageDelivery,
            ),
          );
        } catch (error) {
          const projection = this.pendingComposerUserProjections.at(-1);
          if (projection?.promptText === resolvedPrompt.message) {
            this.pendingComposerUserProjections.pop();
          }
          if (
            !(error instanceof PiServerError) ||
            error.code !== "pi_model_image_unsupported" ||
            !(await this.persistImageUnsupportedPromptFailure(submissionId, rpcId))
          ) {
            throw error;
          }
        }
      }
      this.session.sessionManager.appendCustomEntry(PROMPT_SOURCE_CUSTOM_TYPE, {
        version: 1,
        mode: "followUp",
        source: { kind: "rpc", rpcId },
      });
    } finally {
      this.submissionLeaseActive = false;
      this.notifyRunningChanged();
    }
  }

  regenerate(messageId: string, requestId?: string): Promise<void> {
    return this.runQueueMutation(async () => {
      if (this.isBusy) throw new PiServerError("pi_session_busy", 409);
      const manager = this.session.sessionManager;
      const selectedEntry = manager.getEntry(messageId);
      const event = selectedEntry ? storedCanonicalEvent(selectedEntry) : undefined;
      const eventData = isRecord(event?.data) ? event.data : undefined;
      const eventMessage = event?.type === "message" ? eventData : eventData?.message;
      const composerEntry =
        selectedEntry?.type === "custom_message"
          ? selectedEntry
          : isRecord(eventMessage) && eventMessage.role === "custom"
            ? manager
                .getBranch(messageId)
                .findLast((entry) => customMessageMatchesEntry(eventMessage, entry))
            : undefined;
      const composerDetails =
        composerEntry?.type === "custom_message" &&
        isWorkbenchComposerUserCustomType(composerEntry.customType)
          ? parseWorkbenchComposerUserDetails(composerEntry.details)
          : undefined;
      if (composerDetails?.composer && composerEntry) {
        const attachments = composerDetails.attachments ?? composerDetails.images ?? [];
        const images: PiImageContent[] = attachments.flatMap((attachment) =>
          attachment.mimeType.startsWith("image/")
            ? [
                {
                  type: "image" as const,
                  data: attachment.data,
                  mimeType: attachment.mimeType,
                  ...(attachment.name === undefined ? {} : { name: attachment.name }),
                },
              ]
            : [],
        );
        const managedFiles =
          composerDetails.fileAttachments ?? composerDetails.imageAttachments ?? [];
        images.push(
          ...managedFiles.filter(isNativeImageAttachment).map((attachment) => ({
            type: "image" as const,
            data: "",
            mimeType: attachment.mediaType,
            name: attachment.name,
            attachmentId: attachment.id,
            attachment,
          })),
        );
        const fileAttachmentIds = managedFiles
          .filter((attachment) => !isNativeImageAttachment(attachment))
          .map((attachment) => attachment.id);
        if (
          images.length > 0 ||
          fileAttachmentIds.length > 0 ||
          composerDetails.textAttachments?.length
        ) {
          await this.retryComposerSubmission(
            composerEntry.id,
            composerDetails.submissionId,
            {
              message: composerDetails.composer.text,
              ...(composerDetails.textAttachments?.length
                ? {
                    textAttachmentIds: composerDetails.textAttachments.map(
                      (attachment) => attachment.id,
                    ),
                  }
                : {}),
              ...(fileAttachmentIds.length ? { fileAttachmentIds } : {}),
              ...(images.length === 0 ? {} : { images }),
            },
            composerDetails.composer,
            requestId ?? randomUUID(),
          );
          return;
        }
      }
      let legacySource = false;
      const userEntry = (() => {
        if (
          selectedEntry?.type === "message" &&
          isRecord(selectedEntry.message) &&
          selectedEntry.message.role === "user"
        ) {
          legacySource = true;
          return selectedEntry;
        }
        if (
          (event?.type !== "message_end" && event?.type !== "message") ||
          !isRecord(eventMessage) ||
          eventMessage.role !== "user"
        ) {
          return undefined;
        }
        if (event.type === "message_end") {
          return manager
            .getChildren(messageId)
            .find(
              (entry) =>
                entry.type === "message" &&
                isRecord(entry.message) &&
                entry.message.role === "user" &&
                jsonEqual(entry.message, eventMessage),
            );
        }
        // Legacy journal migration records canonical `message` events after the original context.
        // Its sequence is the stable index into that migrated context.
        const entryId = historyFromManager(manager).context.entryIds[event.seq];
        const entry = entryId ? manager.getEntry(entryId) : undefined;
        if (entry?.type !== "message" || !jsonEqual(entry.message, eventMessage)) return undefined;
        legacySource = true;
        return entry;
      })();
      if (!userEntry) throw new PiServerError("pi_branch_not_found", 404);

      let branchLeafId = userEntry.id;
      if (legacySource) {
        manager.branch(userEntry.id);
        const initialized = initializeSessionEventJournal(
          manager,
          legacySessionEventsFromManager(manager),
        );
        if (initialized.error !== undefined) throw initialized.error;
        branchLeafId = manager.getLeafId() ?? userEntry.id;
      }
      this.activateBranch(branchLeafId, false);
      await this.syncContextPolicyFromBranch();
      await this.prepareContinuationModel();
      this.startAgentContinuation();
    });
  }

  resume(checkpointId: string, expectedLeafId: string): Promise<void> {
    return this.runQueueMutation(async () => {
      if (this.isBusy) throw new PiServerError("pi_session_busy", 409);
      const manager = this.session.sessionManager;
      if (manager.getLeafId() !== expectedLeafId) {
        throw new PiServerError("pi_resume_stale", 409);
      }
      const resumeState = sessionResumeStateFromBranch(
        manager.getBranch(),
        this.currentResumeModel(),
      );
      if (resumeState.checkpoint?.checkpointId !== checkpointId) {
        throw new PiServerError("pi_resume_stale", 409);
      }
      if (resumeState.checkpoint.capability === "confirmation-required") {
        throw new PiServerError("pi_resume_confirmation_required", 409);
      }
      if (resumeState.checkpoint.capability !== "ready") {
        throw new PiServerError("pi_resume_unavailable", 409);
      }

      const checkpointEntry = manager.getEntry(checkpointId);
      const storedCheckpoint =
        checkpointEntry?.type === "custom" &&
        checkpointEntry.customType === SESSION_RESUME_CHECKPOINT_CUSTOM_TYPE
          ? parseStoredSessionResumeCheckpoint(checkpointEntry.data)
          : undefined;
      if (
        !storedCheckpoint ||
        !manager.getBranch().some((entry) => entry.id === storedCheckpoint.anchorEntryId)
      ) {
        throw new PiServerError("pi_resume_stale", 409);
      }

      await this.syncContextPolicyFromBranch();
      await this.prepareContinuationModel();
      let resumableMessages = [...this.session.agent.state.messages];
      while (resumableMessages.length > 0) {
        const tail = resumableMessages.at(-1);
        if (
          !isRecord(tail) ||
          tail.role !== "assistant" ||
          (resumeReasonFromAssistantMessage(tail as unknown as PiAssistantMessage) === undefined &&
            tail.stopReason !== "error" &&
            tail.stopReason !== "aborted")
        ) {
          break;
        }
        resumableMessages = resumableMessages.slice(0, -1);
      }
      const continuationRole = isRecord(resumableMessages.at(-1))
        ? resumableMessages.at(-1)?.role
        : undefined;
      if (continuationRole !== "user" && continuationRole !== "toolResult") {
        throw new PiServerError("pi_resume_unavailable", 409);
      }
      this.session.agent.state.messages = resumableMessages;
      manager.appendCustomEntry(SESSION_RESUME_ATTEMPT_CUSTOM_TYPE, {
        version: 1,
        checkpointId,
        terminalMessageId: storedCheckpoint.terminalMessageId,
        expectedLeafId,
        createdAt: Date.now(),
      });
      this.startAgentContinuation();
    });
  }

  async prompt(
    message: string,
    images?: PiImageContent[],
    selection?: PiModelSelection,
  ): Promise<void> {
    await this.submit("followUp", { message, ...(images?.length ? { images } : {}) }, undefined, {
      requireIdle: true,
      ...(selection === undefined ? {} : { selection }),
    });
  }

  /** Wait for the prompt admitted through AgentExecutionPort without creating another send path. */
  async waitForCurrentPrompt(): Promise<void> {
    const admittedRun = this.promptTask;
    if (admittedRun) await admittedRun;
  }

  private async resolveComposerSubmission(
    prompt: PiQueuedPrompt,
    submission: WorkbenchComposerSubmission,
    rpcId?: string,
    replay?: ComposerSubmissionReplay,
  ): Promise<PiQueuedPrompt | undefined> {
    const attachmentStore = getComposerAttachmentStore();
    const textAttachments = await attachmentStore.retain(prompt.textAttachmentIds ?? []);
    const retainedFileAttachments = await attachmentStore.retainFiles(
      prompt.fileAttachmentIds ?? [],
    );
    const fileReferencedImageIds = retainedFileAttachments
      .filter(isNativeImageAttachment)
      .map((attachment) => attachment.id);
    const fileAttachments = retainedFileAttachments.filter(
      (attachment) => !isNativeImageAttachment(attachment),
    );
    const imageAttachmentIds = [
      ...fileReferencedImageIds,
      ...(prompt.images?.flatMap((image) =>
        image.attachmentId ? [image.attachmentId] : image.attachment ? [image.attachment.id] : [],
      ) ?? []),
    ];
    const imageAttachments = await attachmentStore.retainImages(imageAttachmentIds);
    const imageDataById = new Map(
      await Promise.all(
        imageAttachments.map(
          async (attachment) =>
            [attachment.id, (await attachmentStore.readImage({ id: attachment.id })).data] as const,
        ),
      ),
    );
    const resolvedImages = [
      ...imageAttachments.map((attachment) => ({
        type: "image" as const,
        data: imageDataById.get(attachment.id)!,
        mimeType: attachment.mediaType,
        name: attachment.name,
        attachmentId: attachment.id,
        attachment,
      })),
      ...(prompt.images?.filter((image) => !image.attachmentId && !image.attachment) ?? []),
    ];
    const imageDelivery = imageAttachments.length
      ? this.session.model?.input.includes("image")
        ? ("native" as const)
        : ("path" as const)
      : undefined;
    const plannedCommands = preflightPlanWorkbenchComposerCommands(this.session, submission);
    const submissionId = replay?.submissionId ?? randomUUID();
    const canonicalDetails = submission.document
      ? {
          version: 3 as const,
          submissionId,
          sourceText: submission.sourceText,
          text: submission.text,
          document: submission.document,
          commands: submission.commands,
          composer: submission,
          ...(textAttachments.length ? { textAttachments } : {}),
          ...(imageAttachments.length || fileAttachments.length
            ? { fileAttachments: [...imageAttachments, ...fileAttachments] }
            : {}),
          ...(resolvedImages.some((image) => !image.attachment)
            ? {
                attachments: resolvedImages
                  .filter((image) => !image.attachment)
                  .map(({ data, mimeType, name }) => ({
                    data,
                    mimeType,
                    ...(name === undefined ? {} : { name }),
                  })),
              }
            : {}),
          status: "accepted" as const,
        }
      : {
          version: 1 as const,
          submissionId,
          sourceText: submission.sourceText,
        };
    if (!replay) {
      await this.session.sendCustomMessage(
        {
          customType: submission.document
            ? WORKBENCH_COMPOSER_USER_CUSTOM_TYPE
            : LEGACY_WORKBENCH_COMPOSER_USER_CUSTOM_TYPE,
          content: "",
          display: false,
          details: canonicalDetails,
        },
        { triggerTurn: false },
      );
    }

    const projection = {
      version: 2 as const,
      submissionId,
      sourceText: submission.sourceText,
      ...(submission.document === undefined ? {} : { document: submission.document }),
      hidden: true as const,
    };
    const publishCommandResponse = (response: WorkbenchComposerCommandResponse) => {
      const responseDetails: WorkbenchComposerCommandResponseDetails = {
        version: 2,
        submissionId,
        ...response,
      };
      const timestamp = Date.now();
      this.publish(
        {
          type: "message",
          role: "custom",
          customType: WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
          content: "",
          display: true,
          details: responseDetails,
          timestamp,
        },
        timestamp,
      );
    };
    const sessionActionWithoutUserText =
      !submission.text.trim() &&
      plannedCommands.some((command) => command.effect === "session-action");
    const resolution = await this.ports.resolveComposerCommands(
      this.session,
      {
        ...submission,
        text: sessionActionWithoutUserText ? submission.text : prompt.message,
      },
      {
        plannedCommands,
        projectInternalUserPrompt: () => this.queueComposerUserProjection(projection),
        onCommandResponse: publishCommandResponse,
      },
    );
    resolution.request.untrustedContext = await resolveConversationReferenceContexts({
      contexts: resolution.request.untrustedContext,
      currentConversationId: this.session.sessionManager.getSessionId(),
      getHistory: this.ports.readHistory,
    });
    resolution.request.untrustedContext = await resolveWorkspaceFileReferenceContexts({
      contexts: resolution.request.untrustedContext,
      readFile: (input) => {
        const files = this.ports.workspaceFiles();
        if (!files) throw new Error("Workspace file service is not installed.");
        return files.readFile(input);
      },
    });
    const commandFailed = resolution.request.commandTrace.some(
      (command) => command.status === "execution-failed",
    );
    const commandOwnsAgentTurn = plannedCommands.some((command) => command.effect === "agent-turn");
    const needsMainTurn =
      !commandOwnsAgentTurn &&
      !commandFailed &&
      (textAttachments.length > 0 ||
        imageAttachments.length > 0 ||
        fileAttachments.length > 0 ||
        Boolean(prompt.images?.length) ||
        Boolean(resolution.request.userText.trim()) ||
        resolution.request.selectedSkills.length > 0 ||
        resolution.request.instructions.length > 0 ||
        resolution.request.trustedContext.length > 0 ||
        resolution.request.untrustedContext.length > 0);
    const resolutionDetails: WorkbenchComposerResolutionDetails = {
      version: 2,
      submissionId,
      status:
        needsMainTurn || !commandFailed
          ? needsMainTurn
            ? "resolved"
            : "completed"
          : "command_error",
      commandTrace: resolution.request.commandTrace,
    };
    await this.session.sendCustomMessage(
      {
        customType: WORKBENCH_COMPOSER_RESOLUTION_CUSTOM_TYPE,
        content: "",
        display: false,
        details: resolutionDetails,
      },
      { triggerTurn: false },
    );
    for (const response of resolution.commandResponses) {
      const responseDetails: WorkbenchComposerCommandResponseDetails = {
        version: 2,
        submissionId,
        ...response,
      };
      this.session.sessionManager.appendCustomEntry(
        WORKBENCH_COMPOSER_COMMAND_RESPONSE_CUSTOM_TYPE,
        responseDetails,
      );
    }

    if (!needsMainTurn) {
      this.publish(
        commandFailed
          ? { type: "command_error", code: "pi_composer_command_failed" }
          : { type: "command_done" },
      );
      return undefined;
    }
    const modelInput =
      hasWorkbenchComposerSemantics(submission) ||
      textAttachments.length > 0 ||
      fileAttachments.length > 0 ||
      imageAttachments.length > 0
        ? compilePiComposerPrompt(resolution.request, textAttachments, [
            ...managedImageTrailingText(resolvedImages, imageDelivery === "native"),
            ...managedFileTrailingText(fileAttachments),
          ])
        : undefined;
    if (modelInput) {
      this.session.sessionManager.appendCustomEntry(
        PI_COMPOSER_MODEL_INPUT_CUSTOM_TYPE,
        modelInput,
      );
    }
    const resolvedPrompt = modelInput?.prompt ?? resolution.request.userText;
    this.queueComposerUserProjection(projection, resolvedPrompt);
    return {
      message: resolvedPrompt,
      ...(textAttachments.length || imageAttachments.length || fileAttachments.length
        ? {
            textAttachments,
            textAttachmentIds: textAttachments.map((attachment) => attachment.id),
            sourceText: submission.sourceText,
          }
        : {}),
      ...(fileAttachments.length
        ? {
            fileAttachments,
            fileAttachmentIds: fileAttachments.map((attachment) => attachment.id),
          }
        : {}),
      ...(resolvedImages.length ? { images: resolvedImages } : {}),
      ...(imageDelivery === undefined ? {} : { imageDelivery }),
    };
  }

  submit(
    mode: PiQueueMode,
    prompt: PiQueuedPrompt,
    provenance?: PromptSubmissionProvenance,
    options: Readonly<{
      requireIdle?: boolean;
      requireRunning?: boolean;
      selection?: PiModelSelection;
    }> = {},
  ): Promise<PromptSubmissionResult> {
    return this.runQueueMutation(async () => {
      let submissionLeaseAcquired = false;
      try {
        if (provenance?.clientMutation) {
          const mutation = findSessionClientMutation(
            this.session.sessionManager,
            provenance.clientMutation,
          );
          if (mutation === "match") return { queued: false };
          if (mutation === "conflict") {
            throw new PiServerError("pi_client_mutation_conflict", 409);
          }
        }
        if (options.requireIdle && this.isBusy) {
          throw new PiServerError("pi_session_busy", 409);
        }
        if (options.requireRunning && !this.hasActiveAgentRun) {
          throw new PiServerError("pi_session_not_running", 409);
        }
        if (provenance?.rpcId && this.cancelledQueueItemIds.delete(provenance.rpcId)) {
          return { queued: false };
        }
        this.submissionLeaseActive = true;
        submissionLeaseAcquired = true;
        this.notifyRunningChanged();
        if (options.selection) await this.applyPromptSelection(options.selection);
        let admission: PromptSubmissionResult = { queued: false };
        const submittedComposer = provenance?.composer;
        const hasPromptAttachments = Boolean(
          prompt.images?.length ||
          prompt.fileAttachmentIds?.length ||
          prompt.textAttachmentIds?.length,
        );
        const composer = submittedComposer
          ? hasPromptAttachments &&
            !hasWorkbenchComposerDocument(submittedComposer) &&
            !hasWorkbenchComposerSemantics(submittedComposer)
            ? {
                ...submittedComposer,
                document: [{ type: "text" as const, text: submittedComposer.sourceText }],
              }
            : submittedComposer
          : hasPromptAttachments
            ? {
                version: 2 as const,
                document: [{ type: "text" as const, text: prompt.message }],
                sourceText: prompt.message,
                text: prompt.message,
                context: [],
                metadata: {},
                commands: [],
              }
            : undefined;
        let resolvedPrompt =
          composer &&
          (hasWorkbenchComposerDocument(composer) || hasWorkbenchComposerSemantics(composer))
            ? await this.resolveComposerSubmission(prompt, composer, provenance?.rpcId)
            : prompt;
        if (resolvedPrompt) {
          const queuedIntoActiveRun = this.hasActiveAgentRun;
          try {
            if (provenance?.clientMutation) {
              appendSessionClientMutation(this.session.sessionManager, provenance.clientMutation);
            }
            if (queuedIntoActiveRun) {
              admission = {
                queued: true,
                queueItemId: await this.queueNow(mode, resolvedPrompt, provenance?.rpcId),
              };
            } else {
              await this.promptNow(
                resolvedPrompt.message,
                nativeImagesForModel(
                  resolvedPrompt.images,
                  this.session.model,
                  resolvedPrompt.imageDelivery,
                ),
              );
            }
          } catch (error) {
            let pendingProjection:
              | { promptText?: string; projection: WorkbenchComposerUserProjection }
              | undefined;
            if (resolvedPrompt !== prompt) {
              pendingProjection = this.pendingComposerUserProjections.at(-1);
              if (pendingProjection?.promptText === resolvedPrompt.message) {
                this.pendingComposerUserProjections.pop();
              }
            }
            if (
              !queuedIntoActiveRun &&
              error instanceof PiServerError &&
              error.code === "pi_model_image_unsupported"
            ) {
              if (!pendingProjection) throw error;
              if (
                !(await this.persistImageUnsupportedPromptFailure(
                  pendingProjection.projection.submissionId,
                  provenance?.rpcId,
                ))
              ) {
                throw error;
              }
            } else {
              throw error;
            }
          }
        }

        if (provenance !== undefined) {
          try {
            this.session.sessionManager.appendCustomEntry(PROMPT_SOURCE_CUSTOM_TYPE, {
              version: 1,
              mode,
              source: {
                kind: "rpc",
                ...(provenance.rpcId === undefined ? {} : { rpcId: provenance.rpcId }),
                ...(provenance.clientTimeZone === undefined
                  ? {}
                  : { clientTimeZone: provenance.clientTimeZone }),
              },
            });
          } catch (error) {
            try {
              this.ports.getPublisher().publishHost({
                type: "host/agent-error",
                sessionId: this.id,
                message:
                  error instanceof Error
                    ? `Prompt provenance could not be persisted: ${error.message}`
                    : "Prompt provenance could not be persisted.",
              });
            } catch {
              // Prompt admission already succeeded; provenance failure must not duplicate the turn.
            }
          }
        }

        if (provenance?.rpcId) {
          try {
            const runTiming = this.runTiming;
            this.ports.getPublisher().publishMux(
              {
                type: "session/prompt-accepted",
                sessionId: this.id,
                mode: mode === "followUp" ? "queue" : "steer",
                running: this.isRunning,
                ...(runTiming === undefined ? {} : { runTiming }),
              },
              { rpcId: provenance.rpcId },
            );
          } catch (error) {
            // The prompt is already admitted. Never turn an acknowledgement transport
            // failure into an HTTP failure that could make the caller submit it twice.
            console.error("[workbench-pi] prompt acknowledgement publish failed", error);
          }
        }
        return admission;
      } finally {
        if (submissionLeaseAcquired) {
          this.submissionLeaseActive = false;
          this.notifyRunningChanged();
        }
      }
    });
  }

  selectModel(selection: {
    provider: string;
    model: string;
    reasoningEffort?: string;
  }): Promise<void> {
    return this.runQueueMutation(async () => {
      await this.refreshChangedModelProvider(selection.provider);
      const model = this.session.modelRuntime
        .getAvailableSnapshot()
        .find(
          (candidate) =>
            candidate.provider === selection.provider && candidate.id === selection.model,
        );
      if (!model) throw new PiServerError("pi_model_not_available", 400);
      const contextualModel = this.contextualizeModel(model);
      this.requireModelImageCompatibility(contextualModel);
      if (
        this.session.model?.provider !== contextualModel.provider ||
        this.session.model?.id !== contextualModel.id
      ) {
        const previousModel = this.session.model;
        const hadConversation =
          this.session.sessionManager.buildSessionContext().messages.length > 0;
        await this.session.setModel(contextualModel);
        if (hadConversation) {
          this.publish({
            type: PI_MODEL_CHANGED_EVENT,
            provider: contextualModel.provider,
            model: contextualModel.id,
            ...(previousModel
              ? {
                  previousProvider: previousModel.provider,
                  previousModel: previousModel.id,
                }
              : {}),
          });
        }
      } else if (this.session.model !== contextualModel) {
        this.session.agent.state.model = contextualModel;
      }
      this.prepareModelContext(contextualModel);
      if (selection.reasoningEffort) {
        this.session.setThinkingLevel(selection.reasoningEffort as PiThinkingLevel);
      }
      this.touch();
    });
  }

  async cancel(): Promise<void> {
    if (this.isBusy) {
      this.session.sessionManager.appendCustomEntry(PI_CANCEL_INTENT_CUSTOM_TYPE, {
        requestedAt: Date.now(),
        source: "workbench",
      });
    }
    this.session.abortCompaction();
    await this.session.abort();
    this.touch();
  }

  queue(mode: PiQueueMode, prompt: PiQueuedPrompt): Promise<void> {
    return this.runQueueMutation(async () => {
      await this.queueNow(mode, prompt);
    });
  }

  private async queueNow(
    mode: PiQueueMode,
    prompt: PiQueuedPrompt,
    requestedId?: string,
  ): Promise<string> {
    if (!this.hasActiveAgentRun) throw new PiServerError("pi_session_not_running", 409);
    if (
      (prompt.imageDelivery === "native" || hasUnmanagedImages(prompt.images)) &&
      !this.session.model?.input.includes("image")
    ) {
      throw imageUnsupported();
    }
    const lane = mode === "steer" ? "steering" : "followUp";
    const queueItem = this.queueProjection.append(lane, prompt, requestedId);
    if (this.pausedQueue && mode === "followUp") {
      this.pausedQueue.followUp.push(...copyQueuedPrompts([prompt]));
      this.publishQueueUpdate();
      this.touch();
      return queueItem.id;
    }
    try {
      if (mode === "steer") {
        await this.session.steer(
          prompt.message,
          nativeImagesForModel(prompt.images, this.session.model, prompt.imageDelivery),
        );
      } else {
        await this.session.followUp(
          prompt.message,
          nativeImagesForModel(prompt.images, this.session.model, prompt.imageDelivery),
        );
      }
    } catch (error) {
      this.publishQueueUpdate();
      throw error;
    }
    this.touch();
    return queueItem.id;
  }

  private async restoreActiveQueue(queue: PromptQueueSnapshot): Promise<void> {
    this.session.clearQueue();
    const firstSteering = queue.steering[0];
    const firstFollowUp = queue.followUp[0];
    if (!this.hasActiveAgentRun && (firstSteering || firstFollowUp)) {
      const first = firstSteering ?? firstFollowUp!;
      await this.promptNow(
        first.message,
        nativeImagesForModel(first.images, this.session.model, first.imageDelivery),
      );
      if (firstSteering) queue.steering.shift();
      else queue.followUp.shift();
    }
    for (const prompt of queue.steering) {
      await this.session.steer(
        prompt.message,
        nativeImagesForModel(prompt.images, this.session.model, prompt.imageDelivery),
      );
    }
    for (const prompt of queue.followUp) {
      await this.session.followUp(
        prompt.message,
        nativeImagesForModel(prompt.images, this.session.model, prompt.imageDelivery),
      );
    }
  }

  private async requireQueueImageCapability(queue: ReadonlyPromptQueueSnapshot): Promise<void> {
    if (!promptsHaveImages(queue)) return;
    const currentModel = this.session.model;
    if (currentModel) {
      await this.refreshChangedModelProvider(currentModel.provider);
      const refreshedModel = this.session.modelRuntime
        .getAvailableSnapshot()
        .find(
          (candidate) =>
            candidate.provider === currentModel.provider && candidate.id === currentModel.id,
        );
      if (!refreshedModel) throw new PiServerError("pi_model_not_available", 400);
      const contextualModel = this.contextualizeModel(refreshedModel);
      if (contextualModel !== currentModel) this.session.agent.state.model = contextualModel;
    }
    if (!this.session.model?.input.includes("image")) throw imageUnsupported();
  }

  replaceQueue(
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    return this.runQueueMutation(() => this.replaceQueueNow(steering, followUp));
  }

  private async replaceQueueNow(
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    await this.requireQueueImageCapability({ steering, followUp });
    const nextQueue = {
      steering: copyQueuedPrompts(steering),
      followUp: copyQueuedPrompts(followUp),
    };
    this.queueProjection.reconcile(nextQueue.steering, nextQueue.followUp);
    if (this.pausedQueue) {
      this.pausedQueue.followUp = nextQueue.followUp;
      this.suppressQueueUpdates += 1;
      try {
        this.session.clearQueue();
        for (const prompt of nextQueue.steering) {
          await this.session.steer(
            prompt.message,
            nativeImagesForModel(prompt.images, this.session.model, prompt.imageDelivery),
          );
        }
      } finally {
        this.suppressQueueUpdates -= 1;
        this.publishQueueUpdate();
        this.touch();
      }
      return;
    }
    this.suppressQueueUpdates += 1;
    try {
      await this.restoreActiveQueue(nextQueue);
    } finally {
      this.suppressQueueUpdates -= 1;
      this.publishQueueUpdate();
      this.touch();
    }
  }

  steerQueued(
    prompt: PiQueuedPrompt,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    return this.runQueueMutation(() => this.steerQueuedNow(prompt, steering, followUp));
  }

  private async steerQueuedNow(
    prompt: PiQueuedPrompt,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    await this.requireQueueImageCapability({
      steering: [prompt, ...steering],
      followUp,
    });
    const remaining = {
      steering: copyQueuedPrompts(steering),
      followUp: copyQueuedPrompts(followUp),
    };
    this.queueProjection.reconcile(remaining.steering, remaining.followUp);
    const steeringItem = this.queueProjection.append("steering", prompt);
    this.queueProjection.moveToSteering(steeringItem.id);
    const paused = this.pausedQueue !== undefined;
    if (paused) this.pausedQueue = remaining;

    this.suppressQueueUpdates += 1;
    try {
      this.session.clearQueue();
      if (this.hasActiveAgentRun)
        await this.session.steer(
          prompt.message,
          nativeImagesForModel(prompt.images, this.session.model, prompt.imageDelivery),
        );
      else
        await this.promptNow(
          prompt.message,
          nativeImagesForModel(prompt.images, this.session.model, prompt.imageDelivery),
        );
      for (const queued of remaining.steering) {
        await this.session.steer(
          queued.message,
          nativeImagesForModel(queued.images, this.session.model, queued.imageDelivery),
        );
      }
      if (!paused) {
        for (const queued of remaining.followUp) {
          await this.session.followUp(
            queued.message,
            nativeImagesForModel(queued.images, this.session.model, queued.imageDelivery),
          );
        }
      }
    } finally {
      this.suppressQueueUpdates -= 1;
      this.publishQueueUpdate();
      this.touch();
    }
  }

  setQueuePaused(
    paused: boolean,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    return this.runQueueMutation(() => this.setQueuePausedNow(paused, steering, followUp));
  }

  private async setQueuePausedNow(
    paused: boolean,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    await this.requireQueueImageCapability({ steering, followUp });
    const nextQueue = {
      steering: copyQueuedPrompts(steering),
      followUp: copyQueuedPrompts(followUp),
    };
    this.queueProjection.reconcile(nextQueue.steering, nextQueue.followUp);

    if (paused) {
      this.pausedQueue = nextQueue;
      this.suppressQueueUpdates += 1;
      try {
        this.session.clearQueue();
        for (const prompt of nextQueue.steering) {
          await this.session.steer(
            prompt.message,
            nativeImagesForModel(prompt.images, this.session.model, prompt.imageDelivery),
          );
        }
      } finally {
        this.suppressQueueUpdates -= 1;
        this.publishQueueUpdate();
        this.touch();
      }
      return;
    }

    this.pausedQueue = undefined;
    this.suppressQueueUpdates += 1;
    try {
      await this.restoreActiveQueue(nextQueue);
    } finally {
      this.suppressQueueUpdates -= 1;
      this.publishQueueUpdate();
      this.touch();
    }
  }

  updateQueueItem(itemId: string, mutation: PromptQueueMutation): Promise<void> {
    return this.runQueueMutation(() => this.updateQueueItemNow(itemId, mutation));
  }

  private async updateQueueItemNow(itemId: string, mutation: PromptQueueMutation): Promise<void> {
    const item = this.queueProjection.find(itemId);
    if (!item) {
      if (mutation.kind === "remove") {
        // A client can remove its optimistic row before the matching prompt admission reaches this
        // session. Retain that id as a cancellation intent so the later serialized submit is a no-op.
        this.cancelledQueueItemIds.add(itemId);
        return;
      }
      throw new PiServerError("pi_queue_item_not_found", 404);
    }
    if (mutation.kind === "steer" && (item.lane !== "followUp" || !this.hasActiveAgentRun)) {
      throw new PiServerError("pi_steer_unavailable", 409);
    }

    if (
      mutation.kind === "edit" &&
      (item.prompt.fileAttachments?.length ||
        item.prompt.textAttachments?.length ||
        mutation.prompt.textAttachmentIds?.length)
    ) {
      const textAttachments = await getComposerAttachmentStore().retain(
        mutation.prompt.textAttachmentIds ?? item.prompt.textAttachmentIds ?? [],
      );
      const sourceText = mutation.prompt.message;
      const branch = this.session.sessionManager.getBranch();
      const previousInput = branch.findLast(
        (entry) =>
          entry.type === "custom" &&
          entry.customType === PI_COMPOSER_MODEL_INPUT_CUSTOM_TYPE &&
          isRecord(entry.data) &&
          entry.data.prompt === item.prompt.message,
      );
      const previousTrailingUserText =
        previousInput?.type === "custom" &&
        isRecord(previousInput.data) &&
        Array.isArray(previousInput.data.trailingUserText) &&
        previousInput.data.trailingUserText.every((value) => typeof value === "string")
          ? (previousInput.data.trailingUserText as string[])
          : [];
      const compiled = compilePiComposerPrompt(
        {
          version: 1,
          userText: sourceText,
          config: { metadata: {} },
          selectedSkills: [],
          instructions: [],
          trustedContext: [],
          untrustedContext: [],
          commandTrace: [],
        },
        textAttachments,
        previousTrailingUserText,
      );
      if (
        previousInput?.type === "custom" &&
        isRecord(previousInput.data) &&
        Array.isArray(previousInput.data.context)
      ) {
        compiled.context.unshift(
          ...previousInput.data.context.filter(
            (value): value is string =>
              typeof value === "string" && !value.startsWith("<workbench-pasted-text-files>"),
          ),
        );
        compiled.prompt = compilePiComposerTransportPrompt(compiled);
      }
      this.session.sessionManager.appendCustomEntry(PI_COMPOSER_MODEL_INPUT_CUSTOM_TYPE, compiled);
      const pending = this.pendingComposerUserProjections.find(
        (entry) => entry.promptText === item.prompt.message,
      );
      const priorUser =
        pending &&
        branch.findLast(
          (entry) =>
            entry.type === "custom_message" &&
            isWorkbenchComposerUserCustomType(entry.customType) &&
            parseWorkbenchComposerUserDetails(entry.details)?.submissionId ===
              pending.projection.submissionId,
        );
      const details =
        priorUser?.type === "custom_message"
          ? parseWorkbenchComposerUserDetails(priorUser.details)
          : undefined;
      const document = [{ type: "text" as const, text: sourceText }];
      if (pending && details) {
        await this.session.sendCustomMessage(
          {
            customType: WORKBENCH_COMPOSER_USER_CUSTOM_TYPE,
            content: "",
            display: false,
            details: {
              ...details,
              sourceText,
              text: sourceText,
              document,
              textAttachments,
              ...(details.composer
                ? { composer: { ...details.composer, sourceText, text: sourceText, document } }
                : {}),
            },
          },
          { triggerTurn: false },
        );
        pending.promptText = compiled.prompt;
        pending.projection = { ...pending.projection, sourceText, document };
      }
      mutation = {
        kind: "edit",
        prompt: {
          ...mutation.prompt,
          message: compiled.prompt,
          sourceText,
          textAttachments,
          textAttachmentIds: textAttachments.map((attachment) => attachment.id),
          ...(item.prompt.fileAttachments?.length
            ? {
                fileAttachments: item.prompt.fileAttachments,
                fileAttachmentIds: item.prompt.fileAttachments.map((attachment) => attachment.id),
              }
            : {}),
          ...(item.prompt.images?.length ? { images: item.prompt.images } : {}),
          ...(item.prompt.imageDelivery === undefined
            ? {}
            : { imageDelivery: item.prompt.imageDelivery }),
        },
      };
    }
    const previousQueue = this.queueProjection.prompts();
    if (mutation.kind === "edit") this.queueProjection.edit(itemId, mutation.prompt);
    else if (mutation.kind === "steer") this.queueProjection.moveToSteering(itemId);
    else this.queueProjection.remove(itemId);

    const nextQueue = this.queueProjection.prompts();
    try {
      await this.requireQueueImageCapability(nextQueue);
    } catch (error) {
      this.queueProjection.reconcile(previousQueue.steering, previousQueue.followUp);
      throw error;
    }
    if (this.pausedQueue) this.pausedQueue = copyQueueSnapshot(nextQueue);
    this.suppressQueueUpdates += 1;
    try {
      this.session.clearQueue();
      for (const prompt of nextQueue.steering) {
        await this.session.steer(
          prompt.message,
          nativeImagesForModel(prompt.images, this.session.model, prompt.imageDelivery),
        );
      }
      if (!this.pausedQueue) {
        for (const prompt of nextQueue.followUp) {
          await this.session.followUp(
            prompt.message,
            nativeImagesForModel(prompt.images, this.session.model, prompt.imageDelivery),
          );
        }
      }
    } finally {
      this.suppressQueueUpdates -= 1;
      this.publishQueueUpdate();
      this.touch();
    }
  }

  rename(name: string): number {
    const previousSequence = this.sequence;
    this.session.setSessionName(name);
    appendSessionTitleOrigin(this.session.sessionManager, "explicit");
    if (this.sequence <= previousSequence) {
      throw new PiServerError("pi_session_event_journal_unavailable", 500);
    }
    this.touch();
    return this.sequence;
  }

  summary(): PiSessionSummary {
    return {
      ...sessionManagerSummary(this.session.sessionManager, this.isRunning, this.runTiming),
      waitingForUserInput: this.ports.interactiveResponses().isSessionWaitingForUserInput(this.id),
    };
  }

  metadataSnapshot(): { summary: PiSessionSummary; info?: SessionInfo } {
    const manager = this.session.sessionManager;
    const summary = this.summary();
    return { summary, info: sessionManagerInfo(manager, summary) };
  }

  shutdown(): Promise<void> {
    return this.lifecycle.shutdown(() => this.shutdownNow());
  }

  private async shutdownNow(): Promise<void> {
    const interruptedRunSeq = this.hasActiveAgentRun
      ? this.canonicalEventsValue.findLast((event) => event.type === "agent_start")?.seq
      : undefined;
    this.ports.interactiveResponses().clearSession(this.id);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    let stopped = false;
    try {
      this.session.abortCompaction();
      this.session.abortBranchSummary();
      this.session.abortBash();
      if (this.isBusy) await this.session.abort();
      await this.promptTask?.catch(() => undefined);
      await this.mutations.run(async () => undefined);
      stopped = true;
    } catch {
      // Disposal below remains authoritative.
    }
    this.flushAssistantMessageChunk();
    this.clearAssistantMessageStream();
    this.unsubscribeAgent();
    this.listeners.clear();
    try {
      if (stopped && this.journalWritable) {
        reconcileInterruptedSession(
          this.session.sessionManager,
          this.canonicalEventsValue,
          interruptedRunSeq,
        );
        this.sequence = this.canonicalEventsValue.at(-1)?.seq ?? -1;
        resumeStateFromManager(this.session.sessionManager, this.canonicalEventsValue);
      }
    } finally {
      await this.lifecycle.dispose();
    }
  }
}
