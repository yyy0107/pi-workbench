export const messages = {
  workbench: {
    chat: {
      composer: {
        placeholder: "Describe what you want to accomplish, or paste content to work with…",
        runningPlaceholder:
          "Press Enter to add to the queue, or Ctrl/Cmd+Enter to steer the ongoing run…",
        runningSteerPlaceholder:
          "Press Enter to steer the ongoing run, or Ctrl/Cmd+Enter to add to the queue…",
        steerMessage: "Steer the run",
        selectWorkspacePlaceholder: "Select a workspace before starting a conversation…",
        messageInput: "Message input",
        addMenu: {
          open: "Add to composer",
          attachment: "Add attachment",
          context: "Add context with @",
          capability: "Use / to select a capability",
        },
        contextMentions: {
          suggestions: "Context suggestions",
          conversations: "Conversations",
          workspaceFiles: "Workspace files",
          untitledConversation: "Untitled conversation",
          loading: "Loading workspace files…",
          empty: "No context found",
          loadError: "Workspace files could not be loaded",
        },
        stopVoiceInput: "Stop voice input",
        voiceInput: "Voice input",
        stopGenerating: "Stop generating",
        sendMessage: "Send message",
        queueFollowUp: "Add to follow-up queue",
        dismissError: "Dismiss message",
      },
    },
  },
  assistant: {
    composer: {
      placeholder: "Send a message…",
      messageInput: "Message input",
      addAttachment: "Add attachment",
      removeAttachment: ({ name }: { name: string }) => `Remove ${name}`,
      stopVoiceInput: "Stop voice input",
      voiceInput: "Voice input",
      startVoiceInput: "Start voice input",
      transcribing: "Transcribing",
      stopGenerating: "Stop generating",
      sendMessage: "Send message",
    },
  },
  composer: {
    errors: {
      modelDoesNotSupportAttachments:
        "The current route cannot accept this attachment. Remove it or choose a compatible recognition route.",
      attachmentTooLarge: "This attachment is too large to send. Choose a smaller file.",
      tooManyAttachments:
        "There are too many attachments to send at once. Remove some files and try again.",
      invalidAttachment:
        "This attachment could not be sent. Use a valid PNG, JPEG, GIF, or WebP file.",
      queueSendFailedRestored:
        "The message could not be queued. Its draft was restored so you can try again.",
      commandCompileFailed:
        "This command combination cannot be sent. Remove conflicting or unavailable command tokens and try again.",
    },
  },
};
