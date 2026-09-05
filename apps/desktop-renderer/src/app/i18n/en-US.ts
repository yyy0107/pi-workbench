import type { MessageFormatters } from "@workbench/shell/i18n";
export const desktopRendererEnUS = {
  metadata: {
    description: "A composable AI workbench built on the Workbench Agent Runtime.",
  },
  bootstrap: {
    title: "Pi Workbench",
    loading: "Connecting to the local Workbench Runtime…",
    failed: "The local Workbench Runtime could not be initialized.",
    retry: "Retry",
  },
  settings: {
    title: "Desktop",
    hardwareAcceleration: "Chrome hardware acceleration",
    hardwareAccelerationDescription:
      "Use GPU acceleration for rendering. Restart the app after changing this setting.",
    previewUpdates: "Receive preview updates",
    previewUpdatesDescription:
      "Include prerelease versions from the configured GitHub repository. Turning off keeps the current version until a newer stable release is available.",
    automaticUpdates: "Automatically download and install updates",
    automaticUpdatesDescription:
      "Download available updates automatically and restart if no tasks are running. While tasks are active, installation waits for your confirmation.",
    taskNotifications: "Task notifications",
    taskNotificationsDescription:
      "Send desktop notifications when tasks complete, fail, or need your response.",
    notificationSounds: "Notification sounds",
    notificationSoundsDescription:
      "Choose a built-in tone for task notifications, or turn sound off. Changes apply immediately.",
    notificationSound: "Notification tone",
    previewSound: "Preview",
    soundFailed: "Could not play the sound. Check your audio output and try Preview again.",
    sounds: { chime: "Chime", soft: "Soft", bell: "Bell", droplet: "Droplet" },
    keepAwake: "Keep the computer awake",
    keepAwakeDescription:
      "Prevent idle system sleep while the app is open. Manual sleep and lid closure still work.",
    terminalShell: "Integrated terminal Shell",
    terminalShellDescription:
      "Choose the default Shell used by integrated and agent tool terminals. Restart required.",
    terminalShells: { powershell: "PowerShell", "command-prompt": "Command Prompt" },
    httpProxy: "HTTP proxy",
    httpProxyDescription:
      "One proxy for models, MCP, command tools, and the built-in browser. Leave empty for direct runtime traffic and the browser’s system proxy. Restart required.",
    httpProxyPlaceholder: "http://127.0.0.1:7890",
    noProxy: "Addresses that bypass the proxy",
    noProxyDescription:
      "Comma-separated host rules; loopback traffic always bypasses the proxy. Restart required.",
    noProxyPlaceholder: "localhost,127.0.0.1,::1,.example.com,*.corp.com",
    networkSaveDescription: "Save the proxy and bypass rules together.",
    save: "Save",
    clear: "Clear",
    updates: "Application updates",
    updateSource: "Release source: yyy0107/pi-workbench (private GitHub repository).",
    updateToken: "GitHub update token",
    tokenConfigured:
      "A token is configured on this machine. Saved tokens use the operating system’s secure storage.",
    tokenMissing:
      "Provide a token with read access to this repository’s Releases, or set PI_WORKBENCH_UPDATE_TOKEN before launching the app.",
    checkUpdates: "Check for updates",
    install: "Restart and install",
    download: "Download update",
    loading: "Loading…",
    connectionUnavailable:
      "Desktop settings are not connected. Fully quit and reopen Pi Workbench to load them; refreshing this page is not enough.",
    loadError:
      "Could not load desktop settings. Retry, or fully quit and reopen Pi Workbench if you just updated the app.",
    soundRestartRequired:
      "Fully quit and reopen Pi Workbench to enable built-in notification tones.",
    retry: "Retry",
    restartRequired:
      "Quit and reopen the app to apply terminal, hardware acceleration, and network changes.",
    notificationsUnsupported: "Desktop notifications are unavailable on this system.",
    invalidProxy: "Enter an HTTP or HTTPS proxy origin without credentials, path, or query.",
    invalidBypass: "Use comma-separated host rules without spaces, slashes, or semicolons.",
    secureStorageUnavailable:
      "Secure OS storage is unavailable. Set PI_WORKBENCH_UPDATE_TOKEN before launching the app instead.",
    updateInProgress: "Wait for the update operation to finish before changing these settings.",
    error: "The desktop operation failed. Retry to reload the saved settings.",
    updateStatus: {
      idle: "Ready to check",
      development: "Updates are available in the packaged desktop app.",
      checking: "Checking for updates…",
      current: "This version is up to date.",
      available: "An update is available.",
      downloading: "Downloading…",
      downloaded: "Downloaded and ready to install.",
      error:
        "Update failed. Check your token, network connection, and the repository’s update assets.",
    },
    version: ({ version }: { version: string }) => `Version ${version}`,
    progress: ({ percent }: { percent: number }, { number }: MessageFormatters) =>
      number(percent / 100, { style: "percent" }),
  },
  runtime: {
    category: "Desktop",
    restart: {
      title: "Restart local service",
      description: "Restart the local Workbench Runtime and reload the desktop workspace.",
    },
  },
} as const;
