import type { AppendMessage, RemoteThreadListAdapter, ThreadMessage } from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";

import { workbenchBrowserStorage, WORKBENCH_STORAGE_PREFIX } from "@/runtime/adapters/history";

import {
  PI_THINKING_LEVELS,
  type PiAssistantMessage,
  type PiEvent,
  type PiModelSelection,
  type PiSessionSummary,
  type PiWorkspaceSummary,
} from "../contracts";
import {
  cancelPiSession,
  createPiSession,
  deletePiSession,
  fetchPiSessionHistory,
  listPiSessions,
  PiApiError,
  promptPiSession,
  renamePiSession,
} from "./api";
import { PiConnectionController } from "./connections";
import {
  appendMessageToPiPrompt,
  eventMessage,
  optimisticUserMessage,
  piAssistantToThreadMessage,
  piHistoryToThreadMessages,
} from "./messages";

const ARCHIVED_STORAGE_KEY = `${WORKBENCH_STORAGE_PREFIX}pi-archived-sessions`;

export interface PiSessionSnapshot {
  messages: readonly ThreadMessage[];
  isRunning: boolean;
  isLoading: boolean;
}

type Listener = () => void;

function createClientMessageId(prefix: string): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function modelSelectionFromMessage(message: AppendMessage): PiModelSelection | undefined {
  const candidate = message.metadata?.custom?.piModel;
  if (!candidate || typeof candidate !== "object") return undefined;
  const selection = candidate as Record<string, unknown>;
  if (typeof selection.provider !== "string" || typeof selection.modelId !== "string") {
    return undefined;
  }
  const thinkingLevel = PI_THINKING_LEVELS.find((level) => level === selection.thinkingLevel);
  return {
    provider: selection.provider,
    modelId: selection.modelId,
    ...(thinkingLevel ? { thinkingLevel } : {}),
  };
}

export class PiClientSession {
  readonly localId: string;
  private readonly manager: PiSessionManager;
  private readonly listeners = new Set<Listener>();
  private remoteIdValue?: string;
  private baseMessages: ThreadMessage[] = [];
  private liveMessages: ThreadMessage[] = [];
  private streamingMessage?: ThreadMessage;
  private snapshotValue: PiSessionSnapshot;
  private openTask?: Promise<void>;
  private reloadTask?: Promise<void>;
  private lastSequence = 0;
  private promptRequestPending = false;
  private promptStartTimer?: ReturnType<typeof setTimeout>;

  constructor(
    manager: PiSessionManager,
    localId: string,
    remoteId: string | undefined,
    running: boolean,
  ) {
    this.manager = manager;
    this.localId = localId;
    this.remoteIdValue = remoteId;
    this.snapshotValue = { messages: [], isRunning: running, isLoading: Boolean(remoteId) };
  }

  get remoteId(): string | undefined {
    return this.remoteIdValue;
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

    this.openTask = this.reload().finally(() => {
      this.replaceSnapshot({ isLoading: false });
    });
    return this.openTask;
  }

  async reload(): Promise<void> {
    if (!this.remoteIdValue) return;
    if (this.reloadTask) return this.reloadTask;
    const remoteId = this.remoteIdValue;
    this.reloadTask = fetchPiSessionHistory(remoteId)
      .then((history) => {
        if (this.remoteIdValue !== remoteId) return;
        this.baseMessages = piHistoryToThreadMessages(history);
        this.liveMessages = [];
        this.streamingMessage = undefined;
        this.publishMessages();
      })
      .finally(() => {
        this.reloadTask = undefined;
      });
    return this.reloadTask;
  }

  async send(message: AppendMessage): Promise<void> {
    if (this.reloadTask) await this.reloadTask;
    const summary = await this.manager.ensureRemote(this);
    const remoteId = summary.id;
    await this.manager.connections.ensureSessionEvents(remoteId, this.handleEvent);

    const optimisticId = createClientMessageId("pi-user");
    this.liveMessages.push(optimisticUserMessage(message, optimisticId));
    this.publishMessages();
    this.setRunning(true);
    this.promptRequestPending = true;

    const prompt = appendMessageToPiPrompt(message);
    const model = modelSelectionFromMessage(message);
    try {
      await promptPiSession(
        remoteId,
        prompt.text,
        prompt.images.length ? prompt.images : undefined,
        model,
      );
      this.manager.notePrompt(remoteId, prompt.text);
      if (this.promptRequestPending) {
        this.promptStartTimer = setTimeout(() => {
          this.promptRequestPending = false;
          if (!this.manager.isRunning(remoteId)) this.setRunningFromManager(false);
        }, 15_000);
      }
    } catch (error) {
      this.liveMessages = this.liveMessages.filter((candidate) => candidate.id !== optimisticId);
      this.clearPromptPending();
      this.setRunning(false);
      this.publishMessages();
      this.manager.connections.scheduleSessionClose(remoteId);
      throw error;
    }
  }

