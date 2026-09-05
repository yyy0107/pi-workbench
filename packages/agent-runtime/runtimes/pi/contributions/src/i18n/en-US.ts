import type { MessageFormatters } from "@workbench/shell/i18n";

const piExtensionGuide = `
## Pi extension reference

Pi extensions are TypeScript modules loaded by the coding-agent runtime. A factory receives ExtensionAPI (usually named pi) and registers behavior. Hooks subscribe to events, tools expose structured actions to the model, and commands expose user actions such as /extension-status. A Skill is a SKILL.md instruction package loaded on demand; a prompt template is reusable Markdown with arguments. Use the mechanism that owns the requested behavior, and combine them only when needed.

### Read the installed SDK first

Resolve the actual coding-agent package and version from this project. This Workbench uses @earendil-works/pi-coding-agent; do not substitute another distribution's API. Read docs/extensions.md and examples/extensions/ in the resolved package, plus docs/skills.md, docs/prompt-templates.md, or docs/packages.md for the resources involved. Check dist/index.d.ts and the event/tool declarations for signatures. Declaration files under dist/core/ are inspection material, not supported deep-import paths. If local documentation is missing, locate documentation matching the installed version and state any uncertainty.

### Minimal extension entry

The following illustrates the factory and event registration; replace the example behavior with the requested feature:

\`\`\`ts
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

const extension: ExtensionFactory = (pi) => {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.notify("Extension ready", "info");
  });
};

export default extension;
\`\`\`

### API and lifecycle map

- pi.on(event, handler): observe or transform the lifecycle. Use session_start/session_shutdown for resources, before_agent_start for run instructions, input for user input, tool_call for execution checks, and tool_result for results. agent_end ends one run; agent_settled waits until automatic retries, compaction, and follow-ups have finished. Return only the result allowed by that event; for example, tool_call can return { block: true, reason: "..." }. An observer normally returns nothing.
- pi.registerTool(definition): register a model-callable tool with name, label, description, parameters, and execute. The installed SDK uses Type from typebox for schemas and execute(toolCallId, params, signal, onUpdate, ctx). Honor cancellation and return content with text/image blocks and any necessary structured details; onUpdate reports optional progress. Verify these fields against the installed version before implementing.
- pi.registerCommand(name, { description, handler }): register /name for the user; handler receives args and an extension command context. It is separate from a model-callable tool and a Markdown prompt template.
- pi.appendEntry(customType, data): persist extension state in session history when required. Use ctx.sessionManager to restore state with the session/branch lifecycle. Do not share mutable session data globally.
- Check ctx.mode and ctx.hasUI before UI interactions. Keep initialization finite; create long-lived resources only when needed and dispose them idempotently on session shutdown.

### Files, loading, and Workbench integration

Default user extensions live in ~/.pi/agent/extensions/*.ts or */index.ts; project extensions live in .pi/extensions/*.ts or */index.ts. Respect configured resource paths and project trust. In the Pi CLI, pi -e ./my-extension.ts loads an extension for a quick check; /reload reloads auto-discovered extensions. In Workbench, follow its existing resource loading/reload path.

Skills usually live in ~/.pi/agent/skills/<name>/SKILL.md or .pi/skills/<name>/SKILL.md; configured .agents/skills directories are also supported. Include name and description frontmatter, then the workflow; use /skill:name when skill commands are enabled. Standalone prompt templates live in the configured prompts directory and are invoked by their template name. The /prompts-name commands on this Workbench page are built-in Composer commands, not a new Pi SDK API or directory convention.

For this repository, read packages/agent-runtime/runtimes/pi/README.md. Host-owned runtime extensions use server/src/internal-extensions/ and its existing InlineExtension registration; DefaultResourceLoader and resourceLoaderOptions.extensionFactories own loading. Browser components belong under contributions/ and use @workbench/extension-sdk plus existing RPC capabilities. Pi TUI renderers do not create Workbench React components. Reuse the existing session and event transport.

In the result, explain what the extension does, its entry point, the selected events/tools/commands and their inputs/outputs, installation and activation or reload steps, and one concrete usage example. Include limitations and verification results.
`;

