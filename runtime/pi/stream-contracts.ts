import type { RpcError, SessionEvent, ToolEventView, WorkspaceView } from "./rpc-contracts";

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

export interface SessionSubscribedPayload {
  type: "session/subscribed";
  sessionId: string;
  lastSeq: number;
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

export interface StreamErrorPayload {
  type: "stream/error";
  error: RpcError;
}

export type MuxStreamPayload =
  | SessionEventPayload
  | SessionSubscribedPayload
  | ApprovalRequestedPayload
  | ApprovalResolvedPayload
  | QuestionRequestedPayload
  | QuestionResolvedPayload
  | SessionQueuePayload
  | SessionJobsPayload
  | SessionProjectionPayload
  | StreamErrorPayload;

export interface HostSessionAddedPayload {
  type: "host/session-added";
  sessionId: string;
  blank: boolean;
  cwd?: string;
  agentPreset?: string;
  parentSessionId?: string;
  origin?: "subagent";
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

export interface HostArchivedSessionsChangedPayload {
  type: "host/archived-sessions-changed";
  archivedSessionIds: string[];
}

export interface HostRemoteEventPayload {
  type: "host/remote-event";
  event: string;
  args: unknown[];
}

export type HostStreamPayload =
  | HostSessionAddedPayload
  | HostSessionRemovedPayload
  | HostSessionStatusPayload
  | HostAgentErrorPayload
  | HostWorkspaceChangedPayload
  | HostWorkspaceRemovedPayload
  | HostWorkspaceOrderChangedPayload
  | HostArchivedSessionsChangedPayload
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
