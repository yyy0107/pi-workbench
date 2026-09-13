import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  assistant: {
    tool: {
      used: "Used tool",
      cancelled: "Cancelled tool",
      result: "Result:",
      error: "Error:",
      cancelledReason: "Cancellation reason:",
      allow: "Allow",
      alwaysAllow: "Always allow",
      deny: "Deny",
      alwaysDeny: "Always deny",
      confirm: "Confirm",
      cancel: "Cancel",
      back: "Back",
      confirmOption: ({ label }: { label: string }) => `${label}?`,
      calls: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} tool ${count === 1 ? "call" : "calls"}`,
    },
  },
  extensions: {
    messagePresentation: {
      elapsed: ({ duration }: { duration: string }) => `·${duration}·`,
      toolTimeline: {
        active: (
          { steps, files }: { steps: number; files: number },
          { number }: MessageFormatters,
        ) => {
          const stepLabel = steps === 1 ? "step" : "steps";
          const fileLabel = files === 1 ? "file" : "files";
          return files > 0
            ? `Working · ${number(steps)} ${stepLabel} · ${number(files)} ${fileLabel} changed`
            : `Working · ${number(steps)} ${stepLabel}`;
        },
        activeLatest: ({ latest }: { latest: string }) => `Working · ${latest}`,
        planningNextStep: "Planning next step",
        summary: (
          { steps, files }: { steps: number; files: number },
          { number }: MessageFormatters,
        ) => {
          const stepLabel = steps === 1 ? "step" : "steps";
          const fileLabel = files === 1 ? "file" : "files";
          return files > 0
            ? `Completed · ${number(steps)} ${stepLabel} · ${number(files)} ${fileLabel} changed`
            : `Completed · ${number(steps)} ${stepLabel}`;
        },
        steps: {
          thinking: "Thinking",
          read: "Read",
          ran: "Ran",
          edited: "Edited",
          created: "Created",
          searched: "Searched",
          used: "Used",
        },
        activeSteps: {
          thinking: "Thinking",
          read: "Reading",
          ran: "Running",
          edited: "Editing",
          creating: "Creating",
          searched: "Searching",
          used: "Using",
        },
        request: "Request",
        result: "Result",
        failed: "Failed",
      },
      reasoning: {
        active: "Thinking",
        recovering: "Restoring connection",
        stalled: "Still thinking",
        complete: "Reasoned",
        completeWithDuration: ({ seconds }: { seconds: number }, { number }: MessageFormatters) =>
          `Reasoned for ${number(seconds)}s`,
        elapsed: ({ seconds }: { seconds: number }, { number }: MessageFormatters) =>
          `${number(seconds)}s`,
        step: "Reasoning",
      },
    },
    settings: {
      conversation: {
        explorationGroup: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `Explore · ${number(count)}`,
        terminalGroup: ({ count }: { count: number }, { number, plural }: MessageFormatters) =>
          `Ran ${number(count)} ${plural(count) === "one" ? "command" : "commands"}`,
        changesGroup: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `Changes · ${number(count)}`,
      },
    },
  },
};
