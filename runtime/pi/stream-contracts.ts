import type { PiMessagesEvent } from "@earendil-works/pi-ai";

import type { PiAssistantMessage, PiSessionSummary } from "./contracts";
import type {
  RpcError,
  SessionContextTraceEventSummary,
  SessionEvent,
  ToolEventView,
  WorkspaceView,
} from "./rpc-contracts";

export type { SessionEvent, ToolEventView } from "./rpc-contracts";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface QuestionItem {
  id: string;
  question: string;
  header?: string;
  detail?: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
  intent?: { kind: "plan-review"; approve: string };
}

export interface QueueItem {
  id: string;
  placement: "queued" | "steering" | "context";
  message: {
    id: string;
    role: "system" | "user" | "assistant";
    content: Array<{ type: string; [key: string]: unknown }>;
    source: { kind: string; [key: string]: unknown };
  };
}

export interface JobView {
  id: string;
  kind: string;
  label: string;
  status: "running" | "stopping" | "completed" | "killed" | "failed";
  detail?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface SessionEventPayload {
  type: "session/event";
  sessionId: string;
  event: SessionEvent;
  view?: ToolEventView;
}

export type SessionMessageDelta = Exclude<PiMessagesEvent, { type: "start" | "done" | "error" }>;

export type SessionMessageMetadata = Omit<PiAssistantMessage, "content">;

interface SessionMessageStreamPayload {
  format: "pi-messages-v1";
  sessionId: string;
  /** Stable for one assistant generation; unrelated generations must never share an id. */
  streamId: string;
  /** Monotonic within `streamId`; snapshots may start at 0 before the first delta. */
  revision: number;
  /** Durable sequence of the matching assistant `message_start`. */
  startSeq: number;
  time: number;
}

/** A compact, transient assistant content update. */
export interface SessionMessageUpdatePayload extends SessionMessageStreamPayload {
  type: "session/message-update";
  /** Message fields that can change while streaming, excluding cumulative content. */
  message: SessionMessageMetadata;
  update: SessionMessageDelta;
}

/**
 * A reconnect-only materialized view. The hub retains at most one per active session and clears it
 * before the matching durable `message_end` is published.
 */
export interface SessionMessageSnapshotPayload extends SessionMessageStreamPayload {
  type: "session/message-snapshot";
  message: PiAssistantMessage;
  /** Raw partial tool argument JSON needed to continue parsing deltas after a reconnect. */
  toolCallJson?: Record<string, string>;
}

export interface SessionSubscribedPayload {
  type: "session/subscribed";
  sessionId: string;
  lastSeq: number;
}

/** Transient acknowledgement that the matching session.prompt RPC was admitted. */
export interface SessionPromptAcceptedPayload {
  type: "session/prompt-accepted";
  sessionId: string;
  mode: "queue" | "steer";
  running: boolean;
}

export interface ApprovalRequestedPayload {
  type: "approval/requested";
  sessionId: string;
  approvalId: string;
  toolName: string;
  callId?: string;
  reason?: string;
}

export interface ApprovalResolvedPayload {
  type: "approval/resolved";
  sessionId: string;
  approvalId: string;
  outcome: "allowed-once" | "rejected" | "cancelled" | "unavailable";
}

export interface QuestionRequestedPayload {
  type: "question/requested";
  sessionId: string;
  questions: QuestionItem[];
}

export interface QuestionResolvedPayload {
  type: "question/resolved";
  sessionId: string;
  questionRpcId: string;
  outcome: "answered" | "cancelled";
}

export interface SessionQueuePayload {
  type: "session/queue";
  sessionId: string;
  items: QueueItem[];
}

export interface SessionJobsPayload {
  type: "session/jobs";
  sessionId: string;
  jobs: JobView[];
}

export interface SessionProjectionPayload {
  type: "session/projection";
  sessionId: string;
  key: string;
  value: unknown;
  seq: number;
}

/** Lightweight live notification; fetch the bounded detail with session.contextTrace.read. */
export interface SessionContextTracePayload {
  type: "session/context-trace";
  sessionId: string;
  event: SessionContextTraceEventSummary;
}

export interface StreamErrorPayload {
  type: "stream/error";
  error: RpcError;
}

export type MuxStreamPayload =
  | SessionEventPayload
  | SessionMessageUpdatePayload
  | SessionMessageSnapshotPayload
  | SessionSubscribedPayload
  | SessionPromptAcceptedPayload
  | ApprovalRequestedPayload
  | ApprovalResolvedPayload
  | QuestionRequestedPayload
  | QuestionResolvedPayload
  | SessionQueuePayload
  | SessionJobsPayload
  | SessionProjectionPayload
  | SessionContextTracePayload
  | StreamErrorPayload;

export interface HostSessionAddedPayload {
  type: "host/session-added";
  sessionId: string;
  blank: boolean;
  summary: PiSessionSummary;
  cwd?: string;
  agentPreset?: string;
  parentSessionId?: string;
  origin?: "subagent";
}

export interface HostSessionChangedPayload {
  type: "host/session-changed";
  sessionId: string;
  summary: PiSessionSummary;
}

export interface HostSessionRemovedPayload {
  type: "host/session-removed";
  sessionId: string;
}

export interface HostSessionStatusPayload {
  type: "host/session-status";
  sessionId: string;
  running: boolean;
}

export interface HostAgentErrorPayload {
  type: "host/agent-error";
  sessionId: string;
  message: string;
}

export interface HostWorkspaceChangedPayload {
  type: "host/workspace-changed";
  workspace: WorkspaceView;
}

export interface HostWorkspaceRemovedPayload {
  type: "host/workspace-removed";
  workspaceId: string;
}

export interface HostWorkspaceOrderChangedPayload {
  type: "host/workspace-order-changed";
  workspaceIds: string[];
}

export interface HostWorkspacePinnedChangedPayload {
  type: "host/workspace-pinned-changed";
  workspaceId: string;
  pinned: boolean;
}

export interface HostSessionArchiveChangedPayload {
  type: "host/session-archive-changed";
  sessionId: string;
  archived: boolean;
  workspace?: WorkspaceView;
}

export interface HostSessionPinnedChangedPayload {
  type: "host/session-pinned-changed";
  sessionId: string;
  pinned: boolean;
}

export interface HostRemoteEventPayload {
  type: "host/remote-event";
  event: string;
  args: unknown[];
}

export type HostStreamPayload =
  | HostSessionAddedPayload
  | HostSessionChangedPayload
  | HostSessionRemovedPayload
  | HostSessionStatusPayload
  | HostAgentErrorPayload
  | HostWorkspaceChangedPayload
  | HostWorkspaceRemovedPayload
  | HostWorkspaceOrderChangedPayload
  | HostWorkspacePinnedChangedPayload
  | HostSessionArchiveChangedPayload
  | HostSessionPinnedChangedPayload
  | HostRemoteEventPayload
  | StreamErrorPayload;

export interface StreamPayloadMap {
  mux: MuxStreamPayload;
  host: HostStreamPayload;
}

export type StreamName = keyof StreamPayloadMap;

export interface ServerRequest<
  Payload extends { type: string } = MuxStreamPayload | HostStreamPayload,
> {
  type: "server-request";
  rpcId: string;
  method: Payload["type"];
  payload: Payload;
}

export const STREAM_PATHS = {
  mux: "/api/events.mux",
  host: "/api/events.host",
} as const satisfies Record<StreamName, string>;

export function createServerRequest<Payload extends { type: string }>(
  rpcId: string,
  payload: Payload,
): ServerRequest<Payload> {
  return {
    type: "server-request",
    rpcId,
    method: payload.type,
    payload,
  };
}

export function createSessionEventPayload(
  sessionId: string,
  event: SessionEvent,
  view?: ToolEventView,
): SessionEventPayload {
  return {
    type: "session/event",
    sessionId,
    event,
    ...(view === undefined ? {} : { view }),
  };
}

function assertSessionMessageStreamCoordinates(
  sessionId: string,
  streamId: string,
  revision: number,
  startSeq: number,
  time: number,
): void {
  if (sessionId.length === 0) throw new TypeError("A session id must not be empty.");
  if (streamId.length === 0) throw new TypeError("An assistant stream id must not be empty.");
  if (!Number.isInteger(revision) || revision < 0) {
    throw new RangeError("An assistant stream revision must be a non-negative integer.");
  }
  if (!Number.isInteger(startSeq) || startSeq < -1) {
    throw new RangeError("An assistant stream start sequence must be at least -1.");
  }
  if (!Number.isFinite(time)) {
    throw new RangeError("An assistant stream time must be finite.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasContentIndex(value: Record<string, unknown>): boolean {
  return Number.isInteger(value.contentIndex) && (value.contentIndex as number) >= 0;
}

function hasOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

/** Runtime validation for the compact subset reused from pi-ai's streaming protocol. */
export function isSessionMessageDelta(value: unknown): value is SessionMessageDelta {
  if (!isRecord(value) || typeof value.type !== "string" || !hasContentIndex(value)) return false;
  switch (value.type) {
    case "text_start":
    case "thinking_start":
      return true;
    case "text_delta":
    case "thinking_delta":
    case "toolcall_delta":
      return typeof value.delta === "string";
    case "text_end":
      return typeof value.content === "string" && hasOptionalString(value.contentSignature);
    case "thinking_end":
      return (
        typeof value.content === "string" &&
        hasOptionalString(value.contentSignature) &&
        (value.redacted === undefined || typeof value.redacted === "boolean")
      );
    case "toolcall_start":
      return typeof value.id === "string" && typeof value.toolName === "string";
    case "toolcall_end": {
      const toolCall = value.toolCall;
      return (
        isRecord(toolCall) &&
        toolCall.type === "toolCall" &&
        typeof toolCall.id === "string" &&
        typeof toolCall.name === "string" &&
        isRecord(toolCall.arguments)
      );
    }
    default:
      return false;
  }
}

export function createSessionMessageUpdatePayload(
  sessionId: string,
  streamId: string,
  revision: number,
  startSeq: number,
  time: number,
  message: SessionMessageMetadata,
  update: SessionMessageDelta,
): SessionMessageUpdatePayload {
  assertSessionMessageStreamCoordinates(sessionId, streamId, revision, startSeq, time);
  if (revision < 1) {
    throw new RangeError("An assistant stream update revision must be a positive integer.");
  }
  if (message.role !== "assistant") {
    throw new TypeError("An assistant stream update requires assistant message metadata.");
  }
  if (!isSessionMessageDelta(update)) {
    throw new TypeError("An assistant stream update must use a supported pi message event.");
  }

  return {
    type: "session/message-update",
    format: "pi-messages-v1",
    sessionId,
    streamId,
    revision,
    startSeq,
    time,
    message,
    update,
  };
}

export function createSessionMessageSnapshotPayload(
  sessionId: string,
  streamId: string,
  revision: number,
  startSeq: number,
  time: number,
  message: PiAssistantMessage,
  toolCallJson?: Record<string, string>,
): SessionMessageSnapshotPayload {
  assertSessionMessageStreamCoordinates(sessionId, streamId, revision, startSeq, time);
  if (message.role !== "assistant" || !Array.isArray(message.content)) {
    throw new TypeError("An assistant stream snapshot requires an assistant message.");
  }
  return {
    type: "session/message-snapshot",
    format: "pi-messages-v1",
    sessionId,
    streamId,
    revision,
    startSeq,
    time,
    message,
    ...(toolCallJson === undefined ? {} : { toolCallJson }),
  };
}
