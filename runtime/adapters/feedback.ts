import type { FeedbackAdapter } from "@assistant-ui/react";

export const WORKBENCH_FEEDBACK_EVENT = "workbench:message-feedback";

export interface WorkbenchFeedbackEventDetail {
  messageId: string;
  type: "positive" | "negative";
}

export const workbenchFeedbackAdapter: FeedbackAdapter = {
  submit({ message, type }) {
    if (typeof window === "undefined") return;

    window.dispatchEvent(
      new CustomEvent<WorkbenchFeedbackEventDetail>(WORKBENCH_FEEDBACK_EVENT, {
        detail: { messageId: message.id, type },
      }),
    );
  },
};
