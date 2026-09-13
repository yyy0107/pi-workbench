import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  ui: {
    colorPicker: {
      hex: "Hex color",
      red: "Red",
      green: "Green",
      blue: "Blue",
      hue: "Hue",
      saturation: "Saturation and brightness",
      saturationValue: (
        { saturation, brightness }: { saturation: number; brightness: number },
        { number }: MessageFormatters,
      ) =>
        `Saturation ${number(saturation / 100, { style: "percent" })}, Brightness ${number(brightness / 100, { style: "percent" })}`,
    },
  },
  extensions: {
    settings: {
      groups: {
        basics: "Basics",
        other: "Other",
        appearance: "Appearance",
        intelligence: "AI",
        capabilities: "Capabilities",
        data: "Data",
      },
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
      general: {
        title: "General",
        description: "Configure the language and other shared Workbench preferences.",
      },
    },
    appearance: {
      title: "Theme",
      description:
        "Choose a color mode and customize theme colors, fonts, font size, and font weights.",
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
        title: "Theme configuration",
        description:
          "Colors and contrast are saved separately for light and dark themes. Fonts, font sizes, weights, and the code theme are shared. A contrast of 0 uses the default appearance. Higher values make borders, secondary text, and control surfaces stand out more against the background.",
      },
      themeSettings: {
        accent: "Accent color",
        background: "Background",
        foreground: "Foreground",
        contrast: "Contrast",
        lightAccent: "Light theme accent color",
        lightBackground: "Light theme background color",
        lightForeground: "Light theme foreground color",
        lightContrast: "Light theme contrast",
        darkAccent: "Dark theme accent color",
        darkBackground: "Dark theme background color",
        darkForeground: "Dark theme foreground color",
        darkContrast: "Dark theme contrast",
        customAccent: "Custom accent color",
        contrastValue: ({ contrast }: { contrast: number }, { number }: MessageFormatters) =>
          number(contrast),
      },
      accentColors: {
        neutral: "Neutral",
        blue: "Blue",
        green: "Green",
        orange: "Orange",
        red: "Red",
        pink: "Pink",
        purple: "Purple",
        custom: "Custom",
      },
      typography: {
        font: "UI font",
        contentFont: "Content font",
        inheritUiFont: "Same as UI font",
        inheritedWeightDescription:
          "Currently using the UI font weight. Choose a specific content font to adjust its weight separately.",
        fontWeight: "Font weight",
        fontWeightFor: ({ font }: { font: string }) => `${font} weight`,
      },
      fontWeights: {
        "300": "Light",
        "400": "Regular",
        "500": "Medium",
        "600": "Semibold",
        "700": "Bold",
      },
      interface: {
        sectionTitle: "Interface",
        description:
          "Choose your interface language and adjust control sizing, running indicators, borders, and corners.",
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
      composerAnimation: {
        title: "Composer border animation",
        description:
          "Show a flowing accent-colored border around the composer while the assistant is working.",
        enabled: "Enable border animation",
        intensity: "Effect intensity",
        intensityDescription: "Adjust the border brightness, thickness, and glow.",
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
      systemFonts: {
        loading: "Loading system fonts…",
        failed: "Could not load system fonts. Using system defaults. Reopen settings to retry.",
      },
      fontFamilies: {
        ui: { system: "System default" },
        code: { systemMono: "System monospace" },
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
          "Set a workbench base color or background image, then adjust component surface opacity and glass blur.",
        colorTitle: "Workbench base color",
        imageTitle: "Background image",
        image: "Local image",
        custom: "Customize workbench base color",
        customDescription:
          "Set the background color beneath the entire workbench, visible in the conversation area and gaps between panels. A background image covers this base color.",
        color: "Base color",
        syncSurfaces: "Blend the workbench base color into sidebars, panels, and popups",
        surfaceColorBlend: "Base color blend",
        surfaceColorBlendDescription:
          "Set the share of the selected base color in the mix; the rest uses the theme background. Higher values look closer to the selected color. Opacity is controlled separately.",
        preview: "Background image preview",
        chooseImage: "Choose image",
        replaceImage: "Replace image",
        removeImage: "Remove background image",
        loadingImage: "Loading image…",
        blur: "Image blur",
        blurRequiresImage: "Choose a background image above to adjust its blur.",
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
        requiresBackground:
          "Enable a custom workbench base color or choose a background image above to adjust these surface effects.",
        opacity: "Surface opacity",
        opacityValue: ({ opacity }: { opacity: number }, { number }: MessageFormatters) =>
          `${number(opacity)}%`,
        glassBlur: "Glass blur",
      },
      borders: {
        title: "Borders",
        style: "Border style",
        customColor: "Use a custom border color",
        colorRequiresCustom: "Enable the custom border color option above to choose a color.",
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
        fontSizeValue: ({ size }: { size: number }, { number }: MessageFormatters) =>
          `${number(size)} px`,
      },
      reset: "Restore defaults",
    },
    localeSelector: {
      languageTitle: "Language",
      languageDescription: "Choose the language used by Workbench controls and menus.",
      selectLanguage: "Select interface language",
    },
  },
};
