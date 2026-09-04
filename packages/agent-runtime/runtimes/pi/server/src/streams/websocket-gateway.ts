import { randomUUID } from "node:crypto";

import type {
  ApiRequestTrustOptions,
  ApiRequestTrustResult,
} from "@workbench/server-core/request-trust";
import {
  configuredApiTrustedHosts,
  inspectApiRequestTrust,
} from "@workbench/server-core/request-trust";
import type { StreamBootstrap, StreamHub, StreamSubscription } from "./stream-hub";
// @ts-expect-error TS5097 -- application sources are bundled without emitting this specifier.
import { getStreamHub, toStreamRpcError } from "./stream-hub.ts";
import type {
  ServerRequest,
  StreamErrorPayload,
  StreamName,
  StreamPayloadMap,
} from "@workbench/agent-runtime-pi-protocol/stream";
import { createServerRequest, STREAM_PATHS } from "@workbench/agent-runtime-pi-protocol/stream";

export const WEB_SOCKET_OPEN = 1;
export const DEFAULT_MAX_WEBSOCKET_BUFFERED_BYTES = 1024 * 1024;
export const DEFAULT_WEBSOCKET_BACKPRESSURE_GRACE_MS = 10_000;
const WEBSOCKET_HEARTBEAT_INTERVAL_MS = 10_000;

export interface WebSocketGatewayTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

const defaultWebSocketGatewayTimers: WebSocketGatewayTimers = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
};

type SocketListener = (...args: unknown[]) => void;

export interface DownlinkWebSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string, callback?: (error?: Error) => void): void;
  ping?(): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
  on(event: "message" | "close" | "error" | "pong", listener: SocketListener): unknown;
}

export interface DownlinkConnection {
  readonly ready: Promise<void>;
  close(code?: number, reason?: string): void;
}

export interface AcceptDownlinkOptions<Stream extends StreamName> {
  hub?: StreamHub;
  bootstrap?: StreamBootstrap<Stream>;
  maxBufferedBytes?: number;
  backpressureGraceMs?: number;
  timers?: WebSocketGatewayTimers;
  maxBootstrapBufferFrames?: number;
  createRpcId?: () => string;
}

