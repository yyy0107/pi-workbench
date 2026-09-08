export const BROWSER_WEBSOCKET_PATH = "/api/browser/ws";
export const MAX_BROWSER_MESSAGE_BYTES = 16 * 1024 * 1024;

export type BrowserPermission = "navigate" | "history" | "download" | "upload";
export type BrowserPermissionDecision = "allow" | "ask" | "deny";
export interface BrowserSitePermissions {
  origin: string;
  permissions?: Partial<Record<BrowserPermission, BrowserPermissionDecision>>;
  siteTools?: boolean;
}
export interface BrowserSettings {
  webLinks: "external" | "embedded";
  localLinks: "external" | "embedded";
  showFullUrl: boolean;
  fitToWidth: boolean;
  defaultZoom: number;
  annotationScreenshots: "always" | "ask" | "never";
  downloadDirectory: string;
  askDownloadLocation: boolean;
  permissions: Record<BrowserPermission, BrowserPermissionDecision>;
  siteTools: boolean;
  fullCdpAccess: boolean;
  sites: BrowserSitePermissions[];
}
export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
  webLinks: "external",
  localLinks: "embedded",
  showFullUrl: false,
  fitToWidth: true,
  defaultZoom: 1,
  annotationScreenshots: "ask",
  downloadDirectory: "",
  askDownloadLocation: false,
  permissions: { navigate: "ask", history: "ask", download: "ask", upload: "ask" },
  siteTools: true,
  fullCdpAccess: false,
  sites: [],
};

export interface BrowserDevice {
  width: number;
  height: number;
  mobile: boolean;
}
export interface BrowserSessionState {
  id: string;
  projectId: string;
  url: string;
  title: string;
  status: "loading" | "ready" | "error" | "disconnected" | "permission-required";
  error?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  revision: number;
  zoom: number;
  fitToWidth: boolean;
  width: number;
  height: number;
  device?: BrowserDevice;
}
export type BrowserPage =
  | "history"
  | "downloads"
  | "passwords"
  | "contacts"
  | "site-settings"
  | "settings"
  | "clear-data"
  | "download-settings"
  | "import";
export const BROWSER_PAGES: Record<BrowserPage, string> = {
  history: "chrome://history/",
  downloads: "chrome://downloads/",
  passwords: "chrome://password-manager/passwords",
  contacts: "chrome://settings/addresses",
  "site-settings": "chrome://settings/content",
  settings: "chrome://settings/",
  "clear-data": "chrome://settings/clearBrowserData",
  "download-settings": "chrome://settings/downloads",
  import: "chrome://password-manager/settings",
};
export interface BrowserFile {
  name: string;
  mimeType: string;
  data: string;
  viewport?: { width: number; height: number };
  capture?: { width: number; height: number };
}
export interface BrowserDownload {
  id: string;
  name: string;
  url: string;
  state: "inProgress" | "completed" | "canceled";
  receivedBytes: number;
  totalBytes: number;
}
export type BrowserInput =
  | {
      kind: "mouse";
      type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
      x: number;
      y: number;
      button?: "none" | "left" | "middle" | "right";
      buttons?: number;
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
      modifiers?: number;
    }
  | {
      kind: "key";
      type: "keyDown" | "keyUp";
      key: string;
      code: string;
      text?: string;
      windowsVirtualKeyCode?: number;
      modifiers?: number;
    }
  | { kind: "text"; text: string };
export type BrowserCommand =
  | { type: "attach"; sessionId: string; projectId: string; url?: string }
  | { type: "navigate"; sessionId: string; url: string }
  | { type: "back" | "forward" | "reload" | "stop" | "close" | "print" | "copy"; sessionId: string }
  | { type: "screenshot"; sessionId: string; fullPage?: boolean }
  | {
      type: "viewport";
      sessionId: string;
      width: number;
      height: number;
      visible: boolean;
      /** Requested image pixels per displayed CSS pixel; layout and input stay in CSS pixels. */
      deviceScaleFactor?: number;
      zoom?: number;
      fitToWidth?: boolean;
      device?: BrowserDevice | null;
    }
  | { type: "input"; sessionId: string; event: BrowserInput }
  | { type: "find"; sessionId: string; text: string; backwards?: boolean; matchCase?: boolean }
  | { type: "open-page"; sessionId: string; page: BrowserPage }
  | { type: "settings.get" }
  | { type: "settings.update"; patch: Partial<BrowserSettings> }
  | { type: "cookies.import" | "passwords.import"; data: string }
  | { type: "permission.respond"; requestId: string; allow: boolean }
  | { type: "upload"; sessionId: string; requestId: string; files: BrowserFile[] }
  | { type: "dialog.respond"; sessionId: string; accept: boolean; text?: string }
  | { type: "downloads.list" | "downloads.clear" }
  | { type: "download.read" | "download.cancel"; downloadId: string }
  | { type: "cdp"; sessionId: string; method: string; params?: Record<string, unknown> }
  | { type: "site-tools.list"; sessionId: string }
  | {
      type: "site-tools.call";
      sessionId: string;
      name: string;
      arguments: Record<string, unknown>;
    };

