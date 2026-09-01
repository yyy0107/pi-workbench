import type { MessageFormatters } from "../types";

export const extensionsEnUS = {
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
        "Adjust interface typography, control sizing, running indicators, component surfaces, borders, and corners.",
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
          ? `${number(steps)} ${stepLabel} · ${number(files)} ${fileLabel} changed`
          : `${number(steps)} ${stepLabel}`;
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
