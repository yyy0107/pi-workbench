"use client";

import { MessageNotSentError, useAuiState, useExternalStoreRuntime } from "@assistant-ui/react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useI18n, type Translate } from "@/i18n";
import type { WorkbenchAgentComposerSendError } from "@/runtime/assistant-ui/agent-runtime-adapter";
import { useWorkbenchRuntimeAdapters } from "@/runtime/assistant-ui/adapters/use-workbench-runtime-adapters";

import type { PiSessionManager } from "../runtime/manager";
import { piRequestErrorKind } from "../runtime/request-error";
import { piComposerSendError } from "../runtime/send-error";
import { PiApiError } from "../transport/api";
import { projectPiAgentRuntimeExtras } from "./extras";

function localizedPiError(error: unknown, t: Translate): Error {
  if (!(error instanceof PiApiError))
    return error instanceof Error ? error : new Error(String(error));
  switch (piRequestErrorKind(error)) {
    case "session-busy":
      return new Error(t("workbench.chat.errors.sessionBusy"));
    case "empty-prompt":
      return new Error(t("workbench.chat.errors.emptyPrompt"));
    case "session-not-found":
      return new Error(t("workbench.chat.errors.sessionNotFound"));
    case "invalid-working-directory":
      return new Error(t("workbench.chat.errors.invalidWorkingDirectory"));
    case "invalid-workspace":
      return new Error(t("workbench.chat.errors.invalidWorkspace"));
    case "model-not-available":
      return new Error(t("workbench.chat.errors.modelNotAvailable"));
    default:
      return new Error(t("workbench.chat.errors.requestFailed"));
  }
}

export function usePiThreadRuntime(manager: PiSessionManager) {
  const { t } = useI18n();
  const localId = useAuiState((state) => state.threadListItem.id);
  const remoteId = useAuiState((state) => state.threadListItem.remoteId);
  const threadScopeId = remoteId ?? localId;
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
    () => (listener: () => void) => manager.subscribeThread(threadScopeId, listener),
    [manager, threadScopeId],
  );
  const getThreadRevision = useMemo(
    () => () => manager.getThreadRevision(threadScopeId),
    [manager, threadScopeId],
  );
  useSyncExternalStore(subscribeThread, getThreadRevision, getThreadRevision);
  const workspace = manager.getThreadStateSnapshot(threadScopeId).metadata.workspace;
  const [committedSession, setCommittedSession] = useState<typeof session>();
  const isPublishedRunning = committedSession === session && snapshot.isRunning;
  const adapters = useWorkbenchRuntimeAdapters();
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
        composerError,
        clearComposerError,
      }),
    [
      clearComposerError,
      composerError,
      session,
      snapshot.autoRetry,
      snapshot.queuePaused,
      snapshot.rejectedQueueDraft,
      snapshot.resumeCheckpoint,
      snapshot.runTiming,
      snapshot.steeringQueueIds,
      workspace,
    ],
  );

  useEffect(() => {
    // RemoteThreadResource publishes a newly bound runtime while React is rendering.
    // Publishing an already-running runtime makes assistant-ui synchronously notify
    // thread-list subscribers in that render, and React surfaces their failures as an
    // AggregateError. Publish an idle first snapshot, then expose the authoritative
    // running state after this session has completed its first commit.
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
      if (headId) session.selectBranch(headId);
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
        const localized = localizedPiError(error, t);
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
    onCancel: async () => {
      try {
        await session.cancel();
      } catch (error) {
        throw localizedPiError(error, t);
      }
    },
    onReload: async (parentId, config) => {
      try {
        await session.retry(parentId, config.runConfig);
      } catch (error) {
        // MessageRuntime.reload() currently dispatches this async adapter callback
        // through a void message action, so a rejection cannot be observed by the
        // caller and becomes an unhandled promise rejection. The Pi session has
        // already restored its authoritative history in retry()'s failure path;
        // keep the existing failed message visible and terminate the callback here.
        const localized = localizedPiError(error, t);
        const code = error instanceof PiApiError ? error.code : "unknown";
        console.warn(`[workbench-pi] message reload failed (${code}): ${localized.message}`);
      }
    },
    onRefetchThread: () => session.reload(),
    adapters,
  });
}
