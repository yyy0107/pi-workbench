export type BrowserErrorCode =
  | "browser-unavailable"
  | "browser-invalid"
  | "browser-session-missing"
  | "browser-permission-denied"
  | "browser-operation-failed"
  | "browser-file-too-large";

const messages: Record<BrowserErrorCode, string> = {
  "browser-unavailable":
    "Chrome or Chromium could not be started. Install Chrome or configure WORKBENCH_BROWSER_EXECUTABLE.",
  "browser-invalid": "The browser request is invalid.",
  "browser-session-missing": "The browser tab is no longer available.",
  "browser-permission-denied": "The browser operation is not permitted by browser settings.",
  "browser-operation-failed": "The browser operation could not be completed.",
  "browser-file-too-large": "The browser file exceeds the supported size.",
};

export class BrowserError extends Error {
  readonly code: BrowserErrorCode;
  constructor(code: BrowserErrorCode) {
    super(messages[code]);
    this.code = code;
    this.name = "BrowserError";
  }
}
