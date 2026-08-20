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
      selectWorkspacePlaceholder: "Select a workspace before starting a conversation…",
      messageInput: "Message input",
      commandSuggestions: "Command suggestions",
      commandParameters: {
        close: "Close command parameters",
        edit: ({ command }: { command: string }) => `Edit parameters for ${command}`,
        enabled: "Enabled",
        optional: "Optional",
        required: "Required",
        valuePlaceholder: ({ parameter }: { parameter: string }) => `Enter ${parameter}`,
      },
      commandGroups: {
        builtin: "Pi built-ins",
        extension: "Extensions",
        prompt: "Prompt templates",
        skill: "Skills",
        workbench: "Workbench",
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
      openDrawer: "Show composer options",
      closeDrawer: "Hide composer options",
      drawer: "Composer options",
      contextCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `Context ${number(count)}`,
      extensionsCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `Extensions ${number(count)}`,
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
    working: "Pi Working...",
    workingElapsed: ({ duration }: { duration: string }) => `Pi Working... · ${duration}`,
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
      emptyPrompt: "Enter a message or attach an image before sending.",
      sessionNotFound: "This conversation is no longer available.",
      invalidWorkingDirectory: "The Pi working directory is not available.",
      invalidWorkspace: "Select a valid workspace before starting a conversation.",
      modelNotAvailable: "This model is not available from the configured Pi providers.",
      modelDoesNotSupportImages:
        "The current model does not accept images. Remove the image or choose an image-capable model.",
      invalidImage: "This image could not be sent. Use a valid PNG, JPEG, GIF, or WebP image.",
      imageTooLarge: "This image is too large to send. Choose a smaller image.",
      tooManyImages: "There are too many images to send at once. Remove some images and try again.",
      requestFailed: "Pi could not complete the request. Please try again.",
      commandCompileFailed:
        "This command combination cannot be sent. Remove conflicting or unavailable command tokens and try again.",
      retry: "Retry",
      retrying: "Retrying",
      generationStopped: "Generation stopped",
      generationInterrupted: "Generation interrupted",
      connectionFailed: "Connection failed",
      requestFailedTitle: "Request failed",
      stoppedByUser: "The response was stopped by the user.",
      interrupted: "The response ended before it could be completed.",
      outputLimit: ({ tokens }: { tokens?: number }, { number }: MessageFormatters) =>
        tokens === undefined
          ? "The model reached its output limit."
          : `The model reached its output limit after ${number(tokens)} tokens.`,
      networkFailure: "The connection to the model provider was interrupted.",
      apiFailure: "The model provider could not complete the request.",
      providerFailure: "The configured model provider could not complete the request.",
      unknownFailure: "The response could not be completed.",
    },
    scrollLatest: "Scroll to latest",
  },
  sidebar: {
    newThread: "New conversation",
    workspaceOptions: "Workspace options",
    removeWorkspace: "Remove workspace",
    expandWorkspace: "Expand workspace",
    collapseWorkspace: "Collapse workspace",
    conversations: "Conversations",
    loading: "Loading conversations",
    loadingMoreWorkspaces: "Loading more workspaces",
    empty: "Conversations will appear here after you send your first message.",
    noWorkspaces: "Add a workspace to start a conversation.",
    ungrouped: "Ungrouped conversations",
    loadMore: "Show more",
    generating: "Generating",
    completed: "Completed in the background",
    pin: "Pin conversation",
    unpin: "Unpin conversation",
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
    workbench: "Workbench",
  },
} as const;
