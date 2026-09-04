"use client";

import { MessageNotSentError, useExternalStoreRuntime } from "@assistant-ui/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  WorkbenchAgentComposerSendError,
  WorkbenchAgentWorkspace,
} from "@workbench/agent-runtime-client/adapter";
import { useWorkbenchRuntimeAdapters } from "@workbench/agent-runtime-client";

import type { PiSessionManager } from "../runtime/manager";
import type { PiClientSession } from "../runtime/session";
import { piRequestErrorKind } from "../runtime/request-error";
import { piComposerSendError } from "../runtime/send-error";
import { PiApiError } from "../transport/api";
import { createBoundPiThreadListAdapter } from "./bound-thread-identity";
import { usePiAgentRuntimeCopy, type PiAgentRuntimeCopy } from "./copy";
import { projectPiAgentRuntimeExtras } from "./extras";

function localizedPiError(error: unknown, copy: PiAgentRuntimeCopy["errors"]): Error {
  if (!(error instanceof PiApiError))
    return error instanceof Error ? error : new Error(String(error));
  switch (piRequestErrorKind(error)) {
    case "session-busy":
      return new Error(copy.sessionBusy);
    case "empty-prompt":
      return new Error(copy.emptyPrompt);
    case "session-not-found":
      return new Error(copy.sessionNotFound);
    case "invalid-working-directory":
      return new Error(copy.invalidWorkingDirectory);
    case "invalid-workspace":
      return new Error(copy.invalidWorkspace);
    case "model-not-available":
      return new Error(copy.modelNotAvailable);
    default:
      return new Error(copy.requestFailed);
  }
}

/** Keep assistant-ui cancellation mapped to the authoritative Pi session command. */
export function createPiThreadCancelHandler(
  session: Pick<PiClientSession, "cancel">,
  errorCopy: PiAgentRuntimeCopy["errors"],
): () => Promise<void> {
  return async () => {
    try {
      await session.cancel();
    } catch (error) {
      throw localizedPiError(error, errorCopy);
    }
  };
}

export interface BoundPiThreadRuntimeOptions {
  /** Local assistant-ui id when a remote thread is still being promoted. */
  localId?: string;
  /** Explicit null preserves draft semantics; omission binds directly to `threadId`. */
  remoteId?: string | null;
  /** Optional workspace projection for sessions intentionally hidden from the formal thread list. */
  workspace?: WorkbenchAgentWorkspace;
}

