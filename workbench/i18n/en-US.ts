import type { MessageFormatters } from "@/i18n/types";

export const workbenchEnUS = {
  chat: {
    empty: {
      question: "What will you make in Pi Workbench?",
      description:
        "Ask a question, attach context, or open a workbench panel when the conversation needs more room.",
      planProject: "Help me plan a small project",
      explainConcept: "Explain a difficult concept simply",
      reviewIdea: "Review an idea and find its risks",
    },
    composer: {
      placeholder: "Describe what you want to accomplish, or paste content to work with…",
      runningPlaceholder:
        "Press Enter to queue a message, or Ctrl+Enter to send a steering message directly…",
      selectWorkspacePlaceholder: "Select a workspace before starting a conversation…",
      messageInput: "Message input",
      commandSuggestions: "Command suggestions",
      commandParameters: {
        close: "Close command parameters",
        disabled: "Disabled",
        done: "Done",
        edit: ({ command }: { command: string }) => `Edit parameters for ${command}`,
        enabled: "Enabled",
        notSet: "Not set",
        optional: "Optional",
        required: "Required",
        reset: "Reset",
        selectPlaceholder: "Select a value",
        title: "Command parameters",
        valuePlaceholder: ({ parameter }: { parameter: string }) => `Enter ${parameter}`,
        errors: {
          integer: "Enter a whole number.",
          invalidChoice: "Select a valid value.",
          invalidNumber: "Enter a valid number.",
          maximum: ({ limit }: { limit: string }) => `Enter ${limit} or less.`,
          maxLength: ({ limit }: { limit: string }) => `Use no more than ${limit} characters.`,
          minimum: ({ limit }: { limit: string }) => `Enter ${limit} or more.`,
          minLength: ({ limit }: { limit: string }) => `Use at least ${limit} characters.`,
          required: "Enter a value.",
        },
      },
      commandGroups: {
        builtin: "Pi built-ins",
        extension: "Extensions",
        prompt: "Prompt templates",
        skill: "Skills",
        workbench: "Workbench",
      },
      commandScopes: {
        user: "User",
        project: "Project",
        temporary: "Temporary",
        manualOnly: "Manual only",
      },
      builtinCommands: {
        compact: {
          label: "Compact",
          description: "Manually compact the conversation context",
          argumentHint: "[optional instructions]",
        },
        reload: {
          label: "Reload",
          description: "Reload extensions, skills, prompts, and context files",
        },
      },
      stopVoiceInput: "Stop voice input",
      voiceInput: "Voice input",
      stopGenerating: "Stop generating",
      sendMessage: "Send message",
      queueFollowUp: "Add to follow-up queue",
      dismissError: "Dismiss message",
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
    working: "Pi Working...",
    workingElapsed: ({ duration }: { duration: string }) => `Pi Working... · ${duration}`,
    workingWordmarkElapsed: ({ duration }: { duration: string }) => `· ${duration}`,
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
      emptyPrompt: "Enter a message or attach an image or PDF before sending.",
      sessionNotFound: "This conversation is no longer available.",
      invalidWorkingDirectory: "The Pi working directory is not available.",
      invalidWorkspace: "Select a valid workspace before starting a conversation.",
      modelNotAvailable: "This model is not available from the configured Pi providers.",
      modelDoesNotSupportAttachments:
        "The current route cannot accept this attachment. Remove it or choose a compatible recognition route.",
      invalidAttachment:
        "This attachment could not be sent. Use a valid PNG, JPEG, GIF, WebP, or PDF file.",
      attachmentTooLarge: "This attachment is too large to send. Choose a smaller file.",
      tooManyAttachments:
        "There are too many attachments to send at once. Remove some files and try again.",
      requestFailed: "Pi could not complete the request. Please try again.",
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
  sidebar: {
    newThread: "New conversation",
    toolbox: "Toolbox",
    workflows: "Workflows",
    search: "Search conversations",
    searchPlaceholder: "Search conversations…",
    searchToolbox: "Search Toolbox",
    searchToolboxPlaceholder: "Search capabilities…",
    searchWorkflows: "Search workflows",
    searchWorkflowsPlaceholder: "Search workflows…",
    clearSearch: "Clear search",
    closeSearch: "Close search",
    noSearchResults: "No matching conversations found.",
    toolboxEmpty: "Toolbox content will appear here.",
    workflowsEmpty: "Workflow content will appear here.",
    workspaceOptions: "Workspace options",
    conversationOptions: "Conversation options",
    openWorkspaceFolder: "Open containing folder",
    removeWorkspace: "Remove workspace",
    expandWorkspace: "Expand workspace",
    collapseWorkspace: "Collapse workspace",
    expandSection: "Expand section",
    collapseSection: "Collapse section",
    conversations: "Conversations",
    loading: "Loading conversations",
    loadingMoreWorkspaces: "Loading more workspaces",
    empty: "Conversations will appear here after you send your first message.",
    noWorkspaces: "Add a workspace to start a conversation.",
    pinned: "Pinned",
    projects: "Projects",
    chatSortTitle: "Chat sorting",
    chatSortManual: "Manual",
    chatSortPriority: "Priority",
    chatSortRecent: "Most recent",
    ungrouped: "Ungrouped conversations",
    loadMore: "Show more",
    generating: "Generating",
    waitingForUserInput: "Waiting for user input",
    completed: "Completed in the background",
    pin: "Pin conversation",
    unpin: "Unpin conversation",
    pinWorkspace: "Pin project",
    unpinWorkspace: "Unpin project",
    archive: "Archive conversation",
    delete: "Delete conversation",
    resize: "Resize conversation sidebar",
    mobileTitle: "Conversation sidebar",
    mobileDescription: "Displays conversations and workspace navigation.",
    closeMobile: "Close conversation sidebar",
    collapse: "Collapse sidebar",
    expand: "Expand sidebar",
    openMobile: "Open conversation sidebar",
    mainNavigation: "Main navigation",
    region: "Conversation sidebar",
  },
  panels: {
    closePanel: "Close panel",
    resize: ({ location }: { location: string }) => `Resize ${location} panel`,
    locations: {
      left: "left",
      right: "right",
      bottom: "bottom",
    },
    expandRight: "Expand right sidebar",
    collapseRight: "Collapse right sidebar",
    rightExtensions: "Right sidebar extensions",
    closeTab: ({ label }: { label: string }) => `Close ${label}`,
    addTab: "Add right sidebar tab",
    noTabs: "No more tabs available",
  },
  shell: {
    workspace: "Workspace",
    currentWorkspace: ({ name }: { name: string }) => `Current workspace: ${name}`,
    workbench: "Workbench",
  },
} as const;
