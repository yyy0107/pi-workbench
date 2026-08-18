"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  useAuiState,
  useExternalStoreRuntime,
  useRemoteThreadListRuntime,
  WebSpeechDictationAdapter,
} from "@assistant-ui/react";

import { useI18n, type Translate } from "@/i18n";

import { workbenchAttachmentAdapter } from "./adapters/attachments";
import { workbenchFeedbackAdapter } from "./adapters/feedback";
import { PiApiError } from "./pi/client/api";
import { PiSessionManager } from "./pi/client/manager";

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
  const extras = useMemo(
    () => ({
      piQueue: {
        ...session.runtimeExtras.piQueue,
        paused: snapshot.queuePaused,
      },
    }),
    [session, snapshot.queuePaused],
  );

  useEffect(() => {
    void session
      .open()
      .catch((error) => console.error("[workbench-pi] history load failed", error));
  }, [session]);

  return useExternalStoreRuntime({
    messages: snapshot.messages,
    isRunning: snapshot.isRunning,
    isLoading: snapshot.isLoading,
    extras,
    queue: session.queueAdapter,
    onNew: async (message) => {
      try {
        await session.send(message);
      } catch (error) {
        throw localizedPiError(error, t);
      }
    },
    onCancel: async () => {
      try {
        await session.cancel();
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
  return useRemoteThreadListRuntime({
    adapter,
    runtimeHook: () => useWorkbenchPiRuntime(manager),
  });
}
