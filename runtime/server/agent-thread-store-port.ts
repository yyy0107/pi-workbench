export interface AgentThreadRunTiming {
  readonly startedAt: number;
  readonly elapsedMs: number;
}

/** Runtime-neutral metadata needed to list, search, and organize Agent threads. */
export interface AgentThreadSummary {
  readonly threadId: string;
  readonly rootPath: string;
  readonly title?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly firstMessage: string;
  readonly transient: boolean;
  readonly running: boolean;
  readonly waitingForUserInput?: boolean;
  readonly runTiming?: AgentThreadRunTiming;
}

export interface AgentThreadSearchDocument {
  readonly threadId: string;
  readonly text: string;
}

export interface AgentThreadStoreCapabilities {
  readonly requestedThreadId: boolean;
  readonly preset: boolean;
}

export interface AgentThreadCreateInput {
  readonly rootPath: string;
  readonly requestedThreadId?: string;
  readonly preset?: string;
}

export interface AgentThreadCreateResult {
  readonly threadId: string;
  readonly preset?: string;
}

export interface AgentThreadRenameResult {
  /** Optional revision of the implementation's canonical event journal. */
  readonly revision?: number;
}

export const AGENT_THREAD_STORE_ERROR_CODES = [
  "thread-not-found",
  "thread-id-conflict",
  "invalid-root",
  "busy",
  "fork-unavailable",
  "unsupported",
  "internal",
] as const;

export type AgentThreadStoreErrorCode = (typeof AGENT_THREAD_STORE_ERROR_CODES)[number];

export interface AgentThreadStoreErrorDetails {
  readonly existingRootPath?: string;
}

/** Stable repository failure emitted before protocol-specific error projection. */
export class AgentThreadStoreError extends Error {
  readonly code: AgentThreadStoreErrorCode;
  readonly details: AgentThreadStoreErrorDetails;

  constructor(
    code: AgentThreadStoreErrorCode,
    message: string,
    details: AgentThreadStoreErrorDetails = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AgentThreadStoreError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Runtime-neutral server port for thread catalog and lifecycle persistence.
 * Implementations own SDK session objects, on-disk formats, and implementation error codes.
 */
export interface AgentThreadStorePort {
  readonly capabilities: AgentThreadStoreCapabilities;
  list(): Promise<readonly AgentThreadSummary[]>;
  listSearchDocuments(): Promise<readonly AgentThreadSearchDocument[]>;
  create(input: AgentThreadCreateInput): Promise<AgentThreadCreateResult>;
  rename(input: Readonly<{ threadId: string; title: string }>): Promise<AgentThreadRenameResult>;
  fork(
    input: Readonly<{ threadId: string; atEventRevision?: number }>,
  ): Promise<Readonly<{ threadId: string }>>;
  delete(input: Readonly<{ threadId: string }>): Promise<void>;
}
