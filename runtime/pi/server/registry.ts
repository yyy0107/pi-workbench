import { existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  type AgentSession,
  type AgentSessionServices,
  type AgentSessionEvent,
  createAgentSessionFromServices,
  createAgentSessionServices,
  sessionEntryToContextMessages,
  type SessionInfo,
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
} from "../contracts";
import { PiServerError } from "./errors";
import { validateWorkspace, workspaceFromCwd } from "./workspaces";

export { PiServerError } from "./errors";

const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

type SessionEventListener = (event: PiEvent) => void;
type RunningListener = (sessionIds: string[]) => void;

interface PromptQueueSnapshot {
  steering: PiQueuedPrompt[];
  followUp: PiQueuedPrompt[];
}

function copyQueuedPrompts(prompts: readonly PiQueuedPrompt[]): PiQueuedPrompt[] {
  return prompts.map((prompt) => ({
    message: prompt.message,
    ...(prompt.images?.length ? { images: prompt.images.map((image) => ({ ...image })) } : {}),
  }));
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

function eventForClient(event: AgentSessionEvent): PiEvent {
  return JSON.parse(JSON.stringify(event)) as PiEvent;
}

class HostedPiSession {
  readonly session: AgentSession;
  private readonly listeners = new Set<SessionEventListener>();
  private readonly onRunningChanged: () => void;
  private readonly onDestroyed: () => void;
  private readonly unsubscribeAgent: () => void;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private promptTask: Promise<void> | undefined;
  private sequence = 0;
  private alive = true;
  private suppressQueueUpdates = 0;
  private pausedQueue?: PromptQueueSnapshot;
  private modifiedAt = new Date();

  constructor(session: AgentSession, onRunningChanged: () => void, onDestroyed: () => void) {
    this.session = session;
    this.onRunningChanged = onRunningChanged;
    this.onDestroyed = onDestroyed;
    this.unsubscribeAgent = session.subscribe((event) => {
      this.modifiedAt = new Date();
      this.touch();
      if (event.type === "queue_update" && this.suppressQueueUpdates === 0 && this.pausedQueue) {
        this.publish({
          ...eventForClient(event),
          followUp: this.pausedQueue.followUp.map((prompt) => prompt.message),
          queuePaused: true,
        });
      } else if (event.type !== "queue_update" || this.suppressQueueUpdates === 0) {
        this.publish(eventForClient(event));
      }
      this.onRunningChanged();
    });
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

  private publish(event: PiEvent): void {
    const nextEvent = { ...event, sequence: ++this.sequence };
    for (const listener of this.listeners) listener(nextEvent);
  }

  private publishQueueUpdate(): void {
    this.publish({
      type: "queue_update",
      steering: this.steeringMessages,
      followUp: this.followUpMessages,
      queuePaused: this.queuePaused,
    });
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

  async prompt(
    message: string,
    images?: PiImageContent[],
    selection?: PiModelSelection,
  ): Promise<void> {
    if (this.isRunning) throw new PiServerError("pi_session_busy", 409);

    if (selection) {
      const model = this.session.modelRuntime
        .getAvailableSnapshot()
        .find(
          (candidate) =>
            candidate.provider === selection.provider && candidate.id === selection.modelId,
        );
      if (!model) throw new PiServerError("pi_model_not_available", 400);
      if (this.session.model?.provider !== model.provider || this.session.model?.id !== model.id) {
        await this.session.setModel(model);
      }
      if (selection.thinkingLevel) {
        this.session.setThinkingLevel(selection.thinkingLevel);
      }
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
    this.modifiedAt = new Date();
    this.touch();
    this.onRunningChanged();

    void run
      .then(() => this.publish({ type: "command_done" }))
      .catch(() => this.publish({ type: "command_error", code: "pi_prompt_failed" }))
      .finally(() => {
        if (this.promptTask === run) this.promptTask = undefined;
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

  async cancel(): Promise<void> {
    await this.session.abort();
    this.touch();
  }

  async queue(mode: PiQueueMode, prompt: PiQueuedPrompt): Promise<void> {
    if (!this.isRunning) throw new PiServerError("pi_session_not_running", 409);
    if (this.pausedQueue && mode === "followUp") {
      this.pausedQueue.followUp.push(...copyQueuedPrompts([prompt]));
      this.publishQueueUpdate();
      this.modifiedAt = new Date();
      this.touch();
      return;
    }
    if (mode === "steer") {
      await this.session.steer(prompt.message, prompt.images);
    } else {
      await this.session.followUp(prompt.message, prompt.images);
    }
    this.modifiedAt = new Date();
    this.touch();
  }

  private async restoreActiveQueue(queue: PromptQueueSnapshot): Promise<void> {
    this.session.clearQueue();
    const firstSteering = queue.steering[0];
    const firstFollowUp = queue.followUp[0];
    if (!this.isRunning && (firstSteering || firstFollowUp)) {
      const first = firstSteering ?? firstFollowUp!;
      await this.prompt(first.message, first.images);
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

  async replaceQueue(
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    const nextQueue = {
      steering: copyQueuedPrompts(steering),
      followUp: copyQueuedPrompts(followUp),
    };
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
        this.modifiedAt = new Date();
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
      this.modifiedAt = new Date();
      this.touch();
    }
  }

  async steerQueued(
    prompt: PiQueuedPrompt,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    const remaining = {
      steering: copyQueuedPrompts(steering),
      followUp: copyQueuedPrompts(followUp),
    };
    const paused = this.pausedQueue !== undefined;
    if (paused) this.pausedQueue = remaining;

    this.suppressQueueUpdates += 1;
    try {
      this.session.clearQueue();
      if (this.isRunning) await this.session.steer(prompt.message, prompt.images);
      else await this.prompt(prompt.message, prompt.images);
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
      this.modifiedAt = new Date();
      this.touch();
    }
  }

  async setQueuePaused(
    paused: boolean,
    steering: readonly PiQueuedPrompt[],
    followUp: readonly PiQueuedPrompt[],
  ): Promise<void> {
    const nextQueue = {
      steering: copyQueuedPrompts(steering),
      followUp: copyQueuedPrompts(followUp),
    };

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
        this.modifiedAt = new Date();
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
      this.modifiedAt = new Date();
      this.touch();
    }
  }

  rename(name: string): void {
    this.session.setSessionName(name);
    this.modifiedAt = new Date();
    this.touch();
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
      modified: this.modifiedAt.toISOString(),
      messageCount: context.messages.length,
      firstMessage: firstUserText(context.messages),
      transient: !file || !existsSync(file),
      running: this.isRunning,
    };
  }

  async shutdown(): Promise<void> {
    if (!this.alive) return;
    this.alive = false;
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
  runningListeners: Set<RunningListener>;
  lastRunningKey: string;
}

const serverGlobal = globalThis as typeof globalThis & {
  __workbenchPiRegistry?: RegistryState;
};

function state(): RegistryState {
  if (!serverGlobal.__workbenchPiRegistry) {
    serverGlobal.__workbenchPiRegistry = {
      sessions: new Map(),
      startLocks: new Map(),
      runningListeners: new Set(),
      lastRunningKey: "",
    };
  }
  return serverGlobal.__workbenchPiRegistry;
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
  registry.lastRunningKey = key;
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
  await session.bindExtensions({ mode: "rpc" });

  let host: HostedPiSession;
  host = new HostedPiSession(session, publishRunningSessions, () => {
    const registry = state();
    if (registry.sessions.get(host.id) === host) registry.sessions.delete(host.id);
    publishRunningSessions();
  });
  state().sessions.set(host.id, host);
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
  const sessions = await SessionManager.listAll();
  return sessions.find((session) => session.id === id);
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

export async function createSession(cwd: string): Promise<HostedPiSession> {
  const workspace = validateWorkspace(cwd);
  const key = `new:${randomUUID()}`;
  const registry = state();
  const start = createHost(SessionManager.create(workspace.cwd)).finally(() =>
    registry.startLocks.delete(key),
  );
  registry.startLocks.set(key, start);
  return start;
}

function persistedSummary(info: SessionInfo, running: boolean): PiSessionSummary {
  return {
    id: info.id,
    cwd: info.cwd,
    workspace: workspaceFromCwd(info.cwd),
    name: info.name,
    created: info.created.toISOString(),
    modified: info.modified.toISOString(),
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
  const messages: PiAgentMessage[] = [];
  const entryIds: string[] = [];
  for (const entry of manager.buildContextEntries()) {
    for (const message of sessionEntryToContextMessages(entry)) {
      messages.push(JSON.parse(JSON.stringify(message)) as PiAgentMessage);
      entryIds.push(entry.id);
    }
  }
  return {
    sessionId: manager.getSessionId(),
    context: {
      messages,
      entryIds,
      thinkingLevel: context.thinkingLevel,
      model: context.model,
    },
  };
}

export async function getSessionHistory(id: string): Promise<PiSessionHistory> {
  const live = state().sessions.get(id);
  if (live?.isAlive) return historyFromManager(live.session.sessionManager);
  const info = await persistedSession(id);
  if (!info) throw new PiServerError("pi_session_not_found", 404);
  return historyFromManager(SessionManager.open(info.path));
}

export async function renameSession(id: string, name: string): Promise<void> {
  const normalized = name.trim();
  const live = state().sessions.get(id);
  if (live?.isAlive) {
    live.rename(normalized);
    return;
  }
  const info = await persistedSession(id);
  if (!info) throw new PiServerError("pi_session_not_found", 404);
  SessionManager.open(info.path).appendSessionInfo(normalized);
}

export async function deleteSession(id: string): Promise<void> {
  const live = state().sessions.get(id);
  const info = await persistedSession(id);
  if (!live && !info) throw new PiServerError("pi_session_not_found", 404);
  await live?.shutdown();
  if (info?.path && existsSync(info.path)) unlinkSync(info.path);
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

export function getRunningSessionIds(): string[] {
  return runningSessionIds();
}

export function subscribeRunningSessions(listener: RunningListener): () => void {
  state().runningListeners.add(listener);
  return () => state().runningListeners.delete(listener);
}

export type HostedSession = HostedPiSession;
