import type { PiEvent } from "../../contracts";
import type {
  HostStreamPayload,
  MuxStreamPayload,
  ServerRequest,
  StreamName,
} from "../../stream-contracts";

const IDLE_CLOSE_DELAY_MS = 30_000;
const CONNECT_WAIT_MS = 10_000;
const INITIAL_RECONNECT_DELAY_MS = 250;
const MAX_RECONNECT_DELAY_MS = 10_000;
// Match the server hub's bootstrap buffer so a large retained mux baseline
// cannot force the paired sockets into a permanent reconnect loop.
const MAX_PENDING_GENERATION_FRAMES = 10_000;

const STREAM_PATHS: Record<StreamName, string> = {
  mux: "/api/events.mux",
  host: "/api/events.host",
};

const LOG_CONNECTION_LIFECYCLE = process.env.NODE_ENV === "development";

function logConnectionInfo(message: string, details: Record<string, unknown>): void {
  if (!LOG_CONNECTION_LIFECYCLE) return;
  console.info(`[workbench-pi] websocket ${message}`, details);
}

function logConnectionWarning(message: string, details: Record<string, unknown>): void {
  if (!LOG_CONNECTION_LIFECYCLE) return;
  console.warn(`[workbench-pi] websocket ${message}`, details);
}

const MUX_PAYLOAD_TYPES = new Set([
  "session/event",
  "session/subscribed",
  "approval/requested",
  "approval/resolved",
  "question/requested",
  "question/resolved",
  "session/queue",
  "session/jobs",
  "session/projection",
  "stream/error",
]);

const HOST_PAYLOAD_TYPES = new Set([
  "host/session-added",
  "host/session-removed",
  "host/session-status",
  "host/agent-error",
  "host/workspace-changed",
  "host/workspace-removed",
  "host/workspace-order-changed",
  "host/archived-sessions-changed",
  "host/remote-event",
  "stream/error",
]);

export interface PiWebSocketMessageEvent {
  data: unknown;
}

export interface PiWebSocket {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: PiWebSocketMessageEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  close(code?: number, reason?: string): void;
}

export type PiWebSocketFactory = (path: string) => PiWebSocket;

export interface PiConnectionTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

export interface PiConnectionControllerOptions {
  webSocketFactory?: PiWebSocketFactory;
  timers?: PiConnectionTimers;
  random?: () => number;
  onMuxFrame?: (frame: ServerRequest<MuxStreamPayload>, generation: number) => void;
  onHostFrame?: (payload: HostStreamPayload, generation: number) => void;
  onGenerationReady?: (generation: number) => void;
}

interface SessionConnection {
  listener: (event: PiEvent) => void;
  closeTimer?: unknown;
}

interface ReadyWaiter {
  resolve: () => void;
  timer?: unknown;
}

interface PendingFrame {
  stream: StreamName;
  data: unknown;
}

interface ConnectionGeneration {
  id: number;
  mux: PiWebSocket;
  host: PiWebSocket;
  muxOpen: boolean;
  hostOpen: boolean;
  ready: boolean;
  active: boolean;
  pendingFrames: PendingFrame[];
}

interface ServerRequestFrame {
  type: "server-request";
  rpcId: string;
  method: string;
  payload: Record<string, unknown> & { type: string };
}

const browserTimers: PiConnectionTimers = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
};