export const piExtensionsEnUS = {
  extensions: {
    externalSessionImport: {
      title: "Import",
      description:
        "Bring local Codex, Claude Code, and Cursor conversations into Pi as native sessions. Source files remain unchanged; system prompts, credentials, encrypted state, and application-only metadata are not copied.",
      refresh: "Scan again",
      selectAll: "Select all available",
      clearSelection: "Clear selection",
      selectedCount: ({ count }: { count: string }) => `${count} selected`,
      importSelected: "Import selected",
      importing: "Importing…",
      empty: "No supported local Codex, Claude Code, or Cursor conversations were found.",
      noSessions: "No conversations were found for this source.",
      selectSession: ({ title }: { title: string }) => `Select ${title} for import`,
      messageCount: ({ count }: { count: string }) => `${count} records`,
      result: ({ imported, skipped }: { imported: string; skipped: string }) =>
        `Imported ${imported}; skipped ${skipped}.`,
      sources: {
        codex: "Codex",
        "claude-code": "Claude Code",
        cursor: "Cursor",
      },
      sourceStatus: {
        ready: "Ready",
        "not-found": "Not installed or no local data",
        error: "This source could not be read",
      },
      states: {
        ready: "Ready",
        imported: "Already imported",
        subagent: "Subagent",
        unknownProject: "Unknown project",
      },
      issues: {
        "source-unavailable": "Source unavailable",
        "source-unreadable": "Source unreadable",
        "workspace-missing": "Project folder no longer exists",
        "workspace-not-directory": "Project path is not a folder",
        "conversation-empty": "No complete conversation",
        "conversation-unsupported": "Unsupported conversation format",
      },
      errors: {
        requestFailed: "The scan or import could not be completed. Try again.",
      },
    },
    agentConfiguration: {
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
        title: "System prompt",
        tabLabel: "SYSTEM",
        sectionTitle: "Base prompt",
        pageDescription:
          "Shape your agent's behavior with a base prompt and additional instructions.",
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
        description:
          "Use these placeholders in the system prompt or append prompt. Workbench expands them from the active session; saved files and previews keep the original placeholders. Unknown placeholders stay unchanged.",
        cwd: "The session's working directory.",
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
    connectionStatus: {
      loading: "Loading",
      streaming: "Streaming",
      ready: "Ready",
      accessibleLabel: ({ status }: { status: string }) => `Assistant runtime: ${status}`,
      description: "Derived from the local assistant runtime",
      piVersionDescription: ({ version }: { version: string }) => `Pi version ${version}`,
      piVersionLoading: "Loading the Pi version",
    },
    modelConfig: {
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
      apiKeyEditPlaceholder:
        "Enter a new API key, or leave blank to keep the current configuration",
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
      adapterDefaultModels: "Using the adapter's default models",
      customModels: "Custom model catalog",
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
      thinkingModel: "Thinking model",
      reasoningLevels: "Reasoning levels",
      reasoningLevelsSelected: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} levels enabled`,
      reasoningLevelsDisabled: "Enable thinking model first",
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
        "Checks provider model metadata first. Only when metadata is unknown does it send a small image using the saved configuration, which may incur a small charge.",
      multimodalMetadataSupported:
        "Provider model metadata confirms image input support. Save to keep this result.",
      multimodalMetadataUnsupported:
        "Provider model metadata confirms image input is not supported. Save to keep this result.",
      multimodalTestSupported: "Image input verified. Save to keep this result.",
      multimodalTestUnsupported:
        "The provider explicitly rejected image input. Save to keep this result.",
      multimodalTestSaveFirst:
        "This model is not in the saved runtime configuration. Save it, reopen the provider, and test again.",
      multimodalTestRuntimeUnavailable:
        "The current model runtime cannot run an image-input capability test.",
      multimodalTestUnexpectedResponse:
        "The model responded but did not read the test image reliably. The current setting was not changed.",
      multimodalTestAuthentication:
        "Authentication failed. Save a valid API key or sign in to this provider, then try again; the current setting was not changed.",
      multimodalTestQuotaExceeded:
        "The provider reports insufficient credits, balance, or quota. The current setting was not changed.",
      multimodalTestRateLimited:
        "The provider rate-limited the image test. Wait a moment and try again; the current setting was not changed.",
      multimodalTestTimeout:
        "The image test timed out before the model returned a result. Try again; the current setting was not changed.",
      multimodalTestNetwork:
        "The image test could not connect to the provider. Check the API address and network; the current setting was not changed.",
      multimodalTestProviderUnavailable:
        "The provider is temporarily unavailable or overloaded. Try again later; the current setting was not changed.",
      multimodalTestProtocolMismatch:
        "The provider does not recognize the standard image request fields for the selected protocol. Choose the API protocol that matches this endpoint; the current setting was not changed.",
      multimodalTestModelUnavailable:
        "The provider could not find or route this model ID. Refresh the model list or check the model ID; the current setting was not changed.",
      multimodalTestInvalidImage:
        "The provider could not decode the built-in RGB PNG test image. The current setting was not changed.",
      multimodalTestSafety:
        "The provider blocked the image test with a safety or content filter. The current setting was not changed.",
      multimodalTestProviderError:
        "The provider rejected the image test without explicitly reporting that image input is unsupported. Check the selected protocol and model ID; the current setting was not changed.",
      multimodalTestInconclusive:
        "The test could not confirm image support. Check authentication, network access, or rate limits and try again; the current setting was not changed.",
      multimodalTestServiceUnavailable:
        "The image-input test could not reach the local model service. The current setting was not changed.",
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
    toolbox: {
      title: "Toolbox",
      back: "Back to Toolbox",
      pinned: "Pinned",
      noPinned: "Pin a capability from a list or its details to keep it here.",
      capabilities: "Capabilities",
      manage: "Manage",
      searchResults: "Search results",
      projectTag: ({ project }: { project: string }) => `Project: ${project}`,
      expandCategory: ({ name }: { name: string }) => `Expand ${name}`,
      collapseCategory: ({ name }: { name: string }) => `Collapse ${name}`,
      noMatches: "No capabilities match this search.",
      noSession: "No Pi capabilities are available yet.",
      scopeUnavailable: "This resource scope does not have an available Pi catalog yet.",
      sessionUnavailable: "A Pi catalog source is no longer available.",
      loadFailed: "The capability catalog could not be loaded from Pi.",
      unavailable: "The current host does not expose this information.",
      managementUnavailable:
        "Installing, updating, and removing capabilities is not supported by the current Pi host.",
      currentSession: "Current Pi session",
      scope: {
        title: "Scope",
        label: "Scope:",
        select: "Select Toolbox resource scope",
        clear: "Clear resource scope",
        selecting: "Selecting resource scope…",
        selectError: "Could not select resource scope",
        search: "Search resource scopes",
        searchPlaceholder: "Search user or project scopes",
        noSearchResults: "No matching resource scopes",
        personal: "Personal",
        user: "User",
        userDescription: "Resources configured for your Pi user environment.",
        projects: "Projects",
        noProjects: "No imported projects",
        unavailableProject: "Unavailable project",
      },
      sidebar: {
        search: "Search Toolbox",
        searchPlaceholder: "Search skills, Pi extensions, prompts, and packages",
      },
      main: {
        searchIn: ({ name }: { name: string }) => `Search ${name}`,
        backToList: ({ name }: { name: string }) => `Back to ${name}`,
        refresh: "Refresh list",
        loading: "Loading resources…",
        descriptions: {
          packages: "Discover skills, extensions, prompts, and themes for your agent.",
          skills: "Extend your agent with task-specific skills.",
          extensions: "Manage the tools, commands, and events added by Pi extensions.",
          prompts: "Keep reusable prompts ready for your next task.",
          installed: "Manage the Pi packages installed in this scope.",
        },
        search: "Search capabilities",
        searchPlaceholder: "Search skills, Pi extensions, prompts, and packages",
        selectCapability: "Select a capability",
        selectCapabilityDescription:
          "Choose an item from the list to inspect its details in this workspace.",
        resultsCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
          count === 1 ? "1 result" : `${number(count)} results`,
      },
      openDetails: ({ name }: { name: string }) => `Open details for ${name}`,
      pin: "Pin capability",
      unpin: "Unpin capability",
      addCapability: "Add capability",
      openSettings: "Open settings",
      browseMarketplace: "Browse marketplace",
      browsePiPackages: "Browse Pi packages",
      updates: "Updates",
      installLocal: "Install from local source",
      installedCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} installed`,
      loadedCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} loaded`,
      capabilityKinds: {
        skill: "Skill",
        extension: "Pi extension",
        prompt: "Prompt template",
        package: "Pi package",
      },
      status: {
        available: "Available",
        loaded: "Loaded",
        modelInvocable: "Model access",
        manualOnly: "Manual only",
        installed: "Installed",
        uninstalled: "Uninstalled",
        updateAvailable: "Update available",
        officialCatalog: "Official catalog",
      },
      scopes: {
        user: "User",
        project: "Workspace",
        temporary: "Temporary",
      },
      origins: {
        builtin: "Built-in Workbench extension",
        package: "Package",
        "top-level": "Local extension",
      },
      skills: {
        title: "Skills",
        currentSession: "Current session",
        empty: "No skills are available.",
        browse: "Browse skills",
        browseUnavailable:
          "The current Pi protocol can list loaded skills, but it cannot browse or install skills yet.",
        groupingUnavailable:
          "Pi does not expose each skill's source or scope, so Built-in, User, and Workspace grouping is unavailable.",
        enabledStatus: "Enabled",
        disabledStatus: "Disabled",
        enableSkill: ({ name }: { name: string }) => `Enable ${name}`,
        disableSkill: ({ name }: { name: string }) => `Disable ${name}`,
        openFolder: ({ name }: { name: string }) =>
          `Open the ${name} folder in the right workspace`,
        deleteSkill: ({ name }: { name: string }) => `Delete ${name}`,
        deleteUnavailable: ({ name }: { name: string }) =>
          `${name} cannot be deleted here because of its source`,
        actionFailed: "This skill could not be changed. Try again.",
        deleteTitle: "Delete skill?",
        deletePackageDescription: ({ source }: { source: string }) =>
          `This skill is provided by ${source}. Continuing will uninstall the entire Pi package and remove its other capabilities too.`,
        deleteIndependentDescription: ({ name, path }: { name: string; path: string }) =>
          `This will permanently delete the ${name} directory at ${path}. This action cannot be undone.`,
        cancelDelete: "Cancel",
        confirmDelete: "Delete",
        deleting: "Deleting…",
        deleteFailed: "Deletion failed. Check the source or directory permissions and try again.",
        removed: "The skill was deleted.",
        packageRemoved:
          "The Pi package was uninstalled and its capabilities were removed from the sessions.",
      },
      extensions: {
        title: "Pi Extensions",
        browse: "Browse Pi extensions",
        loaded: "Loaded",
        empty: "Pi did not load any visible extensions.",
        disabled: "Disabled",
        updates: "Updates available",
        stateUnavailable: "Disabled extensions remain available here so they can be enabled again.",
        updatesUnavailable: "Extension versions and available updates are not exposed by Pi.",
        enabledStatus: "Enabled",
        disabledStatus: "Disabled",
        enableExtension: ({ name }: { name: string }) => `Enable ${name}`,
        disableExtension: ({ name }: { name: string }) => `Disable ${name}`,
        openFolder: ({ name }: { name: string }) => `Open the ${name} folder`,
        openFolderFailed: "The extension folder could not be opened.",
        deleteExtension: ({ name }: { name: string }) => `Delete ${name}`,
        deleteUnavailable: ({ name }: { name: string }) =>
          `${name} cannot be deleted here because of its source`,
        actionFailed: "This extension could not be changed. Try again.",
        deleteTitle: "Delete Pi extension?",
        deletePackageDescription: ({ source }: { source: string }) =>
          `This extension is provided by ${source}. Continuing will uninstall the entire Pi package and remove its other capabilities too.`,
        deleteIndependentDescription: ({ name, path }: { name: string; path: string }) =>
          `This will permanently delete the independently installed ${name} extension at ${path}. This action cannot be undone.`,
        cancelDelete: "Cancel",
        confirmDelete: "Delete",
        deleting: "Deleting…",
        deleteFailed:
          "Deletion failed. Check the extension source or directory permissions and try again.",
        removed: "The Pi extension was deleted.",
        packageRemoved:
          "The Pi package was uninstalled and its capabilities were removed from the sessions.",
        capabilitySummary: (
          { events, tools, commands }: { events: number; tools: number; commands: number },
          { number }: MessageFormatters,
        ) =>
          `${number(events)} ${events === 1 ? "event" : "events"} · ${number(tools)} ${tools === 1 ? "tool" : "tools"} · ${number(commands)} ${commands === 1 ? "command" : "commands"}`,
        loadErrors: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `${number(count)} ${count === 1 ? "extension failed" : "extensions failed"} to load`,
      },
      prompts: {
        builtinTitle: "Built-in templates",
        builtinDescription:
          "Use a template as a /prompts-name command, or create a copy to edit and save in the selected scope.",
        savedTitle: "Saved templates",
        createFromBuiltin: ({ name }: { name: string }) => `Create from ${name}`,
        savedCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
          count === 1 ? "1 saved template" : `${number(count)} saved templates`,
        builtins: {
          "pi-extension": {
            title: "Create a Pi extension",
            description:
              "Combine hooks, tools, commands, and supporting resources for a Pi extension.",
            content:
              '---\ndescription: "Combine hooks, tools, commands, and supporting resources for a Pi extension."\nargument-hint: "[extension requirements, triggers, and installation scope]"\n---\nCreate a Pi extension for: ${ARGUMENTS:-the Pi extension requirements described in this conversation}.\n\nRead applicable AGENTS.md files, identify the installed Pi coding-agent package and version, and inspect its public types, bundled documentation, existing extensions, and registration entry points. Reuse existing capabilities; do not invent APIs from memory. If the goal is still unclear, ask only about the intended behavior and trigger.\n\nChoose only the hooks, model-callable tools, or user commands the feature needs. Implement with the existing SDK extension factory and public exports, following project types, configuration, and error handling. User extensions belong in the configured user or project extension directory; Workbench built-ins belong in the existing server extension directory and stable registration list. Follow repository conventions when scope is unspecified and report the chosen location.\n\nKeep factory initialization finite. Start long-lived resources only when a session or operation needs them, and clean them up idempotently at session shutdown. Handle asynchronous failures, cancellation, and concurrency. Use existing credential configuration or environment variables, never hardcoded secrets.\n\nAdd a supporting Skill or prompt template only if needed, using Pi resource discovery. Workbench UI uses its extension platform and existing RPC boundary; Pi TUI renderers are not web components. Do not create another session or event stream.\n\nRun the smallest meaningful checks for actual triggers, important failures, and cleanup. Report files, installation or activation steps, a usage example, results, and unverified behavior. Do not commit, push, or publish unless requested.\n' +
              piExtensionGuide,
          },
          "pi-hook": {
            title: "Create a Pi hook",
            description:
              "Choose lifecycle events and handle return values, session state, and cleanup.",
            content:
              '---\ndescription: "Choose lifecycle events and handle return values, session state, and cleanup."\nargument-hint: "[trigger, intended behavior, and data to observe or modify]"\n---\nCreate a Pi hook for: ${ARGUMENTS:-the hook behavior described in this conversation}.\n\nRead applicable AGENTS.md files, related extensions, and the installed SDK event types and documentation. Determine whether the hook observes, transforms, or blocks behavior. Trace event ordering and choose the narrowest event; a message ending does not mean the entire run has finished.\n\nCandidates to verify include session_start/session_shutdown for session resources, before_agent_start for run prompts, input for user input, tool_call for execution checks, tool_result for results, and agent_settled for a fully finished run. Use only events supported by the installed version, with their exact allowed return values and execution semantics.\n\nPrefer adding the hook to its owning extension using pi.on. Preserve earlier handlers\' valid results and unrelated context. Avoid duplicate injection and recursive triggers; keep state isolated between sessions. Handle failures, repeated events, and reloads, and make cleanup idempotent. Check mode and UI availability before interactions and preserve the host\'s trust and confirmation mechanisms.\n\nUse existing test tools to simulate matching and nonmatching events plus relevant failure or cleanup cases, without real model requests. Report the event choice, trigger conditions, return behavior, files, and validation results. Do not commit or push unless requested.\n' +
              piExtensionGuide,
          },
          "pi-tool": {
            title: "Create a Pi tool",
            description:
              "Define tool inputs and implement execution, cancellation, errors, and output.",
            content:
              '---\ndescription: "Define tool inputs and implement execution, cancellation, errors, and output."\nargument-hint: "[tool purpose, inputs, outputs, and allowed side effects]"\n---\nCreate a model-callable Pi tool for: ${ARGUMENTS:-the tool requirements described in this conversation}.\n\nRead applicable AGENTS.md files, existing tools and callers, and the installed SDK\'s public tool types, schema library, and examples. Confirm a model tool is needed and reuse existing tools or services where possible.\n\nUse pi.registerTool for an extension-owned tool, or the host\'s existing standalone injection mechanism when appropriate. Choose a stable, unique name and an accurate description explaining when to call it, required inputs, output, and side effects. Cover required fields, valid ranges, and length limits in the schema. Validate untrusted paths and external responses at execution boundaries too.\n\nFollow the installed execute signature and honor cancellation, timeouts, and call context. Prefer existing SDKs, standard libraries, and argument arrays over shell string concatenation. Preserve existing credentials, permissions, and confirmation mechanisms; never hardcode secrets. Distinguish invalid input, execution failure, and empty results. Use SDK truncation support for large output and send progress only when useful.\n\nReturn SDK-compliant content and necessary structured data. Add Workbench tool rendering only when the product needs it, keeping execution on the server.\n\nTest success, invalid input, and important failure or cancellation paths with existing test tools. Do not access real paid services or sensitive user data. Report a call example, input/output contract, files, and validation results. Do not commit, push, or publish unless requested.\n' +
              piExtensionGuide,
          },
          "pi-skill": {
            title: "Create a Pi Skill",
            description:
              "Write a focused Skill with clear triggers, workflows, and supporting references.",
            content:
              '---\ndescription: "Write a focused Skill with clear triggers, workflows, and supporting references."\nargument-hint: "[skill goal, use cases, inputs, outputs, and installation scope]"\n---\nCreate a Skill that Pi can discover and use for: ${ARGUMENTS:-the skill requirements described in this conversation}.\n\nRead applicable AGENTS.md files, similar Skills, and the installed Pi skill documentation. Prefer extending an existing Skill. Express task guidance as a Skill; add a tool or extension only when deterministic execution or lifecycle events are required.\n\nCreate a clearly named directory and SKILL.md in a configured skill location. Follow repository conventions if scope is unspecified and report the location. Include a valid name and specific description in frontmatter. Explain what the Skill does, when it applies, and its boundaries without matching every task. Follow current naming and length rules and avoid name collisions.\n\nWrite the goal, inputs, outputs, prerequisites, actionable steps, validation, and failure handling, with one or two practical examples. Identify missing dependencies, credentials, or permissions explicitly. Do not pretend execution succeeded or bypass authorization. Resolve paths relative to the Skill rather than the author\'s machine.\n\nKeep SKILL.md concise. Put longer material in references with explicit reading conditions, and add scripts or assets only when needed. Reuse existing tools and standard libraries; do not create empty directories or placeholder scripts.\n\nCheck frontmatter, referenced files, and Pi discovery. Run a minimal example for any scripts. Report location, use cases, required configuration, invocation such as /skill:name, and validation results. Do not commit, push, or publish unless requested.\n' +
              piExtensionGuide,
          },
          "code-review": {
            title: "Review code",
            description: "Find evidenced bugs, regressions, and security issues in code changes.",
            content:
              '---\ndescription: "Find evidenced bugs, regressions, and security issues in code changes."\nargument-hint: "[files, directory, or review focus; defaults to uncommitted changes]"\n---\nReview: ${ARGUMENTS:-uncommitted changes in the current repository, including staged, unstaged, and relevant new files}.\n\nRead applicable AGENTS.md files, understand the change, and inspect callers and surrounding code. Focus on correctness, edge cases, error handling, data loss, and security. Report only issues with concrete triggers and impact; skip style-only advice and do not modify code.\n\nOrder findings by severity. Include file and line, trigger, impact, and the smallest suggested fix. Separate verified defects from open questions. If none are found, say so and identify what remains unverified. If there are no uncommitted changes, report that without expanding the scope.\n',
          },
          "debug-issue": {
            title: "Debug an issue",
            description: "Reproduce a problem, locate its root cause, and make the smallest fix.",
            content:
              '---\ndescription: "Reproduce a problem, locate its root cause, and make the smallest fix."\nargument-hint: "[symptoms, reproduction steps, or logs; defaults to the current issue]"\n---\nInvestigate and fix: ${ARGUMENTS:-the most recently described issue in this conversation}.\n\nRead applicable AGENTS.md files and establish actual behavior, expected behavior, and reproduction conditions. Trace related code and tests to find the root cause with evidence, including other callers of shared logic. Do the investigation possible with available information and ask only for details blocking progress.\n\nFix the root cause with the smallest change, reuse existing capabilities, and preserve unrelated edits. Choose verification proportional to risk and explain any limitations. Report the cause, changed files, checks, and remaining issues. Do not commit or push unless requested.\n',
          },
          "implement-feature": {
            title: "Implement a feature",
            description: "Reuse existing capabilities to complete a feature and its validation.",
            content:
              '---\ndescription: "Reuse existing capabilities to complete a feature and its validation."\nargument-hint: "[requirements and acceptance criteria; defaults to the current request]"\n---\nImplement: ${ARGUMENTS:-the latest unfinished feature request in this conversation}.\n\nRead applicable AGENTS.md files, establish expected behavior and acceptance criteria, and inspect existing components, services, tools, and patterns. Extend existing capabilities before adding new implementations, dependencies, or speculative abstractions. Use reasonable defaults and ask only for critical missing information that blocks implementation.\n\nComplete the user-facing flow with necessary error handling, accessibility, and project localization requirements. Preserve unrelated changes and use verification proportional to risk. Report completed behavior, validation results, and unresolved items. Do not commit, push, or deploy unless requested.\n',
          },
          "safe-refactor": {
            title: "Refactor safely",
            description: "Simplify the selected code while preserving its public behavior.",
            content:
              '---\ndescription: "Simplify the selected code while preserving its public behavior."\nargument-hint: "[file, module, or refactoring goal; defaults to the specified scope]"\n---\nRefactor: ${ARGUMENTS:-the code scope explicitly identified in this conversation}.\n\nRead applicable AGENTS.md files and understand public behavior, all callers, and existing tests. If no scope is specified, ask for a target instead of refactoring the entire repository. Prefer deleting dead or duplicated code, reusing helpers, and replacing custom machinery with standard libraries or installed dependencies.\n\nPreserve public interfaces, error semantics, and data formats. Avoid mixing in new features or unrelated formatting. Keep changes small and reviewable, run relevant existing checks, and add verification only for real risks. Report what became simpler, how behavior was checked, and what remains unverified. Do not commit or push unless requested.\n',
          },
          "write-tests": {
            title: "Add focused tests",
            description:
              "Cover real risks, edge cases, and regression scenarios with useful tests.",
            content:
              '---\ndescription: "Cover real risks, edge cases, and regression scenarios with useful tests."\nargument-hint: "[file, behavior, or regression; defaults to uncommitted behavior changes]"\n---\nAdd necessary tests for: ${ARGUMENTS:-behavior changes in the current repository\'s uncommitted edits}.\n\nRead applicable AGENTS.md files and existing tests, reusing the project\'s framework and commands. Select valuable cases around observable behavior, prioritizing real defects, edge cases, and failure paths. Do not mirror implementation details or add tests for simple copy or styling changes.\n\nKeep tests deterministic and independent of real paid services or user data. For regressions, demonstrate failure before the fix and success after it where practical. Run the smallest relevant set and report coverage, results, and remaining gaps. Explain when new tests are unnecessary. Do not commit or push unless requested.\n',
          },
        },
        viewMode: "Template view mode",
        existingDraft:
          "You have an unsent draft. Use the current draft, or finish it before switching conversations.",
        create: "New template",
        edit: "Edit template",
        copy: "Copy to my templates",
        use: "Use",
        useNow: "Use now",
        useNowNamed: ({ name }: { name: string }) => `Use now: ${name}`,
        useNamed: ({ name }: { name: string }) => `Use ${name}`,
        delete: "Delete template",
        deleteDescription: ({ name }: { name: string }) =>
          `Delete the template file for ${name}? This cannot be undone.`,
        cancel: "Cancel",
        save: "Save",
        saving: "Saving…",
        name: "Template name",
        nameHint:
          "Use letters, numbers, hyphens, underscores, or dots. This is also the /command and file name.",
        content: "Template content",
        emptyContent: "This template has no content.",
        editorHint:
          "Saved in the prompts directory of the selected scope. Optional YAML frontmatter can define description and argument-hint.",
        useExample: "Use reference template",
        example:
          '---\n# description: Explains the template\'s purpose in the template list.\ndescription: "Review code changes, identify evidence-backed issues, and suggest minimal fixes."\n# argument-hint: A hint shown in the use dialog and command menu; it does not enforce validation.\nargument-hint: "[file or directory] [review focus] [additional requirements...]"\n# Suggested template name: review, available as /review after saving.\n# Enter only the arguments in the use dialog, without /review:\n# "src/app page.tsx" "error handling" "preserve existing interfaces" "check edge cases"\n# Separate arguments with spaces and quote values containing spaces. Leave empty to use defaults.\n# $1 and $2: The first and second arguments; $ARGUMENTS or $@: All arguments.\n# ${1:-default}: Use a default when the first argument is missing.\n# ${@:3}: Arguments from the third onward; ${@:3:2}: Two arguments starting at the third.\n# This YAML configuration and its comments are excluded from the expanded prompt.\n---\nYou are a careful code reviewer. Understand the code\'s actual behavior before suggesting changes.\n\n## Review target\n- Scope: ${1:-uncommitted changes in the current project}\n- Focus: ${2:-correctness, error handling, and maintainability}\n- Additional requirements: ${@:3}\n\n## Steps\n1. Read project instructions and relevant code to understand expected behavior, callers, and constraints.\n2. Trace inputs, state changes, error paths, and boundary conditions through the call chain.\n3. Prioritize reproducible issues; explain their triggers, impact, and supporting code evidence.\n4. Suggest the smallest fix for each issue and the cheapest effective way to verify it.\n\n## Constraints\n- Report findings first. Modify files only when the user explicitly requests changes.\n- Reuse existing components, tools, and conventions; avoid unrelated refactors and new dependencies.\n- Do not guess missing context. State uncertainties and the information needed to resolve them.\n- Do not claim unrun checks passed. Say clearly when no issues were found.\n\n## Output format\n1. Conclusion: Summarize the review in one or two sentences.\n2. Findings: Order by severity; include file locations, triggers, impact, and suggested fixes.\n3. Verification: List checks actually performed, their results, and what remains unverified.',
        discardTitle: "Discard unsaved changes?",
        discardDescription: "Closing will discard your unsaved changes.",
        keepEditing: "Keep editing",
        discard: "Discard changes",
        destination: "Destination conversation",
        newConversation: "New conversation",
        currentDraft: "Current draft",
        untitledConversation: "Untitled conversation",
        selectWorkspace: "Select a project",
        searchWorkspace: "Search projects",
        noWorkspaces: "Add a project first.",
        arguments: "Template arguments",
        argumentsHint:
          "Separate arguments with spaces; quote arguments containing spaces. Leave empty to use template defaults.",
        preparing: "Preparing…",
        insert: "Insert into composer",
        useHint:
          "The expanded template is appended to the composer, preserving your draft. Review it before sending.",
        enabled: "Enable template",
        independent: "Independent template",
        packageSource: ({ source }: { source: string }) => `From ${source}`,
        untrusted: "Trust this project in project settings before managing its templates.",
        busy: "A related conversation is running. Wait for it to finish, then retry.",
        conflict:
          "The file has changed. Keep a copy of your draft, close the editor, refresh, and retry.",
        nameExists: "A template with this name already exists in this scope. Choose another name.",
        invalidContent:
          "Check the template name and YAML format. Content cannot be empty, and the file must not exceed 256 KiB.",
        readOnly: "This template is read-only. Copy it to your templates to make changes.",
        notFound: "This template is no longer available. Refresh the list.",
        disabledUse: "Enable this template before using it.",
        failed: "The operation failed. Check your connection and file permissions, then retry.",
        title: "Prompts",
        empty: "No prompt templates are available.",
      },
      plugins: {
        title: "Plugins",
        connected: "Connected",
        setupNeeded: "Setup needed",
        disabled: "Disabled",
        protocolUnavailable:
          "Plugin connections are not part of the current Workbench/Pi protocol. Accounts and connection status cannot be listed yet.",
      },
      packages: {
        title: "Pi Packages",
        installedTitle: "Installed Pi Packages",
        officialCatalog: "Official Pi catalog",
        sourceNote: "Extensions, skills, prompts, and themes from the official Pi Package Catalog.",
        catalogCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `${number(count)} packages`,
        refresh: "Refresh Pi packages",
        retry: "Retry",
        loadFailed: "The official Pi package catalog could not be loaded.",
        detailsLoadFailed: "The complete official package details could not be loaded.",
        installedDetailsLoadFailed: "The installed package snapshot could not be loaded.",
        installedDescriptionUnavailable:
          "The installed package snapshot does not provide a description.",
        empty: "No installed Pi Packages were found.",
        browseEmpty: "No Pi packages match this search and filter.",
        checkUpdates: "Check downloaded packages for updates",
        checkUpdatesAction: "Check for updates",
        updateNamed: ({ name }: { name: string }) => `Update ${name}`,
        retryUpdateNamed: ({ name }: { name: string }) => `Retry updating ${name}`,
        updated: "Updated",
        checkingUpdates: "Checking downloaded package versions…",
        updateCheckDescription:
          "Compare downloaded Pi packages with their latest npm version or Git revision.",
        updateCheckFailed:
          "Downloaded package versions could not be checked. Check your network and try again.",
        upToDate: "All downloaded Pi packages in this scope are up to date.",
        updateAvailable: "Update available",
        versionChange: ({ current, target }: { current: string; target: string }) =>
          `${current} → ${target}`,
        update: "Update",
        updating: "Updating…",
        updatingAt: ({ target }: { target: string }) => `Updating in ${target}…`,
        updateSuccess: "Updated and loaded into the affected sessions.",
        updateProjectSuccess: ({ project }: { project: string }) =>
          `Updated in ${project} and loaded into the affected project sessions.`,
        updateProjectUntrusted:
          "This workspace is not trusted, so the project-level Pi Package cannot be updated.",
        updateWorkspaceMissing: "That project is no longer imported, so it cannot be updated.",
        updateAlreadyMissing: "This Pi Package is no longer installed in that location.",
        updateSessionMissing:
          "The current session is unavailable, so the user package cannot be updated.",
        updateFailed: "Update failed. Check your network and Pi Package configuration, then retry.",
        updateTargetUnavailable:
          "The imported workspace for this project could not be determined, so it cannot be updated yet.",
        availableUpdatesCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
          count === 1 ? "1 update" : `${number(count)} updates`,
        filteredResources: "Selected resources",
        allResources: "All package resources",
        typeFilter: "Category",
        installedResourceVersion: ({ version }: { version: string }) =>
          `Resources in installed version ${version} in the current scope, including disabled items.`,
        installedResources: "Resources in the current installation, including disabled items.",
        resourcesEmpty: "No resources of this type were found in the current installation.",
        resourcesLoadFailed:
          "Could not read the installed package's resource details. Retry to load them.",
        resourceDescriptionUnavailable: "No description is provided for this resource.",
        resourceDetailsUnavailable: ({ kind }: { kind: string }) =>
          `This package declares ${kind} resources, but the market does not publish their names or descriptions. See the package documentation; details can be read locally after installation.`,
        installContents: "Installation contents",
        installContentsUnavailable:
          "Installation contents are unavailable. Retry loading the package details.",
        noBundledPrompts:
          "This package does not include prompt templates. Installing it will not add entries to the prompt template list.",
        sortLabel: "Sort",
        results: "Packages",
        pagination: "Package pages",
        previous: "Previous",
        next: "Next",
        page: ({ page, count }: { page: string; count: string }) => `${page} / ${count}`,
        unknownAuthor: "Unknown author",
        downloadsPerMonth: ({ count }: { count: string }) => `${count}/mo`,
        downloadsByPeriod: ({ monthly, weekly }: { monthly: string; weekly: string }) =>
          `${monthly}/mo · ${weekly}/wk`,
        packageName: "Package",
        author: "Author",
        installedVersion: "Installed version",
        availableVersion: "Available version",
        localRevision: "Local revision",
        remoteRevision: "Remote revision",
        license: "License",
        resourceTypes: "Includes",
        downloads: "Downloads",
        monthlyDownloads: "Monthly downloads",
        published: "Published",
        version: "Version",
        size: "Size",
        dependencies: "Dependencies",
        dependenciesSummary: (
          { dependencies, peers }: { dependencies: number; peers: number },
          { number }: MessageFormatters,
        ) =>
          `${number(dependencies)} ${dependencies === 1 ? "dependency" : "dependencies"} · ${number(peers)} ${peers === 1 ? "peer" : "peers"}`,
        manifest: "Pi manifest JSON",
        manifestShow: "View JSON",
        installQuick: "One-click install",
        install: "Install from npm",
        installNow: "Install",
        installInTerminal: "Install in right terminal",
        terminalInstallTitle: ({ name }: { name: string }) => `Install ${name}`,
        terminalInstallOpenFailed:
          "Could not open the right-side terminal. Check that Terminal is available and try again.",
        installing: "Installing…",
        installed: "Installed",
        chooseInstallLocation: "Choose install location",
        installLocation: "Install location",
        installLocationUser: "User",
        installLocationProjects: "Projects",
        installProjectsCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
          count === 1 ? "1 imported project" : `${number(count)} imported projects`,
        installChooseLocation: "Choose a user or project, then choose an install method.",
        installingAt: ({ target }: { target: string }) => `Installing to ${target}…`,
        installSuccess: "Installed and loaded into the affected sessions.",
        installProjectSuccess: ({ project }: { project: string }) =>
          `Installed in ${project} and loaded into the affected project sessions.`,
        installProjectUntrusted:
          "This workspace is not trusted, so a project-level Pi Package cannot be installed. Update the folder's project trust decision in Pi, then retry.",
        installWorkspaceMissing: "That project is no longer imported. Refresh and choose another.",
        mutationSessionBusy:
          "A related Pi session is running. Wait for it to finish, then try again.",
        installProjectsEmpty: "No projects have been imported yet.",
        installFailed:
          "Installation failed. Check your network and Pi npm configuration, then retry.",
        remove: "Uninstall",
        removing: "Uninstalling…",
        removingAt: ({ target }: { target: string }) => `Uninstalling from ${target}…`,
        removeSuccess: "Uninstalled and removed from the affected sessions.",
        removeProjectSuccess: ({ project }: { project: string }) =>
          `Uninstalled from ${project} and removed from the affected project sessions.`,
        removeProjectUntrusted:
          "This workspace is not trusted, so the project-level Pi Package cannot be uninstalled.",
        removeWorkspaceMissing: "That project is no longer imported, so it cannot be uninstalled.",
        removeAlreadyMissing: "This Pi Package is no longer installed in that location.",
        removeSessionMissing:
          "The current session is unavailable, so the user package cannot be uninstalled.",
        removeFailed: "Uninstall failed. Check the Pi Package configuration and try again.",
        removeTargetUnavailable:
          "The imported workspace for this project could not be determined, so it cannot be uninstalled yet.",
        copyCommand: "Copy command",
        copied: "Copied",
        copyFailed: "Couldn't copy command",
        openCatalog: "Open in Pi Catalog",
        repository: "Repository",
        filters: {
          all: "All packages",
          extension: "Extension-related",
          skill: "Skill-related",
          prompt: "Prompt-related",
          theme: "TUI themes",
        },
        sort: {
          downloads: "Popular",
          recent: "Recently published",
          name: "Name",
        },
        types: {
          extension: "Extension",
          skill: "Skill",
          prompt: "Prompt template",
          theme: "Theme",
          package: "Package",
        },
      },
      details: {
        information: "Information",
        overview: "Overview",
        capabilityDetails: "Capability details",
        descriptionUnavailable: "No description is exposed by the current Pi protocol.",
        modelAccess: "Invocation",
        whenToUse: "When to use",
        sourceAndScope: "Source and scope",
        source: "Source",
        scope: "Scope",
        projectScope: ({ project }: { project: string }) => `Project: ${project}`,
        origin: "Origin",
        skillSourcePackage: ({ source }: { source: string }) => `Provided by Pi Package ${source}`,
        skillSourcePackageUnknown: "Provided by a Pi Package",
        skillSourceIndependent: "Installed independently",
        invocation: "Invocation",
        arguments: "Arguments",
        resourceSelection: "Loaded resources",
        notExposed: "Not exposed by the current host",
        contributions: "Extension points",
        events: "Registered hooks / events",
        tools: "Registered tools",
        commands: "Registered commands",
        contributionDetail: "Extension point details",
        contributionName: "Name",
        eventKind: "Hook / event",
        toolKind: "Tool",
        commandKind: "Command",
        viewContributionDetail: ({ kind, name }: { kind: string; name: string }) =>
          `View details for ${kind} “${name}”`,
        closeContributionDetail: "Close details",
        registeredHandlers: "Registered handlers",
        toolLabel: "Display label",
        description: "Description",
        parameterSchema: "Parameter schema",
        argumentCompletions: "Argument completions",
        available: "Available",
        unavailable: "Unavailable",
        eventDetailLimit:
          "Pi exposes only the number of handlers this extension registers for the event; handler source is not returned.",
        toolDetailLimit: "Execution and custom rendering functions are not sent to the browser.",
        commandDetailLimit:
          "Command handlers and argument-completion implementations are not sent to the browser.",
        renderers: "Registered message renderers",
        none: "None",
        skillDocument: "SKILL.md",
        skillDocumentViewMode: "SKILL.md view mode",
        skillDocumentPreview: "Preview",
        skillDocumentSource: "View source code",
        skillDocumentLoading: "Loading SKILL.md…",
        skillDocumentLoadFailed: "This skill's SKILL.md could not be loaded.",
        skillDocumentEmpty: "This skill's SKILL.md is empty.",
        retry: "Retry",
        extensionProtocolLimit:
          "Version, permissions, changelog, panels, editors, and file types are not included in the current extension-list response; extension-point details show only safe declarative metadata, never handler or execution source.",
      },
    },
    contextTrace: {
      title: "Context Inspector",
      shortTitle: "Context",
      open: "Open context inspector",
      close: "Close context inspector",
      views: {
        duration: "Duration",
        turns: "Context",
        calls: "Calls",
      },
      contextRoles: {
        system: "SYSTEM PROMPT",
        compaction: "COMPACTION SUMMARY",
        user: "USER",
        assistant: "ASSISTANT",
        tool: "TOOL",
      },
      contextEvents: {
        skills: "SKILLS",
        toolSchema: "TOOL SCHEMA",
      },
      messagePart: {
        composeContext: "Prepare context",
        composingContext: "Preparing context",
        contextComposed: "Context ready",
        systemPromptInjected: "· System prompt added",
        toolsInjected: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `· Tools added (${number(count)})`,
        extensionsLoaded: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `· Extensions loaded (${number(count)})`,
        extensions: "Extensions",
        systemPromptSources: "System prompt sources",
        modelTools: "Tools sent to the model",
        systemPromptCharacters: "System prompt characters",
      },
      tree: {
        turn: ({ index }: { index: number }, { number }: MessageFormatters) =>
          `Turn ${number(index)}`,
        userInteraction: "User interaction",
        userMessage: "USER",
        modelStep: ({ index }: { index: number }, { number }: MessageFormatters) =>
          `MODEL STEP ${number(index)}`,
        context: "CONTEXT",
        output: "OUTPUT",
        instructions: "INSTRUCTIONS",
        system: "SYSTEM",
        piDefault: "PI BUILT-IN DEFAULT",
        skills: "SKILLS",
        contextFiles: "CONTEXT FILES",
        tools: "TOOLS",
        conversation: "CONVERSATION",
        runtime: "RUNTIME",
        attachments: "ATTACHMENTS",
        text: "TEXT",
        reasoningSummary: "REASONING SUMMARY",
        toolCall: ({ name }: { name: string }) => `TOOL CALL · ${name}`,
        toolResult: ({ name }: { name: string }) => `TOOL RESULT · ${name}`,
        arguments: "ARGUMENTS",
        execution: "EXECUTION",
        finalResponse: "FINAL RESPONSE",
        retry: "RETRY",
        compaction: "CONTEXT COMPACTION",
        compactionOverview: "BEFORE / AFTER",
        compactionSummary: "COMPACTION SUMMARY",
        compactionMessages: "MESSAGES SUMMARIZED",
        compactionTurnPrefix: "SPLIT-TURN PREFIX",
      },
      compactionReasons: {
        manual: "Manual",
        threshold: "Context threshold",
        overflow: "Overflow recovery",
      },
      contextRoleDetails: {
        user: "User messages in model context",
        assistant: "Assistant messages in model context",
        tool: "Tool calls and results in model context",
      },
      overviewLanes: {
        input: "Input",
        model: "Model",
        tool: "Tools",
        lifecycle: "Lifecycle",
      },
      timeline: {
        label: "Context timeline",
        instructions:
          "Timeline overview. Drag horizontally to focus events; double-click or press Escape to reset.",
        empty: "No timeline events",
      },
      eventCategories: {
        round: "ROUND",
        prompt: "PROMPT",
        run: "RUN",
        turn: "TURN",
        context: "CONTEXT",
        model: "MODEL",
        tool: "TOOL",
        recovery: "RECOVERY",
      },
      detailTabs: {
        summary: "Summary",
        preview: "Preview",
        raw: "Raw",
        source: "Source",
        payload: "Payload",
        result: "Result",
        schema: "Schema",
        timing: "Timing",
      },
      detailCoordinates: {
        message: "Message",
        step: ({ index }: { index: number }, { number }: MessageFormatters) =>
          `Step ${number(index)}`,
      },
      turnNumber: ({ index }: { index: number }, { number }: MessageFormatters) =>
        `Turn ${number(index)}`,
      modelContext: "Context seen by the model",
      turnTokenTotal: ({ value }: { value: string }) => `${value} tokens`,
      tokenCount: ({ value }: { value: string }) => `${value} t`,
      estimatedTokenCount: ({ value }: { value: string }) => `≈ ${value} t`,
      tokenFlow: ({ input, output }: { input: string; output: string }) => `${input} → ${output}`,
      contextWindowUsage: ({
        used,
        window,
        percent,
      }: {
        used: string;
        window: string;
        percent: string;
      }) => `${used} / ${window} · ${percent}`,
      modelStepTokenBreakdown: ({
        input,
        cached,
        uncached,
        output,
        reasoning,
        duration,
      }: {
        input: string;
        cached: string;
        uncached: string;
        output: string;
        reasoning: string;
        duration: string;
      }) =>
        `Input ${input} · cached ${cached} · uncached ${uncached} · output ${output} · reasoning ${reasoning} · duration ${duration}`,
      turnTokenBreakdown: ({
        input,
        output,
        cacheRead,
        cacheWrite,
      }: {
        input: string;
        output: string;
        cacheRead: string;
        cacheWrite: string;
      }) =>
        `Input ${input} · output ${output} · cache read ${cacheRead} · cache write ${cacheWrite}`,
      contextMessageNumber: ({ index }: { index: number }, { number }: MessageFormatters) =>
        `Message ${number(index)}`,
      compactionInsertionPosition: ({ index }: { index: number }, { number }: MessageFormatters) =>
        `Inserted as context message ${number(index)}`,
      contextContentUnavailable: "No displayable text content",
      contextMessage: "Context message",
      modelOutput: "Model output",
      loadingTreeData: "Loading captured data…",
      running: "Running…",
      completed: "Completed",
      failed: "Failed",
      expandToLoad: "Expand to load from the audit journal",
      contextCountPending: "…",
      noMessagesForRole: "There are no messages in this group.",
      noContextSnapshots: "No model context yet",
      noContextSnapshotsDescription:
        "After you send a message, the System Prompt, User, Assistant, and Tool context captured before each model call appears here.",
      requestNumber: ({ index }: { index: number }, { number }: MessageFormatters) =>
        `Request ${number(index)}`,
      round: "Round",
      closeDetail: "Close event detail",
      sourceEnvironment: "Source environment",
      sourceResources: "Context, skill, and tool sources",
      noSourceMetadataTitle: "No source metadata",
      noSourceMetadataDescription:
        "This event has no additional resource provenance. Its trace coordinates remain available in Summary.",
      persistenceUnavailable:
        "The disk audit journal is unavailable. Current events only have a bounded in-memory fallback and will not survive restart.",
      pauseFollow: "Pause live following",
      resumeFollow: "Resume live following",
      refresh: "Refresh context trace",
      loading: "Loading context trace…",
      loadMore: "Load more events",
      loadingMore: "Loading more events…",
      loadFailed: "The context trace could not be loaded.",
      retry: "Retry",
      permissionTitle: "Local access required",
      permissionDescription:
        "Detailed context can only be read from a loopback connection to the Pi host.",
      emptyTitle: "No context events yet",
      emptyDescription:
        "Send a message to inspect the final prompt, model context, provider request, and run lifecycle.",
      noMatches: "No context events match these filters.",
      search: "Search context events",
      searchPlaceholder: "Search trace…",
      resumeWithCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} new events · resume live`,
      evictionNotice: ({ count, retainedFrom }: { count: string; retainedFrom: string }) =>
        `${count} earlier events were evicted. Retained from sequence ${retainedFrom}.`,
      selectEvent: "Select a context event",
      selectEventDescription: "Choose an event in the timeline to load its captured detail.",
      loadingDetail: "Loading event detail…",
      detailFailed: "The event detail could not be loaded.",
      evictedTitle: "Event detail evicted",
      evictedDescription:
        "The timeline summary is still available, but this detail could not be found in the audit journal.",
      overview: "Overview",
      finalSystemPrompt: "Final system prompt",
      systemPromptLoading: "System prompt loading",
      systemPromptSourceContent: "Prompt content",
      piDefaultPromptDescription:
        "Pi represents its built-in default by omitting a custom system prompt. Its effective content is available in the SYSTEM node preview.",
      systemPromptSourceKinds: {
        builtin: "Pi built-in default prompt",
        replacement: "Replacement system prompt",
        append: "Appended system prompt",
        extension: "Pi extension hook",
      },
      systemPromptSourceScopes: {
        builtin: "Pi built-in",
        user: "User directory",
        project: "Project directory",
        temporary: "Temporary override",
      },
      userPrompt: "User prompt",
      userSource: "User",
      assistantMessage: "Assistant message",
      modelAndUsage: "Model and context usage",
      contextFiles: "Context files",
      skills: "Skills",
      tools: "Tools",
      toolSchemas: "Tool schemas",
      toolExecution: "Tool execution",
      toolArguments: "Tool arguments",
      toolResult: "Tool result",
      images: "Images and attachments",
      finalMessages: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `Final context · ${number(count)} messages`,
      capturedJson: "Captured JSON",
      logicalRequestNotice:
        "This is one logical provider request. Transport-level retries may occur without another trace event.",
      response: "Provider response",
      tokenUsage: "Token usage",
      contextWindowOccupancy: "Context window occupancy",
      turnMessage: "Final turn message",
      toolResults: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `Tool results · ${number(count)}`,
      retryDetail: "Retry",
      compactionDetail: "Compaction",
      compactionSummary: "Generated compaction summary",
      previousCompactionSummary: "Previous compaction summary",
      compactionInstructions: "Custom compaction instructions",
      compactionMessagesToSummarize: "Messages replaced by the summary",
      compactionTurnPrefix: "Split-turn prefix messages",
      compactionFileOperations: "File operations carried into the summary",
      compactionProviderDetails: "Compaction provider details",
      errorDetail: "Captured error",
      lifecycle: "Lifecycle",
      noAdditionalDetail: "This lifecycle boundary has no additional captured payload.",
      expandMessage: "Inspect message",
      none: "None",
      active: "Active",
      inactive: "Inactive",
      yes: "Yes",
      no: "No",
      flagTruncated: "Truncated",
      flagRedacted: "Redacted",
      truncated: ({ captured, original }: { captured: string; original: string }) =>
        `Truncated · ${captured} of ${original} bytes captured`,
      redacted: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} redacted paths`,
      relativeTime: ({ value }: { value: number }, { number }: MessageFormatters) =>
        `+${number(value)} ms`,
      duration: ({ value }: { value: number }, { number }: MessageFormatters) =>
        value < 1_000
          ? `${number(value)} ms`
          : `${number(value / 1_000, { maximumFractionDigits: 2 })} s`,
      filters: {
        all: "All",
        prompt: "Prompt",
        context: "Context",
        provider: "Provider",
        lifecycle: "Lifecycle",
        recovery: "Retry / compact",
      },
      events: {
        roundStart: "Round started",
        promptComposition: "Prompt composed",
        runStart: "Run started",
        turnStart: "Turn started",
        contextSnapshot: "Context snapshot",
        providerRequest: "Provider request",
        providerResponse: "Provider response",
        modelOutput: "Model output",
        toolExecutionStart: "Tool started",
        toolExecutionEnd: "Tool completed",
        turnEnd: "Turn ended",
        runEnd: "Run ended",
        retry: "Retry",
        compaction: "Compaction",
        roundSettled: "Round settled",
      },
      fields: {
        session: "Session",
        activation: "Activation",
        round: "Round",
        run: "Run",
        turn: "Turn",
        request: "Request",
        toolName: "Tool name",
        toolCallId: "Tool call ID",
        isError: "Failed",
        agentAttempt: "Agent attempt",
        sequence: "Sequence",
        time: "Time",
        detailBytes: "Detail bytes",
        flags: "Flags",
        traceId: "Trace ID",
        provider: "Provider",
        model: "Model",
        api: "API",
        thinkingLevel: "Thinking level",
        contextUsage: "Context usage",
        contextTokens: "Current context tokens",
        contextWindow: "Context window",
        contextPercent: "Window occupied",
        inputTokens: "Input tokens",
        outputTokens: "Output tokens",
        cacheReadTokens: "Cache-read tokens",
        cacheWriteTokens: "Cache-write tokens",
        cacheWrite1hTokens: "One-hour cache-write tokens",
        reasoningTokens: "Reasoning tokens (subset of output)",
        totalTokens: "Total tokens",
        cwd: "Working directory",
        scope: "Scope",
        path: "Path",
        hook: "Pi hook",
        handler: "Handler",
        status: "Status",
        headers: "Allowlisted headers",
        messageCount: "Message count",
        willRetry: "Will retry",
        phase: "Phase",
        attempt: "Attempt",
        maxAttempts: "Maximum attempts",
        delay: "Delay (ms)",
        source: "Source",
        hierarchy: "Hierarchy",
        started: "Started",
        duration: "Duration",
        success: "Success",
        reason: "Reason",
        tokensBefore: "Tokens before compaction",
        estimatedTokensAfter: "Estimated tokens after compaction",
        firstKeptEntryId: "First retained entry ID",
        summarizedMessageCount: "Messages summarized",
        turnPrefixMessageCount: "Split-turn prefix messages",
        branchEntryCount: "Branch entries inspected",
        splitTurn: "Split turn",
        reserveTokens: "Summary token reserve",
        keepRecentTokens: "Recent tokens kept",
        fromExtension: "Summary supplied by extension",
        compactionEntryId: "Compaction entry ID",
        aborted: "Aborted",
        trigger: "Trigger",
        timestamp: "Provider timestamp",
      },
    },
    settings: {
      viewConfigurationFile: "View configuration file",
      piConfigurationFile: "Pi settings",
      openingConfigurationFile: "Opening…",
      openConfigurationFileFailed: "The configuration file could not be opened.",
    },
    runningIndicator: {
      piLogoShine: "Pi logo · Light sweep",
      piLogoShineInverted: "Pi logo · Inverted light sweep",
      piWordmarkOnLight: "Pixel wordmark · Light theme",
      piWordmarkOnDark: "Pixel wordmark · Dark theme",
    },
  },
} as const;
