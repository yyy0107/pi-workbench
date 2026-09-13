export const messages = {
  workbench: {
    chat: {
      commandArguments: {
        customInstructions: "Custom instructions",
      },
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
      },
      errors: {
        retry: "Retry",
        retrying: "Retrying",
        requestFailedTitle: "Request failed",
        unknownFailure: "The response could not be completed.",
      },
    },
  },
  assistant: {
    actions: {
      edit: "Edit",
      copy: "Copy",
      copied: "Copied",
      copyFailed: "Couldn't copy",
      refresh: "Refresh",
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
  },
  chatContent: {
    userMessage: {
      showMore: "Show more",
      showLess: "Show less",
    },
  },
};
