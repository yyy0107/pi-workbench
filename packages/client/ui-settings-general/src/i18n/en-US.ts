import type { MessageFormatters } from "@workbench/i18n/runtime";

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
      remoteDevices: {
        title: "Remote devices",
        accessTitle: "Direct access",
        description:
          "Let paired phones control sessions over the same local network or Tailscale. No Workbench account or relay is used.",
        enabled: "Enable mobile access",
        enabledDescription:
          "The listener is off by default and binds only to the interfaces selected below.",
        port: "Port",
        portDescription: "Use a port allowed by this computer's firewall. The default is 8787.",
        interfaces: "Allowed network interfaces",
        interfacesDescription:
          "Select the exact private LAN and Tailscale addresses that phones may reach.",
        noInterfaces: "No eligible private or Tailscale interface is currently available.",
        selectInterfaces: "Select network interfaces",
        selectedInterfaces: ({ count }: { count: number }, { number }: MessageFormatters) =>
          `${number(count)} interfaces selected`,
        localNetwork: "Local network",
        tailscale: "Tailscale",
        listenerStatus: "Listener status",
        noEndpoints: "Mobile access is not listening on any address.",
        saveAccess: "Apply",
        listener: {
          disabled: "Off",
          starting: "Starting",
          listening: "Listening",
          replacing: "Updating",
          stopping: "Stopping",
          failed: "Failed",
        },
        createPairing: "Pair a phone",
        pairingCode: "Manual pairing code",
        pairingQrLabel: "Pairing QR code",
        pairingExpires: "This pairing request expires shortly.",
        manualPairingHint:
          "On the phone, enter one listed IP address, this port, and the manual code.",
        pairingRequiresListener: "Enable direct access on at least one interface before pairing.",
        safetyCode: "Safety code",
        confirmSafetyCode: "Confirm matching code",
        rejectPairing: "Reject",
        cancelPairing: "Cancel pairing",
        waitingForPhone: "Waiting for a phone to scan or enter the code…",
        waitingForConfirmation: "Confirm that this code matches the phone.",
        pairedDevices: "Paired phones",
        active: "Active",
        revoked: "Revoked",
        noPairedDevices: "No phones are paired with this computer.",
        revoke: "Revoke",
        revokeLabel: "Revoke remote access for this phone",
        loadError: "Could not load remote devices. Try again.",
        pairingError: "Could not complete pairing. Create a new request and try again.",
        revokeError: "Could not revoke this phone. Refresh the list and try again.",
        saveError: "Could not apply direct-access settings. The previous listener remains active.",
        resetIdentity: "Reset pairing identity",
        resetIdentityDescription:
          "Disables access, revokes every phone, and requires all phones to pair again.",
        resetIdentityConfirm:
          "This cannot be undone. Confirm to replace this computer's pairing identity.",
        confirmReset: "Reset identity",
        cancelReset: "Keep identity",
        resetError: "Could not reset the pairing identity. Try again.",
      },
    },
    localeSelector: {
      languageTitle: "Language",
      languageDescription: "Choose the language used by Workbench controls and menus.",
      selectLanguage: "Select interface language",
    },
  },
} as const;