interface PendingWebSocketFrame {
  readonly data: string;
  readonly byteLength: number;
  readonly oversized: boolean;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function streamErrorFrame(
  error: unknown,
  createRpcId: () => string,
): ServerRequest<StreamErrorPayload> {
  return createServerRequest(createRpcId(), {
    type: "stream/error",
    error: toStreamRpcError(error),
  });
}

export function acceptDownlinkWebSocket<Stream extends StreamName>(
  stream: Stream,
  socket: DownlinkWebSocket,
  options: AcceptDownlinkOptions<Stream> = {},
): DownlinkConnection {
  const hub = options.hub ?? getStreamHub();
  const maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_WEBSOCKET_BUFFERED_BYTES;
  if (!Number.isInteger(maxBufferedBytes) || maxBufferedBytes < 1) {
    throw new RangeError("maxBufferedBytes must be a positive integer.");
  }
  const backpressureGraceMs =
    options.backpressureGraceMs ?? DEFAULT_WEBSOCKET_BACKPRESSURE_GRACE_MS;
  if (!Number.isInteger(backpressureGraceMs) || backpressureGraceMs < 1) {
    throw new RangeError("backpressureGraceMs must be a positive integer.");
  }

  const createRpcId = options.createRpcId ?? randomUUID;
  const timers = options.timers ?? defaultWebSocketGatewayTimers;
  let terminal = false;
  let subscription: StreamSubscription | undefined;
  let sendInFlight = false;
  let backpressureTimer: unknown | undefined;
  let heartbeatTimer: unknown | undefined;
  let awaitingPong = false;
  let pendingBytes = 0;
  let pendingOversizedFrames = 0;
  let pendingFrameHead = 0;
  let pendingFrameTail = 0;
  const pendingFrames = new Map<number, PendingWebSocketFrame>();

  const clearBackpressureTimer = () => {
    if (backpressureTimer === undefined) return;
    timers.clearTimeout(backpressureTimer);
    backpressureTimer = undefined;
  };

  const clearHeartbeatTimer = () => {
    if (heartbeatTimer === undefined) return;
    timers.clearTimeout(heartbeatTimer);
    heartbeatTimer = undefined;
  };

  const clearPendingFrames = () => {
    clearBackpressureTimer();
    pendingFrames.clear();
    pendingFrameHead = 0;
    pendingFrameTail = 0;
    pendingBytes = 0;
    pendingOversizedFrames = 0;
  };

  const cleanup = () => {
    if (terminal) return;
    terminal = true;
    clearHeartbeatTimer();
    clearPendingFrames();
    subscription?.close();
  };

  const closeSocket = (code: number, reason: string) => {
    if (terminal) return;
    terminal = true;
    clearHeartbeatTimer();
    clearPendingFrames();
    subscription?.close();
    try {
      socket.close(code, reason);
    } catch {
      // The peer or transport may already be gone.
    }
  };

  const closeWithStreamError = (error: unknown) => {
    if (terminal) return;
    terminal = true;
    clearHeartbeatTimer();
    clearPendingFrames();
    subscription?.close();

    if (socket.readyState === WEB_SOCKET_OPEN && socket.bufferedAmount <= maxBufferedBytes) {
      try {
        const serialized = JSON.stringify(streamErrorFrame(error, createRpcId));
        if (socket.bufferedAmount + byteLength(serialized) <= maxBufferedBytes) {
          socket.send(serialized, () => undefined);
        }
      } catch {
        // Closing still preserves a safe terminal state when even diagnostics fail.
      }
    }
    try {
      socket.close(1011, "stream error");
    } catch {
      // The peer or transport may already be gone.
    }
  };

  const terminateUnresponsiveSocket = () => {
    if (terminal) return;
    terminal = true;
    clearHeartbeatTimer();
    clearPendingFrames();
    subscription?.close();
    try {
      if (socket.terminate) socket.terminate();
      else socket.close(1011, "heartbeat timeout");
    } catch {
      // The peer or transport may already be gone.
    }
  };

  const scheduleHeartbeat = () => {
    if (terminal || !socket.ping) return;
    heartbeatTimer = timers.setTimeout(() => {
      heartbeatTimer = undefined;
      if (terminal) return;
      if (awaitingPong) {
        terminateUnresponsiveSocket();
        return;
      }
      awaitingPong = true;
      try {
        socket.ping?.();
      } catch {
        terminateUnresponsiveSocket();
        return;
      }
      scheduleHeartbeat();
    }, WEBSOCKET_HEARTBEAT_INTERVAL_MS);
  };

  const pendingBacklogExceedsBudget = () =>
    pendingOversizedFrames > 1 || pendingBytes > maxBufferedBytes;

  const refreshBackpressureTimer = () => {
    if (terminal || !pendingBacklogExceedsBudget()) {
      clearBackpressureTimer();
      return;
    }
    if (backpressureTimer !== undefined) return;
    backpressureTimer = timers.setTimeout(() => {
      backpressureTimer = undefined;
      if (terminal || !pendingBacklogExceedsBudget()) return;
      closeWithStreamError(new Error("WebSocket client is not consuming stream frames."));
    }, backpressureGraceMs);
  };

  const drainPendingFrames = () => {
    if (terminal || sendInFlight || socket.readyState !== WEB_SOCKET_OPEN) return;
    const next = pendingFrames.get(pendingFrameHead);
    if (!next) return;
    pendingFrames.delete(pendingFrameHead++);
    if (pendingFrames.size === 0) {
      pendingFrameHead = 0;
      pendingFrameTail = 0;
    }

    if (next.oversized) pendingOversizedFrames -= 1;
    else pendingBytes -= next.byteLength;
    refreshBackpressureTimer();

    sendInFlight = true;
    try {
      socket.send(next.data, (error) => {
        sendInFlight = false;
        if (error) {
          closeWithStreamError(error);
          return;
        }
        drainPendingFrames();
      });
    } catch (error) {
      sendInFlight = false;
      closeWithStreamError(error);
    }
  };

  const enqueueFrame = (serialized: string) => {
    const serializedBytes = byteLength(serialized);
    const oversized = serializedBytes > maxBufferedBytes;

    pendingFrames.set(pendingFrameTail++, {
      data: serialized,
      byteLength: serializedBytes,
      oversized,
    });
    if (oversized) pendingOversizedFrames += 1;
    else pendingBytes += serializedBytes;
    // Bursty bootstrap/live publication can fill the application queue before `ws` gets an event
    // loop turn to invoke even the first send callback. Treat the byte budget as a sustained
    // backpressure watermark; only a queue that remains above it for the full grace period is a
    // slow consumer. Returning below the watermark cancels the deadline; merely making slower
    // progress does not let an ever-growing queue retain memory indefinitely. A single oversized
    // protocol frame remains an indivisible allowed unit.
    refreshBackpressureTimer();
    drainPendingFrames();
  };

  const sendFrame = (frame: ServerRequest<StreamPayloadMap[Stream]>) => {
    if (terminal || socket.readyState !== WEB_SOCKET_OPEN) return;

    let serialized: string;
    try {
      serialized = JSON.stringify(frame);
      if (serialized === undefined) throw new TypeError("Stream frame is not serializable.");
    } catch (error) {
      closeWithStreamError(error);
      return;
    }

    enqueueFrame(serialized);
  };

  socket.on("message", () => closeSocket(1008, "downlink only"));
  socket.on("pong", () => {
    awaitingPong = false;
  });
  socket.on("close", cleanup);
  socket.on("error", cleanup);

  try {
    subscription = hub.subscribe(
      stream,
      { onFrame: sendFrame, onError: closeWithStreamError },
      {
        ...(options.bootstrap === undefined ? {} : { bootstrap: options.bootstrap }),
        ...(options.maxBootstrapBufferFrames === undefined
          ? {}
          : { maxBufferedFrames: options.maxBootstrapBufferFrames }),
      },
    );
  } catch (error) {
    closeWithStreamError(error);
  }
  scheduleHeartbeat();

  return {
    ready: subscription?.ready ?? Promise.resolve(),
    close: (code = 1000, reason = "") => closeSocket(code, reason),
  };
}

export interface UpgradeRequestLike {
  url?: string;
  headers: Headers | Record<string, string | string[] | undefined>;
}

export interface UpgradeSocketLike {
  write(data: string): unknown;
  destroy(error?: Error): unknown;
}

export interface NoServerWebSocketServerLike<
  Request extends UpgradeRequestLike,
  Socket extends UpgradeSocketLike,
  Head,
> {
  handleUpgrade(
    request: Request,
    socket: Socket,
    head: Head,
    callback: (webSocket: DownlinkWebSocket, request: Request) => void,
  ): void;
}

export type InspectUpgradeTrust = (
  request: { headers: Headers },
  options?: ApiRequestTrustOptions,
) => ApiRequestTrustResult;

export interface NoServerWebSocketGatewayOptions<
  Request extends UpgradeRequestLike,
  Socket extends UpgradeSocketLike,
  Head,
> {
  webSocketServer: NoServerWebSocketServerLike<Request, Socket, Head>;
  hub?: StreamHub;
  bootstrap?: { [Stream in StreamName]?: StreamBootstrap<Stream> };
  trustedHosts?: readonly string[];
  inspectTrust?: InspectUpgradeTrust;
  maxBufferedBytes?: number;
  backpressureGraceMs?: number;
  timers?: WebSocketGatewayTimers;
  maxBootstrapBufferFrames?: number;
  createRpcId?: () => string;
  onUnexpectedError?: (error: unknown) => void;
}

export interface NoServerWebSocketGateway<
  Request extends UpgradeRequestLike,
  Socket extends UpgradeSocketLike,
  Head,
> {
  /** Returns false for non-WS paths so the owning HTTP server can continue routing. */
  handleUpgrade(request: Request, socket: Socket, head: Head): boolean;
}

function requestHeaders(source: Headers | Record<string, string | string[] | undefined>): Headers {
  if (source instanceof Headers) return new Headers(source);
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

export function streamNameForUpgradeUrl(url: string | undefined): StreamName | undefined {
  if (!url) return undefined;
  let pathname: string;
  try {
    pathname = new URL(url, "http://localhost").pathname;
  } catch {
    return undefined;
  }
  if (pathname === STREAM_PATHS.mux) return "mux";
  if (pathname === STREAM_PATHS.host) return "host";
  return undefined;
}

function rejectUpgrade(socket: UpgradeSocketLike, status: 400 | 403): void {
  const reason = status === 403 ? "Forbidden" : "Bad Request";
  const body = reason;
  try {
    socket.write(
      `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${byteLength(body)}\r\n\r\n${body}`,
    );
  } finally {
    socket.destroy();
  }
}

export function createNoServerWebSocketGateway<
  Request extends UpgradeRequestLike,
  Socket extends UpgradeSocketLike,
  Head,
>(
  options: NoServerWebSocketGatewayOptions<Request, Socket, Head>,
): NoServerWebSocketGateway<Request, Socket, Head> {
  const inspectTrust = options.inspectTrust ?? inspectApiRequestTrust;
  const hub = options.hub ?? getStreamHub();

  return {
    handleUpgrade(request, socket, head) {
      const stream = streamNameForUpgradeUrl(request.url);
      if (!stream) return false;

      const trust = inspectTrust(
        { headers: requestHeaders(request.headers) },
        { trustedHosts: options.trustedHosts ?? configuredApiTrustedHosts() },
      );
      if (!trust.trusted) {
        rejectUpgrade(socket, 403);
        return true;
      }

      try {
        options.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
          const connectionOptions = {
            hub,
            ...(options.maxBufferedBytes === undefined
              ? {}
              : { maxBufferedBytes: options.maxBufferedBytes }),
            ...(options.backpressureGraceMs === undefined
              ? {}
              : { backpressureGraceMs: options.backpressureGraceMs }),
            ...(options.timers === undefined ? {} : { timers: options.timers }),
            ...(options.maxBootstrapBufferFrames === undefined
              ? {}
              : { maxBootstrapBufferFrames: options.maxBootstrapBufferFrames }),
            ...(options.createRpcId === undefined ? {} : { createRpcId: options.createRpcId }),
          };
          if (stream === "mux") {
            acceptDownlinkWebSocket("mux", webSocket, {
              ...connectionOptions,
              ...(options.bootstrap?.mux === undefined ? {} : { bootstrap: options.bootstrap.mux }),
            });
          } else {
            acceptDownlinkWebSocket("host", webSocket, {
              ...connectionOptions,
              ...(options.bootstrap?.host === undefined
                ? {}
                : { bootstrap: options.bootstrap.host }),
            });
          }
        });
      } catch (error) {
        options.onUnexpectedError?.(error);
        rejectUpgrade(socket, 400);
      }
      return true;
    },
  };
}
