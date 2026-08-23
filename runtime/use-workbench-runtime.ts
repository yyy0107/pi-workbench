"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  MessageNotSentError,
  useAuiState,
  useExternalStoreRuntime,
  useRemoteThreadListRuntime,
  WebSpeechDictationAdapter,
} from "@assistant-ui/react";

import { useI18n, type Translate } from "@/i18n";

import { workbenchAttachmentAdapter } from "./adapters/attachments";
import { workbenchFeedbackAdapter } from "./adapters/feedback";
import { PiApiError } from "./pi/client/transport/api";
import { PiSessionManager } from "./pi/client/runtime/manager";
import { piComposerSendError, type PiComposerSendError } from "./pi/client/runtime/send-error";

function localizedPiError(error: unknown, t: Translate): Error {
  if (!(error instanceof PiApiError))
    return error instanceof Error ? error : new Error(String(error));
  switch (error.code) {
    case "pi_session_busy":
      return new Error(t("workbench.chat.errors.sessionBusy"));
    case "pi_empty_prompt":
      return new Error(t("workbench.chat.errors.emptyPrompt"));
    case "pi_session_not_found":
      return new Error(t("workbench.chat.errors.sessionNotFound"));
    case "pi_invalid_working_directory":
      return new Error(t("workbench.chat.errors.invalidWorkingDirectory"));
    case "pi_invalid_workspace":
    case "pi_workspace_path_required":
    case "pi_workspace_not_found":
    case "pi_workspace_not_directory":
      return new Error(t("workbench.chat.errors.invalidWorkspace"));
    case "pi_model_not_available":
      return new Error(t("workbench.chat.errors.modelNotAvailable"));
    default:
      return new Error(t("workbench.chat.errors.requestFailed"));
  }
}

function useWorkbenchPiRuntime(manager: PiSessionManager) {
  const { t } = useI18n();
  const localId = useAuiState((state) => state.threadListItem.id);
  const remoteId = useAuiState((state) => state.threadListItem.remoteId);
  const session = useMemo(
    () => manager.getSession(localId, remoteId),
    [localId, manager, remoteId],
  );
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const dictation = useMemo(() => new WebSpeechDictationAdapter(), []);
  const [composerErrorState, setComposerErrorState] = useState<{
    session: typeof session;
    code: PiComposerSendError;
  }>();
  const composerError =
    composerErrorState?.session === session ? composerErrorState.code : undefined;
  const clearComposerError = useCallback(() => {
    setComposerErrorState((current) => (current?.session === session ? undefined : current));
  }, [session]);
  const extras = useMemo(
    () => ({
      piQueue: {
        ...session.runtimeExtras.piQueue,
        paused: snapshot.queuePaused,
        rejectedDraft: snapshot.rejectedQueueDraft,
        steeringIds: snapshot.steeringQueueIds,
      },
      piRun: {
        startedAt: snapshot.runStartedAt,
        autoRetry: snapshot.autoRetry,
      },
      piComposer: {
        error: composerError,
        clearError: clearComposerError,
      },
    }),
    [
      clearComposerError,
      composerError,
      session,
      snapshot.autoRetry,
      snapshot.queuePaused,
      snapshot.rejectedQueueDraft,
      snapshot.runStartedAt,
      snapshot.steeringQueueIds,
    ],
  );

  useEffect(() => {
    void session
      .open()
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
    isRunning: snapshot.isRunning,
    isLoading: snapshot.isLoading,
    extras,
    // The queue adapter is only a dispatch path while a run is active. Keeping
    // it installed while idle makes assistant-ui route ordinary sends through
    // `enqueue`, which cannot report a rejected send back to the composer for
    // draft restoration.
    queue: snapshot.isRunning ? session.queueAdapter : undefined,
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
        throw localizedPiError(error, t);
      }
    },
    onRefetchThread: () => session.reload(),
    adapters: {
      attachments: workbenchAttachmentAdapter,
      dictation,
      feedback: workbenchFeedbackAdapter,
    },
  });
}

export function useWorkbenchRuntime(manager: PiSessionManager) {
  const adapter = useMemo(() => manager.createThreadListAdapter(), [manager]);
  const runtime = useRemoteThreadListRuntime({
    adapter,
    runtimeHook: () => useWorkbenchPiRuntime(manager),
  });
  useEffect(
    () =>
      manager.subscribeThreadList(() => {
        void runtime.threads
          .reload()
          .catch((error) => console.error("[workbench-pi] thread list reload failed", error));
      }),
    [manager, runtime],
  );
  return runtime;
}
