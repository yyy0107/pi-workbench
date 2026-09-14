import {
  createQuestionAnswerOperation,
  recreateRemoteOperationForExplicitRetry,
  createRemoteConversationState,
  createStopOperation,
  type MobileRemoteConversationSnapshot,
  type MobileRemoteOperation,
} from "@workbench/remote-control-client";
import type {
  RemoteConversationPageV1,
  RemoteCursor,
  RemoteEventV1,
  RemoteOperationRequestV1,
  RemoteOperationResultV1,
  RemoteOrdinaryQuestionV1,
  RemoteRunStateV1,
} from "@workbench/remote-control-contracts/protocol";

import type { createMobileConversationStore } from "./conversation-store.ts";
import type { createMobileSessionStore } from "./session-store.ts";

type MobileConversationStore = ReturnType<typeof createMobileConversationStore>;
type MobileSessionStore = ReturnType<typeof createMobileSessionStore>;

export interface MobileRemoteSessionPort {
  readHistory(input: {
    readonly machineId: string;
    readonly sessionId: string;
    readonly historyCursor?: string;
  }): Promise<RemoteConversationPageV1>;
  submit(input: {
    readonly machineId: string;
    readonly request: RemoteOperationRequestV1;
  }): Promise<RemoteOperationResultV1 | void>;
  recoverOperations?(input: {
    readonly machineId: string;
    readonly operationIds: readonly string[];
  }): Promise<readonly RemoteOperationResultV1[]>;
  subscribe?(
    machineId: string,
    listener: (payload: RemoteEventV1 | RemoteOperationResultV1) => void,
  ): () => void;
}

export interface MobileRemoteSessionSnapshot extends MobileRemoteConversationSnapshot {
  readonly stale: boolean;
  readonly runState: RemoteRunStateV1;
  readonly errorCode?: string;
}

function failureCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[a-z_]+$/u.test(code)) return code;
  }
  return error instanceof Error && /^[a-z_]+$/u.test(error.message)
    ? error.message
    : "network_error";
}

