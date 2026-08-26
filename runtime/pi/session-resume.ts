import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import type { PiAssistantMessage } from "./contracts";
import { terminationFromAssistantMessage, type PiMessageTermination } from "./message-termination";
import type {
  SessionEvent,
  SessionResumeCheckpoint,
  SessionResumeReason,
  SessionResumeState,
} from "./rpc-contracts";

export const SESSION_RESUME_CHECKPOINT_CUSTOM_TYPE = "workbench.resume-checkpoint.v1";
export const SESSION_RESUME_ATTEMPT_CUSTOM_TYPE = "workbench.resume-attempt.v1";

export interface StoredSessionResumeCheckpoint {
  version: 1;
  terminalMessageId: string;
  anchorEntryId: string;
  sourceEventSeq: number;
  reason: SessionResumeReason;
  createdAt: number;
  model?: { provider: string; model: string };
  ambiguousTools?: Array<{ toolCallId: string; toolName?: string }>;
}

export interface MissingSessionResumeCheckpoint {
  terminalMessageId: string;
  value: StoredSessionResumeCheckpoint;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseReason(value: unknown): SessionResumeReason | undefined {
  switch (value) {
    case "user-cancelled":
    case "process-interrupted":
    case "rate-limited":
    case "quota-exhausted":
    case "authentication-required":
    case "network-error":
    case "provider-error":
      return value;
    default:
      return undefined;
  }
}

function classifyApiFailure(termination: PiMessageTermination): SessionResumeReason {
  const evidence =
    `${termination.rawStopReason ?? ""}\n${termination.errorMessage ?? ""}`.toLowerCase();
  if (/rate[\s_-]*limit|too many requests|\b429\b/.test(evidence)) return "rate-limited";
  if (/insufficient[_\s-]*quota|quota|credit|balance|billing|exhausted/.test(evidence)) {
    return "quota-exhausted";
  }
  if (/api[\s_-]*key|authentication|unauthori[sz]ed|forbidden|\b401\b|\b403\b/.test(evidence)) {
    return "authentication-required";
  }
  return "provider-error";
}

export function resumeReasonFromAssistantMessage(
  message: Pick<PiAssistantMessage, "diagnostics">,
): SessionResumeReason | undefined {
  const termination = terminationFromAssistantMessage(message);
  switch (termination?.kind) {
    case "cancelled":
      return "user-cancelled";
    case "aborted":
      return "process-interrupted";
    case "network-error":
      return "network-error";
    case "api-error":
      return classifyApiFailure(termination);
    case "provider-error":
      return "provider-error";
    default:
      return undefined;
  }
}

export function parseStoredSessionResumeCheckpoint(
  value: unknown,
): StoredSessionResumeCheckpoint | undefined {
  const candidate = record(value);
  const terminalMessageId = nonEmptyString(candidate?.terminalMessageId);
  const anchorEntryId = nonEmptyString(candidate?.anchorEntryId);
  const reason = parseReason(candidate?.reason);
  if (
    candidate?.version !== 1 ||
    !terminalMessageId ||
    !anchorEntryId ||
    !reason ||
    !Number.isInteger(candidate.sourceEventSeq) ||
    (candidate.sourceEventSeq as number) < 0 ||
    typeof candidate.createdAt !== "number" ||
    !Number.isFinite(candidate.createdAt)
  ) {
    return undefined;
  }

  const modelCandidate = record(candidate.model);
  const provider = nonEmptyString(modelCandidate?.provider);
  const model = nonEmptyString(modelCandidate?.model);
  const ambiguousTools = Array.isArray(candidate.ambiguousTools)
    ? candidate.ambiguousTools.flatMap((value) => {
        const tool = record(value);
        const toolCallId = nonEmptyString(tool?.toolCallId);
        if (!toolCallId) return [];
        const toolName = nonEmptyString(tool?.toolName);
        return [{ toolCallId, ...(toolName ? { toolName } : {}) }];
      })
    : undefined;

  return {
    version: 1,
    terminalMessageId,
    anchorEntryId,
    sourceEventSeq: candidate.sourceEventSeq as number,
    reason,
    createdAt: candidate.createdAt,
    ...(provider && model ? { model: { provider, model } } : {}),
    ...(ambiguousTools?.length ? { ambiguousTools } : {}),
  };
}

function customEntryData(entry: SessionEntry): unknown {
  return entry.type === "custom" ? entry.data : undefined;
}

function isConversationMessageEntry(entry: SessionEntry): boolean {
  if (entry.type === "message") {
    const role = record(entry.message)?.role;
    return role === "user" || role === "assistant" || role === "toolResult";
  }
  return false;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

/**
 * Reconstructs a checkpoint when a settled terminal message predates the checkpoint producer.
 * This is used for cold-open sessions and live HostedPiSession instances retained across HMR.
 */
export function missingSessionResumeCheckpointFromBranch(
  branch: readonly SessionEntry[],
  events: readonly SessionEvent[],
  currentModel?: { provider: string; model: string },
): MissingSessionResumeCheckpoint | undefined {
  const terminal = events.findLast((event) => {
    if (event.type !== "message_end" || !event.entryId) return false;
    const data = record(event.data);
    const message = record(data?.message);
    return message?.role === "assistant";
  });
  if (!terminal?.entryId) return undefined;
  const terminalData = record(terminal.data);
  const terminalMessage = record(terminalData?.message);
  if (!terminalMessage) return undefined;
  const reason = resumeReasonFromAssistantMessage(terminalMessage as unknown as PiAssistantMessage);
  if (!reason) return undefined;

  const settled = events.find(
    (event) => event.seq > terminal.seq && event.type === "agent_settled",
  );
  if (!settled) return undefined;
  if (events.some((event) => event.seq > terminal.seq && event.type === "agent_start")) {
    return undefined;
  }
  if (
    branch.some(
      (entry) =>
        entry.type === "custom" &&
        entry.customType === SESSION_RESUME_CHECKPOINT_CUSTOM_TYPE &&
        record(entry.data)?.terminalMessageId === terminal.entryId,
    )
  ) {
    return undefined;
  }

  const terminalEventIndex = branch.findIndex((entry) => entry.id === terminal.entryId);
  const terminalMessageEntry = branch[terminalEventIndex + 1];
  if (
    terminalEventIndex < 0 ||
    terminalMessageEntry?.type !== "message" ||
    !jsonEqual(terminalMessageEntry.message, terminalMessage)
  ) {
    return undefined;
  }
  if (branch.slice(terminalEventIndex + 2).some(isConversationMessageEntry)) return undefined;

  const anchor = branch
    .slice(0, terminalEventIndex + 1)
    .findLast(
      (entry) =>
        entry.type === "message" &&
        record(entry.message)?.role !== undefined &&
        (record(entry.message)?.role === "user" || record(entry.message)?.role === "toolResult"),
    );
  if (!anchor) return undefined;

  const runStartSeq =
    events.findLast((event) => event.seq <= terminal.seq && event.type === "agent_start")?.seq ?? 0;
  const unresolvedTools = new Map<string, { toolCallId: string; toolName?: string }>();
  for (const event of events) {
    const data = record(event.data);
    if (event.seq < runStartSeq || event.seq > terminal.seq || !data) continue;
    const toolCallId = nonEmptyString(data.toolCallId);
    if (!toolCallId) continue;
    if (event.type === "tool_execution_start" || event.type === "tool_execution_update") {
      const toolName = nonEmptyString(data.toolName) ?? nonEmptyString(data.tool);
      unresolvedTools.set(toolCallId, { toolCallId, ...(toolName ? { toolName } : {}) });
    }
  }
  for (const entry of branch.slice(0, terminalEventIndex + 1)) {
    if (entry.type !== "message") continue;
    const message = record(entry.message);
    if (message?.role !== "toolResult") continue;
    const toolCallId = nonEmptyString(message.toolCallId);
    if (toolCallId) unresolvedTools.delete(toolCallId);
  }

  const provider = nonEmptyString(terminalMessage.provider);
  const model = nonEmptyString(terminalMessage.model);
  const terminalModel =
    provider && model ? { provider, model } : currentModel ? { ...currentModel } : undefined;
  return {
    terminalMessageId: terminal.entryId,
    value: {
      version: 1,
      terminalMessageId: terminal.entryId,
      anchorEntryId: anchor.id,
      sourceEventSeq: terminal.seq,
      reason,
      createdAt: settled.time,
      ...(terminalModel ? { model: terminalModel } : {}),
      ...(unresolvedTools.size ? { ambiguousTools: [...unresolvedTools.values()] } : {}),
    },
  };
}

function modelBlocksResume(
  checkpoint: StoredSessionResumeCheckpoint,
  currentModel: { provider: string; model: string } | undefined,
): boolean {
  if (checkpoint.reason !== "quota-exhausted" && checkpoint.reason !== "authentication-required") {
    return false;
  }
  if (!checkpoint.model || !currentModel) return true;
  return (
    checkpoint.model.provider === currentModel.provider &&
    checkpoint.model.model === currentModel.model
  );
}

/** Projects the one active recovery point on the selected append-only Pi branch. */
export function sessionResumeStateFromBranch(
  branch: readonly SessionEntry[],
  currentModel?: { provider: string; model: string },
): SessionResumeState {
  let checkpoint: { entryId: string; value: StoredSessionResumeCheckpoint } | undefined;

  for (const entry of branch) {
    if (entry.type === "custom" && entry.customType === SESSION_RESUME_CHECKPOINT_CUSTOM_TYPE) {
      const value = parseStoredSessionResumeCheckpoint(customEntryData(entry));
      if (value) checkpoint = { entryId: entry.id, value };
      continue;
    }
    // Model changes, journal events, attempts, and other metadata do not invalidate the recovery
    // point. A new durable conversation message does: the branch has moved beyond the interruption.
    if (checkpoint && isConversationMessageEntry(entry)) checkpoint = undefined;
  }

  if (!checkpoint) return {};
  const branchLeafId = branch.at(-1)?.id;
  if (!branchLeafId) return {};

  const ambiguousTools = checkpoint.value.ambiguousTools;
  const blockedByAmbiguousTools = Boolean(ambiguousTools?.length);
  const blockedByModel =
    !blockedByAmbiguousTools && modelBlocksResume(checkpoint.value, currentModel);
  const projected: SessionResumeCheckpoint = {
    checkpointId: checkpoint.entryId,
    terminalMessageId: checkpoint.value.terminalMessageId,
    branchLeafId,
    sourceEventSeq: checkpoint.value.sourceEventSeq,
    reason: checkpoint.value.reason,
    capability: blockedByAmbiguousTools
      ? "confirmation-required"
      : blockedByModel
        ? "blocked"
        : "ready",
    ...(blockedByAmbiguousTools
      ? { blockedBy: "ambiguous-tools" as const }
      : blockedByModel
        ? { blockedBy: "model" as const }
        : {}),
    createdAt: checkpoint.value.createdAt,
    ...(checkpoint.value.model ? { model: checkpoint.value.model } : {}),
    ...(ambiguousTools?.length ? { ambiguousTools } : {}),
  };
  return { checkpoint: projected };
}