export type BrowserEvent =
  | { type: "state"; session: BrowserSessionState }
  | {
      type: "frame";
      sessionId: string;
      data: string;
      mimeType?: "image/jpeg" | "image/png";
      /** Visible page bounds in CSS input coordinates, independent of bitmap resolution. */
      width: number;
      height: number;
    }
  | { type: "settings"; settings: BrowserSettings }
  | {
      type: "permission";
      requestId: string;
      sessionId: string;
      origin: string;
      action: BrowserPermission;
    }
  | { type: "file-chooser"; sessionId: string; requestId: string; multiple: boolean }
  | {
      type: "dialog";
      sessionId: string;
      kind: string;
      message: string;
      defaultPrompt?: string;
      url?: string;
    }
  | { type: "download"; download: BrowserDownload }
  | { type: "file"; file: BrowserFile }
  | { type: "error"; sessionId?: string; code: string };
export interface BrowserClientFrame {
  id: string;
  command: BrowserCommand;
  source?: "agent";
}
export type BrowserServerFrame =
  | BrowserEvent
  | { type: "result"; id: string; result: unknown }
  | { type: "error"; id: string; code: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function string(value: unknown, maximum = 8192): value is string {
  return typeof value === "string" && value.length <= maximum;
}
function finite(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}
function member(value: unknown, options: readonly string[]): boolean {
  return typeof value === "string" && options.includes(value);
}
const permissions = ["navigate", "history", "download", "upload"] as const;
const decisions = ["allow", "ask", "deny"];
function validPermissions(value: unknown): boolean {
  return (
    record(value) &&
    Object.entries(value).every(
      ([key, choice]) => member(key, permissions) && member(choice, decisions),
    )
  );
}
export function parseBrowserSettingsPatch(value: unknown): Partial<BrowserSettings> | undefined {
  if (!record(value)) return undefined;
  for (const [key, field] of Object.entries(value)) {
    switch (key) {
      case "webLinks":
      case "localLinks":
        if (!member(field, ["external", "embedded"])) return undefined;
        break;
      case "showFullUrl":
      case "fitToWidth":
      case "askDownloadLocation":
      case "siteTools":
      case "fullCdpAccess":
        if (typeof field !== "boolean") return undefined;
        break;
      case "defaultZoom":
        if (!finite(field, 0.25, 3)) return undefined;
        break;
      case "annotationScreenshots":
        if (!member(field, ["always", "ask", "never"])) return undefined;
        break;
      case "downloadDirectory":
        if (!string(field, 4096) || field.includes("\0")) return undefined;
        break;
      case "permissions":
        if (!validPermissions(field)) return undefined;
        break;
      case "sites":
        if (
          !Array.isArray(field) ||
          field.length > 200 ||
          !field.every((site) => {
            if (
              !record(site) ||
              !string(site.origin, 2048) ||
              (site.permissions !== undefined && !validPermissions(site.permissions)) ||
              (site.siteTools !== undefined && typeof site.siteTools !== "boolean")
            )
              return false;
            try {
              const url = new URL(site.origin);
              return ["http:", "https:"].includes(url.protocol) && url.origin === site.origin;
            } catch {
              return false;
            }
          })
        )
          return undefined;
        break;
      default:
        return undefined;
    }
  }
  return value as Partial<BrowserSettings>;
}
function device(value: unknown): boolean {
  return (
    record(value) &&
    finite(value.width, 240, 3840) &&
    finite(value.height, 240, 3840) &&
    typeof value.mobile === "boolean"
  );
}
function input(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.kind === "text") return string(value.text, 65536);
  if (value.modifiers !== undefined && !finite(value.modifiers, 0, 15)) return false;
  if (value.kind === "key")
    return (
      member(value.type, ["keyDown", "keyUp"]) &&
      string(value.key, 128) &&
      string(value.code, 128) &&
      (value.text === undefined || string(value.text, 1024)) &&
      (value.windowsVirtualKeyCode === undefined || finite(value.windowsVirtualKeyCode, 0, 255))
    );
  return (
    value.kind === "mouse" &&
    member(value.type, ["mousePressed", "mouseReleased", "mouseMoved", "mouseWheel"]) &&
    finite(value.x, 0, 16384) &&
    finite(value.y, 0, 16384) &&
    (value.button === undefined || member(value.button, ["none", "left", "middle", "right"])) &&
    (value.buttons === undefined || finite(value.buttons, 0, 31)) &&
    (value.clickCount === undefined || finite(value.clickCount, 0, 3)) &&
    (value.deltaX === undefined || finite(value.deltaX, -10000, 10000)) &&
    (value.deltaY === undefined || finite(value.deltaY, -10000, 10000))
  );
}
export function parseBrowserCommand(value: unknown): BrowserCommand | undefined {
  if (!record(value) || !string(value.type, 64)) return undefined;
  if ("sessionId" in value && (!string(value.sessionId, 256) || !value.sessionId)) return undefined;
  let valid = false;
  switch (value.type) {
    case "settings.get":
    case "downloads.list":
    case "downloads.clear":
      valid = true;
      break;
    case "settings.update":
      valid = parseBrowserSettingsPatch(value.patch) !== undefined;
      break;
    case "cookies.import":
    case "passwords.import":
      valid = string(value.data, 8 * 1024 * 1024);
      break;
    case "permission.respond":
      valid = string(value.requestId, 256) && typeof value.allow === "boolean";
      break;
    case "download.read":
    case "download.cancel":
      valid = string(value.downloadId, 256);
      break;
    default:
      if (!string(value.sessionId, 256) || !value.sessionId) return undefined;
      switch (value.type) {
        case "attach":
          valid = string(value.projectId, 1024) && (value.url === undefined || string(value.url));
          break;
        case "navigate":
          valid = string(value.url);
          break;
        case "back":
        case "forward":
        case "reload":
        case "stop":
        case "close":
        case "print":
        case "copy":
        case "site-tools.list":
          valid = true;
          break;
        case "screenshot":
          valid = value.fullPage === undefined || typeof value.fullPage === "boolean";
          break;
        case "viewport":
          valid =
            finite(value.width, 1, 7680) &&
            finite(value.height, 1, 7680) &&
            typeof value.visible === "boolean" &&
            (value.deviceScaleFactor === undefined || finite(value.deviceScaleFactor, 1, 3)) &&
            (value.zoom === undefined || finite(value.zoom, 0.25, 3)) &&
            (value.fitToWidth === undefined || typeof value.fitToWidth === "boolean") &&
            (value.device === undefined || value.device === null || device(value.device));
          break;
        case "input":
          valid = input(value.event);
          break;
        case "find":
          valid =
            string(value.text, 1024) &&
            (value.backwards === undefined || typeof value.backwards === "boolean") &&
            (value.matchCase === undefined || typeof value.matchCase === "boolean");
          break;
        case "open-page":
          valid = typeof value.page === "string" && Object.hasOwn(BROWSER_PAGES, value.page);
          break;
        case "upload":
          valid =
            string(value.requestId, 256) &&
            Array.isArray(value.files) &&
            value.files.length <= 20 &&
            value.files.every(
              (file) =>
                record(file) &&
                string(file.name, 255) &&
                !/[\\/\0]/.test(file.name) &&
                string(file.mimeType, 256) &&
                string(file.data, 12 * 1024 * 1024) &&
                /^[A-Za-z0-9+/]*={0,2}$/.test(file.data),
            );
          break;
        case "dialog.respond":
          valid =
            typeof value.accept === "boolean" &&
            (value.text === undefined || string(value.text, 65536));
          break;
        case "cdp":
          valid =
            string(value.method, 256) &&
            /^[A-Za-z]+\.[A-Za-z]+$/.test(value.method) &&
            (value.params === undefined || record(value.params));
          break;
        case "site-tools.call":
          valid = string(value.name, 256) && record(value.arguments);
          break;
      }
  }
  return valid ? (value as BrowserCommand) : undefined;
}
export function parseBrowserClientFrame(value: unknown): BrowserClientFrame | undefined {
  if (
    !record(value) ||
    !string(value.id, 128) ||
    !value.id ||
    (value.source !== undefined && value.source !== "agent")
  )
    return undefined;
  const command = parseBrowserCommand(value.command);
  return command
    ? { id: value.id, command, ...(value.source === "agent" ? { source: "agent" as const } : {}) }
    : undefined;
}
