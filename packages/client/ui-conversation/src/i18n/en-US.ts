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
      edit: {
        label: "Edit message",
        cancel: "Cancel",
        update: "Update",
      },
      loadingHistory: "Loading conversation history…",
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
      errors: {
        sessionBusy: "This conversation is already generating a response.",
        emptyPrompt: "Enter a message or attach an image before sending.",
        sessionNotFound: "This conversation is no longer available.",
        invalidWorkingDirectory: "The runtime working directory is not available.",
        invalidWorkspace: "Select a valid workspace before starting a conversation.",
        modelNotAvailable: "This model is not available from the configured providers.",
        requestFailed: "The runtime could not complete the request. Please try again.",
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
    markdown: {
      footnotes: "Footnotes",
      backToReference: "Back to reference",
    },
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
};
