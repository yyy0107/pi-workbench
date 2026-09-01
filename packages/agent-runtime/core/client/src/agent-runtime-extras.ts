import type { AppendMessage } from "@assistant-ui/react";

import type {
  WorkbenchAgentAutoRetry,
  WorkbenchAgentComposerExtras,
  WorkbenchAgentComposerSendError,
  WorkbenchAgentQueueExtras,
  WorkbenchAgentResumeCheckpoint,
  WorkbenchAgentRunTiming,
  WorkbenchAgentWorkspace,
} from "./agent-runtime-adapter";

type UnknownRecord = Record<string, unknown>;

export interface WorkbenchAgentRejectedQueueDraft {
  readonly rejectedDraft: {
    readonly revision: number;
    readonly message: AppendMessage;
  };
  clearRejectedDraft(revision: number): void;
}

export type WorkbenchAgentQueueControls = Pick<
  WorkbenchAgentQueueExtras,
  "paused" | "steeringIds" | "beginEdit" | "setPaused"
>;

export interface WorkbenchAgentRunRecovery {
  readonly resumeCheckpoint?: WorkbenchAgentResumeCheckpoint;
  resume?(checkpointId: string, expectedStateId: string): Promise<void>;
  resumeLatest?(terminalMessageId: string): Promise<void>;
}

const COMPOSER_ERRORS = new Set<WorkbenchAgentComposerSendError>([
  "model-attachment-unsupported",
  "attachment-invalid",
  "attachment-too-large",
  "too-many-attachments",
]);

const RESUME_CAPABILITIES = new Set<WorkbenchAgentResumeCheckpoint["capability"]>([
  "ready",
  "blocked",
  "confirmation-required",
]);