/** Build the existing Pi external-store Runtime around one explicit session identity. */
export function useBoundPiThreadRuntime(
  manager: PiSessionManager,
  threadId: string,
  options: BoundPiThreadRuntimeOptions = {},
) {
  const { errors: errorCopy } = usePiAgentRuntimeCopy();
  const localId = options.localId ?? threadId;
  const remoteId = options.remoteId === null ? undefined : (options.remoteId ?? threadId);
  const session = useMemo(
    () => manager.getSession(localId, remoteId),
    [localId, manager, remoteId],
  );
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const subscribeThread = useMemo(
    () => (listener: () => void) => manager.subscribeThread(threadId, listener),
    [manager, threadId],
  );
  const getThreadRevision = useMemo(
    () => () => manager.getThreadRevision(threadId),
    [manager, threadId],
  );
  useSyncExternalStore(subscribeThread, getThreadRevision, getThreadRevision);
  const transportRecovering = useSyncExternalStore(
    manager.subscribe,
    manager.connections.getRecovering,
    manager.connections.getRecovering,
  );
  const workspace =
    options.workspace ?? manager.getThreadStateSnapshot(threadId).metadata.workspace;
  const [committedSession, setCommittedSession] = useState<typeof session>();
  const isPublishedRunning = committedSession === session && snapshot.isRunning;
  const adapters = useWorkbenchRuntimeAdapters();
  const threadListAdapter = useMemo(
    () => createBoundPiThreadListAdapter(localId, remoteId),
    [localId, remoteId],
  );
  const runtimeAdapters = useMemo(
    () => ({ ...adapters, threadList: threadListAdapter }),
    [adapters, threadListAdapter],
  );
  const [composerErrorState, setComposerErrorState] = useState<{
    session: typeof session;
    code: WorkbenchAgentComposerSendError;
  }>();
  const composerError =
    composerErrorState?.session === session ? composerErrorState.code : undefined;
  const clearComposerError = useCallback(() => {
    setComposerErrorState((current) => (current?.session === session ? undefined : current));
  }, [session]);
  const extras = useMemo(
    () =>
      projectPiAgentRuntimeExtras({
        session,
        snapshot,
        workspace,
        transportRecovering,
        composerError,
        clearComposerError,
      }),
    [
      clearComposerError,
      composerError,
      session,
      snapshot.autoRetry,
      snapshot.messages,
      snapshot.queuePaused,
      snapshot.rejectedQueueDraft,
      snapshot.resumeCheckpoint,
      snapshot.runTiming,
      snapshot.steeringQueueIds,
      transportRecovering,
      workspace,
    ],
  );

  useLayoutEffect(() => {
    // RemoteThreadResource publishes a newly bound runtime while React is rendering.
    // Publishing an already-running runtime makes assistant-ui synchronously notify
    // thread-list subscribers in that render, and React surfaces their failures as an
    // AggregateError. Publish an idle first snapshot, then expose the authoritative
    // running state after this session has completed its first commit but before paint,
    // so the working row does not visibly disappear and remount during thread promotion.
    setCommittedSession(session);
  }, [session]);

  useEffect(() => {
    void session
      .open()
      .then(() => globalThis.performance?.mark("workbench:active-thread-ready"))
      .catch((error) => console.error("[workbench-pi] history load failed", error));
  }, [session]);

  return useExternalStoreRuntime({
    messages: snapshot.messages,
    messageRepository: snapshot.messageRepository,
    // assistant-ui requires this callback to enable branch switching. The durable
    // mutation is handled by `unstable_onBranchChange` against Pi's session tree.
    setMessages: () => undefined,
    unstable_onBranchChange: ({ headId }) => {
      if (headId) void session.selectBranch(headId).catch(() => undefined);
    },
    isRunning: isPublishedRunning,
    isLoading: snapshot.isLoading,
    extras,
    // The queue adapter is only a dispatch path while a run is active. Keeping
    // it installed while idle makes assistant-ui route ordinary sends through
    // `enqueue`, which cannot report a rejected send back to the composer for
    // draft restoration.
    queue: isPublishedRunning ? session.queueAdapter : undefined,
    onNew: async (message) => {
      clearComposerError();
      try {
        await session.send(message);
      } catch (error) {
        const localized = localizedPiError(error, errorCopy);
        const composerError = piComposerSendError(error);
        if (composerError) {
          setComposerErrorState({ session, code: composerError });
        }
        // assistant-ui only restores the submitted text and attachments when
        // the adapter identifies the failure as a rejected send. Transport,
        // session, and provider failures are just as recoverable from the
        // composer's perspective as attachment-admission failures.
        throw new MessageNotSentError(localized.message);
      }
    },
    onCancel: createPiThreadCancelHandler(session, errorCopy),
    onReload: async (parentId, config) => {
      try {
        await session.retry(parentId, config.runConfig);
      } catch (error) {
        // MessageRuntime.reload() currently dispatches this async adapter callback
        // through a void message action, so a rejection cannot be observed by the
        // caller and becomes an unhandled promise rejection. The Pi session has
        // already restored its authoritative history in retry()'s failure path;
        // keep the existing failed message visible and terminate the callback here.
        const localized = localizedPiError(error, errorCopy);
        const code = error instanceof PiApiError ? error.code : "unknown";
        console.warn(`[workbench-pi] message reload failed (${code}): ${localized.message}`);
      }
    },
    onRefetchThread: () => session.reload(),
    adapters: runtimeAdapters,
  });
}

/** Bind the remote-thread-list current item through the explicit-session Runtime seam. */
export function usePiThreadRuntime(manager: PiSessionManager) {
  const current = useSyncExternalStore(
    manager.current.subscribe,
    manager.current.getSnapshot,
    manager.current.getSnapshot,
  );
  if (!current.sessionId) throw new Error("Pi Headless Runtime has no current Session");
  return useBoundPiThreadRuntime(manager, current.threadId ?? current.sessionId, {
    localId: current.sessionId,
    remoteId: current.threadId ?? null,
  });
}
