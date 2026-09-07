import { workbenchBrowserStorage, WORKBENCH_STORAGE_PREFIX } from "@workbench/agent-runtime-client";
import type {
  AgentRuntime,
  CreateThreadOptions,
  CurrentSessionSnapshot,
  HostObservable,
  ThreadListActions,
  ThreadListItem,
  ThreadListSnapshot,
} from "@workbench/agent-runtime-core";
import { deriveSessionDisplayTitle } from "@workbench/agent-runtime-pi-shared/sessions";
import type { AutomationSessionOrigin } from "@workbench/automation-contracts";
import type {
  PromptFeedbackClaim,
  PromptFeedbackPort,
} from "@workbench/agent-runtime-client/prompt-feedback";

import type {
  PiRunTiming,
  PiSessionSummary,
  PiWorkspaceSummary,
} from "@workbench/agent-runtime-pi-protocol/messages";
import {
  archivePiWorkspaceSession,
  createPiRpcScratchSession,
  createPiRpcSession,
  describePiHost,
  deletePiRpcSession,
  deletePiWorkspace,
  forkPiRpcSession,
  insertPiSessionBefore,
  insertPiWorkspaceBefore,
  listAvailablePiPackageUpdates,
  listPiArchivedWorkspaceSessions,
  listPiRpcSessions,
  listPiWorkspaces,
  type PiRpcCallOptions,
  PiApiError,
  promotePiRpcScratchSession,
  releasePiRpcScratchSession,
  renamePiRpcSession,
  respondPiRpc,
  selectPiRpcSessionModel,
  setPiWorkspacePinned,
  setPiWorkspaceSessionPinned,
  unarchivePiWorkspaceSession,
} from "../transport/api";
import type {
  HostDescription,
  QuestionAnswerItem,
  RpcReceipt,
  SessionContextTraceEventSummary,
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
import { PiModelCatalogInvalidation } from "../models/model-catalog-invalidation";
import { createPiPackageUpdatesQuery, type PiPackageUpdatesQuery } from "./package-updates-query";
import { PiResourceCatalogRevision } from "./resource-catalog-revision";
import { createWorkbenchSettingsClient } from "@workbench/services-client/settings";
import type { WorkbenchSettingsPort } from "@workbench/agent-runtime-contracts/settings";
import { PiSessionContextPolicyClient } from "../context-policy/session-context-policy-client";
import {
  resolveSessionCreateIntent,
  type SessionCreateIntent,
} from "../sessions/session-create-intent";
import { nextForkTitle } from "./fork-title";
import { piSummaryFromSessionListItem } from "../sessions/session-rpc-projection";
import {
  PiClientSession,
  clientRunTiming,
  createClientMessageId,
  type PiClientRunTiming,
} from "./session";

const ARCHIVED_STORAGE_KEY = `${WORKBENCH_STORAGE_PREFIX}pi-archived-sessions`;
const PINNED_STORAGE_KEY = `${WORKBENCH_STORAGE_PREFIX}pi-pinned-sessions`;
const PINNED_WORKSPACES_STORAGE_KEY = "pi-workbench:pinned-workspaces";

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
      readonly expiresAt?: number;
      readonly progress?: { currentIndex: number; answers: QuestionAnswerItem[] };
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
  | { kind: "question"; answers: readonly QuestionAnswerItem[]; nextQuestionIndex?: number }
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

export interface PiSessionTitleFallbacks {
  readonly attachment: string;
  readonly image: string;
}

export interface PiSessionManagerOptions {
  readonly settings?: WorkbenchSettingsPort;
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

export class PiSessionManager implements AgentRuntime {
  readonly implementationToken = PI_CLIENT_RUNTIME_IMPLEMENTATION_TOKEN;
  readonly connections: PiConnectionController;
  readonly threads: HostObservable<ThreadListSnapshot>;
  readonly current: HostObservable<CurrentSessionSnapshot>;
  readonly threadActions: Readonly<ThreadListActions>;
  readonly modelCatalogInvalidation = new PiModelCatalogInvalidation();
  readonly resourceCatalogRevision = new PiResourceCatalogRevision();
  readonly packageUpdatesQuery: PiPackageUpdatesQuery;
  readonly workbenchSettings: WorkbenchSettingsPort;
  readonly contextPolicies: PiSessionContextPolicyClient;
  readonly rpcTransportOptions: Readonly<Pick<PiRpcCallOptions, "invalidation" | "transport">>;
  private readonly listeners = new Set<Listener>();
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
  private readonly failedRuns = new Set<string>();
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
  private runtimeCatalogLoading = true;
  private runtimeThreadListRevision = -1;
  private runtimeThreadListSnapshot: ThreadListSnapshot = Object.freeze({
    threads: Object.freeze([]),
    isLoading: true,
  });
  private runtimeThreadItems = new Map<
    string,
    { readonly signature: string; readonly item: ThreadListItem }
  >();
  private runtimeCurrentSnapshot: CurrentSessionSnapshot = Object.freeze({
    sessionId: undefined,
    isNewThread: true,
  });
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
    this.workbenchSettings =
      options.settings ?? createWorkbenchSettingsClient(this.rpcTransportOptions);
    this.contextPolicies = new PiSessionContextPolicyClient(this.rpcTransportOptions);
    this.connections = new PiConnectionController({
      webSocketFactory: transport.webSocketFactory,
      onMuxFrame: (frame, generation) => this.handleMuxFrame(frame, generation),
      onHostFrame: (payload, generation) => this.handleHostFrame(payload, generation),
      onGenerationReady: (generation) => this.handleGenerationReady(generation),
      onConnectionRecoveringChange: () => this.notify(),
    });
    this.threads = Object.freeze({
      getSnapshot: () => this.getRuntimeThreadListSnapshot(),
      subscribe: (listener: Listener) => this.subscribe(listener),
    });
    this.current = Object.freeze({
      getSnapshot: () => this.getRuntimeCurrentSnapshot(),
      subscribe: (listener: Listener) => this.subscribeActiveSession(listener),
    });
    this.threadActions = Object.freeze({
      rename: (threadId, title) => this.renameThread(threadId, title),
      archive: (threadId) => this.setThreadArchived(threadId, true),
      unarchive: (threadId) => this.setThreadArchived(threadId, false),
      delete: (threadId) => this.deleteThread(threadId),
      setPinned: (threadId, pinned) => this.setThreadPinned(threadId, pinned),
      moveWithinWorkspace: ({ workspaceId, threadId, beforeThreadId }) =>
        this.moveWorkspaceSessionBefore(workspaceId, threadId, beforeThreadId),
    } satisfies ThreadListActions);
    this.createDraft();
  }

  getSnapshot = (): number => this.revision;

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

  private getRuntimeCurrentSnapshot(): CurrentSessionSnapshot {
    const sessionId = this.activeLocalId;
    const threadId = this.activeRemoteId;
    const isNewThread = this.activeRemoteId === undefined;
    if (
      this.runtimeCurrentSnapshot.sessionId === sessionId &&
      this.runtimeCurrentSnapshot.threadId === threadId &&
      this.runtimeCurrentSnapshot.isNewThread === isNewThread
    ) {
      return this.runtimeCurrentSnapshot;
    }
    this.runtimeCurrentSnapshot = Object.freeze({
      sessionId,
      ...(threadId === undefined ? {} : { threadId }),
      isNewThread,
    });
    return this.runtimeCurrentSnapshot;
  }

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
                  ...(response.nextQuestionIndex === undefined
                    ? {}
                    : { nextQuestionIndex: response.nextQuestionIndex }),
                  answers: response.answers.map((answer) => ({
                    id: answer.id,
                    selected: [...answer.selected],
                    ...(answer.custom === undefined ? {} : { custom: answer.custom }),
                    ...(answer.skipped ? { skipped: true as const } : {}),
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

  private getRuntimeThreadListSnapshot(): ThreadListSnapshot {
    if (this.runtimeThreadListRevision === this.revision) return this.runtimeThreadListSnapshot;
    this.runtimeThreadListRevision = this.revision;

    const nextItems = new Map<
      string,
      { readonly signature: string; readonly item: ThreadListItem }
    >();
    const projected = this.getThreadListSnapshot().map(({ remoteId }) => {
      const state = this.getThreadStateSnapshot(remoteId);
      const thread = state.thread!;
      const { metadata } = state;
      const signature = this.threadStateSignature(state);
      const cached = this.runtimeThreadItems.get(remoteId);
      if (cached?.signature === signature) {
        nextItems.set(remoteId, cached);
        return cached.item;
      }
      const workspace = metadata.workspace;
      const item: ThreadListItem = Object.freeze({
        threadId: remoteId,
        ...(thread.title === undefined ? {} : { title: thread.title }),
        ...(metadata.createdAt === undefined ? {} : { createdAt: metadata.createdAt }),
        updatedAt: thread.lastMessageAt.toISOString(),
        isArchived: thread.status === "archived",
        isPinned: metadata.pinned,
        isRunning: metadata.running,
        isWaitingForInput: metadata.waitingForUserInput,
        hasUnreadCompletion: metadata.completed,
        lastRunFailed: this.failedRuns.has(remoteId),
        ...(metadata.automationOrigin === undefined
          ? {}
          : { origin: { kind: metadata.automationOrigin.origin } }),
        ...(workspace
          ? {
              workspace: {
                id: workspace.id,
                name: workspace.name,
                rootPath: workspace.cwd,
              },
            }
          : {}),
      });
      nextItems.set(remoteId, { signature, item });
      return item;
    });
    this.runtimeThreadItems = nextItems;
    const previous = this.runtimeThreadListSnapshot;
    const threads =
      previous.threads.length === projected.length &&
      previous.threads.every((thread, index) => thread === projected[index])
        ? previous.threads
        : Object.freeze(projected);
    if (previous.threads === threads && previous.isLoading === this.runtimeCatalogLoading) {
      return previous;
    }
    this.runtimeThreadListSnapshot = Object.freeze({
      threads,
      isLoading: this.runtimeCatalogLoading,
    });
    return this.runtimeThreadListSnapshot;
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
      thread ? this.failedRuns.has(thread.remoteId) : false,
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
    this.startTask ??= this.loadInitialMetadata().finally(() => {
      if (this.disposed) return;
      this.runtimeCatalogLoading = false;
      this.notify();
    });
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
    this.failedRuns.clear();
    this.pendingModelSelections.clear();
    this.runTimings.clear();
    this.running.clear();
    this.activeLocalId = undefined;
    this.activeRemoteId = undefined;
    this.runtimeCatalogLoading = false;
    this.runtimeThreadListRevision = -1;
    this.runtimeThreadItems.clear();
    this.runtimeThreadListSnapshot = Object.freeze({
      threads: Object.freeze([]),
      isLoading: false,
    });
    this.runtimeCurrentSnapshot = Object.freeze({
      sessionId: undefined,
      isNewThread: true,
    });
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
          ...(payload.expiresAt === undefined ? {} : { expiresAt: payload.expiresAt }),
          ...(payload.progress === undefined
            ? {}
            : { progress: structuredClone(payload.progress) }),
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
      if (changed) this.notify();
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
      const summaryChanged = this.applySummaryRunning(payload.summary);
      const waitingForUserInputChanged = this.applySummaryWaitingForUserInput(payload.summary);
      if (workspaceChanged || waitingForUserInputChanged || summaryChanged) {
        this.notify();
      }
      return;
    }
    if (payload.type === "host/session-changed") {
      if (payload.summary.id !== payload.sessionId) return;
      const summaryChanged = this.applySummaryRunning(payload.summary);
      const waitingForUserInputChanged = this.applySummaryWaitingForUserInput(payload.summary);
      if (waitingForUserInputChanged || summaryChanged) {
        this.notify();
      }
      return;
    }
    if (payload.type === "host/session-removed") {
      this.removeSessionMetadata(payload.sessionId);
      this.notify();
      return;
    }
    if (payload.type === "host/agent-error") {
      this.failedRuns.add(payload.sessionId);
      this.notify();
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

  session(id: string): PiClientSession | undefined {
    const remoteId =
      this.aliases.get(id) ??
      (this.summaries.has(id) || this.scratchSessions.has(id) ? id : undefined);
    const existing = (remoteId ? this.sessions.get(remoteId) : undefined) ?? this.sessions.get(id);
    if (existing) return existing;
    if (!remoteId && !this.draftWorkspaces.has(id)) return undefined;
    return this.getSession(id, remoteId);
  }

  async createThread(options: CreateThreadOptions = {}): Promise<string> {
    await this.start();
    const created = await createPiRpcSession(
      {
        ...(options.workspaceId === undefined ? {} : { workspaceId: options.workspaceId }),
        ...(options.preset === undefined ? {} : { agentPreset: options.preset }),
      },
      this.rpcTransportOptions,
    );
    await this.refreshMetadata();
    this.getSession(created.sessionId, created.sessionId);
    this.setActive(created.sessionId, created.sessionId);
    return created.sessionId;
  }

  createDraft(options: CreateThreadOptions = {}): string {
    if (this.disposed) throw new Error("PiSessionManager has been disposed");
    for (const session of this.sessions.values()) {
      if (
        !session.remoteId &&
        this.draftWorkspaces.get(session.localId)?.id === options.workspaceId
      ) {
        this.setActive(session.localId, undefined);
        return session.localId;
      }
    }
    const localId = createClientMessageId("pi-thread");
    const workspace = options.workspaceId ? this.workspaces.get(options.workspaceId) : undefined;
    if (workspace) {
      this.draftWorkspaces.set(localId, {
        id: workspace.workspaceId,
        name: workspace.title,
        cwd: workspace.path,
        pinned: this.pinnedWorkspaces.has(workspace.workspaceId),
      });
    }
    this.getSession(localId);
    this.setActive(localId, undefined);
    return localId;
  }

  switchToThread(id: string): void {
    const session = this.session(id);
    if (!session) throw new Error(`Unknown Pi Session: ${id}`);
    this.setActive(session.id, session.remoteId);
  }

  switchToNewThread(): void {
    if (this.activeLocalId && this.activeRemoteId === undefined) return;
    this.createDraft();
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
        if (!this.activeLocalId && !this.disposed) this.createDraft();
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
    }
  }

  async renameThread(threadId: string, title: string): Promise<void> {
    const sessionId = this.aliases.get(threadId) ?? threadId;
    await renamePiRpcSession({ sessionId, title }, this.rpcTransportOptions);
    const summary = this.summaries.get(sessionId);
    if (summary && this.setSummary({ ...summary, name: title })) this.notify();
  }

  async setThreadArchived(threadId: string, archived: boolean): Promise<void> {
    const sessionId = this.aliases.get(threadId) ?? threadId;
    await this.setSessionArchivedMetadata(sessionId, archived);
  }

  async deleteThread(threadId: string): Promise<void> {
    const sessionId = this.aliases.get(threadId) ?? threadId;
    await deletePiRpcSession({ sessionId }, this.rpcTransportOptions);
    this.removeSessionMetadata(sessionId);
    this.notify();
  }

  private async archiveSessionMetadata(sessionId: string): Promise<void> {
    return this.setSessionArchivedMetadata(sessionId, true);
  }

  private async setSessionArchivedMetadata(sessionId: string, archived: boolean): Promise<void> {
    if (archived) await archivePiWorkspaceSession(sessionId, this.rpcTransportOptions);
    else await unarchivePiWorkspaceSession(sessionId, this.rpcTransportOptions);
  }

  setActive(localId: string | undefined, remoteId: string | undefined): void {
    const previousLocalId = this.activeLocalId;
    this.activeLocalId = localId;
    const nextActiveRemoteId = remoteId ?? (localId ? this.aliases.get(localId) : undefined);
    const activeSessionChanged =
      previousLocalId !== localId || this.activeRemoteId !== nextActiveRemoteId;
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
    // The Headless Runtime owns draft promotion. Compatibility consumers observe the resulting
    // catalog invalidation instead of maintaining a second promotion state machine.
  }

  private readonly applyRunningSnapshot = (
    sessionIds: string[],
    authoritativeBaseline = false,
  ): void => {
    if (this.disposed) return;
    const next = new Set(sessionIds);
    const all = new Set([...this.running, ...next]);
    // Include locally-running sessions so a unary rebaseline can release a stale local lease.
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
    const session = this.sessions.get(remoteId);
    if (session && session !== source) {
      session.setRunningFromManager(running, runTiming, authoritativeBaseline);
      // Host status and mux events can cross. Keep the catalog running when the session's
      // local lease rejects an idle frame, including immediately after stop/resume.
      running ||= session.getSnapshot().isRunning;
    }
    if (session?.isStopRequested) running = false;
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

    if (wasRunning && !running && this.activeRemoteId !== remoteId) this.completed.add(remoteId);
    if (running) {
      this.completed.delete(remoteId);
      if (!wasRunning) this.failedRuns.delete(remoteId);
    }
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
    const summaryChanged = this.setSummary(summary);
    this.updateRunning(summary.id, summary.running, undefined, summary.runTiming);
    return summaryChanged || wasRunning !== this.running.has(summary.id);
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
    const activeSessionRemoved =
      this.activeRemoteId === sessionId ||
      this.activeLocalId === sessionId ||
      this.aliases.get(this.activeLocalId ?? "") === sessionId;
    this.disposeCachedSession(sessionId);
    this.deleteSummary(sessionId);
    this.running.delete(sessionId);
    this.waitingForUserInput.delete(sessionId);
    this.completed.delete(sessionId);
    this.failedRuns.delete(sessionId);
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
    if (activeSessionRemoved && !this.disposed) this.createDraft();
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
