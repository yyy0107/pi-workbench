import type { ComposerSubmission } from "@workbench/contracts/composer";

import type { AgentBranchToken, AgentStateToken } from "./tokens";

export type AgentExecutionMode = "steer" | "follow-up";

export type AgentExecutionAttachment =
  | {
      readonly kind: "image";
      readonly data: string;
      readonly mediaType: string;
      readonly name?: string;
    }
  | {
      readonly kind: "document";
      readonly data: string;
      readonly mediaType: string;
      readonly name?: string;
    };

export interface AgentExecutionPrompt {
  readonly text: string;
  readonly attachments: readonly AgentExecutionAttachment[];
  readonly composer?: ComposerSubmission;
}

export interface AgentExecutionProvenance {
  readonly requestId?: string;
  readonly clientTimeZone?: string;
}

export interface AgentPromptSubmission {
  readonly threadId: string;
  readonly mode: AgentExecutionMode;
  readonly prompt: AgentExecutionPrompt;
  readonly provenance?: AgentExecutionProvenance;
}

export type AgentPromptAdmission =
  | { readonly kind: "started" }
  | { readonly kind: "queued"; readonly queueItemId?: string };

export type AgentQueueMutation =
  | { readonly kind: "edit"; readonly text: string }
  | { readonly kind: "remove" }
  | { readonly kind: "steer" };

export const AGENT_EXECUTION_ERROR_CODES = [
  "thread-not-found",
  "busy",
  "branch-not-found",
  "resume-stale",
  "resume-blocked",
  "resume-confirmation-required",
  "queue-item-not-found",
  "steer-unavailable",
  "prompt-rejected",
  "image-input-unsupported",
  "unsupported",
  "internal",
] as const;

export type AgentExecutionErrorCode = (typeof AGENT_EXECUTION_ERROR_CODES)[number];

/** Stable failure emitted by an Agent implementation before protocol-specific error projection. */
export class AgentExecutionError extends Error {
  readonly code: AgentExecutionErrorCode;

  constructor(code: AgentExecutionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentExecutionError";
    this.code = code;
  }
}

export interface AgentRegenerationPort {
  regenerate(
    input: Readonly<{ threadId: string; userMessageId: string; requestId?: string }>,
  ): Promise<void>;
}

export interface AgentResumePort {
  resume(
    input: Readonly<{
      threadId: string;
      checkpointId: string;
      expectedStateToken: AgentStateToken;
    }>,
  ): Promise<void>;
}

export interface AgentBranchPort {
  select(input: Readonly<{ threadId: string; branchToken: AgentBranchToken }>): Promise<void>;
}

export interface AgentQueuePort {
  update(
    input: Readonly<{
      threadId: string;
      itemId: string;
      mutation: AgentQueueMutation;
    }>,
  ): Promise<void>;
}

/**
 * Runtime-neutral required execution surface.
 *
 * Presence of a nested port is the capability declaration for optional queue, regeneration,
 * branch, and recovery behavior. Implementations own SDK objects, prompt encoding, and error
 * translation.
 */
export interface AgentExecutionPort {
  submit(input: AgentPromptSubmission): Promise<AgentPromptAdmission>;
  cancel(input: Readonly<{ threadId: string }>): Promise<void>;
  readonly regeneration?: AgentRegenerationPort;
  readonly resume?: AgentResumePort;
  readonly branches?: AgentBranchPort;
  readonly queue?: AgentQueuePort;
}
