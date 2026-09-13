import type {
  PiAssistantMessage,
  PiEvent,
  PiRunTiming,
} from "@workbench/agent-runtime-pi-protocol/messages";
import {
  isSessionMessageDelta,
  type StreamName,
} from "@workbench/agent-runtime-pi-protocol/stream";
import { parseAutomationSessionOrigin } from "@workbench/automation-contracts";
const MUX_PAYLOAD_TYPES = new Set([
  "session/event",
  "session/message-snapshot",
  "session/message-update",
  "session/subscribed",
  "session/prompt-accepted",
  "approval/requested",
  "approval/resolved",
  "question/requested",
  "question/resolved",
  "session/queue",
  "session/jobs",
  "session/projection",
  "session/context-trace",
  "stream/error",
]);

const HOST_PAYLOAD_TYPES = new Set([
  "host/session-added",
  "host/session-changed",
  "host/session-removed",
  "host/session-status",
  "host/session-interaction-status",
  "host/agent-error",
  "host/workspace-changed",
  "host/workspace-removed",
  "host/workspace-order-changed",
  "host/workspace-pinned-changed",
  "host/session-archive-changed",
  "host/session-pinned-changed",
  "host/remote-event",
  "stream/error",
]);

interface ServerRequestFrame {
  type: "server-request";
  rpcId: string;
  method: string;
  payload: Record<string, unknown> & { type: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isPiRunTiming(value: unknown): value is PiRunTiming {
  return (
    isRecord(value) &&
    Number.isInteger(value.startedAt) &&
    (value.startedAt as number) >= 0 &&
    Number.isInteger(value.elapsedMs) &&
    (value.elapsedMs as number) >= 0
  );
}

function isOptionalPiRunTiming(value: unknown): boolean {
  return value === undefined || isPiRunTiming(value);
}

function isWorkspaceView(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.workspaceId) &&
    typeof value.path === "string" &&
    typeof value.title === "string" &&
    isStringArray(value.sessionIds) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isPiSessionSummary(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.workspace)) return false;
  return (
    isNonEmptyString(value.id) &&
    typeof value.cwd === "string" &&
    typeof value.workspace.id === "string" &&
    typeof value.workspace.name === "string" &&
    typeof value.workspace.cwd === "string" &&
    (value.name === undefined || typeof value.name === "string") &&
    typeof value.created === "string" &&
    typeof value.modified === "string" &&
    Number.isInteger(value.messageCount) &&
    (value.messageCount as number) >= 0 &&
    typeof value.firstMessage === "string" &&
    typeof value.transient === "boolean" &&
    typeof value.running === "boolean" &&
    (value.waitingForUserInput === undefined || typeof value.waitingForUserInput === "boolean") &&
    (value.automationOrigin === undefined ||
      parseAutomationSessionOrigin(value.automationOrigin) !== undefined) &&
    isOptionalPiRunTiming(value.runTiming)
  );
}

function isRpcError(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    isRecord(value.details)
  );
}

function isSessionEventPayload(payload: ServerRequestFrame["payload"]): boolean {
  if (!isNonEmptyString(payload.sessionId)) return false;
  const event = payload.event;
  return (
    isRecord(event) &&
    typeof event.type === "string" &&
    Number.isInteger(event.seq) &&
    (event.seq as number) >= 0 &&
    typeof event.time === "number" &&
    Number.isFinite(event.time) &&
    Object.hasOwn(event, "data") &&
    isOptionalPiRunTiming(payload.runTiming)
  );
}

function hasSessionMessageCoordinates(payload: ServerRequestFrame["payload"]): boolean {
  return (
    payload.format === "pi-messages-v1" &&
    isNonEmptyString(payload.sessionId) &&
    isNonEmptyString(payload.streamId) &&
    Number.isInteger(payload.revision) &&
    (payload.revision as number) >= 0 &&
    Number.isInteger(payload.startSeq) &&
    (payload.startSeq as number) >= -1 &&
    typeof payload.time === "number" &&
    Number.isFinite(payload.time)
  );
}

