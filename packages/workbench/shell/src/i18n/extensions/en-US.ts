import type { MessageFormatters } from "../types";

export const extensionsEnUS = {
  todoPanel: {
    title: "Tasks",
    updating: "Updating tasks",
    empty: "No tasks remaining.",
    progress: (
      { completed, total }: { completed: number; total: number },
      { number }: MessageFormatters,
    ) => `${number(completed)} / ${number(total)} completed`,
    owner: ({ owner }: { owner: string }) => `Owner: ${owner}`,
    blockedBy: ({ tasks }: { tasks: string }) => `Depends on: ${tasks}`,
  },
  interactiveRequests: {
    questionTitle: "Question",
    questionDescription: "Answer this request to let the session continue.",
    approvalTitle: "Tool approval required",
    approvalDescription: "Review this tool request before allowing it to run.",
    session: ({ sessionId }: { sessionId: string }) => `Session ${sessionId}`,
    pending: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `${number(count)} pending ${count === 1 ? "request" : "requests"}`,
    answerLabel: ({ question }: { question: string }) => `Answer for ${question}`,
    answerPlaceholder: "Reply…",
    customAnswerLabel: "Other answer",
    customAnswerPlaceholder: "Or write your own response",
    required: "Required",
    yes: "Yes",
    no: "No",
    tool: "Tool",
    callId: "Call ID",
    reason: "Reason",
    submit: "Submit response",
    send: "Send",
    submitAndContinue: "Submit and continue",
    nextQuestion: "Next",
    skip: "Skip",
    timeoutCountdown: ({ seconds }: { seconds: number }, { number }: MessageFormatters) =>
      `Automatically skip this question in ${number(seconds)} seconds`,
    submitting: "Sending…",
    cancel: "Cancel request",
    close: "Close approval request",
    allowOnce: "Allow once",
    reject: "Reject",
    selectedCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
      count === 1 ? "1 selected" : `${number(count)} selected`,
    recommended: "Recommended",
    navigator: {
      title: "Questions",
      position: (
        { current, total }: { current: number; total: number },
        { number }: MessageFormatters,
      ) => `${number(current)} of ${number(total)}`,
      index: ({ index }: { index: number }, { number }: MessageFormatters) => number(index),
      open: (
        { current, total }: { current: number; total: number },
        { number }: MessageFormatters,
      ) => `Open question list, question ${number(current)} of ${number(total)}`,
      previous: "Previous question",
      next: "Next question",
      answered: "Answered",
      unanswered: "Not answered",
    },
    validation: {
      missingRequired: "Answer all required questions before submitting.",
    },
    askUserTool: {
      activityGenerating: "Generating questions",
      activityRunning: "Asking user",
      activityComplete: "Asked user",
      questionCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} ${count === 1 ? "question" : "questions"}`,
      history: "Question and answer record",
      waiting: "Waiting for the user's answer",
      unanswered: "No answer submitted",
      cancelledAnswer: "No answer submitted before cancellation",
      cancelled: "The request was cancelled before answers were submitted.",
      interrupted: "The request ended before answers were submitted.",
      disabled: "Ask User was disabled, so no answers were requested.",
    },
    settings: {
      title: "Ask User",
      description: "Control whether the agent may pause to request structured input.",
      enable: "Allow Ask User",
      enableDescription:
        "Let the agent ask follow-up questions when it needs a decision or missing detail.",
      saveError: "Could not save this setting. Check the connection and try again.",
    },
    errors: {
      badResponse: "The host rejected this response. Review the fields and try again.",
      notPending: "This request is no longer pending.",
      network: "Could not send the response. Check the connection and try again.",
    },
  },
  sideChat: {
    title: "Temporary chat",
    indexedTitle: ({ sequence }: { sequence: number }, { number }: MessageFormatters) =>
      `Temporary chat (${number(sequence)})`,
    open: "Open temporary chat",
    creating: "Creating temporary chat…",
    promote: "Keep as conversation",
    promoteDescription: "Save this temporary chat as a regular conversation.",
    promoting: "Saving…",
  },
  automations: {
    title: "Automations",
    breadcrumb: {
      newTask: "New task",
      editor: "Edit",
    },
    sidebar: {
      region: "Automation navigation",
      retry: "Retry",
    },
    trust: {
      question: "Trust this automation workspace?",
      description:
        "Trusting allows Pi to run this automation in the selected workspace. Only trust workspaces you created or reviewed.",
      securityDecision: "Automation workspace trust",
      accept: "Trust workspace",
      decline: "Do not trust",
      saving: "Saving…",
      cancel: "Cancel automation workspace trust",
      saveError: "Unable to save the workspace trust decision.",
      selectError: "Unable to select this automation workspace.",
    },
    automationHome: {
      title: "Automation",
      description:
        "Create scheduled tasks, control when they run, and review every result in one place.",
      tasksLabel: "Automation tasks",
      loading: "Loading tasks…",
      loadFailed: "Tasks could not be loaded.",
      empty: "No tasks yet",
      emptyDescription:
        "Create a task with a schedule and instructions. Once saved, it runs automatically on schedule.",
      myAutomations: "My tasks",
      newAutomation: "New task",
      history: "History",
      edit: "Edit",
      editScheduledTask: "Edit scheduled task",
      runNow: "Run now",
      pause: "Pause",
      enable: "Enable",
      delete: "Delete",
      deleting: "Deleting…",
      starting: "Starting…",
      updatingStatus: "Updating task status…",
      moreActions: ({ name }: { name: string }) => `More actions for ${name}`,
      noNextRun: "No upcoming run",
      nextRun: ({ time }: { time: string }) => `Next run: ${time}`,
      nextRunRelative: ({ time }: { time: string }) => `Next run ${time}`,
      scheduleAt: ({ recurrence, time }: { recurrence: string; time: string }) =>
        `${recurrence} at ${time}`,
      customSchedule: ({ cron }: { cron: string }) => `Cron: ${cron}`,
      scheduleWithNextRun: ({ schedule, nextRun }: { schedule: string; nextRun: string }) =>
        `${schedule} · ${nextRun}`,
      paused: "Paused",
      runCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} ${count === 1 ? "run" : "runs"}`,
      neverRun: "Never run",
      lastRun: ({ status, time }: { status: string; time: string }) =>
        `Last run: ${status} · ${time}`,
      publishBeforeRun: "Open and save this task before running or enabling it.",
      noTriggerToEnable: ({ name }: { name: string }) => `${name} has no schedule to enable.`,
      runStarted: ({ name }: { name: string }) => `${name} started.`,
      alreadyRunning: ({ name }: { name: string }) => `${name} is already running.`,
      runFailed: ({ name }: { name: string }) => `${name} could not be started.`,
      enabledFeedback: ({ name }: { name: string }) => `${name} is enabled.`,
      disabledFeedback: ({ name }: { name: string }) => `${name} is paused.`,
      toggleFailed: ({ name }: { name: string }) => `${name} could not be updated.`,
      deletedFeedback: ({ name }: { name: string }) => `${name} was deleted.`,
      deleteFailed: ({ name }: { name: string }) => `${name} could not be deleted.`,
      toggleAutomation: ({ name }: { name: string }) => `Enable or disable ${name}`,
      createScheduled: "Create scheduled task",
      createIdle: "Create idle task",
      createBlank: "Start with a blank scheduled task",
      moreCreateOptions: "More ways to create",
      createInConversation: "Create in a conversation",
      createFailed: "The task could not be created.",
      keepAwake: "Keep the computer awake while Workbench runs tasks.",
      wakeLockUnavailable: "This environment cannot keep the computer awake.",
      idleTemplates: "Idle task templates",
      scheduledTemplates: "Scheduled task templates",
      earliestSlot: "Earliest available slot",
      weekdayMorning: "Weekdays at 09:00",
      dailyMorning: "Daily at 10:00",
      fridayAfternoon: "Fridays at 16:00",
      wednesdayAfternoon: "Wednesdays at 15:00",
      enabled: "Enabled",
      disabled: "Disabled",
      runStatus: {
        queued: "Queued",
        running: "Running",
        waitingForApproval: "Waiting for approval",
        succeeded: "Succeeded",
        failed: "Failed",
        cancelled: "Cancelled",
        interrupted: "Interrupted",
      },
      noTriggers: "No triggers configured",
      triggerSummary: (
        { enabled, total }: { enabled: number; total: number },
        { number }: MessageFormatters,
      ) => `${number(enabled)}/${number(total)} triggers enabled`,
      templates: {
        gitStandup: {
          name: "Git stand-up summary",
          description:
            "Summarize this week's Git activity for Friday stand-up, including important commits, merged PRs, and key changes.",
          commandName: "Collect Git activity",
          nodeName: "Write stand-up summary",
          prompt:
            "Use the Git activity from the previous step to write a concise stand-up summary. Highlight important commits, merged PRs, key changes, risks, and next steps.",
        },
        ciFailureReport: {
          name: "CI failures and flaky tests",
          description:
            "Scan recent CI runs, list failures and flaky tests with likely causes, and recommend fixes by impact.",
          nodeName: "Analyze CI runs",
          prompt:
            "Inspect recent CI runs for this project. Identify failures and flaky tests, analyze likely causes and impact, then recommend fixes in priority order.",
        },
        docsSync: {
          name: "Documentation sync check",
          description:
            "Check whether README, docs, configuration notes, and usage examples are stale or inconsistent with the implementation.",
          nodeName: "Check documentation sync",
          prompt:
            "Compare the current code and recent commits with README, docs, configuration notes, and usage examples. Find stale or inconsistent documentation, and only modify issues confirmed by the code.",
        },
        morningBriefing: {
          name: "Morning briefing",
          description:
            "Summarize commits, module changes, CI status, and follow-ups since the previous workday in no more than six items.",
          nodeName: "Create morning briefing",
          prompt:
            "Summarize commits, module changes, CI status, and follow-up items since the previous workday in no more than six stand-up-ready items. Analyze only; do not modify files.",
          triggerName: "Weekday morning briefing",
        },
        riskScan: {
          name: "Risk scan",
          description:
            "Inspect code changes from the last 24 hours for runtime errors, data loss, permission bypasses, resource leaks, and cross-platform risk.",
          nodeName: "Scan change risk",
          prompt:
            "Inspect code changes from the last 24 hours for runtime errors, data loss, permission bypasses, resource leaks, and cross-platform compatibility risks. Include evidence and remediation priority.",
          triggerName: "Daily risk scan",
        },
      },
    },
    automationTask: {
      title: "New scheduled task",
      editTitle: "Edit scheduled task",
      description: "Configure the task's run time, instructions, and execution mode.",
      editDescription: "Adjust this task's run time, instructions, and execution mode.",
      draftHint: "Once saved, the task runs on its configured schedule.",
      editHint: "Review the task configuration, then save your changes.",
      tabsLabel: "Scheduled task page",
      settings: "Settings",
      history: "History",
      historyEmpty: "Run history will appear here after the task is created.",
      historyLoadFailed: "The run history could not be loaded.",
      historyColumns: {
        triggeredAt: "Trigger time",
        source: "Source",
        status: "Status",
        duration: "Duration",
        actions: "Actions",
      },
      runSource: {
        manual: "Manual",
        schedule: "Scheduled",
        event: "Event",
        replay: "Replay",
      },
      runStatus: {
        running: "Running",
        succeeded: "Succeeded",
        unavailable: "Unavailable",
      },
      runActions: ({ time }: { time: string }) => `Actions for the run triggered at ${time}`,
      goToConversation: "Go to conversation",
      deleteRun: "Delete",
      deleteActiveRunUnavailable: "A run in progress cannot be deleted.",
      deleteRunTitle: "Delete this run?",
      deleteRunDescription:
        "This removes the run from this task's history. The linked conversation will remain available.",
      cancelDeleteRun: "Cancel",
      confirmDeleteRun: "Delete",
      deletingRun: "Deleting…",
      deleteRunFailed: "The run could not be deleted. Try again.",
      deleteRunSucceeded: ({ time }: { time: string }) =>
        `The run triggered at ${time} was removed from history.`,
      status: "Status",
      statusRunning: "Running",
      statusPaused: "Paused",
      moreActions: "More task actions",
      create: "Create scheduled task",
      creating: "Creating…",
      createFailed: "The task could not be created.",
      save: "Save",
      saving: "Saving…",
      saved: "Changes saved.",
      saveFailed: "The task could not be saved.",
      saveConflict: "This task changed elsewhere. Reload it before saving again.",
      invalidConfiguration: "The task configuration is invalid. Check the fields and try again.",
      scheduleInvalid: "The schedule is invalid. Check the Cron expression and timezone.",
      loading: "Loading task…",
      loadFailed: "The task could not be loaded.",
      taskTitle: "Task title",
      untitledTask: "Untitled task",
      taskTitlePlaceholder: "For example: Morning briefing",
      taskTitleRequired: "Enter a task title.",
      schedule: "Schedule",
      at: "at",
      time: "Run time",
      timeLabel: ({ time }: { time: string }) => `Run time: ${time}`,
      hour: "Hour",
      minute: "Minute",
      timeRequired: "Select a valid run time.",
      customCron: "Cron",
      customCronPlaceholder: "For example: 0 9 * * 1-5",
      customCronRequired: "Enter a Cron expression.",
      removeSchedule: "Remove schedule",
      addSchedule: "Add plan",
      scheduleRequired: "A scheduled task needs at least one schedule.",
      maxRunDuration: "Maximum run time",
      maxRunDurationPlaceholder: "Unlimited",
      minutes: "minutes",
      maxRunDurationHint: "Leave blank to allow the task to run without a time limit.",
      maxRunDurationInvalid: ({ max }: { max: number }, { number }: MessageFormatters) =>
        `Enter a whole number from 1 to ${number(max)}, or leave the field blank.`,
      scheduleSummary: ({
        timezone,
        recurrence,
        time,
      }: {
        timezone: string;
        recurrence: string;
        time: string;
      }) => `${timezone} · ${recurrence} at ${time}`,
      scheduleSummaryWithoutTime: ({
        timezone,
        recurrence,
      }: {
        timezone: string;
        recurrence: string;
      }) => `${timezone} · ${recurrence}`,
      customScheduleSummary: ({
        timezone,
        description,
      }: {
        timezone: string;
        description: string;
      }) => `${timezone} · ${description}`,
      customScheduleFallback: ({ timezone, cron }: { timezone: string; cron: string }) =>
        `${timezone} · Cron: ${cron}`,
      frequency: {
        hourly: "Every hour",
        daily: "Every day",
        weekdays: "Every weekday",
        weekly: "Every week",
        monthly: "Every month",
        custom: "Custom",
      },
      frequencySummary: {
        hourly: "Every hour on the hour",
        daily: "Every day",
        weekdays: "Every weekday",
        weekly: "Every Monday",
        monthly: "On the first day of every month",
        custom: "Custom",
      },
      instructions: "Instructions",
      instructionsPlaceholder: "Describe the work, available context, and expected output.",
      instructionsRequired: "Enter task instructions.",
      workspace: "Workspace",
      noWorkspace: "No workspace available",
      workspaceRequired: "Select a trusted workspace.",
      model: "Model",
      defaultModel: "Runtime default model",
      loadingModels: "Loading models…",
      modelsUnavailable: "The model catalog is unavailable. The runtime default will be used.",
      thinkingLevel: "Reasoning effort",
      thinkingOff: "Off",
      triggerName: ({ title }: { title: string }) => `${title} schedule`,
    },
  },
  modelSelector: {
    saving: "Saving the model for this session",
    noModels: "No Pi models found.",
    searchLabel: "Search models",
    searchPlaceholder: "Search models…",
    noSearchResults: "No matching models.",
    loadFailed: "Could not load Pi models.",
    selectFailed: "Could not change the model for this session.",
    currentUnavailable: "The current session model is unavailable. Choose another model.",
    unavailable: "Unavailable for new requests",
    loadingMore: "Loading more models",
    contextWindow: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `${number(count, { notation: "compact", maximumFractionDigits: 1 })} context window`,
    off: "Off",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra high",
    max: "Maximum",
    thinking: "Thinking",
  },
  imageUnderstanding: {
    title: "Attachment understanding",
    description:
      "Send images directly to the selected model, or enable OCR or multimodal preprocessing for image and PDF attachments.",
    settings: {
      loading: "Loading attachment understanding settings…",
      retry: "Retry",
      save: "Save",
      saving: "Saving…",
      saved: "Saved.",
      securityNote:
        "API keys are write-only. Workbench never returns a saved key to this settings screen.",
      routing: {
        label: "Attachment handling",
        description:
          "Model-native sends images directly without attachment understanding. When enabled, Workbench uses the configured OCR or multimodal engine. PDF documents require attachment understanding with a compatible OCR provider.",
        options: {
          alwaysPreprocess: "Enable attachment understanding",
          nativeOnly: "Use model-native input (images)",
          disabled: "Disabled",
        },
      },
      engine: {
        label: "Recognition engine",
        description: "Use a dedicated OCR API or a configured multimodal model.",
        options: {
          ocr: "OCR",
          multimodal: "Multimodal model",
        },
      },
      ocrProvider: {
        label: "OCR provider",
        description: "Select the API used when the recognition engine is OCR.",
        options: {
          glm: "GLM-OCR",
          paddle: "PaddleOCR",
        },
      },
      ocrAdapter: {
        label: "OCR adapter",
        description: "Choose a built-in adapter template or edit a custom declarative adapter.",
        title: "OCR adapter implementation",
        sourceDescription:
          "Endpoint, model, credential, polling, and the adapter source form one active OCR configuration.",
        sourceLabel: "TypeScript adapter source",
        sourceSecurity:
          "This is a commented, versioned declarative TypeScript object. Workbench parses it as data; imports, functions, and arbitrary JavaScript are not executed.",
        exitEditor: "Press Escape to leave the adapter source editor.",
        saveShortcut: "Save attachment understanding settings (Ctrl or Command + S)",
        options: {
          glm: "GLM-OCR",
          paddleVl16: "PaddleOCR-VL-1.6",
          ppOcrV6: "PP-OCRv6",
          ppStructureV3: "PP-StructureV3",
          custom: "Custom adapter",
        },
        operations: {
          sync: "synchronous",
          async: "asynchronous job",
        },
        kinds: {
          image: "images",
          pdf: "PDFs",
        },
        validSummary: ({
          id,
          operation,
          kinds,
        }: {
          id: string;
          operation: string;
          kinds: string;
        }) => `Valid adapter · ${id} · ${operation} · ${kinds}`,
      },
      providers: {
        glmTitle: "GLM-OCR API",
        paddleTitle: "PaddleOCR API",
        description:
          "The endpoint and model are stored as regular settings. Credentials are stored separately and are never read back.",
        endpoint: "Endpoint",
        model: "Model",
        apiKey: "API key",
        apiKeyPlaceholder: "Leave blank to keep the saved key",
        credentialConfigured: "A credential is configured. Enter a new key only to replace it.",
        credentialNotConfigured: "No credential is configured.",
        openCredentialWebsite: ({ provider }: { provider: string }) => `Get a ${provider} API key`,
        clearCredential: "Clear key",
        pollInterval: "Poll interval (ms)",
        pollTimeout: "Poll timeout (ms)",
      },
      multimodal: {
        title: "Multimodal model",
        description:
          "Reference a provider and model already configured in Workbench model settings.",
        provider: "Provider",
        providerPlaceholder: "Select a configured provider",
        modelPlaceholder: "Select a configured model",
        loadingModels: "Loading configured models…",
        modelsLoadFailed: "Configured models could not be loaded. Open this menu to retry.",
        noConfiguredProviders: "No configured model providers are available.",
        imageInputRequired: "The provider reports no models that support image input.",
        imageInputUnknown:
          "No verified image-input capability is available. Use Get available models in Model settings to refresh it; APIs without capability metadata remain unavailable here.",
        selectProviderFirst: "Select a configured provider first.",
      },
      errors: {
        loadFailed: "Attachment understanding settings could not be loaded.",
        saveFailed: "Attachment understanding settings could not be saved. Try again.",
        conflict: "These settings changed elsewhere. Reload them and try again.",
        requiredFields: "Complete the adapter source, endpoint, and model fields before saving.",
        invalidEndpoint: "Enter a valid HTTPS endpoint.",
        invalidPolling: "Polling values must be positive whole numbers.",
        invalidAdapterSource:
          "The adapter source is invalid. Use export default defineOcrAdapter({ … }); with only supported version-one properties.",
        hostRestartRequired:
          "The running Workbench Host still uses the legacy OCR settings protocol. Restart Workbench before editing or using OCR adapters.",
        unsupportedPaddleAsyncModel:
          "The AI Studio async jobs endpoint supports PaddleOCR-VL-1.6, PaddleOCR-VL-1.5, PaddleOCR-VL, PP-StructureV3, or PP-OCRv5. Choose one of these model names.",
        modelCatalogLoadFailed:
          "Configured models could not be loaded. Try opening the provider menu again.",
        configuredProviderRequired: "Select a configured provider with an image-capable model.",
        configuredModelRequired: "Select an image-capable model configured for this provider.",
      },
    },
    recognition: {
      status: {
        pending: "Attachment recognition queued",
        running: "Recognizing attachments",
        succeeded: "Attachment recognition complete",
        failed: "Attachment recognition failed",
        cancelled: "Attachment recognition cancelled",
        skipped: "Attachment recognition skipped",
      },
      stages: {
        routing: "Choosing the recognition path…",
        submitting: "Submitting attachments…",
        polling: "Waiting for the OCR service…",
        recognizing: "Recognizing attachment content…",
        normalizing: "Preparing recognized content…",
        fallback: "Trying the fallback recognizer…",
      },
      methods: {
        ocr: "OCR preprocessing",
        multimodal: "Multimodal recognition",
        native: "Native model vision",
      },
      progress: (
        { completed, total }: { completed: number; total: number },
        { number }: MessageFormatters,
      ) => `${number(completed)} of ${number(total)} attachments`,
      progressLabel: "Attachment recognition progress",
      provider: ({ providerId }: { providerId: string }) => `Provider: ${providerId}`,
      results: {
        title: "Recognition result",
        attachment: ({ index }: { index: number }, { number }: MessageFormatters) =>
          `Attachment ${number(index)}`,
        image: ({ index }: { index: number }, { number }: MessageFormatters) =>
          `Image ${number(index)}`,
        pdf: ({ index }: { index: number }, { number }: MessageFormatters) =>
          `PDF ${number(index)}`,
        formats: {
          markdown: "Markdown",
          text: "Plain text",
        },
        truncated: "The display is truncated; the model context retains the complete text.",
      },
      errors: {
        authentication: "The recognition service rejected its credential.",
        configuration: "The recognition provider is not configured correctly.",
        rateLimited: "The recognition service rate limit was reached.",
        timeout: "The recognition service did not finish in time.",
        network: "Workbench could not reach the recognition service.",
        serviceUnavailable: "The recognition service is unavailable.",
        unsupportedImage:
          "The recognition service does not support this attachment or file format.",
        invalidResponse: "The recognition service returned an invalid response.",
        generic: "The attachments could not be recognized.",
      },
      diagnostics: {
        title: "Failure details",
        errorCode: "Workbench error code",
        phase: "Failure phase",
        reason: "Reason",
        httpStatus: "HTTP status",
        providerCode: "Provider code",
        resultSource: "Result source",
        method: "Method",
        provider: "Provider",
        sanitizedNote:
          "Sensitive values, attachment content, endpoints, and raw provider responses are omitted.",
        phases: {
          configuration: "Configuration",
          routing: "Routing",
          submission: "Job submission",
          polling: "Job polling",
          resultDownload: "Result download",
          resultParsing: "Result parsing",
          normalizing: "Result normalization",
        },
        sources: {
          jsonl: "JSONL",
          markdown: "Markdown",
        },
      },
      skipped: {
        native: "The selected model can read images directly.",
        disabled: "Attachment preprocessing is disabled.",
        notNeeded: "Attachment preprocessing was not needed.",
        generic: "No preprocessing was performed.",
      },
    },
  },
  tokenUsage: {
    turns: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `${number(count)} ${count === 1 ? "turn" : "turns"}`,
    steps: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `${number(count)} ${count === 1 ? "step" : "steps"}`,
    llm: "LLM",
    toolCalls: "tool calls",
    averageFirstToken: "avg first token",
    tokensPerSecondUnit: "tok/s",
    averageCacheHit: "avg cache hit",
    input: "input",
    output: "output",
    tokenUnit: "tok",
    unavailable: "—",
    detailsTitle: "Conversation statistics",
    showDetails: "Show context and conversation statistics",
    description: "Current context usage and cumulative conversation statistics",
    currentContextTitle: "Current context",
    currentContextDescription:
      "Current context occupancy is the next request's working set. It is different from cumulative session tokens billed across all turns.",
    currentContextValue: ({ used, budget }: { used: string; budget: string }) =>
      `${used} / ${budget}`,
    contextUsed: "Context used",
    estimatedContextValue: ({ used, budget }: { used: string; budget: string }) =>
      `~${used} / ${budget}`,
    estimatedTokenValue: ({ tokens }: { tokens: string }) => `~${tokens}`,
    nearingCompaction:
      "Context is approaching the automatic compaction point. Pi will preserve recent work when it compacts.",
    modelInputBreakdown: "Model input composition",
    breakdownGroups: {
      instructions: "Instructions and context",
      tools: "Tool definitions",
      conversation: "Conversation content",
    },
    breakdownCategories: {
      "system-prompt": "System prompt",
      skills: "Skills",
      "context-files": "Context files and injected content",
      "builtin-tools": "Built-in tool schemas",
      "mcp-tools": "MCP tool schemas",
      "extension-tools": "Extension tool schemas",
      "user-input": "User input",
      "assistant-history": "Assistant history",
      "tool-results": "Tool results",
      other: "Other model input",
    },
    usageEstimateDescription: "Estimates update as model steps progress.",
    contextSettings: "Context settings",
    contextBudgetDescription:
      "Follows the current model configuration by default. A custom limit applies only to this conversation and cannot increase model capacity.",
    modelCapacity: ({ tokens }: { tokens: string }) =>
      `Configured model capacity: ${tokens} tokens`,
    compactionThreshold: ({ tokens }: { tokens: string }) =>
      `Auto-compaction threshold: ${tokens} tokens`,
    autoCompactionDisabled: "Automatic compaction is disabled",
    contextBudget: "Context limit",
    contextBudgetControlLabel: ({ mode, tokens }: { mode: string; tokens: string }) =>
      `Session context budget: ${mode}, ${tokens}`,
    customContextBudget: "Custom session context budget",
    applyContextBudget: "Apply",
    customContextBudgetInvalid: ({ tokens }: { tokens: string }) =>
      `Enter a whole number no greater than this model's ${tokens}-token capacity.`,
    contextBudgetModes: {
      inherit: "Follow model",
      auto: "Auto",
      maximum: "Maximum",
      custom: "Custom",
    },
    compactNow: "Compact now",
    viewContextTrace: "View Context Trace",
    contextTooSmall:
      "The current context is too short to compact. Continue the conversation and try again.",
    contextAlreadyCompacted:
      "The current context has already been compacted. Add more conversation before trying again.",
    contextCompactionCancelled: "Context compaction was cancelled.",
    contextActionBusy: "The conversation is running. Wait for the current operation and try again.",
    contextActionFailed: "The context action could not be completed. Try again.",
    cumulativeTitle: "Cumulative usage and performance",
  },

  workspaceFile: {
    capabilityUnavailable: "This runtime does not support workspace files.",
    title: "File",
    loadFailed: "The file could not be loaded. Try again.",
    saveFailed: "The file could not be saved. Try again.",
    openFailed: "The file could not be opened in a local application.",
    openFileTitle: "Open File",
    openFileDescription: "Select a file from the workspace directory tree",
    viewSource: "View source code",
    viewPreview: "View preview",
    markdownPreview: ({ name }: { name: string }) => `${name} preview`,
    documentPreview: ({ name }: { name: string }) => `${name} document preview`,
    loadingPreview: "Loading preview…",
    previewUnsupportedTitle: "Preview unavailable",
    previewUnsupportedDescription: ({ name }: { name: string }) =>
      `${name} is a binary file that the installed previewers do not support.`,
    previewTooLargeDescription: ({ name }: { name: string }) =>
      `${name} is too large for the in-app preview. Use the Open menu to view it in a local application.`,
    previewLoadFailed: ({ name }: { name: string }) =>
      `${name} could not be loaded in the preview. Use the Open menu to view it in a local application.`,
    mediaPreviewLoadFailed: ({ name }: { name: string }) =>
      `${name} could not be streamed in the browser. Use the Open menu to view it in a local application.`,
    filePath: "File path",
    browsePath: ({ name }: { name: string }) => `Browse ${name} in the file tree`,
    open: "Open",
    openOptions: "Open options",
    openFile: "Open with the default application",
    openFolder: "Open folder with the default application",
    openWith: ({ name }: { name: string }) => `Open with ${name}`,
    openWithApps: "Open with",
    loadingLocalApps: "Finding applications…",
    localAppsLoadError: "Applications could not be loaded.",
    openWithError: ({ name }: { name: string }) => `${name} could not be opened.`,
    terminal: "Terminal",
    fileManager: "File Manager",
    openWorkspaceFolder: "Open workspace folder",
    showFileTree: "Show file tree",
    hideFileTree: "Hide file tree",
    loading: "Loading file…",
    loadingLargeText: "Loading large text…",
    loadingLargeTextProgress: ({ percent }: { percent: number }, { number }: MessageFormatters) =>
      `Loading large text… ${number(percent)}%`,
    renderingLargeText: "Rendering visible lines…",
    renderingLargeTextProgress: ({ percent }: { percent: number }, { number }: MessageFormatters) =>
      `Rendering visible lines… ${number(percent)}%`,
    largeTextLoadFailed: "The large text file could not be loaded.",
    retryLargeText: "Retry",
    unavailable: "This file buffer is not attached.",
    diffUnavailableTitle: "Diff unavailable",
    diffUnavailableDescription: "Select the file edit in the conversation to load it again.",
    save: "Save buffer",
    saving: "Saving buffer…",
    saveShortcut: "Save buffer (Ctrl+S)",
    exitEditor: "Press Escape to leave the editor.",
    saved: "Saved",
    dirty: "Unsaved changes",
    source: ({ name }: { name: string }) => `${name} source`,
  },
  gitBranch: {
    select: "Select Git branch",
    loading: "Reading Git branches…",
    loadError: "Git branches could not be read.",
    retry: "Retry reading Git branches",
    searchLabel: "Search branches",
    searchPlaceholder: "Search branches",
    branches: "Branches",
    noBranches: "No local branches",
    noSearchResults: "No matching branches",
    detachedHead: "Detached HEAD",
    detachedAt: ({ revision }: { revision: string }) => `Detached at ${revision}`,
    changedFiles: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `${number(count)} changed ${count === 1 ? "file" : "files"}`,
    createAction: "Create and switch to new branch…",
    graph: {
      action: "Git graph",
      title: "Git graph",
      description: "Explore the repository's commit history, refs, and parent topology.",
      close: "Close Git graph",
      refresh: "Refresh Git graph",
      loading: "Loading Git history…",
      loadError: "Git history could not be read.",
      refreshError: "Git history could not be refreshed. The previous results are still shown.",
      retry: "Retry",
      empty: "This repository does not have any commits yet.",
      tableLabel: "Git commit history",
      noSubject: "No commit subject",
      commitCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} ${count === 1 ? "commit" : "commits"}`,
      truncated: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `Showing the most recent ${number(count)} commits`,
      columns: {
        graph: "Graph",
        subject: "Description",
        date: "Date",
        author: "Author",
        commit: "Commit",
      },
      details: {
        label: "Selected commit details",
        subject: "Subject",
        commit: "Commit",
        date: "Date",
        author: "Author",
        parents: "Parents",
        noParents: "No parent",
      },
    },
    createTitle: "Create Git branch",
    createDescription: "Create a local branch from the current HEAD and switch to it.",
    branchName: "Branch name",
    branchNamePlaceholder: "feature/my-branch",
    cancelCreate: "Cancel",
    create: "Create branch",
    creating: "Creating…",
    switching: ({ branch }: { branch: string }) => `Switching to ${branch}…`,
    switchTitle: "Switch Git branch?",
    switchWithChangesTitle: "Review changes before switching branches",
    switchDescription: "The working tree is clean and ready to switch branches.",
    switchWarning:
      "Git will carry these uncommitted changes to the target branch when possible. If they conflict with that branch, the switch will be rejected. Commit or stash them first if you do not want them to move.",
    affectedFiles: "Uncommitted changes",
    changedFilesTruncated: "Only the first 200 changed files are shown.",
    lineChanges: ({ additions, deletions }: { additions: number; deletions: number }) =>
      `${additions} additions and ${deletions} deletions`,
    cancelSwitch: "Cancel",
    confirmSwitch: "Continue switching",
    switchingShort: "Switching…",
    errors: {
      sessionBusy:
        "A conversation in this project is running. Wait for it to finish and try again.",
      invalidName: "Enter a valid Git branch name.",
      alreadyExists: "A local branch with this name already exists.",
      switchFailed:
        "The branch could not be switched. Resolve conflicting working-tree changes and try again.",
      createFailed: "The branch could not be created. Check the name and repository state.",
    },
  },
  workspaceDirectory: {
    add: "Add workspace",
    newThread: "New conversation",
    defaultName: "Select project",
    clearWorkspace: "Clear selected project",
    localPi: "Runtime host",
    selectTitle: "Select workspace",
    required: "Select a workspace before sending",
    searchLabel: "Search workspaces",
    searchPlaceholder: "Search workspaces",
    noSearchResults: "No matching workspaces",
    openFolder: "Open folder",
    selectDescription: "Choose a directory on the runtime host for the new conversation.",
    path: "Workspace path",
    pathPlaceholder: "/path/to/workspace or ~/workspace",
    open: "Open",
    home: "Open home directory",
    parent: "Open parent directory",
    breadcrumbs: "Current directory path",
    loading: "Loading directories…",
    empty: "No subdirectories",
    truncated: "Only the first 500 directories are shown.",
    selectCurrent: "Use this workspace",
    selecting: "Selecting…",
    newFolderName: "New folder name",
    newFolderPlaceholder: "New folder",
    createFolder: "Create folder",
    creating: "Creating…",
    cancel: "Cancel",
    close: "Close workspace picker",
    browseError: "Unable to open this directory.",
    createError: "Unable to create this directory.",
    selectError: "Unable to select this workspace.",
    trustQuestion: "Trust this project folder?",
    trustDescription:
      "Trusting allows the runtime to load project settings and resources, install missing project packages, and execute project extensions. Only trusted folders are opened in Workbench; choosing not to trust cancels this operation without adding or switching workspaces.",
    trustSecurityDecision: "Project trust",
    trustAccept: "Trust folder",
    trustDecline: "Do not trust",
    trustSaving: "Saving…",
    trustCancel: "Cancel project trust",
    trustSaveError: "Unable to save the project trust decision.",
  },
  generativeUi: {
    name: "Generative UI",
    description:
      "Renders allowlisted generative UI component trees embedded in assistant messages.",
    placement: {
      surface: "Individual text or generative UI part inside an assistant message",
      description:
        "When a message part contains a complete allowlisted component tree, this renderer replaces only that leaf part; unmatched content keeps its original message renderer.",
    },
    preview: {
      title: "Structured response",
      caption: "Assistant message component",
      body: "The preview uses the same component library, theme tokens, and scoped styles as the rendered message.",
      action: "Preview",
    },
  },
  shared: {
    capabilityUnavailable: "This runtime does not support this feature.",
    copyMarkdown: "Copy Markdown",
    markdownCopied: "Markdown copied",
    markdownCopyFailed: "Couldn't copy Markdown",
    panelsCategory: "Panels",
    fileTree: {
      tree: "Workspace file tree",
      empty: "This workspace folder is empty.",
      noMatches: "No files match this filter.",
      loading: "Loading workspace files…",
      loadError: "The workspace files could not be loaded.",
      retry: "Retry",
      loadingDirectory: ({ name }: { name: string }) => `Loading ${name}…`,
      loadDirectoryError: ({ name }: { name: string }) => `${name} could not be loaded.`,
      retryDirectory: ({ name }: { name: string }) => `Retry loading ${name}`,
      emptyDirectory: ({ name }: { name: string }) => `${name} is empty.`,
      openError: ({ name }: { name: string }) => `${name} could not be opened.`,
      truncated: "Some entries are not shown because this folder is very large.",
    },
    reviewableDiff: {
      discard: "Discard",
      discardHunk: ({ range }: { range: string }) => `Discard hunk ${range}`,
      keep: "Keep",
      keepAll: "Keep all",
      keepHunk: ({ range }: { range: string }) => `Keep hunk ${range}`,
      kept: "kept",
      discarded: "discarded",
      remaining: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `${number(count)} left to review`,
      allReviewed: "All reviewed",
    },
  },

  localeSelector: {
    languageTitle: "Language",
    languageDescription: "Choose the language used by Workbench controls and menus.",
    selectLanguage: "Select interface language",
  },
  settings: {
    title: "Settings",
    category: "Workbench",
    trigger: "Settings",
    open: "Open settings",
    openDescription: "Open Workbench settings",
    close: "Close settings",
    backToApp: "Back to app",
    searchLabel: "Search settings",
    searchPlaceholder: "Search settings…",
    noSearchResults: "No matching settings. Try another keyword.",
    sections: "Settings sections",
    empty: "No settings sections are available.",
    emptySection: "No settings are available in this section yet.",
    groups: {
      basics: "Basics",
      appearance: "Appearance",
      intelligence: "AI",
      capabilities: "Capabilities",
      data: "Data",
    },
    conversation: {
      title: "Conversation",
      description:
        "Choose how messages are sent during a run and how conversation details are displayed.",
      runningMessageMode: "Follow-up handling",
      runningMessageDescription:
        "Queue follow-up messages while a conversation is running, or steer the ongoing run. Press Ctrl/Cmd+Enter to use the opposite action for a single message.",
      queue: "Add to queue",
      steer: "Steer the run",
      enhancedSearch: "Enhanced Find and Grep",
      enhancedSearchDescription:
        "Search up to 8 directories in one call; Grep includes 2 context lines by default. Applies to new sessions and sessions restored after restart. Find on Windows is unchanged.",
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
      explorationGroup: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `Explore · ${number(count)}`,
      terminalGroup: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `Terminal · ${number(count)}`,
      changesGroup: ({ count }: { count: number }, { number }: MessageFormatters) =>
        `Changes · ${number(count)}`,
      todosEmpty: "No outstanding todo items.",
      todoStatus: { pending: "Pending", in_progress: "In progress", completed: "Completed" },
      showReasoning: "Show reasoning",
      showReasoningDescription:
        "Display reasoning content returned by the model. Turning this off hides it from the message view without changing saved history.",
      groupParallelTools: "Group parallel tool calls",
      groupParallelToolsDescription:
        "Combine tool calls from the same parallel batch into one expandable group. Turn off to list each tool call separately.",
      loadError: "Could not load conversation preferences. Retry to edit them.",
      saveError: "Could not save this change. Your previous preference is still active; try again.",
      retry: "Retry",
    },
    onboarding: {
      title: "Setup guide",
      description: "Open language setup, migration options, and preference import again.",
      open: "Open setup guide",
      close: "Close setup guide",
      steps: {
        language: "1. Choose your display language.",
        capabilities:
          "2. Configure models or migrate history using the installed settings below. Reopen this guide whenever you need it.",
        import:
          "3. Import portable Workbench preferences from a JSON settings file. Workspace paths, sessions, credentials, and desktop machine settings are not imported.",
      },
      chooseFile: "Choose a Workbench settings JSON file (up to 24 MiB)",
      review: "Review the preferences to merge. The server validates every value before saving.",
      apply: "Apply and reload interface",
      error:
        "Could not read or apply these preferences. Choose a valid supported JSON file and try again.",
      back: "Back",
      next: "Next",
      done: "Done",
    },
    general: {
      title: "General",
      description: "Configure the language and other shared Workbench preferences.",
    },
  },

  archivedChats: {
    title: "Archive",
    description: "Review, restore, or permanently delete conversations you have archived.",
    searchLabel: "Search archived chats",
    searchPlaceholder: "Search archived chats",
    sortLabel: "Sort archived chats",
    newestFirst: "Newest first",
    oldestFirst: "Oldest first",
    projectFilterLabel: "Filter archived chats by project",
    allProjects: "All projects",
    ungroupedProject: "Other chats",
    totalCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
      count === 1 ? "1 archived chat" : `${number(count)} archived chats`,
    groupCount: ({ count }: { count: number }, { number }: MessageFormatters) =>
      count === 1 ? "1 chat" : `${number(count)} chats`,
    untitled: "Untitled chat",
    loading: "Loading archived chats…",
    loadingMore: "Loading more archived chats…",
    empty: "You have no archived chats.",
    noMatches: "No archived chats match these filters.",
    unarchive: "Unarchive",
    working: "Working…",
    delete: "Delete",
    deleteChat: ({ title }: { title: string }) => `Delete ${title}`,
    deleteAll: "Delete all",
    actionFailed: "The archived chat could not be updated. Try again.",
    deleteDialogTitle: "Permanently delete archived chats?",
    deleteChatDescription: ({ title }: { title: string }) =>
      `“${title}” and its complete conversation history will be permanently deleted. This cannot be undone.`,
    deleteAllDescription: ({ count }: { count: number }, { number }: MessageFormatters) =>
      `All ${number(count)} archived chats and their complete conversation histories will be permanently deleted. This cannot be undone.`,
    cancel: "Cancel",
    confirmDelete: "Delete permanently",
    deleting: "Deleting…",
  },

  appearance: {
    title: "Theme",
    description: "Choose a color mode and customize the light and dark theme palettes.",
    theme: {
      title: "Theme",
      description: "Follow the operating system or keep Workbench in one color mode.",
      mode: "Color mode",
    },
    colorModes: {
      system: "System",
      light: "Light",
      dark: "Dark",
    },
    palette: {
      title: "Theme colors",
      description: "View and adjust the complete light and dark color palette together.",
    },
    themeSettings: {
      accent: "Accent color",
      background: "Base color",
      foreground: "Foreground",
      contrast: "Contrast",
      lightAccent: "Light theme accent color",
      lightBackground: "Light theme base color",
      lightForeground: "Light theme foreground color",
      lightContrast: "Light theme contrast",
      darkAccent: "Dark theme accent color",
      darkBackground: "Dark theme base color",
      darkForeground: "Dark theme foreground color",
      darkContrast: "Dark theme contrast",
      contrastValue: ({ contrast }: { contrast: number }, { number }: MessageFormatters) =>
        `${number(contrast)}%`,
    },
    typography: {
      title: "Typography",
      description: "Choose interface fonts and adjust the base UI text size.",
      font: "UI font",
    },
    interface: {
      sectionTitle: "Interface",
      description:
        "Choose your interface language and adjust typography, control sizing, running indicators, component surfaces, borders, and corners.",
    },
    runningIndicator: {
      title: "Running conversations",
      description: "Choose the activity indicator shown beside running conversations.",
      style: "Indicator style",
      styles: {
        orb: "Orbiting particles",
        spinner: "Spinner",
        pulse: "Pulsing dot",
        none: "Hidden",
      },
    },
    activityAnimation: {
      title: "Assistant activity",
      description: "Choose the animation shown while the assistant is working in a conversation.",
      style: "Animation style",
      size: "Animation size",
      sizeDescription: "Adjust the inline animation without changing the activity row height.",
      sizeValue: ({ size }: { size: number }, { number }: MessageFormatters) =>
        `${number(size)} px`,
      styles: {
        working: "Working · Orbiting particles",
        searching: "Searching · Scanning globe",
        solving: "Solving · Scrambling bands",
        listening: "Listening · Rolling waveform",
        connecting: "Connecting · Wired constellation",
        weaving: "Weaving · Braided strands",
        composing: "Composing · Undulating bands",
        breathing: "Breathing · Morphing ring",
        shaping: "Shaping · Geometric outline",
      },
    },
    fontFamilies: {
      ui: {
        system: "System UI",
        geist: "Geist",
        serif: "Serif",
        rounded: "Rounded",
      },
      code: {
        geistMono: "Geist Mono",
        systemMono: "System monospace",
        compactMono: "Compact monospace",
        jetBrainsMono: "JetBrains Mono",
        firaCode: "Fira Code",
        cascadiaCode: "Cascadia Code",
        sourceCodePro: "Source Code Pro",
        ibmPlexMono: "IBM Plex Mono",
        menlo: "Menlo",
        consolas: "Consolas",
        liberationMono: "Liberation Mono",
        ubuntuMono: "Ubuntu Mono",
      },
    },
    codeThemes: {
      "dark-plus": "VS Code Dark Plus",
      "light-plus": "VS Code Light Plus",
      "github-dark": "GitHub Dark",
      "github-dark-dimmed": "GitHub Dark Dimmed",
      "github-dark-high-contrast": "GitHub Dark High Contrast",
      "github-light": "GitHub Light",
      "github-light-high-contrast": "GitHub Light High Contrast",
      "one-dark-pro": "One Dark Pro",
      "one-light": "One Light",
      dracula: "Dracula",
      "dracula-soft": "Dracula Soft",
      "ayu-dark": "Ayu Dark",
      "tokyo-night": "Tokyo Night",
      "night-owl": "Night Owl",
      monokai: "Monokai",
      "min-dark": "Min Dark",
      "min-light": "Min Light",
      nord: "Nord",
      "slack-dark": "Slack Dark",
      "slack-ochin": "Slack Ochin",
      vesper: "Vesper",
      "vitesse-dark": "Vitesse Dark",
      "vitesse-light": "Vitesse Light",
      "catppuccin-mocha": "Catppuccin Mocha",
      "catppuccin-macchiato": "Catppuccin Macchiato",
      "catppuccin-frappe": "Catppuccin Frappé",
      "catppuccin-latte": "Catppuccin Latte",
      "kanagawa-wave": "Kanagawa Wave",
      "kanagawa-dragon": "Kanagawa Dragon",
      "kanagawa-lotus": "Kanagawa Lotus",
      "everforest-dark": "Everforest Dark",
      "everforest-light": "Everforest Light",
      "gruvbox-dark-medium": "Gruvbox Dark Medium",
      "gruvbox-light-medium": "Gruvbox Light Medium",
      "material-theme": "Material Theme",
      "material-theme-ocean": "Material Theme Ocean",
      "material-theme-palenight": "Material Theme Palenight",
      "rose-pine": "Rosé Pine",
      "rose-pine-moon": "Rosé Pine Moon",
      "rose-pine-dawn": "Rosé Pine Dawn",
      "solarized-dark": "Solarized Dark",
      "solarized-light": "Solarized Light",
      "synthwave-84": "SynthWave '84",
    },
    background: {
      sectionTitle: "Background",
      title: "Workbench background",
      description:
        "Use a custom canvas color or local image to create a Workbench background independent of the theme palette.",
      colorTitle: "Canvas color",
      imageTitle: "Background image",
      image: "Local image",
      custom: "Use a custom canvas color",
      color: "Canvas color",
      syncSurfaces: "Coordinate panel and component colors with the canvas",
      preview: "Background image preview",
      chooseImage: "Choose image",
      replaceImage: "Replace image",
      removeImage: "Remove background image",
      loadingImage: "Loading image…",
      blur: "Image blur",
      unsupportedImage: "Choose a supported image file.",
      imageTooLarge: "The image must be 12 MB or smaller.",
      imageStorageError: "The background image could not be saved in Workbench settings.",
    },
    backgroundBlurs: {
      none: "None",
      soft: "Soft",
      medium: "Medium",
      strong: "Strong",
    },
    surfaces: {
      title: "Component surfaces",
      opacity: "Surface opacity",
      opacityValue: ({ opacity }: { opacity: number }, { number }: MessageFormatters) =>
        `${number(opacity)}%`,
      glassBlur: "Glass blur",
    },
    borders: {
      title: "Borders",
      style: "Border style",
      customColor: "Use a custom border color",
      color: "Component border color",
    },
    borderStyles: {
      default: "Component default",
      solid: "Solid",
      dashed: "Dashed",
      dotted: "Dotted",
      none: "No borders",
    },
    corners: {
      title: "Corners",
      radius: "Corner style",
    },
    cornerRadiusStyles: {
      default: "Theme default",
      square: "Square",
      subtle: "Subtle",
      compact: "Compact",
      soft: "Soft",
      rounded: "Rounded",
      "extra-rounded": "Extra rounded",
    },
    code: {
      sectionTitle: "Code",
      title: "Code display",
      description: "Configure code fonts, sizing, syntax colors, and change markers.",
      font: "Code font",
    },
    preferences: {
      uiFontSize: "UI font size",
      uiFontSizeDescription: "Adjust the base size used by the Workbench interface.",
      codeFontSize: "Code font size",
      codeFontSizeDescription: "Adjust the base size used by code and diff views.",
      codeTheme: "Code theme",
      codeThemeDescription:
        "Choose a Shiki palette that follows the Workbench light or dark appearance.",
      codePreview: "Code preview",
      diffMarkers: "Diff markers",
      diffMarkersDescription: "Use +/- markers as well as color to identify changes.",
      fontSizeValue: ({ size }: { size: number }, { number }: MessageFormatters) =>
        `${number(size)} px`,
    },
    reset: "Restore defaults",
  },

  userMessageIndex: {
    navigationLabel: "User message index",
    jumpTo: ({ index }: { index: number }, { number }: MessageFormatters) =>
      `Jump to user message ${number(index)}`,
    nonTextPreview: "This message contains attachments or structured content.",
  },

  messagePresentation: {
    generating: "Generating response…",
    sourceFallback: "Source",
    attachmentReference: {
      image: ({ index }: { index: number }, { number }: MessageFormatters) =>
        `Image ${number(index)}`,
      pdf: ({ index }: { index: number }, { number }: MessageFormatters) => `PDF ${number(index)}`,
    },
    elapsed: ({ duration }: { duration: string }) => `·${duration}·`,
    completedTurn: ({
      completedAt,
      duration,
      kind,
    }: {
      completedAt: string;
      duration: string;
      kind:
        | "completed"
        | "cancelled"
        | "aborted"
        | "length"
        | "network-error"
        | "api-error"
        | "provider-error";
    }) => {
      const durationLabel = duration ? ` · Took ${duration}` : "";
      switch (kind) {
        case "cancelled":
          return `Stopped by user at ${completedAt}${durationLabel}`;
        case "aborted":
          return `Aborted at ${completedAt}${durationLabel}`;
        case "length":
          return `Stopped at ${completedAt} · Length limit reached${durationLabel}`;
        case "network-error":
          return `Failed at ${completedAt} · Network connection error${durationLabel}`;
        case "api-error":
          return `Failed at ${completedAt} · API error${durationLabel}`;
        case "provider-error":
          return `Failed at ${completedAt} · Provider error${durationLabel}`;
        default:
          return `Completed at ${completedAt}${durationLabel}`;
      }
    },
    toolTimeline: {
      active: (
        { steps, files }: { steps: number; files: number },
        { number }: MessageFormatters,
      ) => {
        const stepLabel = steps === 1 ? "step" : "steps";
        const fileLabel = files === 1 ? "file" : "files";
        return files > 0
          ? `Working · ${number(steps)} ${stepLabel} · ${number(files)} ${fileLabel} changed`
          : `Working · ${number(steps)} ${stepLabel}`;
      },
      summary: (
        { steps, files }: { steps: number; files: number },
        { number }: MessageFormatters,
      ) => {
        const stepLabel = steps === 1 ? "step" : "steps";
        const fileLabel = files === 1 ? "file" : "files";
        return files > 0
          ? `Completed · ${number(steps)} ${stepLabel} · ${number(files)} ${fileLabel} changed`
          : `Completed · ${number(steps)} ${stepLabel}`;
      },
      steps: {
        thinking: "Thinking",
        read: "Read",
        ran: "Ran",
        edited: "Edited",
        created: "Created",
        searched: "Searched",
        used: "Used",
      },
      activeSteps: {
        thinking: "Thinking",
        read: "Reading",
        ran: "Running",
        edited: "Editing",
        creating: "Creating",
        searched: "Searching",
        used: "Using",
      },
      request: "Request",
      result: "Result",
      failed: "Failed",
    },
    reasoning: {
      active: "Thinking",
      recovering: "Restoring connection",
      stalled: "Still thinking",
      complete: "Reasoned",
      completeWithDuration: ({ seconds }: { seconds: number }, { number }: MessageFormatters) =>
        `Reasoned for ${number(seconds)}s`,
      elapsed: ({ seconds }: { seconds: number }, { number }: MessageFormatters) =>
        `${number(seconds)}s`,
      step: "Reasoning",
    },
  },
  messageActions: {
    previousResponse: "Previous response",
    nextResponse: "Next response",
    editMessage: "Edit message",
    forkConversation: "Fork conversation here",
    forkConversationPending: "Forking conversation…",
    forkConversationFailed: "Couldn't fork conversation. Try again",
    regenerateResponse: "Regenerate response",
    retryAttachmentRequest: "Recognize attachments again and generate a response",
    timing: {
      details: "Performance statistics",
      total: "total",
      firstToken: "first token",
      inputTokens: "input",
      outputTokens: "output",
      tokensPerSecond: "TPS",
      cacheHitRate: "average cache hit",
    },
  },
  messageQueue: {
    drag: "Drag to reorder",
    steer: "Steer",
    remove: "Remove queued message",
    more: "More actions",
    edit: "Edit message",
    moveUp: "Move up",
    moveDown: "Move down",
    saveEdit: "Save changes",
    cancelEdit: "Cancel editing",
    close: "Close queue",
    enable: "Enable queue mode",
    messageFallback: "Queued attachment",
  },

  workspaceExplorer: {
    title: "Explorer",
    empty: "This workspace folder is empty.",
    openFiles: "Open local files",
    files: "Workspace files",
    tree: "Workspace file tree",
    filterLabel: "Filter workspace files",
    filterPlaceholder: "Filter files…",
    clearFilter: "Clear file filter",
    refresh: "Refresh Explorer",
    collapseAll: "Collapse all folders",
    loading: "Loading workspace files…",
    loadError: "The workspace files could not be loaded.",
    retry: "Retry",
    noMatches: "No files match this filter.",
    loadingDirectory: ({ name }: { name: string }) => `Loading ${name}…`,
    loadDirectoryError: ({ name }: { name: string }) => `${name} could not be loaded.`,
    retryDirectory: ({ name }: { name: string }) => `Retry loading ${name}`,
    emptyDirectory: ({ name }: { name: string }) => `${name} is empty.`,
    openError: ({ name }: { name: string }) => `${name} could not be opened.`,
    truncated: "Some entries are not shown because this folder is very large.",
  },
  workspaceReview: {
    title: "Review",
    loadFailed: "The review could not be loaded. Try again.",
    empty: "No changed files are known yet.",
    connectHint: "Agent file changes appear here; connect a Git service for complete hunks.",
    refresh: "Refresh review",
    stage: "Stage",
    unstage: "Unstage",
    revert: "Revert",
    commentLine: "Comment on this line",
  },
  terminal: {
    title: "Terminal",
    newTerminal: "New terminal",
    toggleTitle: "Toggle terminal",
    toggleDescription: "Create a new terminal or close the active terminal",
    clear: "Clear terminal display",
    reconnect: "Reconnect terminal",
    output: "Terminal output",
    status: {
      connecting: "Connecting to PTY…",
      connected: "Connected",
      connectedProcess: ({ process, pid }: { process: string; pid: number }) =>
        `${process} · PID ${pid}`,
      disconnected: "PTY disconnected · reconnecting…",
      exited: ({ code }: { code: number }) => `Process exited with code ${code}`,
      error: "The terminal session could not be opened.",
    },
    tool: {
      view: "View in terminal",
      activityComplete: "Ran",
      activityRunning: "Running",
      collapseCommand: "Collapse command",
      expandCommand: "Expand command",
      shellTitle: "Shell",
      statusRunning: "Running",
      statusSuccess: "Success",
      interactionPossible: "May be waiting for input",
      interactionActive: "Terminal input active",
      userInputRequested: "Waiting for your input",
      openTerminal: "Open terminal",
    },
    transcript: {
      output: "Conversation terminal output",
      connecting: "Connecting to command terminal…",
      reconnecting: "Command terminal disconnected · reconnecting…",
      stopping: "Stopping command…",
      connectionError: "The command terminal connection failed",
      stop: "Stop command",
      running: "Command output is updating live",
      complete: "Command completed",
      failed: "Command did not complete",
      waiting: "Command is waiting for action",
      interactionPossible: "Command may be waiting for terminal input",
      interactionActive: "Terminal input is active",
      userInputRequested: "The command delegated terminal input to you",
      unavailable: "This command output is not available in the current conversation",
      waitingOutput: "Waiting for output…",
      noOutput: "No output",
    },
  },

  workspaceBrowser: {
    title: "Browser",
    newSession: "New browser session",
    navigateFailed: "The browser could not navigate to that address. Try again.",
    address: "Browser address",
    navigate: "Navigate",
    back: "Go back",
    forward: "Go forward",
    reload: "Reload",
    viewportTitle: "Shared browser session",
    viewportDescription:
      "This surface is attached to an independent browser session. A browser backend can provide the shared live page, screenshots, and CDP state here.",
    annotate: "Annotate browser element",
  },
  workspaceArtifact: {
    title: "Artifact",
    missing: "This artifact is no longer available.",
    rendered: "Rendered preview",
    source: "Source",
    annotate: "Annotate artifact",
  },
} as const;
