import type { PiEvent } from "@workbench/agent-runtime-pi-protocol/messages";
import { isSessionMessageChunkData } from "@workbench/agent-runtime-pi-protocol/stream";
import type {
  HostStreamPayload,
  MuxStreamPayload,
  ServerRequest,
  SessionMessageSnapshotPayload,
  SessionMessageUpdatePayload,
  StreamName,
} from "@workbench/agent-runtime-pi-protocol/stream";
import { STREAM_PATHS } from "@workbench/agent-runtime-pi-protocol/stream";
import { SessionMessageAccumulator } from "@workbench/pi-conversation/accumulator";

const IDLE_CLOSE_DELAY_MS = 30_000;
const CONNECT_WAIT_MS = 10_000;
const INITIAL_RECONNECT_DELAY_MS = 250;
const MAX_RECONNECT_DELAY_MS = 10_000;
// Match the server hub's bootstrap buffer so a large retained mux baseline
// cannot force the paired sockets into a permanent reconnect loop.
const MAX_PENDING_GENERATION_FRAMES = 10_000;

const LOG_CONNECTION_LIFECYCLE = process.env.NODE_ENV === "development";

function logConnectionInfo(message: string, details: Record<string, unknown>): void {
  if (!LOG_CONNECTION_LIFECYCLE) return;
  console.info(`[workbench-pi] websocket ${message}`, details);
}

function logConnectionWarning(message: string, details: Record<string, unknown>): void {
  if (!LOG_CONNECTION_LIFECYCLE) return;
  console.warn(`[workbench-pi] websocket ${message}`, details);
}

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
  onConnectionRecoveringChange?: (recovering: boolean) => void;
}

interface SessionConnection {
  listener: (event: PiEvent) => void;
  closeTimer?: unknown;
  deliveredWatermark?: number;
  deliveredStreamId?: string;
  deliveredStreamRevision?: number;
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

import {
  isAssistantMessage,
  isMuxPayload,
  isHostPayload,
  parseServerRequest,
  sessionEventFromPayload,
  subscribedEventFromPayload,
} from "../lib/stream-frame-parser";
export class PiConnectionController {
  private readonly sessions = new Map<string, SessionConnection>();
  private readonly sessionWatermarks = new Map<string, number>();
  private readonly sessionMessageAccumulators = new Map<string, SessionMessageAccumulator>();
  private readonly endedSessionMessageStreams = new Map<string, string>();
  private readonly running = new Set<string>();
  private readonly webSocketFactory: PiWebSocketFactory;
  private readonly timers: PiConnectionTimers;
  private readonly random: () => number;
  private readonly onMuxFrame?: PiConnectionControllerOptions["onMuxFrame"];
  private readonly onHostFrame?: PiConnectionControllerOptions["onHostFrame"];
  private readonly onGenerationReady?: PiConnectionControllerOptions["onGenerationReady"];
  private readonly onConnectionRecoveringChange?: PiConnectionControllerOptions["onConnectionRecoveringChange"];
  private readonly readyWaiters = new Set<ReadyWaiter>();
  private runningListener?: (sessionIds: string[]) => void;
  private generation?: ConnectionGeneration;
  private reconnectTimer?: unknown;
  private reconnectAttempt = 0;
  private nextGenerationId = 0;
  private recovering = false;
  private started = false;
  private disposed = false;

  constructor(options: PiConnectionControllerOptions = {}) {
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory;
    this.timers = options.timers ?? browserTimers;
    this.random = options.random ?? Math.random;
    this.onMuxFrame = options.onMuxFrame;
    this.onHostFrame = options.onHostFrame;
    this.onGenerationReady = options.onGenerationReady;
    this.onConnectionRecoveringChange = options.onConnectionRecoveringChange;
  }

