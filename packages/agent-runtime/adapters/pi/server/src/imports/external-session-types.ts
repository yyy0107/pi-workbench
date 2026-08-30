import type { Message } from "@earendil-works/pi-ai";

import type {
  ExternalSessionImportIssue,
  ExternalSessionImportScanValue,
  ExternalSessionImportView,
  ExternalSessionSource,
} from "@workbench/agent-runtime-pi-protocol/rpc";

export type { ExternalSessionImportIssue, ExternalSessionSource };

export type ExternalSessionDescriptor = ExternalSessionImportView;

export type ExternalSessionSourceSnapshot = ExternalSessionImportScanValue["sources"][number];

export type ExternalSessionScanSnapshot = ExternalSessionImportScanValue;

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