function isAssistantContent(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "text":
      return typeof value.text === "string";
    case "thinking":
      return typeof value.thinking === "string";
    case "image":
      return typeof value.data === "string" && typeof value.mimeType === "string";
    case "toolCall":
      return (
        typeof value.id === "string" && typeof value.name === "string" && isRecord(value.arguments)
      );
    default:
      return false;
  }
}

export function isAssistantMessage(value: unknown): value is PiAssistantMessage {
  return (
    isRecord(value) &&
    value.role === "assistant" &&
    Array.isArray(value.content) &&
    value.content.every(isAssistantContent)
  );
}

function isSessionMessageUpdatePayload(payload: ServerRequestFrame["payload"]): boolean {
  return (
    hasSessionMessageCoordinates(payload) &&
    (payload.revision as number) >= 1 &&
    isRecord(payload.message) &&
    payload.message.role === "assistant" &&
    !Object.hasOwn(payload.message, "content") &&
    isSessionMessageDelta(payload.update)
  );
}

function isSessionMessageSnapshotPayload(payload: ServerRequestFrame["payload"]): boolean {
  return (
    hasSessionMessageCoordinates(payload) &&
    isAssistantMessage(payload.message) &&
    (payload.toolCallJson === undefined ||
      (isRecord(payload.toolCallJson) &&
        Object.entries(payload.toolCallJson).every(
          ([rawIndex, json]) =>
            Number.isInteger(Number(rawIndex)) && Number(rawIndex) >= 0 && typeof json === "string",
        )))
  );
}

function isQuestion(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && typeof value.question === "string";
}

function isQueueItem(value: unknown): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.id)) return false;
  if (!["queued", "steering", "context"].includes(value.placement as string)) return false;
  const message = value.message;
  return (
    isRecord(message) &&
    isNonEmptyString(message.id) &&
    ["system", "user", "assistant"].includes(message.role as string) &&
    Array.isArray(message.content) &&
    message.content.every((part) => isRecord(part) && typeof part.type === "string") &&
    isRecord(message.source) &&
    typeof message.source.kind === "string"
  );
}

function isJob(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.kind) &&
    isNonEmptyString(value.label) &&
    ["running", "stopping", "completed", "killed", "failed"].includes(value.status as string) &&
    Number.isInteger(value.startedAt) &&
    (value.startedAt as number) >= 0 &&
    (value.finishedAt === undefined ||
      (Number.isInteger(value.finishedAt) && (value.finishedAt as number) >= 0))
  );
}

const CONTEXT_TRACE_KINDS = new Set([
  "round-start",
  "prompt-composition",
  "run-start",
  "turn-start",
  "context-snapshot",
  "provider-request",
  "provider-response",
  "model-output",
  "tool-execution-start",
  "tool-execution-end",
  "turn-end",
  "run-end",
  "retry",
  "compaction",
  "round-settled",
]);

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && (value as number) >= 0);
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isSessionContextTraceSummary(value: unknown, sessionId: string): boolean {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    value.sessionId === sessionId &&
    isNonEmptyString(value.traceId) &&
    isNonEmptyString(value.activationId) &&
    Number.isInteger(value.seq) &&
    (value.seq as number) >= 0 &&
    typeof value.time === "number" &&
    Number.isFinite(value.time) &&
    typeof value.kind === "string" &&
    CONTEXT_TRACE_KINDS.has(value.kind) &&
    Number.isInteger(value.detailBytes) &&
    (value.detailBytes as number) >= 0 &&
    typeof value.truncated === "boolean" &&
    typeof value.redacted === "boolean" &&
    isOptionalNonEmptyString(value.roundId) &&
    isOptionalNonEmptyString(value.runId) &&
    isOptionalNonNegativeInteger(value.runIndex) &&
    isOptionalNonEmptyString(value.turnId) &&
    isOptionalNonNegativeInteger(value.turnIndex) &&
    isOptionalNonEmptyString(value.requestId) &&
    isOptionalNonNegativeInteger(value.requestIndex) &&
    isOptionalNonNegativeInteger(value.agentAttempt)
  );
}

