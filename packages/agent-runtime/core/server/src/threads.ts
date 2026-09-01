import type { AutomationSessionOrigin } from "@workbench/automation-contracts";

import type { AgentForkPointToken, AgentMutationToken } from "./tokens";

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
  readonly automationOrigin?: AutomationSessionOrigin;
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
  /** Optional opaque state produced by the mutation and meaningful only to its implementation. */
  readonly stateToken?: AgentMutationToken;
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

export interface AgentThreadSearchPort {
  listDocuments(): Promise<readonly AgentThreadSearchDocument[]>;
}

export interface AgentThreadForkPort {
  fork(
    input: Readonly<{ threadId: string; atStateToken?: AgentForkPointToken }>,
  ): Promise<Readonly<{ threadId: string }>>;
}

/**
 * Runtime-neutral required thread catalog and lifecycle surface.
 *
 * Search and fork are explicit optional subports. Implementations own SDK session objects,
 * on-disk formats, and implementation error codes.
 */
export interface AgentThreadStorePort {
  readonly capabilities: AgentThreadStoreCapabilities;
  list(): Promise<readonly AgentThreadSummary[]>;
  create(input: AgentThreadCreateInput): Promise<AgentThreadCreateResult>;
  rename(input: Readonly<{ threadId: string; title: string }>): Promise<AgentThreadRenameResult>;
  delete(input: Readonly<{ threadId: string }>): Promise<void>;
  readonly search?: AgentThreadSearchPort;
  readonly fork?: AgentThreadForkPort;
}
