import type { Message } from "@earendil-works/pi-ai";

export const EXTERNAL_SESSION_SOURCES = ["codex", "claude-code", "cursor"] as const;

export type ExternalSessionSource = (typeof EXTERNAL_SESSION_SOURCES)[number];

export type ExternalSessionImportIssue =
  | "source-unavailable"
  | "source-unreadable"
  | "workspace-missing"
  | "workspace-not-directory"
  | "conversation-empty"
  | "conversation-unsupported";

export interface ExternalSessionDescriptor {
  source: ExternalSessionSource;
  sourceSessionId: string;
  title: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
  subagent?: boolean;
  importable: boolean;
  alreadyImported: boolean;
  issue?: ExternalSessionImportIssue;
}

export interface ExternalSessionSourceSnapshot {
  source: ExternalSessionSource;
  status: "ready" | "not-found" | "error";
  sessions: ExternalSessionDescriptor[];
}

export interface ExternalSessionScanSnapshot {
  sources: ExternalSessionSourceSnapshot[];
}

export interface LoadedExternalSession {
  descriptor: Omit<ExternalSessionDescriptor, "alreadyImported" | "importable" | "issue">;
  messages: Message[];
  model?: {
    provider: string;
    modelId: string;
  };
}

export interface ExternalSessionSourceAdapter {
  readonly source: ExternalSessionSource;
  scan(): Promise<ExternalSessionSourceSnapshot>;
  load(sourceSessionId: string): Promise<LoadedExternalSession | undefined>;
}
