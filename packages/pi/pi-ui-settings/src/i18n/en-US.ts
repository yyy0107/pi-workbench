import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  extensions: {
    modelConfig: {
      reasoningOff: "Off",
      editModel: ({ name }: { name: string }) => `Edit ${name}`,
      autoSavePending: "Changes not yet saved",
      manualModel: "Add manually",
      searchModels: "Search model ID…",
      noMatchingModels: "No matching models.",
      newModel: "New model",
      contextSummary: ({ capacity }: { capacity: string }) => `Context ${capacity}`,

      authenticationRequired: "Authentication required",
      providerActions: "Provider actions",
      discardTitle: "Discard unsaved changes?",
      discardDescription: "Continuing will discard changes to the current provider.",
      keepEditing: "Keep editing",
      discard: "Discard changes",

      title: "Model",
      description: "Use Pi account sign-ins, API keys, and custom provider connections.",
      loading: "Loading model configurations…",
      loadFailed: "Could not load model configurations.",
      retry: "Retry",
      empty: "No model providers are configured yet.",
      configured: "Configured",
      accountConfigured: "Account signed in",
      edit: "Edit",
      remove: "Remove",
      removing: "Removing…",
      delete: "Delete",
      deleting: "Deleting…",
      provider: "Provider",
      selectProvider: "Select a provider",
      addProvider: "Add provider",
      addCustomProvider: "Add custom provider",
      customProviderTitle: "Custom provider",
      providerId: "Provider ID",
      providerIdPlaceholder: "acme-gateway",
      providerIdDescription:
        "A lowercase identifier that uniquely identifies this provider in requests and derives its credential name.",
      providerName: "Display name",
      providerNamePlaceholder: "Display name",
      apiProtocol: "API protocol",
      authenticationMethod: "Authentication method",
      apiKey: "API key",
      openApiKeyPage: ({ provider }: { provider: string }) => `Get a ${provider} API key`,
      apiKeyPlaceholder: "Enter an API key, or leave blank to use environment authentication",
      apiKeyEditPlaceholder: "Leave blank to keep the current key",
      environmentOnly: "This provider uses environment authentication",
      accountLogin: "Account login",
      accountLoginDescription: ({ provider }: { provider: string }) =>
        `Continue with ${provider}'s account authentication in your browser. Workbench follows the login steps supplied by Pi and the provider.`,
      signInWithAccount: "Sign in with account",
      signInAgain: "Sign in again",
      startingLogin: "Starting sign-in…",
      accountLoginTitle: ({ provider }: { provider: string }) => `Sign in to ${provider}`,
      accountLoginDialogDescription:
        "Follow the provider's instructions below. Credentials are stored by Pi, not in these settings.",
      openLoginPage: "Open login page",
      deviceCode: "Device code",
      openVerificationPage: "Open verification page",
      preparingLogin: "Preparing the provider's sign-in steps…",
      continueLogin: "Continue",
      continuingLogin: "Continuing…",
      cancelLogin: "Cancel sign-in",
      closeLogin: "Close account sign-in",
      loginComplete: "Account sign-in is complete. This provider is ready to use.",
      done: "Done",
      customSettings: "Custom settings",
      loadingDetails: "Loading provider settings…",
      apiAddress: "API address",
      apiAddressPlaceholder: "https://gateway.example/v1",
      modelCatalog: "Model catalog",
      customizeModels: "Customize models",
      fetchingAvailableModels: "Getting available models…",
      fetchLatestProviderModels: "Fetch latest from provider",
      fetchingLatestProviderModels: "Fetching latest…",
      restoreDefaultModels: "Restore default models",
      selectModelsTitle: "Choose models to add",
      selectModelsDescription: "Select the models to add from those available from this provider.",
      closeModelPicker: "Close model picker",
      availableModelsEmpty: "This provider did not return any available models.",
      addSelectedModels: "Add selected",
      modelId: "Model ID",
      selectAvailableModel: "Select an available model",
      modelName: "Display name",
      contextWindow: "Context window",
      maxOutputTokens: "Maximum output tokens",
      maxOutputTokensUnset: "Not set",
      editMaxOutputTokens: "Edit maximum output tokens",
      modelType: "Model type",
      thinkingModel: "Supports reasoning",
      reasoningLevels: "Reasoning effort",
      reasoningLevelsSelected: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} selected`,
      reasoningLevelsDisabled: "Enable reasoning first",
      reasoningLevelMinimal: "Minimal",
      reasoningLevelLow: "Low",
      reasoningLevelMedium: "Medium",
      reasoningLevelHigh: "High",
      reasoningLevelXhigh: "Extra high",
      reasoningLevelMax: "Maximum",
      multimodalSupport: "Multimodal support",
      multimodalSupported: "Supported",
      multimodalUnsupported: "Not supported",
      testMultimodal: ({ name }: { name: string }) =>
        `Test image input for ${name || "this model"}`,
      testMultimodalShort: "Test",
      testingMultimodal: "Testing…",
      multimodalTestHint:
        "Tests the API with a demo image; checks text separately only if images are rejected. Uses the saved configuration and may incur a small charge.",
      multimodalMetadataSupported: "Provider model metadata confirms image input support.",
      multimodalMetadataUnsupported:
        "Provider model metadata confirms image input is not supported.",
      multimodalTestSupported: "Image input verified.",
      multimodalTestUnsupported: "The provider explicitly rejected image input.",
      multimodalTestSaveFirst:
        "This model is not in the saved runtime configuration. Wait for automatic saving to finish, then test again.",
      multimodalTestRuntimeUnavailable:
        "The current model runtime cannot run an image-input capability test.",
      multimodalTestUnexpectedResponse:
        "The image request did not return a valid API completion status.",
      multimodalTestAuthentication:
        "Authentication failed. Save a valid API key or sign in to this provider, then try again.",
      multimodalTestQuotaExceeded: "The provider reports insufficient credits, balance, or quota.",
      multimodalTestRateLimited:
        "The provider rate-limited the request. Wait a moment and try again.",
      multimodalTestTimeout:
        "The image test timed out before the model returned a result. Try again.",
      multimodalTestNetwork:
        "The image test could not connect to the provider. Check the API address and network.",
      multimodalTestProviderUnavailable:
        "The provider is temporarily unavailable or overloaded. Try again later.",
      multimodalTestProtocolMismatch:
        "The provider does not recognize the standard image request fields for the selected protocol. Choose the API protocol that matches this endpoint.",
      multimodalTestModelUnavailable:
        "The provider could not find or route this model ID. Refresh the model list or check the model ID.",
      multimodalTestInvalidImage: "The provider could not decode the built-in JPEG test image.",
      multimodalTestSafety: "The provider blocked the image test with a safety or content filter.",
      multimodalTestProviderError:
        "The provider rejected the image test without explicitly reporting that image input is unsupported. Check the selected protocol and model ID.",
      multimodalTestInconclusive:
        "The test could not confirm image support. Check authentication, network access, or rate limits and try again.",
      multimodalTestServiceUnavailable:
        "The image-input test could not reach the local model service.",
      modelTypeMultimodal: "Multimodal",
      modelTypeText: "Text",
      modelTypeUnknown: "Unknown",
      expandModel: ({ name }: { name: string }) => `Expand ${name || "model"}`,
      collapseModel: ({ name }: { name: string }) => `Collapse ${name || "model"}`,
      removeModel: ({ name }: { name: string }) => `Remove ${name || "model"}`,
      addModel: "Add model",
      modelIdRequired: ({ index }: { index: number }) => `Model ${index}: Model ID is required.`,
      cancel: "Cancel",
      testProvider: "Test",
      textConnectionFailed:
        "Text connection test failed. Check the model, authentication, and network, then try again.",
      connectionSucceeded: "Connection successful",
      connectionSucceededWithImages: "Connection successful (supports images)",
      testingProvider: "Testing…",
      testAccountProviderHint:
        "This test reuses the signed-in account to refresh and verify the runtime model catalog. It does not require an API key or send an inference request.",
      testProviderHint:
        "The provider test below checks the API key and configured model IDs without sending an inference request.",
      testAccountProviderSucceeded: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `Account sign-in is valid · all ${number(count)} configured ${count === 1 ? "model is" : "models are"} available.`,
      testProviderSucceeded: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `API key is valid · all ${number(count)} configured ${count === 1 ? "model is" : "models are"} available.`,
      testAccountProviderNoConfiguredModels:
        "The account sign-in is valid, but there are no model IDs to verify.",
      testProviderNoConfiguredModels:
        "The API key is valid, but there are no configured model IDs to verify.",
      testAccountProviderModelsUnavailable: ({ modelIds }: { modelIds: string }) =>
        `The account sign-in is valid, but these model IDs are unavailable: ${modelIds}.`,
      testProviderModelsUnavailable: ({ modelIds }: { modelIds: string }) =>
        `The API key is valid, but these configured model IDs are unavailable: ${modelIds}.`,
      save: "Save",
      createProvider: "Create provider",
      saving: "Saving…",
      errors: {
        unsupported: "This provider cannot be configured with a single API key.",
        accountLoginUnsupported: "This provider does not support account sign-in.",
        loginInProgress: "An account sign-in is already in progress for this provider.",
        loginStartFailed: "Could not start account sign-in. Try again.",
        loginStatusFailed: "Could not check the account sign-in status. Try again.",
        loginResponseFailed: "Could not continue account sign-in. Try again.",
        loginFailed: "Account sign-in did not complete. Close this window and try again.",
        loginRequired: "Sign in with an account before saving this provider.",
        readonly: "This configuration comes from outside Workbench and cannot be removed here.",
        environmentMissing:
          "No environment authentication was found for this provider. Enter an API key or configure the runtime environment first.",
        loadDetailsFailed: "Could not load this provider's settings.",
        fetchModelsFailed: "Could not get the available models from this provider.",
        catalogRefreshFailed:
          "Model catalog refresh failed. Showing the catalog already available in Pi.",
        fetchLatestModelsFailed:
          "Could not fetch the latest model list directly from the provider.",
        testAccountProviderAuthenticationFailed:
          "The account sign-in is no longer valid or cannot read this provider's model catalog. Sign in again and retry.",
        testAccountProviderFailed:
          "The signed-in provider could not be verified. Sign in again or try later.",
        testProviderAuthenticationFailed:
          "The API key is invalid or does not have permission to read the provider's model list.",
        testProviderEndpointNotFound:
          "The model-list endpoint was not found. Check the API address and version path.",
        testProviderFailed:
          "API key validation failed. Check the API address, API key, and protocol, then try again.",
        testProviderHttpFailed: ({ status }: { status: number }) =>
          `The provider rejected the model-list request with HTTP ${status}.`,
        testProviderInvalidApiKey:
          "The API key is blank or contains characters that cannot be sent in an HTTP header.",
        testProviderInvalidResponse:
          "The provider returned an invalid model list. Check that the selected protocol matches the API.",
        testProviderNetworkFailed:
          "The provider could not be reached. Check the API address and network connection.",
        testProviderRateLimited:
          "The provider rate-limited the test request. Wait a moment and try again.",
        testProviderRuntimeFailed:
          "The saved provider credentials or model runtime could not be loaded.",
        testProviderServiceUnavailable:
          "The local model configuration service could not be reached.",
        testProviderUnavailable:
          "The provider's model-list service is temporarily unavailable. Try again later.",
        testProviderUnsupportedProtocol:
          "The selected protocol does not provide a model-list endpoint that Workbench can test.",
        providerRequired: "Enter a provider ID.",
        invalidProviderId:
          "Provider ID must start with a lowercase letter and may only contain lowercase letters, numbers, dots, underscores, and hyphens.",
        providerExists: "A provider with this ID already exists.",
        apiAddressRequired: "Enter the provider API address.",
        modelRequired: "Add at least one model.",
        invalidModel: "Enter a model ID and valid positive capacities such as 128K or 1M.",
        duplicateModel: "Model IDs must be unique within a provider.",
        saveFailed: "Could not save the model configuration. Try again.",
      },
    },
    agentConfiguration: {
      cacheMiss: {
        title: "Cache miss notices",
        description:
          "Show significant prompt-cache misses and estimated extra costs in the message action bar. Disabled by default.",
        noticeTitle: "Prompt cache miss",
        tokens: ({ tokens }: { tokens: string }) =>
          `${tokens} previously processed tokens were not read from cache.`,
        cost: ({ cost }: { cost: string }) => `Estimated extra cost: ${cost}`,
        costUnavailable: "Extra cost is unavailable or no price difference was reported.",
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
