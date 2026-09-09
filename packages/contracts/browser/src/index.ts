export const BROWSER_WEBSOCKET_PATH = "/api/browser/ws";
export const MAX_BROWSER_MESSAGE_BYTES = 16 * 1024 * 1024;
/** Shared timing for the native click pause and its visible pointer animation. */
export const BROWSER_CLICK_PREPARE_MS = 1000;

/** Shared tool identities let the workspace reveal completed native browser operations. */
export const BROWSER_TOOL_ACTIONS = {
  browser_setup: "attach",
  browser_click: "click",
  browser_type: "type",
  browser_fill: "fill",
  browser_fill_form: "fill-form",
  browser_select_option: "select",
  browser_set_checked: "set-checked",
  browser_focus: "focus",
  browser_press_key: "press-key",
  browser_dispatch_key: "dispatch-key",
  browser_scroll: "scroll",
  browser_page_info: "page-info",
  browser_wait: "wait",
  browser_wait_for: "wait-for",
  browser_wait_for_load: "wait-for-load",
  browser_handle_dialog: "dialog.respond",
  browser_screenshot: "screenshot",
  browser_navigate: "navigate",
  browser_open_urls: "open-urls",
  browser_go_back: "back",
  browser_go_forward: "forward",
  browser_reload: "reload",
  browser_list_tabs: "tabs.list",
  browser_current_tab: "tabs.current",
  browser_switch_tab: "tabs.switch",
  browser_new_tab: "attach",
  browser_close_tab: "close",
  browser_upload_file: "upload",
  browser_download: "download.configure",
  browser_print_to_pdf: "print",
  browser_viewport_resize: "viewport",
  browser_drag_and_drop: "drag",
  browser_http_get: "http-get",
  browser_network_requests: "network",
  browser_console: "console",
  browser_snapshot: "snapshot",
  browser_execute_js: "evaluate",
  browser_run_script: "run-script",
  browser_web_search: "web-search",
  browser_read_page: "read-page",
} as const;

export type BrowserPermission = "history" | "download" | "upload";
export type BrowserPermissionDecision = "allow" | "ask" | "deny";
export interface BrowserSitePermissions {
  origin: string;
  permissions?: Partial<Record<BrowserPermission, BrowserPermissionDecision>>;
  siteTools?: boolean;
}
export interface BrowserSettings {
  connection: "embedded" | "chrome";
  chromeEndpoint: string;
  chromeUserDataDirectory: string;
  chromeProfile: string;
  webLinks: "external" | "embedded";
  localLinks: "external" | "embedded";
  showFullUrl: boolean;
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
  connection: "embedded",
  chromeEndpoint: "",
  chromeUserDataDirectory: "",
  chromeProfile: "",
  webLinks: "external",
  localLinks: "embedded",
  showFullUrl: false,
  defaultZoom: 1,
  annotationScreenshots: "ask",
  downloadDirectory: "",
  askDownloadLocation: false,
  permissions: { history: "ask", download: "ask", upload: "ask" },
  siteTools: true,
  fullCdpAccess: false,
  sites: [],
};

export interface BrowserProfile {
  id: string;
  name: string;
  browser: string;
  userDataDirectory: string;
  profileDirectory: string;
  lastUsed: boolean;
}