export function createMobileRemoteSession(options: {
  readonly machineId: string;
  readonly sessionId: string;
  readonly initialRunState?: RemoteRunStateV1;
  readonly store: MobileConversationStore;
  readonly sessionStore?: MobileSessionStore;
  readonly remote?: MobileRemoteSessionPort;
  readonly clock: { now(): Date };
  readonly createOperationId: () => string;
}) {
  const conversation = createRemoteConversationState({
    machineId: options.machineId,
    sessionId: options.sessionId,
  });
  const listeners = new Set<() => void>();
  const persistedOperationIds = new Set<string>();
  let stale = true;
  let runState: RemoteRunStateV1 = options.initialRunState ?? "idle";
  let errorCode: string | undefined;
  let readMarker: string | undefined;

  const snapshot = (): MobileRemoteSessionSnapshot =>
    Object.freeze({
      ...conversation.snapshot(),
      stale,
      runState,
      ...(errorCode === undefined ? {} : { errorCode }),
    });

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const persistLocalState = async () => {
    if (!options.sessionStore) return;
    const current = conversation.snapshot();
    await options.sessionStore.saveLocalState({
      machineId: options.machineId,
      sessionId: options.sessionId,
      draft: current.draft,
      ...(readMarker === undefined ? {} : { readMarker }),
      unread: false,
      runState,
    });
  };

  const persistOperations = async () => {
    const current = conversation.snapshot().operations;
    const currentIds = new Set(current.map((operation) => operation.operationId));
    await Promise.all([
      ...current.map((operation) =>
        options.store.saveOperation({
          machineId: options.machineId,
          sessionId: options.sessionId,
          request: operation.request,
          status: operation.status,
          ...(operation.result === undefined ? {} : { result: operation.result }),
        }),
      ),
      ...[...persistedOperationIds]
        .filter((operationId) => !currentIds.has(operationId))
        .map((operationId) => options.store.removeOperation(options.machineId, operationId)),
    ]);
    persistedOperationIds.clear();
    for (const operationId of currentIds) persistedOperationIds.add(operationId);
  };

  const applyOperationResult = async (value: RemoteOperationResultV1): Promise<void> => {
    conversation.applyOperationResult(value);
    if (value.state === "accepted") {
      await options.store.saveDraft(
        options.machineId,
        options.sessionId,
        conversation.snapshot().draft,
      );
    } else if (value.code) {
      errorCode = value.code;
    }
    await persistOperations();
    notify();
  };

  const applyRunState = async (value: RemoteRunStateV1): Promise<void> => {
    runState = value;
    await persistLocalState();
    notify();
  };

  const applyEvent = async (event: RemoteEventV1): Promise<void> => {
    const payload = event.payload;
    if (payload.type === "operation.result") {
      await applyOperationResult(payload);
    } else if (payload.type === "session.runChanged" && payload.sessionId === options.sessionId) {
      await applyRunState(payload.runState);
    } else if (
      payload.type === "session.upserted" &&
      payload.session.sessionId === options.sessionId
    ) {
      await applyRunState(payload.session.runState);
    } else if (payload.type === "session.messageDelta" && payload.sessionId === options.sessionId) {
      conversation.applyMessageDelta(payload);
    } else {
      const item =
        payload.type === "session.messageAppended" && payload.sessionId === options.sessionId
          ? payload.item
          : payload.type === "interaction.upserted" &&
              payload.interaction.sessionId === options.sessionId
            ? payload.interaction
            : undefined;
      if (item) {
        const page: RemoteConversationPageV1 = {
          sessionId: options.sessionId,
          items: [item],
          historyCursor: event.eventId,
          sessionRevision: conversation.snapshot().sessionRevision ?? event.eventId,
          projectionCursor: event.cursor,
        };
        conversation.applyHistoryPage(page);
        await options.store.savePage(options.machineId, page);
      }
    }
    conversation.advanceProjectionCursor(event.cursor);
    stale = false;
    await persistOperations();
    notify();
  };

  const unsubscribeRemote = options.remote?.subscribe?.(options.machineId, (payload) => {
    void (
      payload.type === "sync.event" ? applyEvent(payload) : applyOperationResult(payload)
    ).catch(() => undefined);
  });

  const submitTracked = async (operation: MobileRemoteOperation) => {
    conversation.trackOperation(operation);
    await persistOperations();
    notify();
    try {
      if (!options.remote) throw new Error("machine_offline");
      const result = await options.remote.submit({
        machineId: options.machineId,
        request: operation.request,
      });
      if (result) await applyOperationResult(result);
    } catch (error) {
      conversation.markDisconnected();
      stale = true;
      errorCode = failureCode(error);
      await persistOperations();
      notify();
      throw error;
    }
    return operation.request;
  };

  const operationTime = () => {
    const issuedAt = options.clock.now();
    return {
      operationId: options.createOperationId(),
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 2 * 60 * 1_000).toISOString(),
    };
  };

  const recoverOutcomes = async (): Promise<void> => {
    const unresolved = conversation
      .snapshot()
      .operations.filter(({ status }) => status === "outcome-unknown");
    if (unresolved.length === 0 || !options.remote?.recoverOperations) return;
    let results: readonly RemoteOperationResultV1[];
    try {
      results = await options.remote.recoverOperations({
        machineId: options.machineId,
        operationIds: unresolved.map(({ operationId }) => operationId),
      });
    } catch (error) {
      errorCode = failureCode(error);
      await persistOperations();
      notify();
      return;
    }
    const requestedIds = new Set(unresolved.map(({ operationId }) => operationId));
    for (const result of results) {
      if (!requestedIds.has(result.operationId)) continue;
      if (result.state === "rejected" && result.code === "operation_not_found") {
        errorCode = "operation_not_found";
        continue;
      }
      conversation.applyOperationResult(result);
    }
    await persistOperations();
    notify();
  };

  return {
    snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async initialize(machineReady: boolean): Promise<void> {
      const restored = await options.store.load(options.machineId, options.sessionId);
      if (restored.page) conversation.applyHistoryPage(restored.page);
      readMarker = restored.page?.sessionRevision;
      conversation.setDraft(restored.draft);
      const operations = restored.operations.map((operation): MobileRemoteOperation => ({
        operationId: operation.operationId,
        request: operation.request,
        status: operation.status,
        ...(operation.result === undefined ? {} : { result: operation.result }),
        ...(operation.status === "awaiting-projection" && operation.result?.appliedCursor
          ? { appliedCursor: operation.result.appliedCursor }
          : {}),
      }));
      conversation.restoreOperations(operations);
      for (const operation of operations) persistedOperationIds.add(operation.operationId);

      if (!machineReady || !options.remote) {
        conversation.setReady(false);
        stale = true;
        errorCode = machineReady ? "session_control_unavailable" : "machine_offline";
        await persistLocalState();
        notify();
        return;
      }
      try {
        const page = await options.remote.readHistory({
          machineId: options.machineId,
          sessionId: options.sessionId,
        });
        conversation.applyHistoryPage(page);
        readMarker = page.sessionRevision;
        conversation.setReady(true);
        stale = false;
        errorCode = undefined;
        await options.store.savePage(options.machineId, page);
        await persistLocalState();
        await recoverOutcomes();
      } catch (error) {
        conversation.setReady(false);
        stale = true;
        errorCode = failureCode(error);
      }
      notify();
    },
    async loadMore(): Promise<void> {
      const current = conversation.snapshot();
      if (!current.ready || !current.nextHistoryCursor || !options.remote) return;
      const page = await options.remote.readHistory({
        machineId: options.machineId,
        sessionId: options.sessionId,
        historyCursor: current.nextHistoryCursor,
      });
      conversation.applyHistoryPage(page);
      await options.store.savePage(options.machineId, page);
      readMarker = page.sessionRevision;
      await persistLocalState();
      notify();
    },
    async setDraft(value: string): Promise<void> {
      conversation.setDraft(value);
      await options.store.saveDraft(options.machineId, options.sessionId, value);
      await persistLocalState();
      notify();
    },
    async sendText(): Promise<RemoteOperationRequestV1 | undefined> {
      const prepared = conversation.prepareTextSend(operationTime());
      if (prepared.kind === "draft-only") return undefined;
      await persistOperations();
      notify();
      try {
        if (!options.remote) throw new Error("machine_offline");
        const result = await options.remote.submit({
          machineId: options.machineId,
          request: prepared.request,
        });
        if (result) await applyOperationResult(result);
        return prepared.request;
      } catch (error) {
        conversation.markDisconnected();
        stale = true;
        errorCode = failureCode(error);
        await persistOperations();
        notify();
        throw error;
      }
    },
    stop() {
      return submitTracked(
        createStopOperation({
          ...operationTime(),
          sessionId: options.sessionId,
        }),
      );
    },
    answerQuestion(
      interaction: RemoteOrdinaryQuestionV1,
      answers: Extract<
        RemoteOperationRequestV1["command"],
        { type: "interaction.answerQuestion" }
      >["answers"],
    ) {
      if (interaction.sessionId !== options.sessionId) throw new Error("interaction_not_pending");
      return submitTracked(
        createQuestionAnswerOperation({
          ...operationTime(),
          sessionId: options.sessionId,
          interactionId: interaction.interactionId,
          interactionRevision: interaction.revision,
          answers,
        }),
      );
    },
    async retry(operationId: string): Promise<void> {
      const operation = conversation
        .snapshot()
        .operations.find((candidate) => candidate.operationId === operationId);
      if (!operation || !conversation.snapshot().ready || !options.remote) {
        throw new Error("operation_retry_unavailable");
      }
      if (errorCode !== "operation_not_found") {
        await recoverOutcomes();
        if (errorCode !== "operation_not_found") throw new Error("operation_outcome_unknown");
      }
      const retry = recreateRemoteOperationForExplicitRetry({
        operation,
        ...operationTime(),
      });
      conversation.applyOperationResult({
        type: "operation.result",
        operationId,
        state: "rejected",
        code: "operation_not_found",
      });
      conversation.trackOperation(retry);
      errorCode = undefined;
      await persistOperations();
      notify();
      try {
        const result = await options.remote.submit({
          machineId: options.machineId,
          request: retry.request,
        });
        if (result) await applyOperationResult(result);
      } catch (error) {
        conversation.markDisconnected();
        stale = true;
        errorCode = failureCode(error);
        await persistOperations();
        notify();
        throw error;
      }
    },
    async applyHistoryPage(page: RemoteConversationPageV1): Promise<void> {
      conversation.applyHistoryPage(page);
      readMarker = page.sessionRevision;
      stale = false;
      errorCode = undefined;
      await options.store.savePage(options.machineId, page);
      await persistLocalState();
      await persistOperations();
      notify();
    },
    applyMessageDelta(delta: Parameters<typeof conversation.applyMessageDelta>[0]): void {
      conversation.applyMessageDelta(delta);
      notify();
    },
    applyRunState,
    applyOperationResult,
    async advanceProjectionCursor(cursor: RemoteCursor): Promise<void> {
      conversation.advanceProjectionCursor(cursor);
      await persistOperations();
      notify();
    },
    async markDisconnected(): Promise<void> {
      conversation.markDisconnected();
      stale = true;
      errorCode = "outcome_unknown";
      await persistOperations();
      notify();
    },
    markReady(): void {
      conversation.setReady(true);
      stale = false;
      errorCode = undefined;
      notify();
    },
    recoverOutcomes,
    dispose(): void {
      unsubscribeRemote?.();
    },
  };
}
