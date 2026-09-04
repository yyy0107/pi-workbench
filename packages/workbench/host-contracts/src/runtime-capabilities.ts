/** Host filesystem entry safe to expose to Workbench UI. */
export interface WorkbenchHostDirectoryEntry {
  name: string;
  path: string;
  hidden: boolean;
}

export interface WorkbenchHostDirectoryListing {
  path: string;
  home: string;
  crumbs: WorkbenchHostDirectoryEntry[];
  entries: WorkbenchHostDirectoryEntry[];
  truncated: boolean;
}

export interface WorkbenchProjectTrust {
  path: string;
  requiresTrust: boolean;
  trusted: boolean | null;
  promptRequired: boolean;
  decisionPath?: string;
}

export type WorkbenchLocalAppKind = "editor" | "media-player" | "terminal" | "file-manager";

export type WorkbenchLocalAppFileKind =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "document"
  | "archive"
  | "other";

/** Renderer-safe metadata. Executable paths and launch arguments remain in the Runtime Host. */
export interface WorkbenchLocalApp {
  id: string;
  name: string;
  kind: WorkbenchLocalAppKind;
  icon?: string;
  supportedFileKinds: readonly WorkbenchLocalAppFileKind[];
}

export interface WorkbenchLocalAppOpenRequest {
  appId: string;
  target: string;
}

export type WorkbenchLocalAppPlatform = "windows" | "macos" | "linux";
export interface WorkbenchLocalAppsListResult {
  apps: WorkbenchLocalApp[];
}
export interface WorkbenchLocalAppOpenResult {
  opened: true;
}