export interface BrowserDevice {
  width: number;
  height: number;
  mobile: boolean;
}
export interface BrowserHistoryEntry {
  url: string;
  title: string;
  /** Most recent visit time, in milliseconds since the Unix epoch. */
  time: number;
}
/** Pointer position in the remote page's CSS viewport. */
export interface BrowserCursor {
  x: number;
  y: number;
  pressed?: boolean;
  preparingClick?: boolean;
}
export interface BrowserSessionState {
  id: string;
  projectId: string;
  threadId?: string;
  url: string;
  title: string;
  status: "loading" | "ready" | "error" | "disconnected" | "permission-required";
  error?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  revision: number;
  zoom: number;
  width: number;
  height: number;
  device?: BrowserDevice;
  agentControlled?: boolean;
  agentCursor?: BrowserCursor;
  /** Recent user input takes priority over agent mutations in this tab. */
  userControlled?: boolean;
  userCursor?: BrowserCursor;
}
export interface BrowserSnapshotNode {
  depth: number;
  role: string;
  name: string;
  ref?: string;
  value?: string;
  disabled?: boolean;
  checked?: boolean | "mixed";
  selected?: boolean;
  expanded?: boolean;
  unavailable?: "frame";
  frameId?: string;
  /** Current viewport CSS coordinates; refs re-resolve geometry when used. */
  bounds?: { x: number; y: number; width: number; height: number };
}
export interface BrowserSnapshot {
  session: BrowserSessionState;
  snapshotId: string;
  nodes: BrowserSnapshotNode[];
  truncated: boolean;
}
export type BrowserElementTarget =
  | { ref: string; selector?: never }
  | { selector: string; ref?: never; frameId?: string };
