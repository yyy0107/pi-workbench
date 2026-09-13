import type { MessageFormatters } from "@workbench/i18n/runtime";
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
        commandSuggestions: "Command suggestions",
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
          builtin: (
            { runtimeName, count }: { runtimeName: string; count: number },
            { number }: MessageFormatters,
          ) => `${runtimeName} built-ins (${number(count)})`,
          extension: ({ count }: { count: number }, { number }: MessageFormatters) =>
            `Extensions (${number(count)})`,
          prompt: ({ count }: { count: number }, { number }: MessageFormatters) =>
            `Prompt templates (${number(count)})`,
          skill: ({ count }: { count: number }, { number }: MessageFormatters) =>
            `Skills (${number(count)})`,
          workbench: ({ count }: { count: number }, { number }: MessageFormatters) =>
            `Workbench (${number(count)})`,
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
    },
  },
  assistant: {
    composer: {
      placeholder: "Send a message…",
      messageInput: "Message input",
      addAttachment: "Add attachment",
      removeFile: "Remove file",
      removeAttachment: ({ name }: { name: string }) => `Remove ${name}`,
      stopVoiceInput: "Stop voice input",
      voiceInput: "Voice input",
      startVoiceInput: "Start voice input",
      transcribing: "Transcribing",
      stopGenerating: "Stop generating",
      sendMessage: "Send message",
    },
    attachment: {
      previewTitle: "Image attachment preview",
      previewAlt: "Attachment preview",
      image: "Image",
      document: "Document",
      file: "File",
      uploadFailed: "Upload failed",
      accessibleLabel: ({ type, status }: { type: string; status: string }) =>
        `${type} attachment${status}`,
      statusUploading: ", uploading",
      statusFailed: ", upload failed",
    },
  },
  chatContent: {
    textAttachment: {
      title: "Pasted text",
      saving: "Saving…",
      ready: "Saved",
      failed: "Could not save pasted text",
      retry: "Retry",
      remove: "Remove pasted text",
      preview: "Preview pasted text",
      restore: "Show in text box",
      restoring: "Restoring…",
      restoreFailed: "Could not restore pasted text. The attachment has been kept.",
      unavailable: "This text attachment is unavailable.",
      loadMore: "Load more",
      loading: "Loading…",
      tooLarge: "Pasted text exceeds the 5 MiB limit.",
      tooMany: "A message supports up to 20 attachments.",
      characters: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} characters`,
    },
  },
  composer: {
    close: "Close",
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
