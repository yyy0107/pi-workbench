import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  workbench: {
    chat: {
      empty: {
        question: ({ productName }: { productName: string }) =>
          `What will you make in ${productName}?`,
        description:
          "Ask a question, attach context, or open a workbench panel when the conversation needs more room.",
        planProject: "Help me plan a small project",
        explainConcept: "Explain a difficult concept simply",
        reviewIdea: "Review an idea and find its risks",
      },

      titles: {
        attachmentAnalysis: "Attachment analysis",
        imageConversation: "Image conversation",
      },
      actions: {
        copyMessage: "Copy message",
        copyResponse: "Copy response",
      },
      edit: {
        label: "Edit message",
        cancel: "Cancel",
        update: "Update",
      },
      sourceFallback: "Source",
      generating: "Generating response…",
      loadingHistory: "Loading conversation history…",
      commandArguments: {
        customInstructions: "Custom instructions",
      },
      working: ({ runtimeName }: { runtimeName: string }) => `${runtimeName} Working...`,
      workingElapsed: ({ runtimeName, duration }: { runtimeName: string; duration: string }) =>
        `${runtimeName} Working... · ${duration}`,
      elapsedOnly: ({ duration }: { duration: string }) => `· ${duration}`,
      connectionInterruptedRetrying: ({
        attempt,
        maxAttempts,
      }: {
        attempt: number;
        maxAttempts: number;
      }) => `Connection interrupted, retrying ${attempt}/${maxAttempts}`,
      connectionInterruptedRetryingElapsed: ({
        attempt,
        maxAttempts,
        duration,
      }: {
        attempt: number;
        maxAttempts: number;
        duration: string;
      }) => `Connection interrupted, retrying ${attempt}/${maxAttempts} · ${duration}`,
      commandResponses: {
        compactRunning: "Compacting conversation context…",
        compactSucceeded: "Conversation context was compacted.",
        compactFailed: "The conversation context could not be compacted.",
        reloadRunning: "Reloading extensions, Skills, prompts, and context files…",
        reloadSucceeded: "Extensions, Skills, prompts, and context files were reloaded.",
        reloadFailed: "Extensions, Skills, prompts, and context files could not be reloaded.",
        reloadConfiguration: {
          title: "Reloaded configuration",
          extensions: "Extensions",
          skills: "Skills",
          prompts: "Prompts",
          contextFiles: "Context files",
          none: "None",
        },
        commandRunning: ({ command }: { command: string }) => `${command} is running…`,
        commandSucceeded: ({ command }: { command: string }) => `${command} completed.`,
        commandFailed: ({ command }: { command: string }) => `${command} could not be completed.`,
        failureReasons: {
          contextTooSmall:
            "The current context is too short to compact. Continue the conversation and try again.",
          alreadyCompacted:
            "Reason: The current context is already compacted and has no new content to process. Continue the conversation, then try again.",
          cancelled:
            "Reason: The operation was cancelled before it finished. Make sure no other session action is interrupting it, then try again.",
          modelUnavailable:
            "Reason: This conversation has no available model. Select and configure a model, then try again.",
          authenticationFailed:
            "Reason: Authentication for the selected model failed. Sign in again or check its API key, then retry.",
          quotaExhausted:
            "Reason: The model provider has no available quota or billing capacity. Check the account quota, then retry.",
          rateLimited:
            "Reason: The model provider is rate-limiting requests. Wait a moment, then try again.",
          networkError:
            "Reason: Workbench could not reach the model provider. Check the network and provider endpoint, then retry.",
          timeout:
            "Reason: The model provider did not respond in time. Wait a moment, then try again.",
          providerUnavailable:
            "Reason: The model provider is currently unavailable. Try again later or switch to another model.",
          sessionDataInvalid:
            "Reason: This conversation history cannot be compacted safely. Start a new conversation or repair the persisted session data.",
          summaryGenerationFailed:
            "Reason: The model could not generate a valid context summary. Check the model configuration or switch models, then retry.",
          reloadFailed:
            "Reason: An extension, Skill, prompt, or context file failed to load. Check recently changed resources, then retry.",
          unknown:
            "Reason: The command encountered an unclassified runtime error. Try again; if it continues, check the server log.",
        },
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
        contextCompactionReason: ({ reason }: { reason: string }) => {
          switch (reason) {
            case "manual":
              return "Compaction reason: Manual request";
            case "threshold":
              return "Compaction reason: Context threshold reached";
            case "overflow":
              return "Compaction reason: Runtime detected context overflow or output truncation";
            default:
              return "Compaction reason: Not recorded";
          }
        },
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
        sessionBusy: "This conversation is already generating a response.",
        emptyPrompt: "Enter a message or attach an image before sending.",
        sessionNotFound: "This conversation is no longer available.",
        invalidWorkingDirectory: "The runtime working directory is not available.",
        invalidWorkspace: "Select a valid workspace before starting a conversation.",
        modelNotAvailable: "This model is not available from the configured providers.",
        modelDoesNotSupportAttachments:
          "The current route cannot accept this attachment. Remove it or choose a compatible recognition route.",
        invalidAttachment:
          "This attachment could not be sent. Use a valid PNG, JPEG, GIF, or WebP file.",
        attachmentTooLarge: "This attachment is too large to send. Choose a smaller file.",
        tooManyAttachments:
          "There are too many attachments to send at once. Remove some files and try again.",
        requestFailed: "The runtime could not complete the request. Please try again.",
        commandCompileFailed:
          "This command combination cannot be sent. Remove conflicting or unavailable command tokens and try again.",
        retry: "Retry",
        retrying: "Retrying",
        continue: "Continue",
        continuing: "Continuing",
        generationStopped: "Generation stopped",
        generationInterrupted: "Generation interrupted",
        connectionFailed: "Connection failed",
        requestFailedTitle: "Request failed",
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
        unknownFailure: "The response could not be completed.",
      },
      scrollLatest: "Scroll to latest",
    },
  },
  assistant: {
    common: {
      close: "Close",
      cancel: "Cancel",
      update: "Update",
    },
    thread: {
      greeting: "Hello there!",
      help: "How can I help you today?",
      thinking: "Thinking…",
      scrollLatest: "Scroll to latest",
    },
    actions: {
      edit: "Edit",
      copy: "Copy",
      copied: "Copied",
      copyFailed: "Couldn't copy",
      refresh: "Refresh",
    },
    markdown: { footnotes: "Footnotes", backToReference: "Back to reference" },
    codeBlock: {
      expand: "Expand code block",
      collapse: "Collapse code block",
      plainText: "Text",
      mermaidDiagram: "Mermaid diagram",
      mermaidLoading: "Rendering diagram…",
      mermaidError: "Couldn't render the Mermaid diagram. Check the source below.",
    },
    linkSafety: {
      title: "Open external link?",
      description: "You're about to visit an external website.",
      copy: "Copy link",
      copied: "Link copied",
      copyFailed: "Couldn't copy link",
      open: "Open link",
    },
    branch: {
      previous: "Previous",
      next: "Next",
    },
    threads: {
      search: "Search threads",
      newChat: "New chat",
      newThread: "New thread",
      loading: "Loading threads",
      running: "Running",
      rename: "Rename thread",
      renameAction: "Rename",
      moreOptions: "More options",
      archive: "Archive",
      delete: "Delete",
      noResults: "No threads found",
      today: "Today",
      yesterday: "Yesterday",
      earlier: "Earlier",
      sidebarTitle: "Conversation sidebar",
      sidebarDescription: "Displays the conversation list.",
      toggleSidebar: "Toggle conversation sidebar",
    },
    image: {
      zoom: "Click to zoom image",
      closeZoom: "Close zoomed image",
      generating: "Generating image…",
      failed: "Image could not be generated",
      stopped: "Image generation stopped",
      loadFailed: "Image could not be loaded",
      providerBlocked: "The provider blocked this image.",
      regenerate: "Regenerate image",
      download: "Download image",
      copy: "Copy image",
      contentAlt: "Image content",
    },
    file: {
      unnamed: "Unnamed file",
    },
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
    context: {
      title: "Context",
      system: "System",
      tools: "Tools",
      messages: "Messages",
      total: "Total",
      usage: "Context usage",
    },
    sourceLink: "View source",
  },
  chatContent: { userMessage: { showMore: "Show more", showLess: "Show less" } },
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
      elapsed: ({ duration }: { duration: string }) => `·${duration}·`,
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
    messageActions: {
      previousResponse: "Previous response",
      nextResponse: "Next response",
      editMessage: "Edit message",
      forkConversation: "Fork conversation here",
      forkConversationPending: "Forking conversation…",
      forkConversationFailed: "Couldn't fork conversation. Try again",
      regenerateResponse: "Regenerate response",
      timing: {
        details: "Performance statistics",
        total: "total",
        firstToken: "first token",
        inputTokens: "input",
        outputTokens: "output",
        tokensPerSecond: "TPS",
        cacheHitRate: "average cache hit",
      },
    },
    messageQueue: {
      drag: "Drag to reorder",
      steer: "Steer",
      remove: "Remove queued message",
      more: "More actions",
      edit: "Edit message",
      moveUp: "Move up",
      moveDown: "Move down",
      saveEdit: "Save changes",
      cancelEdit: "Cancel editing",
      close: "Close queue",
      enable: "Enable queue mode",
      messageFallback: "Queued attachment",
    },
    userMessageIndex: {
      navigationLabel: "User message index",
      jumpTo: ({ index }: { index: number }, { number }: MessageFormatters) =>
        `Jump to user message ${number(index)}`,
      nonTextPreview: "This message contains attachments or structured content.",
    },
    todoPanel: {
      title: "Tasks",
      updating: "Updating tasks",
      empty: "No tasks remaining.",
      progress: (
        { completed, total }: { completed: number; total: number },
        { number }: MessageFormatters,
      ) => `${number(completed)} / ${number(total)} completed`,
      owner: ({ owner }: { owner: string }) => `Owner: ${owner}`,
      blockedBy: ({ tasks }: { tasks: string }) => `Depends on: ${tasks}`,
    },
    interactiveRequests: {
      questionTitle: "Question",
      questionDescription: "Answer this request to let the session continue.",
      approvalTitle: "Tool approval required",
      approvalDescription: "Review this tool request before allowing it to run.",
      session: ({ sessionId }: { sessionId: string }) => `Session ${sessionId}`,
      pending: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} pending ${count === 1 ? "request" : "requests"}`,
      answerLabel: ({ question }: { question: string }) => `Answer for ${question}`,
      answerPlaceholder: "Reply…",
      customAnswerLabel: "Other answer",
      customAnswerPlaceholder: "Or write your own response",
      required: "Required",
      yes: "Yes",
      no: "No",
      tool: "Tool",
      callId: "Call ID",
      reason: "Reason",
      submit: "Submit response",
      send: "Send",
      submitAndContinue: "Submit and continue",
      nextQuestion: "Next",
      skip: "Skip",
      timeoutCountdown: ({ seconds }: { seconds: number }, { number }: MessageFormatters) =>
        `Automatically skip this question in ${number(seconds)} seconds`,
      submitting: "Sending…",
      cancel: "Cancel request",
      close: "Close approval request",
      allowOnce: "Allow once",
      reject: "Reject",
      selectedCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        count === 1 ? "1 selected" : `${number(count)} selected`,
      recommended: "Recommended",
      navigator: {
        title: "Questions",
        position: (
          { current, total }: { current: number; total: number },
          { number }: MessageFormatters,
        ) => `${number(current)} of ${number(total)}`,
        index: ({ index }: { index: number }, { number }: MessageFormatters) => number(index),
        open: (
          { current, total }: { current: number; total: number },
          { number }: MessageFormatters,
        ) => `Open question list, question ${number(current)} of ${number(total)}`,
        previous: "Previous question",
        next: "Next question",
        answered: "Answered",
        unanswered: "Not answered",
      },
      validation: {
        missingRequired: "Answer all required questions before submitting.",
      },
      askUserTool: {
        activityGenerating: "Generating questions",
        activityRunning: "Asking user",
        activityComplete: "Asked user",
        questionCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `${number(count)} ${count === 1 ? "question" : "questions"}`,
        history: "Question and answer record",
        waiting: "Waiting for the user's answer",
        unanswered: "No answer submitted",
        cancelledAnswer: "No answer submitted before cancellation",
        cancelled: "The request was cancelled before answers were submitted.",
        interrupted: "The request ended before answers were submitted.",
        disabled: "Ask User was disabled, so no answers were requested.",
      },
      errors: {
        badResponse: "The host rejected this response. Review the fields and try again.",
        notPending: "This request is no longer pending.",
        network: "Could not send the response. Check the connection and try again.",
      },
    },
    sideChat: {
      title: "Temporary chat",
      indexedTitle: ({ sequence }: { sequence: number }, { number }: MessageFormatters) =>
        `Temporary chat (${number(sequence)})`,
      open: "Open temporary chat",
      creating: "Creating temporary chat…",
      promote: "Keep as conversation",
      promoteDescription: "Save this temporary chat as a regular conversation.",
      promoting: "Saving…",
    },
    archivedChats: {
      title: "Archive",
      description: "Review, restore, or permanently delete conversations you have archived.",
      searchLabel: "Search archived chats",
      searchPlaceholder: "Search archived chats",
      sortLabel: "Sort archived chats",
      newestFirst: "Newest first",
      oldestFirst: "Oldest first",
      projectFilterLabel: "Filter archived chats by project",
      allProjects: "All projects",
      ungroupedProject: "Other chats",
      totalCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        count === 1 ? "1 archived chat" : `${number(count)} archived chats`,
      groupCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        count === 1 ? "1 chat" : `${number(count)} chats`,
      untitled: "Untitled chat",
      loading: "Loading archived chats…",
      loadingMore: "Loading more archived chats…",
      empty: "You have no archived chats.",
      noMatches: "No archived chats match these filters.",
      unarchive: "Unarchive",
      working: "Working…",
      delete: "Delete",
      deleteChat: ({ title }: { title: string }) => `Delete ${title}`,
      deleteAll: "Delete all",
      actionFailed: "The archived chat could not be updated. Try again.",
      deleteDialogTitle: "Permanently delete archived chats?",
      deleteChatDescription: ({ title }: { title: string }) =>
        `“${title}” and its complete conversation history will be permanently deleted. This cannot be undone.`,
      deleteAllDescription: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `All ${number(count)} archived chats and their complete conversation histories will be permanently deleted. This cannot be undone.`,
      cancel: "Cancel",
      confirmDelete: "Delete permanently",
      deleting: "Deleting…",
    },
    settings: {
      conversation: {
        explorationGroup: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `Explore · ${number(count)}`,
        terminalGroup: ({ count }: { count: number }, { number, plural }: MessageFormatters) =>
          `Ran ${number(count)} ${plural(count) === "one" ? "command" : "commands"}`,
        changesGroup: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `Changes · ${number(count)}`,
        todoStatus: { pending: "Pending", in_progress: "In progress", completed: "Completed" },
      },
    },
  },
};