const EMPTY_RUN_RECOVERY: WorkbenchAgentRunRecovery = Object.freeze({});

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function agentSection(extras: unknown, key: string): UnknownRecord | undefined {
  return record(record(extras)?.[key]);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function appendMessage(value: unknown): AppendMessage | undefined {
  const candidate = record(value);
  if (
    !candidate ||
    typeof candidate.role !== "string" ||
    !Array.isArray(candidate.content) ||
    !candidate.content.every((part) => {
      const item = record(part);
      return (
        item !== undefined &&
        typeof item.type === "string" &&
        (item.type !== "text" || typeof item.text === "string")
      );
    }) ||
    (candidate.attachments !== undefined &&
      (!Array.isArray(candidate.attachments) ||
        !candidate.attachments.every((attachment) => record(attachment) !== undefined)))
  ) {
    return undefined;
  }
  return candidate as unknown as AppendMessage;
}

function resumeCheckpoint(value: unknown): WorkbenchAgentResumeCheckpoint | undefined {
  const candidate = record(value);
  if (!candidate) return undefined;
  const { checkpointId, terminalMessageId, expectedStateId, capability } = candidate;
  if (
    !isNonEmptyString(checkpointId) ||
    !isNonEmptyString(terminalMessageId) ||
    !isNonEmptyString(expectedStateId) ||
    typeof capability !== "string" ||
    !RESUME_CAPABILITIES.has(capability as WorkbenchAgentResumeCheckpoint["capability"])
  ) {
    return undefined;
  }
  return candidate as unknown as WorkbenchAgentResumeCheckpoint;
}

/** Read the Workbench workspace associated with the active Agent Runtime thread. */
export function readAgentThreadWorkspace(extras: unknown): WorkbenchAgentWorkspace | undefined {
  const candidate = record(agentSection(extras, "agentThread")?.workspace);
  if (!candidate || !isNonEmptyString(candidate.id)) return undefined;
  if (candidate.name !== undefined && !isNonEmptyString(candidate.name)) return undefined;
  if (candidate.rootPath !== undefined && !isNonEmptyString(candidate.rootPath)) return undefined;
  if (candidate.pinned !== undefined && typeof candidate.pinned !== "boolean") return undefined;
  return candidate as unknown as WorkbenchAgentWorkspace;
}

/** Read the queue controls shared by Workbench queue surfaces. */
export function readAgentQueueExtras(extras: unknown): WorkbenchAgentQueueControls | undefined {
  const candidate = agentSection(extras, "agentQueue");
  if (
    !candidate ||
    typeof candidate.paused !== "boolean" ||
    !Array.isArray(candidate.steeringIds) ||
    !candidate.steeringIds.every((id) => typeof id === "string") ||
    typeof candidate.beginEdit !== "function" ||
    typeof candidate.setPaused !== "function"
  ) {
    return undefined;
  }
  return candidate as unknown as WorkbenchAgentQueueControls;
}

/** Read a rejected queue draft without making malformed optional data hide queue controls. */
export function readAgentRejectedQueueDraft(
  extras: unknown,
): WorkbenchAgentRejectedQueueDraft | undefined {
  const queue = agentSection(extras, "agentQueue");
  const rejectedDraft = record(queue?.rejectedDraft);
  if (
    !queue ||
    !rejectedDraft ||
    !isFiniteNonNegative(rejectedDraft.revision) ||
    !Number.isInteger(rejectedDraft.revision) ||
    !appendMessage(rejectedDraft.message) ||
    typeof queue.clearRejectedDraft !== "function"
  ) {
    return undefined;
  }
  return queue as unknown as WorkbenchAgentRejectedQueueDraft;
}

/** Read Composer error recovery projected by an Agent Runtime implementation. */
export function readAgentComposerExtras(extras: unknown): WorkbenchAgentComposerExtras | undefined {
  const candidate = agentSection(extras, "agentComposer");
  if (!candidate || typeof candidate.clearError !== "function") return undefined;
  if (
    candidate.error !== undefined &&
    (typeof candidate.error !== "string" ||
      !COMPOSER_ERRORS.has(candidate.error as WorkbenchAgentComposerSendError))
  ) {
    return undefined;
  }
  return candidate as unknown as WorkbenchAgentComposerExtras;
}

/** Read the server-authoritative active-run timing snapshot. */
export function readAgentRunTiming(extras: unknown): WorkbenchAgentRunTiming | undefined {
  const timing = record(agentSection(extras, "agentRun")?.timing);
  if (
    !timing ||
    !isFiniteNonNegative(timing.startedAt) ||
    !isFiniteNonNegative(timing.elapsedMs) ||
    !isFiniteNonNegative(timing.observedAt)
  ) {
    return undefined;
  }
  return timing as unknown as WorkbenchAgentRunTiming;
}

/** Read the active automatic-retry attempt. */
export function readAgentAutoRetry(extras: unknown): WorkbenchAgentAutoRetry | undefined {
  const autoRetry = record(agentSection(extras, "agentRun")?.autoRetry);
  if (
    !autoRetry ||
    typeof autoRetry.attempt !== "number" ||
    !Number.isInteger(autoRetry.attempt) ||
    autoRetry.attempt <= 0 ||
    typeof autoRetry.maxAttempts !== "number" ||
    !Number.isInteger(autoRetry.maxAttempts) ||
    autoRetry.maxAttempts < autoRetry.attempt
  ) {
    return undefined;
  }
  return autoRetry as unknown as WorkbenchAgentAutoRetry;
}

/** Whether the active run's realtime transport is reconnecting. */
export function readAgentTransportRecovering(extras: unknown): boolean {
  return agentSection(extras, "agentRun")?.transportRecovering === true;
}

/** Read the subset used by interrupted-run recovery UI. Invalid optional fields are omitted. */
export function readAgentRunRecovery(extras: unknown): WorkbenchAgentRunRecovery {
  const candidate = agentSection(extras, "agentRun");
  if (!candidate) return EMPTY_RUN_RECOVERY;

  const checkpoint = resumeCheckpoint(candidate.resumeCheckpoint);
  const resume = typeof candidate.resume === "function" ? candidate.resume : undefined;
  const resumeLatest =
    typeof candidate.resumeLatest === "function" ? candidate.resumeLatest : undefined;
  if (!checkpoint && !resume && !resumeLatest) return EMPTY_RUN_RECOVERY;

  if (
    (candidate.resumeCheckpoint === undefined || checkpoint) &&
    (candidate.resume === undefined || resume) &&
    (candidate.resumeLatest === undefined || resumeLatest)
  ) {
    return candidate as unknown as WorkbenchAgentRunRecovery;
  }

  return {
    ...(checkpoint ? { resumeCheckpoint: checkpoint } : {}),
    ...(resume ? { resume: resume as WorkbenchAgentRunRecovery["resume"] } : {}),
    ...(resumeLatest
      ? { resumeLatest: resumeLatest as WorkbenchAgentRunRecovery["resumeLatest"] }
      : {}),
  };
}
