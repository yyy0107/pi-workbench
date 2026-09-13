export const messages = {
  extensions: {
    settings: {
      conversation: {
        title: "Conversation",
        description:
          "Choose how messages are sent during a run and how conversation details are displayed.",
        runningMessageMode: "Follow-up handling",
        runningMessageDescription:
          "Queue follow-up messages while a conversation is running, or steer the ongoing run. Press Ctrl/Cmd+Enter to use the opposite action for a single message.",
        queue: "Add to queue",
        steer: "Steer the run",
        askUserAutoContinue: "Automatically continue unanswered questions",
        askUserAutoContinueDescription:
          "Skip each unanswered question after 5 minutes. Turning this off removes the timer from current and future questions. Approval requests still require your decision.",
        retainAllModelIO: "Retain complete model I/O",
        retainAllModelIODescription:
          "Keep all recorded model request and response history without automatic cleanup. Otherwise completed audit history is limited to 100 activations or 1 GiB per session. Applies when a session is next opened; already deleted history cannot be restored.",
        showTodos: "Show todo lists",
        showTodosDescription:
          "Show task lists from supported Todo tools above the composer and in the message timeline.",
        groupExplorationTools: "Group exploration tools",
        groupExplorationToolsDescription:
          "Group consecutive read and search tool calls into an expandable Explore group.",
        groupTerminalTools: "Group terminal commands",
        groupTerminalToolsDescription:
          "Group consecutive Bash tool calls into an expandable Terminal group.",
        groupFileChanges: "Group file changes",
        groupFileChangesDescription:
          "Group consecutive Write, Edit and Apply Patch calls into an expandable Changes group.",

        todosEmpty: "No outstanding todo items.",

        showReasoning: "Show reasoning",
        showReasoningDescription:
          "Display reasoning content returned by the model. Turning this off hides it from the message view without changing saved history.",
        groupParallelTools: "Group parallel tool calls",
        groupParallelToolsDescription:
          "Combine tool calls from the same parallel batch into one expandable group. Turn off to list each tool call separately.",
        loadError: "Could not load conversation preferences. Retry to edit them.",
        saveError:
          "Could not save this change. Your previous preference is still active; try again.",
        retry: "Retry",
      },
    },
    localeSelector: {
      languageTitle: "Language",
      languageDescription: "Choose the language used by Workbench controls and menus.",
      selectLanguage: "Select interface language",
    },
  },
} as const;