  async cancel(): Promise<void> {
    if (!this.remoteIdValue) return;
    await cancelPiSession(this.remoteIdValue);
  }

  connectIfRunning(): void {
    if (!this.remoteIdValue || !this.snapshotValue.isRunning) return;
    void this.manager.connections.ensureSessionEvents(this.remoteIdValue, this.handleEvent);
  }

  setRunningFromManager(running: boolean): void {
    if (!running && this.promptRequestPending) return;
    const wasRunning = this.snapshotValue.isRunning;
    this.setRunning(running, false);
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
    if (sequence !== undefined && sequence < this.lastSequence) return;
    if (sequence !== undefined) this.lastSequence = sequence;

    if (event.type === "connected") {
      this.setRunningFromManager(event.isRunning === true);
      return;
    }
    if (event.type === "agent_start") {
      this.clearPromptPending();
      this.setRunning(true);
      return;
    }

    if (event.type === "message_start" || event.type === "message_update") {
      this.clearPromptPending();
      const message = eventMessage(event);
      if (message?.role === "assistant") {
        this.streamingMessage = piAssistantToThreadMessage(
          message as PiAssistantMessage,
          `pi-stream-${this.remoteIdValue ?? this.localId}`,
          { optimistic: true, streaming: true },
        );
        this.publishMessages();
      }
      return;
    }

    if (event.type === "message_end") {
      const message = eventMessage(event);
      if (message?.role === "assistant") {
        this.liveMessages.push(
          piAssistantToThreadMessage(
            message as PiAssistantMessage,
            createClientMessageId("pi-assistant"),
            { optimistic: true },
          ),
        );
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
      this.clearPromptPending();
      this.setRunning(false);
      if (this.remoteIdValue) this.manager.connections.scheduleSessionClose(this.remoteIdValue);
      void this.reload()
        .then(() => this.manager.refreshMetadata())
        .catch((error) => console.error("[workbench-pi] history refresh failed", error));
    }
  };

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

  private clearPromptPending(): void {
    this.promptRequestPending = false;
    if (this.promptStartTimer) clearTimeout(this.promptStartTimer);
    this.promptStartTimer = undefined;
  }

  private publishMessages(): void {
    this.replaceSnapshot({
      messages: [
        ...this.baseMessages,
        ...this.liveMessages,
        ...(this.streamingMessage ? [this.streamingMessage] : []),
      ],
    });
  }

  private replaceSnapshot(patch: Partial<PiSessionSnapshot>): void {
    this.snapshotValue = { ...this.snapshotValue, ...patch };
    for (const listener of this.listeners) listener();
  }
}

export class PiSessionManager {
  readonly connections = new PiConnectionController();
  private readonly listeners = new Set<Listener>();
  private readonly summaries = new Map<string, PiSessionSummary>();
  private readonly sessions = new Map<string, PiClientSession>();
  private readonly aliases = new Map<string, string>();
  private readonly initializeTasks = new Map<string, Promise<PiSessionSummary>>();
  private readonly draftWorkspaces = new Map<string, PiWorkspaceSummary>();
  private readonly archived = new Set<string>();
  private readonly completed = new Set<string>();
  private running = new Set<string>();
  private activeRemoteId?: string;
  private startTask?: Promise<void>;
  private revision = 0;

  getSnapshot = (): number => this.revision;

  getWorkspaces(): readonly PiWorkspaceSummary[] {
    const workspaces = new Map<string, PiWorkspaceSummary>();
    for (const summary of this.summaries.values()) {
      workspaces.set(summary.workspace.id, summary.workspace);
    }
    return [...workspaces.values()];
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): Promise<void> {
    this.startTask ??= Promise.all([this.loadArchiveState(), this.refreshMetadata()]).then(
      () => undefined,
    );
    return this.startTask.then(() => {
      this.connections.startRunningEvents(this.applyRunningSnapshot);
    });
  }