export interface BrowserConsoleEntry {
  seq: number;
  timestamp: number;
  level: string;
  text: string;
  url?: string;
}
export interface BrowserNetworkEntry {
  seq: number;
  requestId: string;
  redirected?: boolean;
  url: string;
  method: string;
  type: string;
  timestamp: number;
  status?: number;
  mimeType?: string;
  durationMs?: number;
  size?: number;
  failed?: string;
  finished?: boolean;
  body?: string | null;
  bodyTruncated?: boolean;
}
export interface BrowserNetworkQuery {
  sinceSeq?: number;
  sinceMs?: number;
  urlPattern?: string;
  methodFilter?: string[];
  resourceTypes?: string[];
  statusFilter?: { min?: number; max?: number };
  limit?: number;
  includeResponseBodies?: boolean;
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
  /** Actual encoded screenshot dimensions, independent of CSS coverage. */
  pixels?: { width: number; height: number };
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
type BrowserAction =
  | { type: "profiles.list"; userDataDirectory?: string }
  | { type: "connection.test" }
  | { type: "history.list"; query?: string; limit?: number }
  | { type: "tabs.list"; projectId: string; scope?: "owned" | "all"; includeInternal?: boolean }
  | { type: "attach"; sessionId: string; projectId: string; url?: string }
  | { type: "snapshot"; sessionId: string; query?: string; includeScreenshot?: boolean }
  | ({ type: "click"; sessionId: string } & BrowserElementTarget)
  | { type: "click"; sessionId: string; x: number; y: number }
  | ({ type: "fill"; sessionId: string; text: string } & BrowserElementTarget)
  | ({ type: "focus"; sessionId: string } & BrowserElementTarget)
  | ({
      type: "select";
      sessionId: string;
      value?: string;
      label?: string;
      index?: number;
    } & BrowserElementTarget)
  | ({ type: "set-checked"; sessionId: string; checked: boolean } & BrowserElementTarget)
  | ({
      type: "dispatch-key";
      sessionId: string;
      key: string;
      eventType?: "keydown" | "keyup" | "keypress";
      modifiers?: number;
    } & BrowserElementTarget)
  | {
      type: "fill-form";
      sessionId: string;
      fields: Array<{ ref: string; value: string | boolean }>;
    }
  | { type: "type"; sessionId: string; text: string }
  | { type: "press-key"; sessionId: string; key: string; modifiers?: number }
  | { type: "scroll"; sessionId: string; deltaX?: number; deltaY: number; x?: number; y?: number }
  | {
      type: "drag";
      sessionId: string;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      dataTransfer?: Record<string, string>;
    }
  | { type: "page-info" | "tabs.current" | "tabs.switch"; sessionId: string }
  | { type: "wait"; sessionId: string; seconds: number }
  | {
      type: "wait-for";
      sessionId: string;
      selector?: string;
      text?: string;
      gone?: boolean;
      timeout?: number;
    }
  | { type: "wait-for-load"; sessionId: string; timeout?: number }
  | {
      type: "console";
      sessionId: string;
      levels?: string[];
      sinceSeq?: number;
      sinceMs?: number;
      textPattern?: string;
      limit?: number;
    }
  | ({ type: "network"; sessionId: string } & BrowserNetworkQuery)
  | { type: "evaluate"; sessionId: string; expression: string; frameId?: string }
  | { type: "read-page"; sessionId: string; url?: string }
  | { type: "web-search"; sessionId: string; query: string; limit?: number }
  | { type: "navigate"; sessionId: string; url: string }
  | { type: "back" | "forward" | "reload" | "stop" | "close" | "print" | "copy"; sessionId: string }
  | {
      type: "screenshot";
      sessionId: string;
      fullPage?: boolean;
      format?: "png" | "jpeg";
      quality?: number;
      maxDim?: number;
    }
  | {
      type: "viewport";
      sessionId: string;
      width: number;
      height: number;
      visible: boolean;
      /** Requested image pixels per displayed CSS pixel; layout and input stay in CSS pixels. */
      deviceScaleFactor?: number;
      zoom?: number;
      device?: BrowserDevice | null;
    }
  | { type: "input"; sessionId: string; event: BrowserInput }
  | { type: "find"; sessionId: string; text: string; backwards?: boolean; matchCase?: boolean }
  | { type: "open-page"; sessionId: string; page: BrowserPage }
  | { type: "settings.get" }
  | { type: "settings.update"; patch: Partial<BrowserSettings> }
  | { type: "cookies.import" | "passwords.import"; data: string }
  | { type: "permission.respond"; requestId: string; allow: boolean }
  | ({ type: "upload"; sessionId: string; files: BrowserFile[] } & (
      | { requestId: string }
      | BrowserElementTarget
    ))
  | { type: "dialog.respond"; sessionId: string; accept: boolean; text?: string }
  | { type: "downloads.list" | "downloads.clear" }
  | { type: "download.read" | "download.cancel"; downloadId: string }
  | { type: "download.configure"; sessionId: string; directory?: string }
  | { type: "cdp"; sessionId: string; method: string; params?: Record<string, unknown> }
  | { type: "site-tools.list"; sessionId: string }
  | {
      type: "site-tools.call";
      sessionId: string;
      name: string;
      arguments: Record<string, unknown>;
    };

/** The host supplies the conversation scope; it is not an agent tool argument. */
export type BrowserCommand = BrowserAction & { threadId?: string };

export type BrowserEvent =
  | { type: "state"; session: BrowserSessionState }
  | { type: "popup"; session: BrowserSessionState; openerSessionId: string }
  | { type: "cursor"; sessionId: string; cursor: BrowserCursor | null }
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
const permissions = ["history", "download", "upload"] as const;
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
      case "connection":
        if (!member(field, ["embedded", "chrome"])) return undefined;
        break;
      case "chromeEndpoint":
        if (!string(field, 4096)) return undefined;
        if (field) {
          try {
            const endpoint = new URL(field);
            if (
              !["http:", "https:", "ws:", "wss:"].includes(endpoint.protocol) ||
              !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) ||
              endpoint.username ||
              endpoint.password ||
              endpoint.hash
            )
              return undefined;
          } catch {
            return undefined;
          }
        }
        break;
      case "chromeUserDataDirectory":
      case "chromeProfile":
        if (!string(field, 4096) || field.includes("\0")) return undefined;
        break;
      case "webLinks":
      case "localLinks":
        if (!member(field, ["external", "embedded"])) return undefined;
        break;
      case "showFullUrl":
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
function elementTarget(value: Record<string, unknown>): boolean {
  return value.ref !== undefined
    ? string(value.ref, 256) &&
        value.ref.length > 0 &&
        value.selector === undefined &&
        value.frameId === undefined
    : string(value.selector, 2048) &&
        value.selector.trim().length > 0 &&
        (value.frameId === undefined || (string(value.frameId, 256) && value.frameId.length > 0));
}
function strings(value: unknown, maximum = 32): value is string[] {
  return (
    Array.isArray(value) && value.length <= maximum && value.every((item) => string(item, 256))
  );
}
function cursor(value: unknown): boolean {
  return (
    value === undefined || (finite(value, 0, Number.MAX_SAFE_INTEGER) && Number.isInteger(value))
  );
}
export function parseBrowserCommand(value: unknown): BrowserCommand | undefined {
  if (!record(value) || !string(value.type, 64)) return undefined;
  if ("sessionId" in value && (!string(value.sessionId, 256) || !value.sessionId)) return undefined;
  if (value.threadId !== undefined && (!string(value.threadId, 256) || !value.threadId.trim()))
    return undefined;
  let valid = false;
  switch (value.type) {
    case "profiles.list":
      valid =
        value.userDataDirectory === undefined ||
        (string(value.userDataDirectory, 4096) && !value.userDataDirectory.includes("\0"));
      break;
    case "history.list":
      valid =
        (value.query === undefined || string(value.query, 2048)) &&
        (value.limit === undefined ||
          (finite(value.limit, 1, 100) && Number.isInteger(value.limit)));
      break;
    case "tabs.list":
      valid =
        string(value.projectId, 1024) &&
        value.projectId.length > 0 &&
        (value.scope === undefined || member(value.scope, ["owned", "all"])) &&
        (value.includeInternal === undefined || typeof value.includeInternal === "boolean");
      break;
    case "settings.get":
    case "connection.test":
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
        case "page-info":
        case "tabs.current":
        case "tabs.switch":
          valid = true;
          break;
        case "snapshot":
          valid =
            (value.query === undefined || string(value.query, 1024)) &&
            (value.includeScreenshot === undefined || typeof value.includeScreenshot === "boolean");
          break;
        case "click":
          valid =
            value.ref === undefined && value.selector === undefined
              ? finite(value.x, 0, 100000) &&
                finite(value.y, 0, 100000) &&
                value.frameId === undefined
              : elementTarget(value) && value.x === undefined && value.y === undefined;
          break;
        case "fill":
          valid = elementTarget(value) && string(value.text, 65536);
          break;
        case "focus":
          valid = elementTarget(value);
          break;
        case "select":
          valid =
            elementTarget(value) &&
            [value.value, value.label, value.index].filter((field) => field !== undefined)
              .length === 1 &&
            (value.value === undefined || string(value.value, 65536)) &&
            (value.label === undefined || string(value.label, 2048)) &&
            (value.index === undefined ||
              (finite(value.index, 0, 100000) && Number.isInteger(value.index)));
          break;
        case "set-checked":
          valid = elementTarget(value) && typeof value.checked === "boolean";
          break;
        case "dispatch-key":
        case "press-key":
          valid =
            (value.type === "press-key" || elementTarget(value)) &&
            string(value.key, 128) &&
            value.key.length > 0 &&
            (value.modifiers === undefined ||
              (finite(value.modifiers, 0, 15) && Number.isInteger(value.modifiers))) &&
            (value.eventType === undefined ||
              member(value.eventType, ["keydown", "keyup", "keypress"]));
          break;
        case "fill-form":
          valid =
            Array.isArray(value.fields) &&
            value.fields.length > 0 &&
            value.fields.length <= 100 &&
            value.fields.every(
              (field) =>
                record(field) &&
                string(field.ref, 256) &&
                field.ref.length > 0 &&
                (string(field.value, 65536) || typeof field.value === "boolean"),
            );
          break;
        case "type":
          valid = string(value.text, 65536);
          break;
        case "scroll":
          valid =
            finite(value.deltaY, -10000, 10000) &&
            (value.deltaX === undefined || finite(value.deltaX, -10000, 10000)) &&
            (value.x === undefined || finite(value.x, 0, 16384)) &&
            (value.y === undefined || finite(value.y, 0, 16384));
          break;
        case "drag":
          valid =
            [value.fromX, value.fromY, value.toX, value.toY].every((point) =>
              finite(point, 0, 16384),
            ) &&
            (value.dataTransfer === undefined ||
              (record(value.dataTransfer) &&
                Object.entries(value.dataTransfer).length <= 16 &&
                Object.entries(value.dataTransfer).every(
                  ([mime, data]) => string(mime, 256) && string(data, 65536),
                )));
          break;
        case "wait":
          valid = finite(value.seconds, 0, 60);
          break;
        case "wait-for":
          valid =
            [value.selector, value.text].filter((field) => field !== undefined).length === 1 &&
            (value.selector === undefined ||
              (string(value.selector, 2048) && value.selector.trim().length > 0)) &&
            (value.text === undefined || (string(value.text, 4096) && value.text.length > 0)) &&
            (value.gone === undefined || typeof value.gone === "boolean") &&
            (value.timeout === undefined || finite(value.timeout, 0.01, 120));
          break;
        case "wait-for-load":
          valid = value.timeout === undefined || finite(value.timeout, 0.01, 120);
          break;
        case "console":
        case "network":
          valid =
            cursor(value.sinceSeq) &&
            (value.sinceMs === undefined || finite(value.sinceMs, 0, Number.MAX_SAFE_INTEGER)) &&
            (value.textPattern === undefined || string(value.textPattern, 1024)) &&
            (value.limit === undefined ||
              (finite(value.limit, 1, 500) && Number.isInteger(value.limit))) &&
            (value.type !== "console" || value.levels === undefined || strings(value.levels)) &&
            (value.type !== "network" ||
              ((value.urlPattern === undefined || string(value.urlPattern, 1024)) &&
                (value.sinceMs === undefined ||
                  finite(value.sinceMs, 0, Number.MAX_SAFE_INTEGER)) &&
                (value.methodFilter === undefined || strings(value.methodFilter)) &&
                (value.resourceTypes === undefined || strings(value.resourceTypes)) &&
                (value.includeResponseBodies === undefined ||
                  typeof value.includeResponseBodies === "boolean") &&
                (value.statusFilter === undefined ||
                  (record(value.statusFilter) &&
                    (value.statusFilter.min === undefined ||
                      finite(value.statusFilter.min, 100, 599)) &&
                    (value.statusFilter.max === undefined ||
                      finite(value.statusFilter.max, 100, 599)) &&
                    Number(value.statusFilter.min ?? 100) <=
                      Number(value.statusFilter.max ?? 599)))));
          break;
        case "evaluate":
          valid =
            string(value.expression, 100000) &&
            value.expression.trim().length > 0 &&
            (value.frameId === undefined || string(value.frameId, 256));
          break;
        case "read-page":
          valid = value.url === undefined || (string(value.url) && value.url.trim().length > 0);
          break;
        case "download.configure":
          valid =
            value.directory === undefined ||
            (string(value.directory, 4096) && !value.directory.includes("\0"));
          break;
        case "web-search":
          valid =
            string(value.query, 2048) &&
            value.query.trim().length > 0 &&
            (value.limit === undefined ||
              (finite(value.limit, 1, 30) && Number.isInteger(value.limit)));
          break;
        case "screenshot":
          valid =
            (value.fullPage === undefined || typeof value.fullPage === "boolean") &&
            (value.format === undefined || member(value.format, ["png", "jpeg"])) &&
            (value.quality === undefined ||
              (finite(value.quality, 1, 100) && Number.isInteger(value.quality))) &&
            (value.maxDim === undefined ||
              (finite(value.maxDim, 100, 8000) && Number.isInteger(value.maxDim)));
          break;
        case "viewport":
          valid =
            finite(value.width, 1, 7680) &&
            finite(value.height, 1, 7680) &&
            typeof value.visible === "boolean" &&
            (value.deviceScaleFactor === undefined || finite(value.deviceScaleFactor, 1, 3)) &&
            (value.zoom === undefined || finite(value.zoom, 0.25, 3)) &&
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
            (value.requestId === undefined
              ? elementTarget(value)
              : string(value.requestId, 256) &&
                value.requestId.length > 0 &&
                value.ref === undefined &&
                value.selector === undefined) &&
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
