"use client";

import { WebSpeechDictationAdapter } from "@assistant-ui/react";
import { useMemo } from "react";

import { workbenchAttachmentAdapter } from "./attachments";
import { workbenchFeedbackAdapter } from "./feedback";

/** Shared browser adapters installed by every Workbench Agent Runtime implementation. */
export function useWorkbenchRuntimeAdapters() {
  const dictation = useMemo(() => new WebSpeechDictationAdapter(), []);

  return useMemo(
    () => ({
      attachments: workbenchAttachmentAdapter,
      dictation,
      feedback: workbenchFeedbackAdapter,
    }),
    [dictation],
  );
}
