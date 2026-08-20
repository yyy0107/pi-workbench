import { existsSync, statSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  type AgentSession,
  type AgentSessionServices,
  createAgentSessionFromServices,
  createAgentSessionServices,
  sessionEntryToContextMessages,
  type SessionInfo,
  type SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import type {
  PiAgentMessage,
  PiEvent,
  PiImageContent,
  PiModelListResponse,
  PiModelSelection,
  PiQueuedPrompt,
  PiQueueMode,
  PiSessionHistory,
  PiSessionSummary,
  PiThinkingLevel,
  PiToolCallTiming,
} from "../../contracts";
import { PI_MODEL_CHANGED_EVENT } from "../../contracts";
import { PI_CANCEL_INTENT_CUSTOM_TYPE } from "../../message-termination";
import type { SessionEvent } from "../../rpc-contracts";
import { createSessionEventPayload } from "../../stream-contracts";
import { PiServerError } from "../core/errors";
import { getInteractiveResponseRegistry } from "./interactive-response-registry";
import {
  appendSessionEventJournal,
  createCanonicalSessionEvent,
  initializeSessionEventJournal,
  SESSION_EVENT_CUSTOM_TYPE,
  SESSION_EVENT_JOURNAL_CUSTOM_TYPE,
} from "./session-event-journal";
import { SessionQueueProjection } from "./session-queue";
import { getStreamHub } from "../streams/stream-hub";
import { getWorkspaceStore } from "../workspaces/workspace-registry";
import { validateWorkspace, workspaceFromCwd } from "../workspaces/workspace-paths";

export { PiServerError } from "../core/errors";

const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const TOOL_TIMING_CUSTOM_TYPE = "workbench.tool-timing.v1";
export const PROMPT_SOURCE_CUSTOM_TYPE = "workbench.prompt-source.v1";
const modelProviderRevisions = new Map<string, number>();

export function notifyModelProviderConfigurationChanged(provider: string): void {
  modelProviderRevisions.set(provider, (modelProviderRevisions.get(provider) ?? 0) + 1);
}

export interface PromptSubmissionProvenance {
  rpcId?: string;
  clientTimeZone?: string;
}

export interface PromptSubmissionResult {
  queued: boolean;
  queueItemId?: string;
}

type SessionEventListener = (event: PiEvent) => void;
type RunningListener = (sessionIds: string[]) => void;

interface PromptQueueSnapshot {
  steering: PiQueuedPrompt[];
  followUp: PiQueuedPrompt[];
}

interface SessionTimestampEntry {
  type?: string;
  timestamp: string;
  customType?: string;
  data?: unknown;
  message?: unknown;
}

interface SessionTimestampSource {
  getBranch(): readonly SessionTimestampEntry[];
  getHeader(): { timestamp: string } | null;
  getSessionFile(): string | null | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsedDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
}

function meaningfulEntryTime(entry: SessionTimestampEntry): Date | undefined {
  if (
    entry.type === "custom" &&
    (entry.customType === SESSION_EVENT_CUSTOM_TYPE ||
      entry.customType === SESSION_EVENT_JOURNAL_CUSTOM_TYPE)
  ) {
    return undefined;
  }
  if (entry.type === "message" && isRecord(entry.message)) {
    const messageTimestamp = entry.message.timestamp;
    if (typeof messageTimestamp === "number" && Number.isFinite(messageTimestamp)) {
      return new Date(messageTimestamp);
    }
  }
  return parsedDate(entry.timestamp);
}

/** Derive ordering from durable activity without counting journal storage writes as activity. */
export function sessionModifiedAt(source: SessionTimestampSource): Date {
  const branch = source.getBranch();
  let expectedSequence = 0;
  let modifiedTime: number | undefined;
  for (const entry of branch) {
    const canonical = storedCanonicalEvent(entry);
    if (canonical?.seq === expectedSequence) {
      expectedSequence += 1;
      modifiedTime = Math.max(modifiedTime ?? Number.NEGATIVE_INFINITY, canonical.time);
    }
    const meaningful = meaningfulEntryTime(entry);
    if (meaningful) {
      modifiedTime = Math.max(modifiedTime ?? Number.NEGATIVE_INFINITY, meaningful.getTime());
    }
  }
  if (modifiedTime !== undefined) return new Date(modifiedTime);

  const headerTimestamp = parsedDate(source.getHeader()?.timestamp);
  if (headerTimestamp) return headerTimestamp;

  const file = source.getSessionFile();
  if (file) {
    try {
      return statSync(file).mtime;
    } catch {
      // A transient or newly-created session can disappear before the stat call.
    }
  }
  return new Date();
}

export type PromptQueueMutation =
  | { kind: "edit"; prompt: PiQueuedPrompt }
  | { kind: "remove" }
  | { kind: "steer" };

function copyQueuedPrompts(prompts: readonly PiQueuedPrompt[]): PiQueuedPrompt[] {
  return prompts.map((prompt) => ({
    message: prompt.message,
    ...(prompt.images?.length ? { images: prompt.images.map((image) => ({ ...image })) } : {}),
  }));
}

function copyQueueSnapshot(queue: PromptQueueSnapshot): PromptQueueSnapshot {
  return {
    steering: copyQueuedPrompts(queue.steering),
    followUp: copyQueuedPrompts(queue.followUp),
  };
}

function contentHasImage(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some((part) => isRecord(part) && part.type === "image" && typeof part.data === "string")
  );
}

