export const DESKTOP_NOTIFICATION_SOUNDS = ["chime", "soft", "bell", "droplet"] as const;
export type DesktopNotificationSound = (typeof DESKTOP_NOTIFICATION_SOUNDS)[number];

export const DESKTOP_TERMINAL_SHELLS = ["powershell", "command-prompt"] as const;
export type DesktopTerminalShell = (typeof DESKTOP_TERMINAL_SHELLS)[number];

export function isDesktopNotificationSound(value: unknown): value is DesktopNotificationSound {
  return DESKTOP_NOTIFICATION_SOUNDS.some((sound) => sound === value);
}

export function isDesktopTerminalShell(value: unknown): value is DesktopTerminalShell {
  return DESKTOP_TERMINAL_SHELLS.some((shell) => shell === value);
}

export interface DesktopPreferences {
  hardwareAcceleration: boolean;
  keepAwake: boolean;
  previewUpdates: boolean;
  automaticUpdates: boolean;
  taskNotifications: boolean;
  notificationSounds: boolean;
  notificationSound: DesktopNotificationSound;
  terminalShell: DesktopTerminalShell;
  httpProxy: string;
  noProxy: string;
}
export interface DesktopSettingsSnapshot {
  preferences: DesktopPreferences;
  update: {
    status:
      | "idle"
      | "development"
      | "checking"
      | "current"
      | "available"
      | "downloading"
      | "downloaded"
      | "error";
    version?: string;
    percent?: number;
    error?: string;
  };
  version: string;
  platform: string;
  tokenConfigured: boolean;
  restartRequired: boolean;
  notificationsSupported: boolean;
}
export interface DesktopSettingsPort {
  load(): Promise<DesktopSettingsSnapshot>;
  update(patch: Partial<DesktopPreferences>): Promise<DesktopSettingsSnapshot>;
  setUpdateToken(token: string): Promise<DesktopSettingsSnapshot>;
  runUpdate(action: "check" | "download" | "install"): Promise<DesktopSettingsSnapshot>;
  subscribe(listener: (snapshot: DesktopSettingsSnapshot) => void): () => void;
  syncTasks(state: {
    locale: string;
    tasks: { id: string; title: string; running: boolean; waiting: boolean; failed: boolean }[];
  }): Promise<void>;
  onOpenTask(listener: (id: string) => void): () => void;
  onNotificationSound?(listener: (sound: DesktopNotificationSound) => void): () => void;
}
export function readDesktopSettingsPort(value: unknown): DesktopSettingsPort | undefined {
  if (!value || typeof value !== "object") return undefined;
  const port = value as Record<string, unknown>;
  const hasRequiredMethods = [
    "load",
    "update",
    "setUpdateToken",
    "runUpdate",
    "subscribe",
    "syncTasks",
    "onOpenTask",
  ].every((key) => typeof port[key] === "function");
  return hasRequiredMethods &&
    (port.onNotificationSound === undefined || typeof port.onNotificationSound === "function")
    ? (value as DesktopSettingsPort)
    : undefined;
}
