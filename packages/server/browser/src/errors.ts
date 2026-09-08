export type BrowserErrorCode =
  | "browser-unavailable"
  | "browser-invalid"
  | "browser-session-missing"
  | "browser-permission-denied"
  | "browser-page-loading"
  | "browser-element-stale"
  | "browser-element-not-interactable"
  | "browser-operation-failed"
  | "browser-user-active"
  | "browser-file-too-large";

const messages: Record<BrowserErrorCode, string> = {
  "browser-unavailable":
    "Chrome or Chromium could not be started. Install Chrome or configure WORKBENCH_BROWSER_EXECUTABLE.",
  "browser-invalid": "The browser request is invalid.",
  "browser-session-missing": "The browser tab is no longer available.",
  "browser-permission-denied": "The browser operation is not permitted by browser settings.",
  "browser-page-loading": "The page is still loading. Request a new snapshot before interacting.",
  "browser-element-stale": "This element reference is no longer valid. Request a new snapshot.",
  "browser-element-not-interactable": "The requested element cannot be interacted with.",
  "browser-operation-failed": "The browser operation could not be completed.",
  "browser-user-active":
    "The user is operating this tab. This action yielded immediately; earlier steps may already have taken effect. Read a fresh snapshot before retrying after the user becomes idle, or continue work in another tab. Do not busy-retry or cancel the agent run.",
  "browser-file-too-large": "The browser file exceeds the supported size.",
};

export class BrowserError extends Error {
  readonly code: BrowserErrorCode;
  constructor(code: BrowserErrorCode, detail?: string) {
    super(detail ? `${messages[code]} ${detail.slice(0, 2048)}` : messages[code]);
    this.code = code;
    this.name = "BrowserError";
  }
}
