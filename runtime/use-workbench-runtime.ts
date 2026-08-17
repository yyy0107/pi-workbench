"use client";

import { useMemo } from "react";
import { useRemoteThreadListRuntime, WebSpeechDictationAdapter } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";

import { workbenchAttachmentAdapter } from "./adapters/attachments";
import { workbenchFeedbackAdapter } from "./adapters/feedback";
import { workbenchThreadListAdapter } from "./adapters/thread-list";
import { createWorkbenchTransport } from "./transport";

function useWorkbenchChatRuntime() {
  const transport = useMemo(() => createWorkbenchTransport(), []);
  const dictation = useMemo(() => new WebSpeechDictationAdapter(), []);

  return useChatRuntime({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    adapters: {
      attachments: workbenchAttachmentAdapter,
      dictation,
      feedback: workbenchFeedbackAdapter,
    },
  });
}

export function useWorkbenchRuntime() {
  return useRemoteThreadListRuntime({
    adapter: workbenchThreadListAdapter,
    runtimeHook: useWorkbenchChatRuntime,
  });
}