  dispose(): void {
    this.connections.dispose();
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
    const task = createPiSession(workspace.cwd)
      .then((summary) => {
        this.draftWorkspaces.delete(session.localId);
        this.bindSession(session.localId, session, summary);
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

  async refreshMetadata(): Promise<void> {
    const response = await listPiSessions();
    this.summaries.clear();
    for (const summary of response.sessions) this.summaries.set(summary.id, summary);
    this.applyRunningSnapshot(response.runningSessionIds);
    this.notify();
  }

  createThreadListAdapter(): RemoteThreadListAdapter {
    const threadCustom = (summary: PiSessionSummary) => ({
      piRunning: summary.running,
      piWorkspaceId: summary.workspace.id,
      piWorkspaceName: summary.workspace.name,
      piWorkspaceCwd: summary.workspace.cwd,
    });

    return {
      list: async () => {
        await this.start();
        return {
          threads: [...this.summaries.values()].map((summary) => ({
            status: this.archived.has(summary.id) ? ("archived" as const) : ("regular" as const),
            remoteId: summary.id,
            externalId: summary.id,
            title: summary.name || summary.firstMessage || undefined,
            lastMessageAt: new Date(summary.modified),
            custom: threadCustom(summary),
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
          custom: threadCustom(summary),
        };
      },
      initialize: (threadId) => this.initialize(threadId),
      rename: async (remoteId, newTitle) => {
        await renamePiSession(remoteId, newTitle);
        const summary = this.summaries.get(remoteId);
        if (summary) this.summaries.set(remoteId, { ...summary, name: newTitle });
        this.notify();
      },
      archive: async (remoteId) => {
        this.archived.add(remoteId);
        await this.saveArchiveState();
        this.notify();
      },
      unarchive: async (remoteId) => {
        this.archived.delete(remoteId);
        await this.saveArchiveState();
        this.notify();
      },
      delete: async (remoteId) => {
        await deletePiSession(remoteId);
        this.connections.closeSession(remoteId);
        this.summaries.delete(remoteId);
        this.running.delete(remoteId);
        this.completed.delete(remoteId);
        this.archived.delete(remoteId);
        for (const [key, value] of this.sessions) {
          if (value.remoteId === remoteId) this.sessions.delete(key);
        }
        await this.saveArchiveState();
        this.notify();
      },
      generateTitle: async (remoteId, messages) => {
        const title = this.titleFromMessages(messages);
        if (title) await renamePiSession(remoteId, title);
        const summary = this.summaries.get(remoteId);
        if (summary && title) this.summaries.set(remoteId, { ...summary, name: title });
        this.notify();
        return createAssistantStream((controller) => {
          if (title) controller.appendText(title);
        });
      },
    };
  }

  setActive(localId: string | undefined, remoteId: string | undefined): void {
    this.activeRemoteId = remoteId ?? (localId ? this.aliases.get(localId) : undefined);
    if (this.activeRemoteId && this.completed.delete(this.activeRemoteId)) this.notify();
  }

  setDraftWorkspace(localId: string, workspace: PiWorkspaceSummary | undefined): void {
    if (workspace) this.draftWorkspaces.set(localId, workspace);
    else this.draftWorkspaces.delete(localId);
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
    this.summaries.set(remoteId, {
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

  private bindSession(localId: string, session: PiClientSession, summary: PiSessionSummary): void {
    this.aliases.set(localId, summary.id);
    this.sessions.set(summary.id, session);
    this.summaries.set(summary.id, summary);
    session.bindRemote(summary);
    this.notify();
  }

  private readonly applyRunningSnapshot = (sessionIds: string[]): void => {
    const next = new Set(sessionIds);
    const all = new Set([...this.running, ...next]);
    for (const id of all) this.updateRunning(id, next.has(id));
  };

  private updateRunning(remoteId: string, running: boolean, source?: PiClientSession): void {
    const wasRunning = this.running.has(remoteId);
    if (running) this.running.add(remoteId);
    else this.running.delete(remoteId);

    const summary = this.summaries.get(remoteId);
    if (summary && summary.running !== running) {
      this.summaries.set(remoteId, { ...summary, running, modified: new Date().toISOString() });
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

  private notify(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
}