export function isMuxPayload(payload: ServerRequestFrame["payload"]): boolean {
  switch (payload.type) {
    case "session/event":
      return isSessionEventPayload(payload);
    case "session/message-snapshot":
      return isSessionMessageSnapshotPayload(payload);
    case "session/message-update":
      return isSessionMessageUpdatePayload(payload);
    case "session/subscribed":
      return isNonEmptyString(payload.sessionId) && Number.isInteger(payload.lastSeq);
    case "session/prompt-accepted":
      return (
        isNonEmptyString(payload.sessionId) &&
        ["queue", "steer"].includes(payload.mode as string) &&
        typeof payload.running === "boolean" &&
        isOptionalPiRunTiming(payload.runTiming)
      );
    case "approval/requested":
      return (
        isNonEmptyString(payload.sessionId) &&
        isNonEmptyString(payload.approvalId) &&
        typeof payload.toolName === "string" &&
        isOptionalString(payload.callId) &&
        isOptionalString(payload.reason)
      );
    case "approval/resolved":
      return (
        isNonEmptyString(payload.sessionId) &&
        isNonEmptyString(payload.approvalId) &&
        ["allowed-once", "rejected", "cancelled", "unavailable"].includes(payload.outcome as string)
      );
    case "question/requested":
      return (
        isNonEmptyString(payload.sessionId) &&
        (payload.expiresAt === undefined ||
          (typeof payload.expiresAt === "number" &&
            Number.isFinite(payload.expiresAt) &&
            payload.expiresAt > 0)) &&
        Array.isArray(payload.questions) &&
        payload.questions.length > 0 &&
        payload.questions.every(isQuestion) &&
        (payload.progress === undefined ||
          (isRecord(payload.progress) &&
            Number.isInteger(payload.progress.currentIndex) &&
            (payload.progress.currentIndex as number) >= 0 &&
            (payload.progress.currentIndex as number) < payload.questions.length &&
            Array.isArray(payload.progress.answers) &&
            payload.progress.answers.every(
              (answer) =>
                isRecord(answer) &&
                typeof answer.id === "string" &&
                Array.isArray(answer.selected) &&
                answer.selected.every((label) => typeof label === "string") &&
                isOptionalString(answer.custom) &&
                (answer.skipped === undefined || answer.skipped === true),
            )))
      );
    case "question/resolved":
      return (
        isNonEmptyString(payload.sessionId) &&
        typeof payload.questionRpcId === "string" &&
        ["answered", "cancelled"].includes(payload.outcome as string)
      );
    case "session/queue":
      return (
        isNonEmptyString(payload.sessionId) &&
        Array.isArray(payload.items) &&
        payload.items.every(isQueueItem)
      );
    case "session/jobs":
      return (
        isNonEmptyString(payload.sessionId) &&
        Array.isArray(payload.jobs) &&
        payload.jobs.every(isJob)
      );
    case "session/projection":
      return (
        isNonEmptyString(payload.sessionId) &&
        isNonEmptyString(payload.key) &&
        Object.hasOwn(payload, "value") &&
        Number.isInteger(payload.seq) &&
        (payload.seq as number) >= 0
      );
    case "session/context-trace":
      return (
        isNonEmptyString(payload.sessionId) &&
        isSessionContextTraceSummary(payload.event, payload.sessionId)
      );
    case "stream/error":
      return isRpcError(payload.error);
    default:
      return false;
  }
}