/** Durable context image detection shared by model-switch admission and its regression tests. */
export function messagesHaveImages(messages: readonly unknown[]): boolean {
  return messages.some((candidate) => isRecord(candidate) && contentHasImage(candidate.content));
}

function promptsHaveImages(prompts: PromptQueueSnapshot): boolean {
  return [...prompts.steering, ...prompts.followUp].some((prompt) =>
    prompt.images?.some((image) => image.type === "image" && Boolean(image.data)),
  );
}

function imageUnsupported(): PiServerError {
  return new PiServerError("pi_model_image_unsupported", 400);
}

function firstUserText(messages: readonly unknown[]): string {
  for (const candidate of messages) {
    if (!candidate || typeof candidate !== "object") continue;
    const message = candidate as { role?: unknown; content?: unknown };
    if (message.role !== "user") continue;
    if (typeof message.content === "string" && message.content.trim()) {
      return message.content.trim();
    }
    if (!Array.isArray(message.content)) continue;
    const text = message.content.find((part): part is { type: "text"; text: string } =>
      Boolean(
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
      ),
    )?.text;
    if (text?.trim()) return text.trim();
  }
  return "";
}

export class SerializedSessionMutations {
  private tail: Promise<void> = Promise.resolve();

  run<Value>(mutation: () => Promise<Value>): Promise<Value> {
    const run = this.tail.catch(() => undefined).then(mutation);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

class HostedPiSession {
  readonly session: AgentSession;
  private readonly listeners = new Set<SessionEventListener>();
  private readonly onRunningChanged: () => void;
  private readonly onDestroyed: () => void;
  private readonly unsubscribeAgent: () => void;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private promptTask: Promise<void> | undefined;
  private activePromptHasImages = false;
  private sequence = -1;
  private readonly canonicalEventsValue: SessionEvent[];
  private journalWritable = true;
  private journalFailureReported = false;
  private alive = true;
  private suppressQueueUpdates = 0;
  private pausedQueue?: PromptQueueSnapshot;
  private readonly toolStartedAtById = new Map<string, number>();
  private readonly queueProjection = new SessionQueueProjection();
  private readonly mutations = new SerializedSessionMutations();
  private readonly modelProviderRevisions = new Map<string, number>();

  constructor(session: AgentSession, onRunningChanged: () => void, onDestroyed: () => void) {
    this.session = session;
    this.onRunningChanged = onRunningChanged;
    this.onDestroyed = onDestroyed;
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
      this.touch();
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
        this.publish(event as PiEvent, eventTime);
      }
      this.onRunningChanged();
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
    return this.alive;
  }

  get isRunning(): boolean {
    return this.promptTask !== undefined || this.session.isStreaming;
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
      getStreamHub().publishHost({
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

  private publish(event: PiEvent, time = Date.now()): void {
    let canonical: SessionEvent;
    try {
      canonical = createCanonicalSessionEvent(event, this.sequence + 1, time);
    } catch (error) {
      this.reportJournalFailure(error);
      return;
    }

    if (!this.journalWritable) {
      this.notifyLegacyListeners(this.legacyEvent(canonical, false));
      return;
    }

    try {
      canonical = appendSessionEventJournal(this.session.sessionManager, canonical);
    } catch (error) {
      // SessionManager mutates its in-memory branch before attempting the filesystem append.
      // Freeze the canonical prefix after a failed append so history and mux cannot allocate a
      // duplicate sequence in this process. Legacy listeners remain usable without a sequence.
      this.journalWritable = false;
      this.reportJournalFailure(error);
      this.notifyLegacyListeners(this.legacyEvent(canonical, false));
      return;
    }

    this.sequence = canonical.seq;
    this.canonicalEventsValue.push(canonical);
    this.notifyLegacyListeners(this.legacyEvent(canonical, true));
    try {
      getStreamHub().publishMux(createSessionEventPayload(this.id, canonical));
    } catch {
      // The persisted event remains recoverable through unary history after reconnect.
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
    getStreamHub().publishMux({
      type: "session/queue",
      sessionId: this.id,
      items: this.queueProjection.items(),
    });
  }

  private runQueueMutation<Value>(mutation: () => Promise<Value>): Promise<Value> {
    return this.mutations.run(mutation);
  }

  private async refreshChangedModelProvider(provider: string): Promise<void> {
    const revision = modelProviderRevisions.get(provider) ?? 0;
    if ((this.modelProviderRevisions.get(provider) ?? 0) >= revision) return;
    await this.session.modelRuntime.refresh({ allowNetwork: false, providers: [provider] });
    this.modelProviderRevisions.set(provider, revision);
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      const hasPausedPrompts = Boolean(
        this.pausedQueue &&
        (this.pausedQueue.steering.length > 0 || this.pausedQueue.followUp.length > 0),
      );
      if (this.isRunning || hasPausedPrompts) {
        this.touch();
        return;
      }
      void this.shutdown();
    }, SESSION_IDLE_TIMEOUT_MS);
    this.idleTimer.unref?.();
  }

  private async promptNow(
    message: string,
    images?: PiImageContent[],
    selection?: PiModelSelection,
  ): Promise<void> {
    if (this.isRunning) throw new PiServerError("pi_session_busy", 409);

    const requestedProvider = selection?.provider ?? this.session.model?.provider;
    if (requestedProvider) await this.refreshChangedModelProvider(requestedProvider);

    if (selection) {
      const model = this.session.modelRuntime
        .getAvailableSnapshot()
        .find(
          (candidate) =>
            candidate.provider === selection.provider && candidate.id === selection.modelId,
        );
      if (!model) throw new PiServerError("pi_model_not_available", 400);
      if (images?.length && !model.input.includes("image")) throw imageUnsupported();
      if (this.session.model?.provider !== model.provider || this.session.model?.id !== model.id) {
        const previousModel = this.session.model;
        const hadConversation =
          this.session.sessionManager.buildSessionContext().messages.length > 0;
        await this.session.setModel(model);
        if (hadConversation) {
          this.publish({
            type: PI_MODEL_CHANGED_EVENT,
            provider: model.provider,
            model: model.id,
            ...(previousModel
              ? {
                  previousProvider: previousModel.provider,
                  previousModel: previousModel.id,
                }
              : {}),
          });
        }
      }
      if (selection.thinkingLevel) {
        this.session.setThinkingLevel(selection.thinkingLevel);
      }
    } else if (this.session.model) {
      const refreshedModel = this.session.modelRuntime
        .getAvailableSnapshot()
        .find(
          (candidate) =>
            candidate.provider === this.session.model?.provider &&
            candidate.id === this.session.model.id,
        );
      if (!refreshedModel) throw new PiServerError("pi_model_not_available", 400);
      if (refreshedModel !== this.session.model) await this.session.setModel(refreshedModel);
    }

    if (images?.length && !this.session.model?.input.includes("image")) {
      throw imageUnsupported();
    }

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
    this.onRunningChanged();

    void run
      .then(() => this.publish({ type: "command_done" }))
      .catch((error: unknown) => {
        this.publish({ type: "command_error", code: "pi_prompt_failed" });
        try {
          getStreamHub().publishHost({
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
        this.onRunningChanged();
      });

    const accepted = await Promise.race([
      preflight,
      run.then(
        () => true,
        () => false,
      ),
    ]);
    if (!accepted) throw new PiServerError("pi_prompt_rejected", 400);
  }

  prompt(message: string, images?: PiImageContent[], selection?: PiModelSelection): Promise<void> {
    return this.runQueueMutation(() => this.promptNow(message, images, selection));
  }

  submit(
    mode: PiQueueMode,
    prompt: PiQueuedPrompt,
    provenance?: PromptSubmissionProvenance,
  ): Promise<PromptSubmissionResult> {
    return this.runQueueMutation(async () => {
      let admission: PromptSubmissionResult = { queued: false };
      if (this.isRunning) {
        admission = {
          queued: true,
          queueItemId: await this.queueNow(mode, prompt, provenance?.rpcId),
        };
      } else await this.promptNow(prompt.message, prompt.images);

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
            getStreamHub().publishHost({
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
      return admission;
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
      if (
        !model.input.includes("image") &&
        (this.activePromptHasImages ||
          messagesHaveImages(this.session.sessionManager.buildSessionContext().messages) ||
          promptsHaveImages(this.queueProjection.prompts()))
      ) {
        throw imageUnsupported();
      }
      if (this.session.model?.provider !== model.provider || this.session.model?.id !== model.id) {
        const previousModel = this.session.model;
        const hadConversation =
          this.session.sessionManager.buildSessionContext().messages.length > 0;
        await this.session.setModel(model);
        if (hadConversation) {
          this.publish({
            type: PI_MODEL_CHANGED_EVENT,
            provider: model.provider,
            model: model.id,
            ...(previousModel
              ? {
                  previousProvider: previousModel.provider,
                  previousModel: previousModel.id,
                }
              : {}),
          });
        }
      }
      if (selection.reasoningEffort) {
        this.session.setThinkingLevel(selection.reasoningEffort as PiThinkingLevel);
      }
      this.touch();
    });
  }

  async cancel(): Promise<void> {
    if (this.isRunning) {
      this.session.sessionManager.appendCustomEntry(PI_CANCEL_INTENT_CUSTOM_TYPE, {
        requestedAt: Date.now(),
        source: "workbench",
      });
    }
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
    if (!this.isRunning) throw new PiServerError("pi_session_not_running", 409);
    if (prompt.images?.length && !this.session.model?.input.includes("image")) {
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
        await this.session.steer(prompt.message, prompt.images);
      } else {
        await this.session.followUp(prompt.message, prompt.images);
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
    if (!this.isRunning && (firstSteering || firstFollowUp)) {
      const first = firstSteering ?? firstFollowUp!;
      await this.promptNow(first.message, first.images);
      if (firstSteering) queue.steering.shift();
      else queue.followUp.shift();
    }
    for (const prompt of queue.steering) {
      await this.session.steer(prompt.message, prompt.images);
    }
    for (const prompt of queue.followUp) {
      await this.session.followUp(prompt.message, prompt.images);
    }
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
          await this.session.steer(prompt.message, prompt.images);
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
      if (this.isRunning) await this.session.steer(prompt.message, prompt.images);
      else await this.promptNow(prompt.message, prompt.images);
      for (const queued of remaining.steering) {
        await this.session.steer(queued.message, queued.images);
      }
      if (!paused) {
        for (const queued of remaining.followUp) {
          await this.session.followUp(queued.message, queued.images);
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
          await this.session.steer(prompt.message, prompt.images);
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
    if (!item) throw new PiServerError("pi_queue_item_not_found", 404);
    if (mutation.kind === "steer" && (item.lane !== "followUp" || !this.isRunning)) {
      throw new PiServerError("pi_steer_unavailable", 409);
    }

    if (mutation.kind === "edit") this.queueProjection.edit(itemId, mutation.prompt);
    else if (mutation.kind === "steer") this.queueProjection.moveToSteering(itemId);
    else this.queueProjection.remove(itemId);

    const nextQueue = this.queueProjection.prompts();
    if (this.pausedQueue) this.pausedQueue = copyQueueSnapshot(nextQueue);
    this.suppressQueueUpdates += 1;
    try {
      this.session.clearQueue();
      for (const prompt of nextQueue.steering) {
        await this.session.steer(prompt.message, prompt.images);
      }
      if (!this.pausedQueue) {
        for (const prompt of nextQueue.followUp) {
          await this.session.followUp(prompt.message, prompt.images);
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
    if (this.sequence <= previousSequence) {
      throw new PiServerError("pi_session_event_journal_unavailable", 500);
    }
    this.touch();
    return this.sequence;
  }

  summary(): PiSessionSummary {
    const manager = this.session.sessionManager;
    const context = manager.buildSessionContext();
    const header = manager.getHeader();
    const file = manager.getSessionFile();
    const timestamp = header?.timestamp ?? new Date().toISOString();

    return {
      id: this.id,
      cwd: manager.getCwd(),
      workspace: workspaceFromCwd(manager.getCwd()),
      name: manager.getSessionName(),
      created: timestamp,
      modified: sessionModifiedAt(manager).toISOString(),
      messageCount: context.messages.length,
      firstMessage: firstUserText(context.messages),
      transient: !file || !existsSync(file),
      running: this.isRunning,
    };
  }

  async shutdown(): Promise<void> {
    if (!this.alive) return;
    this.alive = false;
    getInteractiveResponseRegistry().clearSession(this.id);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    try {
      if (this.isRunning) await this.session.abort();
    } catch {
      // Disposal below remains authoritative.
    }
    this.unsubscribeAgent();
    this.listeners.clear();
    this.session.dispose();
    this.onDestroyed();
  }
}

interface RegistryState {
  sessions: Map<string, HostedPiSession>;
  startLocks: Map<string, Promise<HostedPiSession>>;
  persistedSessions: Map<string, SessionInfo>;
  runningListeners: Set<RunningListener>;
  lastRunningKey: string;
  forkTail: Promise<void>;
}

const serverGlobal = globalThis as typeof globalThis & {
  __workbenchPiRegistry?: RegistryState;
};

function state(): RegistryState {
  if (!serverGlobal.__workbenchPiRegistry) {
    serverGlobal.__workbenchPiRegistry = {
      sessions: new Map(),
      startLocks: new Map(),
      persistedSessions: new Map(),
      runningListeners: new Set(),
      lastRunningKey: "",
      forkTail: Promise.resolve(),
    };
  }
  const registry = serverGlobal.__workbenchPiRegistry;
  // Preserve compatibility with a registry retained across a development HMR update.
  registry.persistedSessions ??= new Map();
  registry.forkTail ??= Promise.resolve();
  return registry;
}

function runningSessionIds(): string[] {
  return [...state().sessions.values()]
    .filter((host) => host.isAlive && host.isRunning)
    .map((host) => host.id)
    .sort();
}

function publishRunningSessions(): void {
  const registry = state();
  const ids = runningSessionIds();
  const key = ids.join("\u0000");
  if (key === registry.lastRunningKey) return;
  const previous = new Set(registry.lastRunningKey ? registry.lastRunningKey.split("\u0000") : []);
  const next = new Set(ids);
  registry.lastRunningKey = key;
  for (const sessionId of new Set([...previous, ...next])) {
    if (previous.has(sessionId) === next.has(sessionId)) continue;
    try {
      getStreamHub().publishHost({
        type: "host/session-status",
        sessionId,
        running: next.has(sessionId),
      });
    } catch {
      // Running state remains authoritative through session.list.
    }
  }
  for (const listener of registry.runningListeners) listener(ids);
}

async function createHost(sessionManager: SessionManager): Promise<HostedPiSession> {
  const cwd = sessionManager.getCwd();
  const trustProject = process.env.PI_WORKBENCH_TRUST_PROJECT === "1";
  const services = await createAgentSessionServices({
    cwd,
    resourceLoaderReloadOptions: {
      resolveProjectTrust: async () => trustProject,
    },
  });
  const { session } = await createAgentSessionFromServices({ services, sessionManager });
  const interactiveResponses = getInteractiveResponseRegistry();
  await session.bindExtensions({
    mode: "rpc",
    uiContext: interactiveResponses.createExtensionUIContext(session.sessionId),
  });

  let host: HostedPiSession;
  host = new HostedPiSession(session, publishRunningSessions, () => {
    const registry = state();
    if (registry.sessions.get(host.id) === host) registry.sessions.delete(host.id);
    interactiveResponses.clearSession(host.id);
    publishRunningSessions();
  });
  state().sessions.set(host.id, host);
  try {
    getStreamHub().publishMux({
      type: "session/subscribed",
      sessionId: host.id,
      lastSeq: host.currentSequence,
    });
    host.publishQueueSnapshot();
  } catch {
    // The session can still be reached through unary history after reconnect.
  }
  publishRunningSessions();
  return host;
}

async function modelServices(cwd: string): Promise<AgentSessionServices> {
  const workspace = validateWorkspace(cwd);
  return createAgentSessionServices({
    cwd: workspace.cwd,
    resourceLoaderReloadOptions: {
      resolveProjectTrust: async () => process.env.PI_WORKBENCH_TRUST_PROJECT === "1",
    },
  });
}

async function persistedSession(id: string): Promise<SessionInfo | undefined> {
  const cached = state().persistedSessions.get(id);
  if (cached && existsSync(cached.path)) return cached;

  const sessions = await SessionManager.listAll();
  const persistedSessions = state().persistedSessions;
  persistedSessions.clear();
  for (const session of sessions) persistedSessions.set(session.id, session);
  return sessions.find((session) => session.id === id);
}

interface CanonicalJournalEntry {
  entry: SessionEntry;
  event: SessionEvent;
  branchIndex: number;
}

function storedCanonicalEvent(entry: SessionTimestampEntry): SessionEvent | undefined {
  if (entry.type !== "custom" || entry.customType !== SESSION_EVENT_CUSTOM_TYPE) {
    return undefined;
  }
  if (!isRecord(entry.data) || entry.data.version !== 1 || !isRecord(entry.data.event)) {
    return undefined;
  }
  const event = entry.data.event;
  if (
    typeof event.type !== "string" ||
    !event.type ||
    !Number.isInteger(event.seq) ||
    (event.seq as number) < 0 ||
    typeof event.time !== "number" ||
    !Number.isFinite(event.time) ||
    !Object.hasOwn(event, "data")
  ) {
    return undefined;
  }
  return event as unknown as SessionEvent;
}

/** Mirror journal recovery semantics while retaining the Pi entry that owns each event. */
function canonicalJournalEntries(branch: readonly SessionEntry[]): CanonicalJournalEntry[] {
  const result: CanonicalJournalEntry[] = [];
  for (let branchIndex = 0; branchIndex < branch.length; branchIndex += 1) {
    const entry = branch[branchIndex]!;
    const event = storedCanonicalEvent(entry);
    if (!event || event.seq !== result.length) continue;
    result.push({ entry, event, branchIndex });
  }
  return result;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

/**
 * `AgentSession` emits `message_end` before it persists the message. A fork cut is only safe when
 * the journal event is immediately followed by the exact context entry produced for that event.
 */
function hasPersistedMessageForEvent(
  event: SessionEvent,
  journalBranchIndex: number,
  branch: readonly SessionEntry[],
): boolean {
  if (!isRecord(event.data) || !isRecord(event.data.message)) return false;
  const message = event.data.message;
  const next = branch[journalBranchIndex + 1];
  if (!next || typeof message.role !== "string") return false;

  if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
    return next.type === "message" && jsonEqual(next.message, message);
  }
  if (message.role !== "custom" || next.type !== "custom_message") return false;
  return (
    next.customType === message.customType &&
    jsonEqual(next.content, message.content) &&
    next.display === message.display &&
    jsonEqual(next.details, message.details)
  );
}

function forkUnavailable(): PiServerError {
  return new PiServerError("pi_fork_unavailable", 409);
}

function forkLeafForSequence(manager: SessionManager, atSeq?: number): SessionEntry {
  const branch = manager.getBranch();
  const journal = canonicalJournalEntries(branch);
  const lastSeq = journal.at(-1)?.event.seq ?? -1;
  const anchor = atSeq !== undefined && atSeq <= lastSeq ? journal[atSeq] : undefined;
  // Legacy migration records one synthetic `message` event per context message but does not retain
  // the original Pi entry id. A later turn boundary cannot make that historical anchor unambiguous.
  if (anchor?.event.type === "message") throw forkUnavailable();
  const boundary =
    atSeq === undefined
      ? journal.findLast(({ event }) => event.type === "turn_end")
      : (journal.find(({ event }) => event.type === "turn_end" && event.seq >= atSeq) ??
        (atSeq > lastSeq ? journal.findLast(({ event }) => event.type === "turn_end") : undefined));
  if (!boundary) throw forkUnavailable();

  let turnOpen = false;
  for (const candidate of journal) {
    if (candidate.event.seq > boundary.event.seq) break;
    if (candidate.event.type === "turn_start") {
      if (turnOpen) throw forkUnavailable();
      turnOpen = true;
    } else if (candidate.event.type === "message_end") {
      if (!hasPersistedMessageForEvent(candidate.event, candidate.branchIndex, branch)) {
        throw forkUnavailable();
      }
    } else if (candidate.event.type === "turn_end") {
      if (!turnOpen) throw forkUnavailable();
      turnOpen = false;
    }
  }
  if (turnOpen) throw forkUnavailable();
  return boundary.entry;
}

/**
 * Build a child from a detached manager. Pi's runtime-level fork replaces the live source session;
 * opening a second manager and branching that copy preserves the source host and its listeners.
 */
export function createDetachedSessionFork(sourcePath: string, atSeq?: number): SessionManager {
  const sourceBefore = statSync(sourcePath);
  const detached = SessionManager.open(sourcePath);
  const leaf = forkLeafForSequence(detached, atSeq);
  const sourceId = detached.getSessionId();
  const childPath = detached.createBranchedSession(leaf.id);
  if (!childPath || detached.getSessionId() === sourceId) throw forkUnavailable();
  try {
    const sourceAfter = statSync(sourcePath);
    if (sourceAfter.size !== sourceBefore.size || sourceAfter.mtimeMs !== sourceBefore.mtimeMs) {
      removeFailedForkFile(sourcePath, detached);
      throw forkUnavailable();
    }
  } catch (error) {
    removeFailedForkFile(sourcePath, detached);
    if (error instanceof PiServerError) throw error;
    throw forkUnavailable();
  }
  return detached;
}

class RequestedSessionCwdConflict extends PiServerError {
  readonly requestedCwd: string;
  readonly existingCwd: string;

  constructor(sessionId: string, requestedCwd: string, existingCwd: string) {
    super("pi_session_conflict", 409);
    this.name = "RequestedSessionCwdConflict";
    this.message = `Session ${sessionId} already belongs to ${existingCwd}; requested ${requestedCwd}.`;
    this.requestedCwd = requestedCwd;
    this.existingCwd = existingCwd;
  }
}

function requireRequestedCwd(sessionId: string, requestedCwd: string, existingCwd: string): void {
  const canonicalExistingCwd = workspaceFromCwd(existingCwd).cwd;
  if (canonicalExistingCwd !== requestedCwd) {
    throw new RequestedSessionCwdConflict(sessionId, requestedCwd, canonicalExistingCwd);
  }
}

function announceSessionAdded(host: HostedPiSession): void {
  const summary = host.summary();
  try {
    getStreamHub().publishHost({
      type: "host/session-added",
      sessionId: host.id,
      blank: summary.messageCount === 0,
      cwd: summary.cwd,
    });
  } catch {
    // session.list remains the authoritative recovery path.
  }
}

export async function getOrStartSession(id: string): Promise<HostedPiSession> {
  const registry = state();
  const existing = registry.sessions.get(id);
  if (existing?.isAlive) return existing;

  const starting = registry.startLocks.get(id);
  if (starting) return starting;

  const start = (async () => {
    const info = await persistedSession(id);
    if (!info) throw new PiServerError("pi_session_not_found", 404);
    return createHost(SessionManager.open(info.path));
  })().finally(() => registry.startLocks.delete(id));
  registry.startLocks.set(id, start);
  return start;
}

export async function createSession(cwd: string, sessionId?: string): Promise<HostedPiSession> {
  const workspace = validateWorkspace(cwd);
  const registry = state();
  if (sessionId !== undefined) {
    const existing = registry.sessions.get(sessionId);
    if (existing?.isAlive) {
      requireRequestedCwd(sessionId, workspace.cwd, existing.session.sessionManager.getCwd());
      return existing;
    }

    const starting = registry.startLocks.get(sessionId);
    if (starting) {
      const host = await starting;
      requireRequestedCwd(sessionId, workspace.cwd, host.session.sessionManager.getCwd());
      return host;
    }

    const start = (async () => {
      const persisted = await persistedSession(sessionId);
      if (persisted !== undefined) {
        requireRequestedCwd(sessionId, workspace.cwd, persisted.cwd);
        return createHost(SessionManager.open(persisted.path));
      }
      const host = await createHost(
        SessionManager.create(workspace.cwd, undefined, { id: sessionId }),
      );
      announceSessionAdded(host);
      return host;
    })().finally(() => registry.startLocks.delete(sessionId));
    registry.startLocks.set(sessionId, start);
    return start;
  }

  const key = `new:${randomUUID()}`;
  const start = createHost(SessionManager.create(workspace.cwd))
    .then((host) => {
      announceSessionAdded(host);
      return host;
    })
    .finally(() => registry.startLocks.delete(key));
  registry.startLocks.set(key, start);
  return start;
}

function removeFailedForkFile(sourcePath: string, child: SessionManager): void {
  const childPath = child.getSessionFile();
  if (!childPath || childPath === sourcePath || !existsSync(childPath)) return;
  try {
    unlinkSync(childPath);
  } catch {
    // A failed child remains discoverable and reconcilable if cleanup races another filesystem actor.
  }
}

async function serializeForkCreation<Value>(operation: () => Promise<Value>): Promise<Value> {
  const registry = state();
  const previous = registry.forkTail;
  let release!: () => void;
  registry.forkTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

/** Create an independent child without replacing or rebinding the source live AgentSession. */
export async function forkSession(id: string, atSeq?: number): Promise<HostedPiSession> {
  const registry = state();
  let live = registry.sessions.get(id);
  if (!live?.isAlive) {
    const starting = registry.startLocks.get(id);
    if (starting) live = await starting;
  }
  if (live?.isAlive && live.isRunning) throw forkUnavailable();

  let sourcePath = live?.session.sessionManager.getSessionFile() ?? undefined;
  if (!sourcePath || !existsSync(/* turbopackIgnore: true */ sourcePath)) {
    const info = await persistedSession(id);
    if (!info && !live?.isAlive) throw new PiServerError("pi_session_not_found", 404);
    sourcePath = info?.path;
  }
  if (!sourcePath || !existsSync(/* turbopackIgnore: true */ sourcePath)) {
    throw forkUnavailable();
  }
  const resolvedSourcePath = sourcePath;

  return serializeForkCreation(async () => {
    if (
      !existsSync(/* turbopackIgnore: true */ resolvedSourcePath) ||
      registry.sessions.get(id)?.isRunning
    ) {
      throw forkUnavailable();
    }
    const occupiedIds = new Set((await SessionManager.listAll()).map((session) => session.id));
    if (
      !existsSync(/* turbopackIgnore: true */ resolvedSourcePath) ||
      registry.sessions.get(id)?.isRunning
    ) {
      throw forkUnavailable();
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let child: SessionManager;
      try {
        child = createDetachedSessionFork(resolvedSourcePath, atSeq);
      } catch (error) {
        if (error instanceof PiServerError) throw error;
        throw forkUnavailable();
      }

      const childId = child.getSessionId();
      if (
        occupiedIds.has(childId) ||
        registry.sessions.has(childId) ||
        registry.startLocks.has(childId)
      ) {
        removeFailedForkFile(resolvedSourcePath, child);
        continue;
      }

      const start = createHost(child)
        .then((host) => {
          announceSessionAdded(host);
          return host;
        })
        .catch((error) => {
          removeFailedForkFile(resolvedSourcePath, child);
          throw error;
        })
        .finally(() => registry.startLocks.delete(childId));
      registry.startLocks.set(childId, start);
      return start;
    }
    throw forkUnavailable();
  });
}

function persistedSummary(info: SessionInfo, running: boolean): PiSessionSummary {
  let modified = info.modified;
  try {
    modified = sessionModifiedAt(SessionManager.open(info.path));
  } catch {
    // A concurrently removed or malformed log can still use listAll's best-effort metadata.
  }
  return {
    id: info.id,
    cwd: info.cwd,
    workspace: workspaceFromCwd(info.cwd),
    name: info.name,
    created: info.created.toISOString(),
    modified: modified.toISOString(),
    messageCount: info.messageCount,
    firstMessage: info.firstMessage,
    transient: false,
    running,
  };
}

export async function listSessions(): Promise<{
  sessions: PiSessionSummary[];
  runningSessionIds: string[];
}> {
  const persisted = await SessionManager.listAll();
  const persistedSessions = state().persistedSessions;
  persistedSessions.clear();
  for (const session of persisted) persistedSessions.set(session.id, session);
  const runningIds = runningSessionIds();
  const running = new Set(runningIds);
  const summaries = new Map(
    persisted.map((session) => [session.id, persistedSummary(session, running.has(session.id))]),
  );
  for (const host of state().sessions.values()) {
    if (host.isAlive) summaries.set(host.id, host.summary());
  }
  return {
    sessions: [...summaries.values()].sort((left, right) =>
      right.modified.localeCompare(left.modified),
    ),
    runningSessionIds: runningIds,
  };
}

export async function listModels(cwd: string): Promise<PiModelListResponse> {
  const services = await modelServices(cwd);
  const available = services.modelRuntime.getAvailableSnapshot();
  const configuredProvider = services.settingsManager.getDefaultProvider();
  const configuredModelId = services.settingsManager.getDefaultModel();
  const configuredModel = available.find(
    (model) => model.provider === configuredProvider && model.id === configuredModelId,
  );
  const defaultModel = configuredModel ?? available[0];

  return {
    models: available.map((model) => ({
      provider: model.provider,
      providerName: services.modelRuntime.getProvider(model.provider)?.name ?? model.provider,
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      contextWindow: model.contextWindow,
    })),
    defaultModel: defaultModel
      ? { provider: defaultModel.provider, modelId: defaultModel.id }
      : null,
  };
}

function historyFromManager(manager: SessionManager): PiSessionHistory {
  const context = manager.buildSessionContext();
  const entryIds: string[] = [];
  const entryCompletedAts: Array<number | null> = [];
  const toolTimings: PiToolCallTiming[] = [];
  for (const entry of manager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== TOOL_TIMING_CUSTOM_TYPE) continue;
    if (!entry.data || typeof entry.data !== "object") continue;
    const timing = entry.data as Partial<PiToolCallTiming>;
    if (
      typeof timing.toolCallId !== "string" ||
      typeof timing.startedAt !== "number" ||
      !Number.isFinite(timing.startedAt) ||
      typeof timing.completedAt !== "number" ||
      !Number.isFinite(timing.completedAt) ||
      timing.completedAt < timing.startedAt
    ) {
      continue;
    }
    toolTimings.push({
      toolCallId: timing.toolCallId,
      startedAt: timing.startedAt,
      completedAt: timing.completedAt,
    });
  }
  for (const entry of manager.buildContextEntries()) {
    const messageCount = sessionEntryToContextMessages(entry).length;
    const completedAt = Date.parse(entry.timestamp);
    for (let index = 0; index < messageCount; index += 1) {
      entryIds.push(entry.id);
      entryCompletedAts.push(Number.isFinite(completedAt) ? completedAt : null);
    }
  }
  return {
    sessionId: manager.getSessionId(),
    context: {
      // Response.json performs the required serialization. Avoiding an additional
      // stringify/parse pass here matters for multi-megabyte conversation histories.
      messages: context.messages as PiAgentMessage[],
      entryIds,
      entryCompletedAts,
      toolTimings,
      thinkingLevel: context.thinkingLevel,
      model: context.model,
    },
  };
}

function historyEventTime(message: PiAgentMessage, completedAt: number | null | undefined): number {
  if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) {
    return message.timestamp;
  }
  return typeof completedAt === "number" && Number.isFinite(completedAt) ? completedAt : 0;
}

function legacySessionEventsFromManager(manager: SessionManager): SessionEvent[] {
  const history = historyFromManager(manager);
  return history.context.messages.map((message, seq) => ({
    type: "message",
    seq,
    time: historyEventTime(message, history.context.entryCompletedAts?.[seq]),
    data: message,
  }));
}

export async function getSessionHistory(id: string): Promise<PiSessionHistory> {
  const live = state().sessions.get(id);
  if (live?.isAlive) return historyFromManager(live.session.sessionManager);
  const info = await persistedSession(id);
  if (!info) throw new PiServerError("pi_session_not_found", 404);
  return historyFromManager(SessionManager.open(info.path));
}

export async function getSessionEvents(id: string): Promise<SessionEvent[]> {
  const live = state().sessions.get(id);
  if (live?.isAlive) return [...live.canonicalEvents];
  const info = await persistedSession(id);
  if (!info) throw new PiServerError("pi_session_not_found", 404);
  const manager = SessionManager.open(info.path);
  const initialized = initializeSessionEventJournal(
    manager,
    legacySessionEventsFromManager(manager),
  );
  if (initialized.error !== undefined) throw initialized.error;
  return initialized.events;
}

export async function renameSession(id: string, name: string): Promise<number> {
  const normalized = name.trim();
  const live = state().sessions.get(id);
  if (live?.isAlive) {
    return live.rename(normalized);
  }
  const info = await persistedSession(id);
  if (!info) throw new PiServerError("pi_session_not_found", 404);
  const manager = SessionManager.open(info.path);
  const initialized = initializeSessionEventJournal(
    manager,
    legacySessionEventsFromManager(manager),
  );
  if (initialized.error !== undefined) throw initialized.error;
  manager.appendSessionInfo(normalized);
  const event = createCanonicalSessionEvent(
    { type: "session_info_changed", name: normalized || undefined },
    initialized.events.length,
    Date.now(),
  );
  appendSessionEventJournal(manager, event);
  try {
    getStreamHub().publishMux(createSessionEventPayload(id, event));
  } catch {
    // The durable event and its sequence remain recoverable through session.history.
  }
  return event.seq;
}

export async function deleteSession(id: string): Promise<void> {
  const live = state().sessions.get(id);
  const info = await persistedSession(id);
  if (!live && !info) throw new PiServerError("pi_session_not_found", 404);
  await live?.shutdown();
  // Remove durable workspace references first. If deleting the session log then
  // fails, the next authoritative session reconciliation can safely reattach it;
  // the inverse order can leave an unrecoverable ghost session in workspace state.
  await getWorkspaceStore().removeSession(id);
  if (info?.path && existsSync(info.path)) unlinkSync(info.path);
  state().persistedSessions.delete(id);
  try {
    getStreamHub().publishHost({ type: "host/session-removed", sessionId: id });
  } catch {
    // session.list remains the authoritative recovery path.
  }
}

export async function sendPrompt(
  id: string,
  message: string,
  images?: PiImageContent[],
  selection?: PiModelSelection,
): Promise<void> {
  if (!message.trim() && !images?.length) throw new PiServerError("pi_empty_prompt", 400);
  const host = await getOrStartSession(id);
  await host.prompt(message, images, selection);
}

export async function cancelSession(id: string): Promise<void> {
  const host = state().sessions.get(id);
  if (!host?.isAlive) return;
  await host.cancel();
}

export async function selectSessionModel(
  id: string,
  selection: { provider: string; model: string; reasoningEffort?: string },
): Promise<void> {
  const host = await getOrStartSession(id);
  await host.selectModel(selection);
}

export async function queuePrompt(
  id: string,
  mode: PiQueueMode,
  prompt: PiQueuedPrompt,
): Promise<void> {
  if (!prompt.message.trim() && !prompt.images?.length) {
    throw new PiServerError("pi_empty_prompt", 400);
  }
  const host = await getOrStartSession(id);
  await host.queue(mode, prompt);
}

/** Decide prompt-vs-queue against one live HostedPiSession state without a stale list snapshot. */
export async function submitPrompt(
  id: string,
  mode: PiQueueMode,
  prompt: PiQueuedPrompt,
  provenance?: PromptSubmissionProvenance,
): Promise<PromptSubmissionResult> {
  if (!prompt.message.trim() && !prompt.images?.length) {
    throw new PiServerError("pi_empty_prompt", 400);
  }
  const host = await getOrStartSession(id);
  return host.submit(mode, prompt, provenance);
}

export async function replacePromptQueue(
  id: string,
  steering: readonly PiQueuedPrompt[],
  followUp: readonly PiQueuedPrompt[],
): Promise<void> {
  const host = await getOrStartSession(id);
  await host.replaceQueue(steering, followUp);
}

export async function setPromptQueuePaused(
  id: string,
  paused: boolean,
  steering: readonly PiQueuedPrompt[],
  followUp: readonly PiQueuedPrompt[],
): Promise<void> {
  const host = await getOrStartSession(id);
  await host.setQueuePaused(paused, steering, followUp);
}

export async function steerQueuedPrompt(
  id: string,
  prompt: PiQueuedPrompt,
  steering: readonly PiQueuedPrompt[],
  followUp: readonly PiQueuedPrompt[],
): Promise<void> {
  if (!prompt.message.trim() && !prompt.images?.length) {
    throw new PiServerError("pi_empty_prompt", 400);
  }
  const host = await getOrStartSession(id);
  await host.steerQueued(prompt, steering, followUp);
}

export async function updatePromptQueueItem(
  id: string,
  itemId: string,
  mutation: PromptQueueMutation,
): Promise<void> {
  const host = await getOrStartSession(id);
  await host.updateQueueItem(itemId, mutation);
}

export function getRunningSessionIds(): string[] {
  return runningSessionIds();
}

export function getAttachedSessionCount(): number {
  return [...state().sessions.values()].filter((host) => host.isAlive).length;
}

export function subscribeRunningSessions(listener: RunningListener): () => void {
  state().runningListeners.add(listener);
  return () => state().runningListeners.delete(listener);
}

export type HostedSession = HostedPiSession;