  getRecovering = (): boolean => this.recovering;

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
      if (current.listener !== listener) {
        current.deliveredWatermark = undefined;
        current.deliveredStreamId = undefined;
        current.deliveredStreamRevision = undefined;
      }
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
    if (
      registered?.listener === listener &&
      watermark !== undefined &&
      registered.deliveredWatermark !== watermark
    ) {
      this.deliverSessionEvent(sessionId, { type: "subscribed", sequence: watermark });
    }
    if (registered?.listener === listener) this.replaySessionMessageSnapshot(sessionId);
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

  /** Permanently forget all reconnect state for a deleted session. */
  deleteSession(sessionId: string): void {
    this.closeSession(sessionId);
    this.sessionWatermarks.delete(sessionId);
    this.sessionMessageAccumulators.delete(sessionId);
    this.endedSessionMessageStreams.delete(sessionId);
    this.running.delete(sessionId);
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
    this.sessionWatermarks.clear();
    this.sessionMessageAccumulators.clear();
    this.endedSessionMessageStreams.clear();
    this.running.clear();
    this.runningListener = undefined;
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
    this.sessionMessageAccumulators.clear();
    this.endedSessionMessageStreams.clear();
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
    this.setRecovering(false);
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

  private deliverSessionEvent(sessionId: string, event: PiEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (event.type === "subscribed" && typeof event.sequence === "number") {
      session.deliveredWatermark = event.sequence;
    } else if (
      event.type === "message_update" &&
      typeof event.transientStreamId === "string" &&
      typeof event.transientRevision === "number"
    ) {
      session.deliveredStreamId = event.transientStreamId;
      session.deliveredStreamRevision = event.transientRevision;
    }
    try {
      session.listener(event);
    } catch {
      // A session consumer must not invalidate the shared transport.
    }
  }

  private replaySessionMessageSnapshot(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    const event = this.sessionMessageAccumulators.get(sessionId)?.currentEvent();
    if (!session || !event) return;
    if (
      session.deliveredStreamId === event.transientStreamId &&
      session.deliveredStreamRevision === event.transientRevision
    ) {
      return;
    }
    this.deliverSessionEvent(sessionId, event);
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

    const muxPayload = frame.payload as unknown as MuxStreamPayload;
    if (muxPayload.type === "session/message-snapshot") {
      if (this.endedSessionMessageStreams.get(muxPayload.sessionId) === muxPayload.streamId) return;
      const accumulator =
        this.sessionMessageAccumulators.get(muxPayload.sessionId) ??
        new SessionMessageAccumulator();
      this.sessionMessageAccumulators.set(muxPayload.sessionId, accumulator);
      const result = accumulator.applySnapshot(muxPayload as SessionMessageSnapshotPayload);
      if (result.kind === "event") this.deliverSessionEvent(muxPayload.sessionId, result.event);
      return;
    }
    if (muxPayload.type === "session/message-update") {
      if (this.endedSessionMessageStreams.get(muxPayload.sessionId) === muxPayload.streamId) return;
      const accumulator =
        this.sessionMessageAccumulators.get(muxPayload.sessionId) ??
        new SessionMessageAccumulator();
      this.sessionMessageAccumulators.set(muxPayload.sessionId, accumulator);
      const result = accumulator.applyUpdate(muxPayload as SessionMessageUpdatePayload);
      if (result.kind === "gap") {
        this.invalidateGeneration(generation, "mux", "error");
      } else if (result.kind === "event") {
        this.deliverSessionEvent(muxPayload.sessionId, result.event);
      }
      return;
    }
    if (
      muxPayload.type === "session/event" &&
      muxPayload.event.type === "message_update" &&
      isSessionMessageChunkData(muxPayload.event.data)
    ) {
      const accumulator =
        this.sessionMessageAccumulators.get(muxPayload.sessionId) ??
        new SessionMessageAccumulator();
      this.sessionMessageAccumulators.set(muxPayload.sessionId, accumulator);
      const result = accumulator.applyChunk(
        muxPayload.event.data,
        muxPayload.event.seq,
        muxPayload.event.time,
      );
      this.sessionWatermarks.set(
        muxPayload.sessionId,
        Math.max(this.sessionWatermarks.get(muxPayload.sessionId) ?? -1, muxPayload.event.seq),
      );
      if (result.kind === "gap") {
        this.invalidateGeneration(generation, "mux", "error");
      } else if (result.kind === "event") {
        this.deliverSessionEvent(muxPayload.sessionId, {
          ...result.event,
          ...(muxPayload.runTiming === undefined ? {} : { runTiming: muxPayload.runTiming }),
        });
      }
      return;
    }

    if (muxPayload.type === "session/subscribed") {
      this.sessionMessageAccumulators.delete(muxPayload.sessionId);
      this.endedSessionMessageStreams.delete(muxPayload.sessionId);
      const session = this.sessions.get(muxPayload.sessionId);
      if (session) {
        session.deliveredStreamId = undefined;
        session.deliveredStreamRevision = undefined;
      }
    }

    const routed =
      sessionEventFromPayload(frame.payload) ?? subscribedEventFromPayload(frame.payload);
    if (!routed) return;
    const previousWatermark = this.sessionWatermarks.get(routed.sessionId) ?? -1;
    const sequence = routed.event.sequence;
    if (typeof sequence === "number") {
      this.sessionWatermarks.set(
        routed.sessionId,
        frame.payload.type === "session/subscribed"
          ? sequence
          : Math.max(previousWatermark, sequence),
      );
    }
    const eventMessage = routed.event.message;
    if (
      routed.event.type === "message_start" &&
      isAssistantMessage(eventMessage) &&
      typeof sequence === "number"
    ) {
      const accumulator = new SessionMessageAccumulator();
      const eventTime = muxPayload.type === "session/event" ? muxPayload.event.time : Date.now();
      accumulator.start(eventMessage, sequence, eventTime);
      this.sessionMessageAccumulators.set(routed.sessionId, accumulator);
      this.endedSessionMessageStreams.delete(routed.sessionId);
      const session = this.sessions.get(routed.sessionId);
      if (session) {
        session.deliveredStreamId = undefined;
        session.deliveredStreamRevision = undefined;
      }
    } else if (
      routed.event.type === "agent_settled" ||
      (routed.event.type === "message_end" && isAssistantMessage(eventMessage))
    ) {
      const accumulator = this.sessionMessageAccumulators.get(routed.sessionId);
      if (accumulator?.streamId) {
        this.endedSessionMessageStreams.set(routed.sessionId, accumulator.streamId);
      }
      this.sessionMessageAccumulators.delete(routed.sessionId);
    }
    this.deliverSessionEvent(routed.sessionId, routed.event);
  }

  private applyHostPayload(payload: HostStreamPayload): void {
    let changed = false;
    if (payload.type === "host/session-status") {
      const hadSession = this.running.has(payload.sessionId);
      if (payload.running) this.running.add(payload.sessionId);
      else {
        this.running.delete(payload.sessionId);
        this.sessionMessageAccumulators.delete(payload.sessionId);
        this.endedSessionMessageStreams.delete(payload.sessionId);
      }
      changed = hadSession !== payload.running;
    } else if (payload.type === "host/session-removed") {
      changed = this.running.delete(payload.sessionId);
      this.sessionWatermarks.delete(payload.sessionId);
      this.sessionMessageAccumulators.delete(payload.sessionId);
      this.endedSessionMessageStreams.delete(payload.sessionId);
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
    this.sessionMessageAccumulators.clear();
    this.endedSessionMessageStreams.clear();
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
    this.setRecovering(true);
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

  private setRecovering(recovering: boolean): void {
    if (this.recovering === recovering) return;
    this.recovering = recovering;
    try {
      this.onConnectionRecoveringChange?.(recovering);
    } catch {
      // Presentation observers must not invalidate the transport.
    }
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
