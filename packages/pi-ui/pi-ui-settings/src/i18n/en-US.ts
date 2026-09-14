export const messages = {
  extensions: {
    agentConfiguration: {
      cacheMiss: {
        title: "Cache miss notices",
        description:
          "Show significant prompt-cache misses and estimated extra costs in the message action bar. Disabled by default.",
        noticeTitle: "Prompt cache miss",
        summary: "Some prompt content was not read from cache, so this request may cost more.",
        tokensLabel: "Uncached tokens",
        costLabel: "Extra cost (est.)",
        costUnavailableShort: "Unavailable",
        tokens: ({ tokens }: { tokens: string }) =>
          `${tokens} previously processed tokens were not read from cache.`,
        cost: ({ cost }: { cost: string }) => `Estimated extra cost: ${cost}`,
        costUnavailable: "Extra cost is unavailable or no price difference was reported.",
        possibleCauses: "Possible reasons",
        modelChanged: "The model changed since the previous request.",
        idle: ({ minutes }: { minutes: string }) =>
          `Idle for ${minutes} minutes; the provider cache may have expired.`,
      },
      loading: "Loading agent configuration…",
      retry: "Retry",
      save: "Save",
      saving: "Saving…",
      saved: "Saved.",
      unsaved: "Unsaved changes",
      edit: "Edit",
      promptType: "Prompt type",
      saveLocation: "Save location",
      saveLocationUnavailable: "The save location is currently unavailable.",
      cancel: "Cancel",
      editValue: ({ label }: { label: string }) => `Edit ${label}`,
      appliesAfterReload:
        "New sessions use these settings immediately. Run /reload to apply them to an existing session.",
      errors: {
        loadFailed: "Agent configuration could not be loaded.",
        saveFailed: "Agent configuration could not be saved. Try again.",
        unsupportedPrompt:
          "The Runtime did not confirm this prompt setting. Your draft is preserved. Restart with the updated Runtime, then save again.",
        conflict: "These settings changed elsewhere. Reload the page and try again.",
      },
      systemPrompt: {
        title: "System Prompt",
        tabLabel: "SYSTEM",
        sectionTitle: "Base prompt",
        pageDescription:
          "Shape your agent's behavior with a base prompt and additional instructions.",
        compositionLabel: "Pi system prompt composition order",
        compositionTip:
          "Pi builds the system prompt in this order: base prompt (SYSTEM.md or the built-in default) → additional instructions (APPEND_SYSTEM.md) → project instructions (AGENTS.md and similar files) → available skills catalog (when read is enabled) → current working directory. For both prompt files, trusted project settings take precedence over user settings. Extensions may adjust the prompt before it is sent. Saving applies changes to new sessions without interrupting an ongoing response. Loaded sessions keep their current prompt; run /reload after the current turn finishes to apply changes to future requests. Sessions restored after a Runtime restart also load the latest settings. Existing chat history is preserved.",
        description: "Set the global system prompt Pi uses across all workspaces.",
        projectDescription: "Set the system prompt Pi uses in the selected project.",
        inheritedLabel: "Inherited user system prompt (read-only)",
        projectDefaultHint:
          "Leave empty and save to inherit the user prompt or Pi's built-in default. Project instructions take effect when the project is trusted.",
        useInherited: "Use inherited prompt",
        editorLabel: "Custom system prompt",
        builtinLabel: "Built-in system prompt (read-only)",
        builtinUnavailable:
          "The built-in prompt preview is unavailable from this Runtime. Restart with the updated Runtime to view it.",
        exitEditor: "Press Escape to leave the system prompt editor.",
        saveShortcut: "Save system prompt (Ctrl or Command + S)",
        preview: "Preview Markdown",
        placeholder: "Enter a custom system prompt…",
        defaultHint:
          "Leave this empty and save to use Pi's built-in default. A project-level .pi/SYSTEM.md can override this global value; AGENTS.md, skills, and working-directory context are still added by the runtime.",
        useDefault: "Use default prompt",
      },
      placeholders: {
        title: "Dynamic placeholders",
        copy: ({ placeholder }: { placeholder: string }) => `Copy ${placeholder}`,
        copied: ({ placeholder }: { placeholder: string }) => `Copied ${placeholder}`,
        copyFailed: ({ placeholder }: { placeholder: string }) => `Couldn't copy ${placeholder}`,
        description:
          "Use these placeholders in the system prompt or append prompt. Workbench expands them from the active session; saved files and previews keep the original placeholders. Unknown placeholders stay unchanged.",
        cwd: "The session's working directory.",
        terminal_environment:
          "The runtime operating system and Shell used by the current agent terminal.",
        tools: "A Markdown list of active tools and their descriptions, including extension tools.",
        tool_guidelines: "A Markdown list of guidelines for the active tools.",
        readme: "The absolute path to Pi's README.md.",
        docs: "The absolute path to Pi's documentation directory.",
        examples: "The absolute path to Pi's examples directory.",
        automaticContext:
          "Pi already appends project instructions, available skills, and the working directory to custom prompts. These do not need placeholders. Placeholders are a Workbench feature; standalone Pi does not expand them.",
      },
      appendSystemPrompt: {
        title: "Append system prompt",
        tabLabel: "Additional instructions",
        sectionTitle: "Additional instructions",
        description: "Add global instructions after Pi's default or custom system prompt.",
        projectDescription: "Add instructions after the system prompt in the selected project.",
        inheritedLabel: "Inherited user additional instructions (read-only)",
        projectDefaultHint:
          "Leave empty and save to inherit user additional instructions. Project instructions take effect when the project is trusted.",
        useInherited: "Use inherited instructions",
        editorLabel: "Additional instructions",
        exitEditor: "Press Escape to leave the append system prompt editor.",
        saveShortcut: "Save append system prompt (Ctrl or Command + S)",
        preview: "Preview Markdown",
        placeholder: "Enter instructions to append to the system prompt…",
        defaultHint:
          "Leave this empty and save to remove the global addition. A trusted project's .pi/APPEND_SYSTEM.md can override this global value.",
        clear: "Clear additional instructions",
      },
      context: {
        title: "Context",
        description: "Set the default compaction behavior inherited by sessions.",
        loading: "Loading context settings…",
        modelWindowTitle: "Model context window",
        modelWindowDescription:
          "Set the local context-capacity metadata Pi uses for token accounting and compaction. It is not sent to the model API as max_tokens; maximum output tokens are configured separately.",
        modelWindowLoading: "Loading the default model…",
        modelWindowUnavailable: "The default model or its context window could not be loaded.",
        modelWindowSaveFailed: "The model context window could not be saved. Try again.",
        modelWindowSize: "Context window size",
        modelWindowTarget: ({ provider, model }: { provider: string; model: string }) =>
          `Default model: ${model} (${provider})`,
        compactionTitle: "Context compaction",
        compactionDescription:
          "Keep long-running sessions within the model's context window while preserving recent work.",
        autoCompaction: "Automatic compaction",
        autoCompactionDescription:
          "Compact automatically before the model runs out of usable context.",
        reserveTokens: "Response reserve",
        reserveTokensDescription:
          "Start automatic compaction when context usage reaches the model window minus this amount.",
        keepRecentTokens: "Recent context to keep",
        keepRecentTokensDescription:
          "The amount of recent context Pi tries to preserve unchanged during compaction.",
        tokens: "tokens",
        invalidTokens: "Enter whole numbers between 1 and 10,000,000.",
        restoreDefaults: "Restore defaults",
      },
    },
    settings: {
      configurationFiles: "Settings files",
      piConfigurationFile: "Pi built-in settings",
      workbenchConfigurationFile: "Workbench settings",
      openingConfigurationFile: "Opening…",
      openConfigurationFileFailed: "The configuration file could not be opened.",
    },
  },
};
