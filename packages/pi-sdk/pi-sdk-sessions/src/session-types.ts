import type {
  PiAssistantMessage,
  PiEvent,
  PiQueuedPrompt,
} from "@workbench/pi-rpc-contracts/messages";
import type { AutomationSessionOrigin } from "@workbench/automation-contracts";
import type {
  WorkbenchComposerCommandResponse,
  WorkbenchComposerCommandSubmission,
  WorkbenchComposerSubmission,
  WorkbenchResolvedAgentRequest,
} from "@workbench/core-contracts/composer/request";

import type {
  SessionMessageDelta,
  SessionMessageMetadata,
} from "@workbench/pi-rpc-contracts/stream";
import type { PlannedWorkbenchComposerCommand } from "@workbench/pi-sdk-resources/composer-command-planner";

export const PROMPT_SOURCE_CUSTOM_TYPE = "workbench.prompt-source.v1";
export interface PromptSubmissionProvenance {
  rpcId?: string;
  clientTimeZone?: string;
  clientMutation?: Readonly<{
    operationId: string;
    messageId: string;
  }>;
  composer?: WorkbenchComposerSubmission;
}
export interface PromptSubmissionResult {
  queued: boolean;
  queueItemId?: string;
}
export type SessionEventListener = (event: PiEvent) => void;
export type RunningListener = (sessionIds: string[]) => void;
export interface PromptQueueSnapshot {
  steering: PiQueuedPrompt[];
  followUp: PiQueuedPrompt[];
}
export interface ActiveAssistantStream {
  id: string;
  /** Durable coordinate of the matching assistant message_start; fixed for this stream. */
  startSeq: number;
  revision: number;
  message: PiAssistantMessage;
  toolCallJson: Map<number, string>;
  pendingChunk?: {
    firstRevision: number;
    updates: SessionMessageDelta[];
    message: SessionMessageMetadata;
    time: number;
  };
  flushTimer?: ReturnType<typeof setTimeout>;
}
export interface ReadonlyPromptQueueSnapshot {
  readonly steering: readonly PiQueuedPrompt[];
  readonly followUp: readonly PiQueuedPrompt[];
}
export interface SessionTimestampEntry {
  type?: string;
  timestamp: string;
  customType?: string;
  data?: unknown;
  message?: unknown;
}
export interface SessionTimestampSource {
  getBranch(): readonly SessionTimestampEntry[];
  getHeader(): { timestamp: string } | null;
  getSessionFile(): string | null | undefined;
}
export interface ResolveWorkbenchComposerCommandsOptions {
  /** Plans captured by the preflight phase before the durable user marker is recorded. */
  plannedCommands?: readonly PlannedWorkbenchComposerCommand[];
  /**
   * Marks the next Pi user message as internal command expansion. The returned disposer removes an
   * unconsumed marker when Pi handles the command without creating a user message.
   */
  projectInternalUserPrompt?(): () => void;
  /** Reports execution failures after the complete command document has passed validation. */
  onCommandError?(command: WorkbenchComposerCommandSubmission, error: unknown): void;
  /** Publishes the running and terminal states of Pi built-in session actions. */
  onCommandResponse?(response: WorkbenchComposerCommandResponse): void;
}
export interface ResolvedWorkbenchComposerRequest {
  request: WorkbenchResolvedAgentRequest;
  /** Durable, user-visible outcomes produced by the active Agent's built-in session actions. */
  commandResponses: WorkbenchComposerCommandResponse[];
  /** A Pi extension command owns this turn, so no second main turn may be started. */
  agentTurn: boolean;
}
export interface SessionOrigins {
  readonly automationOrigin?: AutomationSessionOrigin;
}
export type PromptQueueMutation =
  | { kind: "edit"; prompt: PiQueuedPrompt }
  | { kind: "remove" }
  | { kind: "steer" };
export interface ComposerSubmissionReplay {
  /** Reuse the durable Composer marker so a retry creates an answer branch, not a user branch. */
  submissionId: string;
}
