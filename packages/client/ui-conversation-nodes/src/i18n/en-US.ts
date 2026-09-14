import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  workbench: {
    chat: {
      actions: {
        copyMessage: "Copy message",
        copyResponse: "Copy response",
      },
      sourceFallback: "Source",
      generating: "Generating response…",
      steering: {
        waitingToInsert: "Waiting to be inserted…",
      },
      separators: {
        continuedFromChat: "Continued from chat",
        modelChanged: "Model switched",
        modelChangedAnnouncement: ({
          previousModel,
          model,
        }: {
          previousModel?: string;
          model: string;
        }) =>
          previousModel
            ? `Model switched from ${previousModel} to ${model}`
            : `Model switched to ${model}`,
        contextCompacted: "Context compacted",
        contextCompactedTokens: (
          { before, after }: { before: number; after: number },
          { number }: MessageFormatters,
        ) =>
          `${number(before, { notation: "compact" })} → ${number(after, { notation: "compact" })} tokens`,
        contextCompactedBefore: ({ before }: { before: number }, { number }: MessageFormatters) =>
          `${number(before, { notation: "compact" })} tokens before`,
        contextCompactedAnnouncement: (
          { before, after }: { before?: number; after?: number },
          { number }: MessageFormatters,
        ) =>
          before !== undefined && after !== undefined
            ? `Context compacted from ${number(before)} to approximately ${number(after)} tokens`
            : before !== undefined
              ? `Context compacted from ${number(before)} tokens`
              : "Context compacted",
      },
      errors: {
        modelDoesNotSupportAttachments:
          "The current route cannot accept this attachment. Remove it or choose a compatible recognition route.",
        invalidAttachment:
          "This attachment could not be sent. Use a valid PNG, JPEG, GIF, or WebP file.",
        attachmentTooLarge: "This attachment is too large to send. Choose a smaller file.",
        tooManyAttachments:
          "There are too many attachments to send at once. Remove some files and try again.",
        commandCompileFailed:
          "This command combination cannot be sent. Remove conflicting or unavailable command tokens and try again.",
        continue: "Continue",
        continuing: "Continuing",
        generationStopped: "Generation stopped",
        generationInterrupted: "Generation interrupted",
        connectionFailed: "Connection failed",
        imageInputUnsupportedTitle: "This model does not support images",
        imageInputUnsupported:
          "This message was saved. Switch to a model that supports image input, then retry this turn.",
        stoppedByUser: "The response was stopped by the user.",
        interrupted: "The response ended before it could be completed.",
        stoppedCanContinue: "The response was stopped. Continue resumes the current task.",
        interruptedCanContinue:
          "The interruption was saved. Continue resumes the current task from its last safe point.",
        continueFailed: "The task could not be continued. Refresh the conversation and try again.",
        resumeRequiresConfirmation:
          "A tool may have changed external state before the interruption. Automatic continuation is disabled until that result can be confirmed.",
        resumeRequiresModelChange:
          "This checkpoint is saved. Switch to a model or provider with available access, then continue.",
        outputLimit: ({ tokens }: { tokens?: number }, { number }: MessageFormatters) =>
          tokens === undefined
            ? "The model reached its output limit."
            : `The model reached its output limit after ${number(tokens)} tokens.`,
        networkFailure: "The connection to the model provider was interrupted.",
        apiFailure: "The model provider could not complete the request.",
        providerFailure: "The configured model provider could not complete the request.",
        queueSendFailedRestored:
          "The message could not be queued. Its draft was restored so you can try again.",
      },
    },
  },
  extensions: {
    messagePresentation: {
      generating: "Generating response…",
      sourceFallback: "Source",
      attachmentReference: {
        image: ({ index }: { index: number }, { number }: MessageFormatters) =>
          `Image ${number(index)}`,
        pdf: ({ index }: { index: number }, { number }: MessageFormatters) =>
          `PDF ${number(index)}`,
      },
      fileChanges: {
        openDiff: ({ name }: { name: string }) => `Open full diff for ${name}`,
        openDiffFailed: ({ name }: { name: string }) =>
          `Could not open the full diff for ${name}. Try again.`,

        summary: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `${number(count)} ${count === 1 ? "file" : "files"} changed`,
        undo: "Undo",
        undoing: "Undoing",
        redo: "Redo",
        redoing: "Redoing",
        undoLabel: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `Undo changes to ${number(count)} ${count === 1 ? "file" : "files"}`,
        undoSucceeded: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `Undid changes to ${number(count)} ${count === 1 ? "file" : "files"}`,
        undoFailed: "Could not undo these changes. They may overlap with newer workspace work.",
        redoLabel: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `Redo changes to ${number(count)} ${count === 1 ? "file" : "files"}`,
        redoSucceeded: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `Redid changes to ${number(count)} ${count === 1 ? "file" : "files"}`,
        redoFailed: "Could not redo these changes. A file may overlap with newer work.",
        review: "Review",
        reviewTitle: "Review changes",
        open: "Open",
        openFailed: ({ name }: { name: string }) => `Could not open ${name}`,
      },
      continuedTurn: ({ continuedAt }: { continuedAt: string }) => `Continued at ${continuedAt}`,
      completedTurn: ({
        completedAt,
        duration,
        kind,
      }: {
        completedAt: string;
        duration: string;
        kind:
          | "completed"
          | "cancelled"
          | "aborted"
          | "length"
          | "network-error"
          | "api-error"
          | "provider-error";
      }) => {
        const durationLabel = duration ? ` · Took ${duration}` : "";
        switch (kind) {
          case "cancelled":
            return `Stopped by user at ${completedAt}${durationLabel}`;
          case "aborted":
            return `Aborted at ${completedAt}${durationLabel}`;
          case "length":
            return `Stopped at ${completedAt} · Length limit reached${durationLabel}`;
          case "network-error":
            return `Failed at ${completedAt} · Network connection error${durationLabel}`;
          case "api-error":
            return `Failed at ${completedAt} · API error${durationLabel}`;
          case "provider-error":
            return `Failed at ${completedAt} · Provider error${durationLabel}`;
          default:
            return `Completed at ${completedAt}${durationLabel}`;
        }
      },
    },
  },
};