function defaultWebSocketFactory(path: string): PiWebSocket {
  if (typeof WebSocket === "undefined") throw new Error("WebSocket is unavailable.");
  let url = path;
  if (typeof location !== "undefined") {
    const resolved = new URL(path, location.href);
    resolved.protocol = resolved.protocol === "https:" ? "wss:" : "ws:";
    url = resolved.href;
  }
  return new WebSocket(url) as unknown as PiWebSocket;
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
    Object.hasOwn(event, "data")
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

function isMuxPayload(payload: ServerRequestFrame["payload"]): boolean {
  switch (payload.type) {
    case "session/event":
      return isSessionEventPayload(payload);
    case "session/subscribed":
      return isNonEmptyString(payload.sessionId) && Number.isInteger(payload.lastSeq);
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
        Array.isArray(payload.questions) &&
        payload.questions.length > 0 &&
        payload.questions.every(isQuestion)
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
    case "stream/error":
      return isRpcError(payload.error);
    default:
      return false;
  }
}

function isHostPayload(payload: ServerRequestFrame["payload"]): boolean {
  switch (payload.type) {
    case "host/session-added":
      return (
        isNonEmptyString(payload.sessionId) &&
        typeof payload.blank === "boolean" &&
        isOptionalString(payload.cwd) &&
        isOptionalString(payload.agentPreset) &&
        (payload.parentSessionId === undefined || isNonEmptyString(payload.parentSessionId)) &&
        (payload.origin === undefined || payload.origin === "subagent")
      );
    case "host/session-removed":
      return isNonEmptyString(payload.sessionId);
    case "host/session-status":
      return isNonEmptyString(payload.sessionId) && typeof payload.running === "boolean";
    case "host/agent-error":
      return isNonEmptyString(payload.sessionId) && typeof payload.message === "string";
    case "host/workspace-changed":
      return isWorkspaceView(payload.workspace);
    case "host/workspace-removed":
      return isNonEmptyString(payload.workspaceId);
    case "host/workspace-order-changed":
      return isStringArray(payload.workspaceIds);
    case "host/archived-sessions-changed":
      return isStringArray(payload.archivedSessionIds);
    case "host/remote-event":
      return isNonEmptyString(payload.event) && Array.isArray(payload.args);
    case "stream/error":
      return isRpcError(payload.error);
    default:
      return false;
  }
}

function parseServerRequest(stream: StreamName, data: unknown): ServerRequestFrame | undefined {
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

function sessionEventFromPayload(payload: ServerRequestFrame["payload"]):
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

  const data = event.data;
  return {
    sessionId: payload.sessionId,
    event: {
      ...(isRecord(data) ? data : { data }),
      type: event.type,
      sequence: event.seq as number,
    },
  };
}

function subscribedEventFromPayload(payload: ServerRequestFrame["payload"]):
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

export class PiConnectionController {
  private readonly sessions = new Map<string, SessionConnection>();
  private readonly sessionWatermarks = new Map<string, number>();
  private readonly running = new Set<string>();
  private readonly webSocketFactory: PiWebSocketFactory;
  private readonly timers: PiConnectionTimers;
  private readonly random: () => number;
  private readonly onMuxFrame?: PiConnectionControllerOptions["onMuxFrame"];
  private readonly onHostFrame?: PiConnectionControllerOptions["onHostFrame"];
  private readonly onGenerationReady?: PiConnectionControllerOptions["onGenerationReady"];
  private readonly readyWaiters = new Set<ReadyWaiter>();
  private runningListener?: (sessionIds: string[]) => void;
  private generation?: ConnectionGeneration;
  private reconnectTimer?: unknown;
  private reconnectAttempt = 0;
  private nextGenerationId = 0;
  private started = false;
  private disposed = false;

  constructor(options: PiConnectionControllerOptions = {}) {
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory;
    this.timers = options.timers ?? browserTimers;
    this.random = options.random ?? Math.random;
    this.onMuxFrame = options.onMuxFrame;
    this.onHostFrame = options.onHostFrame;
    this.onGenerationReady = options.onGenerationReady;
  }

  startRunningEvents(listener: (sessionIds: string[]) => void): void {
    if (this.disposed) return;
    this.runningListener = listener;
    this.ensureStarted();
  }

  /** Replace the host-stream comparison baseline from an authoritative unary snapshot. */
  replaceRunningBaseline(sessionIds: readonly string[]): void {
    this.running.clear();
    for (const sessionId of sessionIds) this.running.add(sessionId);
  }

  async ensureSessionEvents(sessionId: string, listener: (event: PiEvent) => void): Promise<void> {
    if (this.disposed) return;
    const current = this.sessions.get(sessionId);
    if (current) {
      current.listener = listener;
      if (current.closeTimer !== undefined) {
        this.timers.clearTimeout(current.closeTimer);
        current.closeTimer = undefined;
      }
    } else {
      this.sessions.set(sessionId, { listener });
    }

    this.ensureStarted();
    await this.waitUntilConnected();
    const registered = this.sessions.get(sessionId);
    const watermark = this.sessionWatermarks.get(sessionId);
    if (registered?.listener === listener && watermark !== undefined) {
      try {
        listener({ type: "subscribed", sequence: watermark });
      } catch {
        // A session consumer must not invalidate the shared transport.
      }
    }
  }

  scheduleSessionClose(sessionId: string): void {
    const connection = this.sessions.get(sessionId);
    if (!connection || connection.closeTimer !== undefined) return;
    connection.closeTimer = this.timers.setTimeout(
      () => this.closeSession(sessionId),
      IDLE_CLOSE_DELAY_MS,
    );
  }

  closeSession(sessionId: string): void {
    const connection = this.sessions.get(sessionId);
    if (!connection) return;
    if (connection.closeTimer !== undefined) this.timers.clearTimeout(connection.closeTimer);
    this.sessions.delete(sessionId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.started = false;
    if (this.reconnectTimer !== undefined) {
      this.timers.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    const generation = this.generation;
    this.generation = undefined;
    if (generation) this.closeGeneration(generation);
    for (const connection of this.sessions.values()) {
      if (connection.closeTimer !== undefined) this.timers.clearTimeout(connection.closeTimer);
    }
    this.sessions.clear();
    for (const waiter of this.readyWaiters) {
      if (waiter.timer !== undefined) this.timers.clearTimeout(waiter.timer);
      waiter.resolve();
    }
    this.readyWaiters.clear();
  }

  private ensureStarted(): void {
    if (this.disposed) return;
    this.started = true;
    if (!this.generation && this.reconnectTimer === undefined) this.openGeneration();
  }

  private openGeneration(): void {
    if (this.disposed || !this.started || this.generation) return;
    const id = ++this.nextGenerationId;
    logConnectionInfo("connecting", {
      generation: id,
      streams: STREAM_PATHS,
    });
    let mux: PiWebSocket | undefined;
    let host: PiWebSocket | undefined;
    try {
      mux = this.webSocketFactory(STREAM_PATHS.mux);
      host = this.webSocketFactory(STREAM_PATHS.host);
    } catch (error) {
      logConnectionWarning("creation failed", {
        generation: id,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        mux?.close(1011, "generation failed");
      } catch {
        // The partially-created transport may not be open yet.
      }
      try {
        host?.close(1011, "generation failed");
      } catch {
        // The partially-created transport may not be open yet.
      }
      this.scheduleReconnect();
      return;
    }

    const generation: ConnectionGeneration = {
      id,
      mux,
      host,
      muxOpen: false,
      hostOpen: false,
      ready: false,
      active: true,
      pendingFrames: [],
    };
    this.generation = generation;
    this.bindSocket(generation, "mux", mux);
    this.bindSocket(generation, "host", host);
  }

  private bindSocket(
    generation: ConnectionGeneration,
    stream: StreamName,
    socket: PiWebSocket,
  ): void {
    socket.onopen = () => this.markSocketOpen(generation, stream);
    socket.onmessage = (event) => this.receiveFrame(generation, stream, event.data);
    socket.onerror = () => this.invalidateGeneration(generation, stream, "error");
    socket.onclose = () => this.invalidateGeneration(generation, stream, "closed");
  }

  private isCurrent(generation: ConnectionGeneration): boolean {
    return generation.active && this.generation === generation && !this.disposed;
  }

  private markSocketOpen(generation: ConnectionGeneration, stream: StreamName): void {
    if (!this.isCurrent(generation) || generation.ready) return;
    if (stream === "mux") generation.muxOpen = true;
    else generation.hostOpen = true;
    logConnectionInfo("stream open", { generation: generation.id, stream });
    if (!generation.muxOpen || !generation.hostOpen) return;

    generation.ready = true;
    this.reconnectAttempt = 0;
    logConnectionInfo("ready", { generation: generation.id });
    for (const waiter of this.readyWaiters) {
      if (waiter.timer !== undefined) this.timers.clearTimeout(waiter.timer);
      waiter.resolve();
    }
    this.readyWaiters.clear();

    const pendingFrames = generation.pendingFrames.splice(0);
    for (const frame of pendingFrames) {
      if (!this.isCurrent(generation)) return;
      this.dispatchFrame(generation, frame.stream, frame.data);
    }
    try {
      this.onGenerationReady?.(generation.id);
    } catch {
      // Consumer callbacks must not invalidate a healthy transport.
    }
  }

  private receiveFrame(generation: ConnectionGeneration, stream: StreamName, data: unknown): void {
    if (!this.isCurrent(generation)) return;
    if (!generation.ready) {
      if (generation.pendingFrames.length >= MAX_PENDING_GENERATION_FRAMES) {
        this.invalidateGeneration(generation, stream, "buffer-overflow");
      } else {
        generation.pendingFrames.push({ stream, data });
      }
      return;
    }
    this.dispatchFrame(generation, stream, data);
  }

  private dispatchFrame(generation: ConnectionGeneration, stream: StreamName, data: unknown): void {
    if (!this.isCurrent(generation)) return;
    const frame = parseServerRequest(stream, data);
    if (!frame) return;

    if (stream === "host") {
      if (!isHostPayload(frame.payload)) return;
      const payload = frame.payload as unknown as HostStreamPayload;
      this.applyHostPayload(payload);
      try {
        this.onHostFrame?.(payload, generation.id);
      } catch {
        // Consumer callbacks must not invalidate a healthy transport.
      }
      return;
    }

    if (!isMuxPayload(frame.payload)) return;
    try {
      this.onMuxFrame?.(frame as unknown as ServerRequest<MuxStreamPayload>, generation.id);
    } catch {
      // Consumer callbacks must not invalidate a healthy transport.
    }

    const routed =
      sessionEventFromPayload(frame.payload) ?? subscribedEventFromPayload(frame.payload);
    if (!routed) return;
    const previousWatermark = this.sessionWatermarks.get(routed.sessionId) ?? -1;
    const sequence = routed.event.sequence;
    if (typeof sequence === "number") {
      this.sessionWatermarks.set(routed.sessionId, Math.max(previousWatermark, sequence));
    }
    const session = this.sessions.get(routed.sessionId);
    if (!session) return;
    try {
      session.listener(routed.event);
    } catch {
      // A session consumer must not invalidate the shared transport.
    }
  }

  private applyHostPayload(payload: HostStreamPayload): void {
    let changed = false;
    if (payload.type === "host/session-status") {
      const hadSession = this.running.has(payload.sessionId);
      if (payload.running) this.running.add(payload.sessionId);
      else this.running.delete(payload.sessionId);
      changed = hadSession !== payload.running;
    } else if (payload.type === "host/session-removed") {
      changed = this.running.delete(payload.sessionId);
      this.sessionWatermarks.delete(payload.sessionId);
    }
    if (!changed) return;
    try {
      this.runningListener?.([...this.running].sort());
    } catch {
      // Running-state consumers are isolated from the shared transport.
    }
  }

  private invalidateGeneration(
    generation: ConnectionGeneration,
    stream: StreamName,
    reason: "buffer-overflow" | "closed" | "error",
  ): void {
    if (!this.isCurrent(generation)) return;
    logConnectionWarning("disconnected", {
      generation: generation.id,
      stream,
      reason,
    });
    this.generation = undefined;
    this.closeGeneration(generation);
    this.scheduleReconnect();
  }

  private closeGeneration(generation: ConnectionGeneration): void {
    if (!generation.active) return;
    generation.active = false;
    generation.pendingFrames.length = 0;
    for (const socket of [generation.mux, generation.host]) {
      try {
        socket.close(1000, "generation closed");
      } catch {
        // The socket may have failed before reaching OPEN.
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || !this.started || this.reconnectTimer !== undefined) return;
    const exponentialDelay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      INITIAL_RECONNECT_DELAY_MS * 2 ** Math.min(this.reconnectAttempt, 16),
    );
    let randomSample = 0.5;
    try {
      const candidate = this.random();
      if (Number.isFinite(candidate)) randomSample = candidate;
    } catch {
      // A broken jitter source falls back to the center of the bounded range.
    }
    const random = Math.min(1, Math.max(0, randomSample));
    const delay = Math.max(1, Math.round(exponentialDelay * (0.5 + random * 0.5)));
    this.reconnectAttempt += 1;
    logConnectionInfo("reconnect scheduled", {
      attempt: this.reconnectAttempt,
      delayMs: delay,
    });
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openGeneration();
    }, delay);
  }

  private waitUntilConnected(): Promise<void> {
    if (this.disposed || this.generation?.ready) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiter: ReadyWaiter = { resolve };
      waiter.timer = this.timers.setTimeout(() => {
        this.readyWaiters.delete(waiter);
        logConnectionWarning("readiness wait timed out", {
          generation: this.generation?.id,
          timeoutMs: CONNECT_WAIT_MS,
        });
        resolve();
      }, CONNECT_WAIT_MS);
      this.readyWaiters.add(waiter);
    });
  }
}