export function isHostPayload(payload: ServerRequestFrame["payload"]): boolean {
  switch (payload.type) {
    case "host/session-added":
      return (
        isNonEmptyString(payload.sessionId) &&
        typeof payload.blank === "boolean" &&
        isPiSessionSummary(payload.summary) &&
        isOptionalString(payload.cwd) &&
        isOptionalString(payload.agentPreset) &&
        (payload.parentSessionId === undefined || isNonEmptyString(payload.parentSessionId)) &&
        (payload.origin === undefined || payload.origin === "subagent")
      );
    case "host/session-changed":
      return isNonEmptyString(payload.sessionId) && isPiSessionSummary(payload.summary);
    case "host/session-removed":
      return isNonEmptyString(payload.sessionId);
    case "host/session-status":
      return (
        isNonEmptyString(payload.sessionId) &&
        typeof payload.running === "boolean" &&
        isOptionalPiRunTiming(payload.runTiming)
      );
    case "host/session-interaction-status":
      return (
        isNonEmptyString(payload.sessionId) && typeof payload.waitingForUserInput === "boolean"
      );
    case "host/agent-error":
      return isNonEmptyString(payload.sessionId) && typeof payload.message === "string";
    case "host/workspace-changed":
      return isWorkspaceView(payload.workspace);
    case "host/workspace-removed":
      return isNonEmptyString(payload.workspaceId);
    case "host/workspace-order-changed":
      return isStringArray(payload.workspaceIds);
    case "host/workspace-pinned-changed":
      return isNonEmptyString(payload.workspaceId) && typeof payload.pinned === "boolean";
    case "host/session-archive-changed":
      return (
        isNonEmptyString(payload.sessionId) &&
        typeof payload.archived === "boolean" &&
        (payload.workspace === undefined || isWorkspaceView(payload.workspace))
      );
    case "host/session-pinned-changed":
      return isNonEmptyString(payload.sessionId) && typeof payload.pinned === "boolean";
    case "host/remote-event":
      return isNonEmptyString(payload.event) && Array.isArray(payload.args);
    case "stream/error":
      return isRpcError(payload.error);
    default:
      return false;
  }
}

export function parseServerRequest(
  stream: StreamName,
  data: unknown,
): ServerRequestFrame | undefined {
  if (typeof data !== "string") return undefined;

  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (
    !isRecord(value) ||
    value.type !== "server-request" ||
    typeof value.rpcId !== "string" ||
    typeof value.method !== "string" ||
    !isRecord(value.payload) ||
    typeof value.payload.type !== "string" ||
    value.method !== value.payload.type
  ) {
    return undefined;
  }

  const acceptedTypes = stream === "mux" ? MUX_PAYLOAD_TYPES : HOST_PAYLOAD_TYPES;
  if (!acceptedTypes.has(value.payload.type)) return undefined;
  return value as unknown as ServerRequestFrame;
}

export function sessionEventFromPayload(payload: ServerRequestFrame["payload"]):
  | {
      sessionId: string;
      event: PiEvent;
    }
  | undefined {
  if (payload.type !== "session/event" || !isNonEmptyString(payload.sessionId)) return undefined;
  const event = payload.event;
  if (
    !isRecord(event) ||
    typeof event.type !== "string" ||
    !Number.isInteger(event.seq) ||
    (event.seq as number) < 0 ||
    typeof event.time !== "number" ||
    !Number.isFinite(event.time) ||
    !Object.hasOwn(event, "data")
  ) {
    return undefined;
  }

  const data: Record<string, unknown> = isRecord(event.data)
    ? { ...event.data }
    : { data: event.data };
  delete data.entryId;
  return {
    sessionId: payload.sessionId,
    event: {
      ...data,
      type: event.type,
      sequence: event.seq as number,
      eventTime: event.time,
      ...(isNonEmptyString(event.entryId) ? { entryId: event.entryId } : {}),
      ...(isPiRunTiming(payload.runTiming) ? { runTiming: payload.runTiming } : {}),
    },
  };
}

export function subscribedEventFromPayload(payload: ServerRequestFrame["payload"]):
  | {
      sessionId: string;
      event: PiEvent;
    }
  | undefined {
  if (
    payload.type !== "session/subscribed" ||
    !isNonEmptyString(payload.sessionId) ||
    !Number.isInteger(payload.lastSeq)
  ) {
    return undefined;
  }
  return {
    sessionId: payload.sessionId,
    event: { type: "subscribed", sequence: payload.lastSeq as number },
  };
}
