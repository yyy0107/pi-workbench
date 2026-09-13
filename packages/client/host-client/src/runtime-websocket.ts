import {
  RuntimeWebSocketAuthenticationErrorCode,
  RuntimeWebSocketCloseCode,
  createRuntimeWebSocketAuthenticateFrame,
  isRuntimeProtocolVersionCompatible,
  parseRuntimeWebSocketAuthenticatedFrame,
  parseRuntimeWebSocketAuthenticationErrorFrame,
} from "@workbench/host-contracts";
import type { RuntimeConnection } from "@workbench/host-contracts";

import { resolveRuntimeWebSocketUrl } from "./runtime-fetch";

/**
 * The minimal browser WebSocket surface required by the Pi and terminal
 * stream clients. It intentionally avoids DOM event types so consumers can
 * provide deterministic test doubles without a browser runtime.
 */
export interface RuntimeWebSocket {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: RuntimeWebSocketMessageEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  send(data: unknown): void;
  close(code?: number, reason?: string): void;
}

export interface RuntimeWebSocketMessageEvent {
  readonly data: unknown;
}

/** Browser-compatible ready-state values for consumers that use the structural socket port. */
export const RuntimeWebSocketReadyState = Object.freeze({
  connecting: 0,
  open: 1,
  closing: 2,
  closed: 3,
} as const);

/** Creates an unwrapped native socket for one already-resolved URL. */
export type RuntimeWebSocketNativeFactory = (url: string) => RuntimeWebSocket;

export interface RuntimeWebSocketTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

export interface RuntimeWebSocketOptions {
  /**
   * Injectable native socket constructor/factory. The default is the global
   * browser WebSocket constructor.
   */
  readonly webSocketFactory?: RuntimeWebSocketNativeFactory;
  readonly timers?: RuntimeWebSocketTimers;
  /** Time allowed for the desktop authentication acknowledgement after open. */
  readonly authenticationTimeoutMs?: number;
}

export interface RuntimeWebSocketAuthenticationErrorEvent {
  readonly type: "runtime-websocket-authentication-error";
  readonly code: RuntimeWebSocketCloseCode;
}

const DEFAULT_AUTHENTICATION_TIMEOUT_MS = 5_000;
const MAX_AUTHENTICATION_TIMEOUT_MS = 30_000;

const browserTimers: RuntimeWebSocketTimers = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
};

function defaultNativeWebSocketFactory(url: string): RuntimeWebSocket {
  if (typeof globalThis.WebSocket !== "function") throw new Error("WebSocket is unavailable.");
  return new globalThis.WebSocket(url) as unknown as RuntimeWebSocket;
}

function parseJsonFrame(data: unknown): unknown {
  if (typeof data !== "string") return undefined;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return undefined;
  }
}

function authenticationFailureCloseCode(
  errorCode: RuntimeWebSocketAuthenticationErrorCode,
): RuntimeWebSocketCloseCode {
  switch (errorCode) {
    case "invalid-frame":
      return RuntimeWebSocketCloseCode.invalidAuthenticationFrame;
    case "protocol-version-mismatch":
      return RuntimeWebSocketCloseCode.protocolVersionMismatch;
    case "authentication-timed-out":
      return RuntimeWebSocketCloseCode.authenticationTimeout;
    case "authentication-failed":
      return RuntimeWebSocketCloseCode.authenticationFailed;
  }
}

function closeReason(code: RuntimeWebSocketCloseCode): string {
  switch (code) {
    case RuntimeWebSocketCloseCode.invalidAuthenticationFrame:
      return "Runtime WebSocket authentication frame is invalid.";
    case RuntimeWebSocketCloseCode.protocolVersionMismatch:
      return "Runtime WebSocket protocol version is incompatible.";
    case RuntimeWebSocketCloseCode.authenticationTimeout:
      return "Runtime WebSocket authentication timed out.";
    case RuntimeWebSocketCloseCode.authenticationFailed:
      return "Runtime WebSocket authentication failed.";
  }
}

type AuthenticationState = "pending" | "authenticated" | "failed" | "closed";

/**
 * Wraps a desktop socket with the Runtime Host's versioned first-frame
 * authentication. It never places a credential in the URL, error event, or
 * close reason. Business sends before acknowledgement are rejected rather
 * than queued, avoiding cross-connection state and replay ambiguity.
 */
class AuthenticatedDesktopRuntimeWebSocket implements RuntimeWebSocket {
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: RuntimeWebSocketMessageEvent) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  private authenticationState: AuthenticationState = "pending";
  private authenticationTimer: unknown;
  private readonly socket: RuntimeWebSocket;
  private readonly connection: Extract<RuntimeConnection, { kind: "desktop-sidecar" }>;
  private readonly timers: RuntimeWebSocketTimers;
  private readonly authenticationTimeoutMs: number;

  constructor(
    socket: RuntimeWebSocket,
    connection: Extract<RuntimeConnection, { kind: "desktop-sidecar" }>,
    timers: RuntimeWebSocketTimers,
    authenticationTimeoutMs: number,
  ) {
    this.socket = socket;
    this.connection = connection;
    this.timers = timers;
    this.authenticationTimeoutMs = authenticationTimeoutMs;
    this.socket.onopen = () => this.authenticate();
    this.socket.onmessage = (event) => this.receive(event);
    this.socket.onerror = (event) => this.onerror?.(event);
    this.socket.onclose = (event) => {
      this.clearAuthenticationTimer();
      if (this.authenticationState === "pending") this.authenticationState = "closed";
      this.onclose?.(event);
    };
  }

  get readyState(): number {
    if (this.authenticationState === "pending") return RuntimeWebSocketReadyState.connecting;
    if (this.authenticationState === "authenticated") return this.socket.readyState;
    return this.socket.readyState === RuntimeWebSocketReadyState.closed
      ? RuntimeWebSocketReadyState.closed
      : RuntimeWebSocketReadyState.closing;
  }

  send(data: unknown): void {
    if (this.authenticationState !== "authenticated") {
      throw new Error("Runtime WebSocket authentication has not completed.");
    }
    this.socket.send(data);
  }

  close(code?: number, reason?: string): void {
    if (this.authenticationState === "pending") {
      this.authenticationState = "closed";
      this.clearAuthenticationTimer();
    }
    this.socket.close(code, reason);
  }

  private authenticate(): void {
    if (this.authenticationState !== "pending") return;
    this.authenticationTimer = this.timers.setTimeout(
      () => this.failAuthentication(RuntimeWebSocketCloseCode.authenticationTimeout),
      this.authenticationTimeoutMs,
    );
    try {
      this.socket.send(JSON.stringify(createRuntimeWebSocketAuthenticateFrame(this.connection)));
    } catch {
      this.failAuthentication(RuntimeWebSocketCloseCode.authenticationFailed);
    }
  }

  private receive(event: RuntimeWebSocketMessageEvent): void {
    if (this.authenticationState === "authenticated") {
      this.onmessage?.(event);
      return;
    }
    if (this.authenticationState !== "pending") return;

    const frame = parseJsonFrame(event.data);
    const acknowledgement = parseRuntimeWebSocketAuthenticatedFrame(frame);
    if (acknowledgement) {
      if (!isRuntimeProtocolVersionCompatible(acknowledgement.protocolVersion)) {
        this.failAuthentication(RuntimeWebSocketCloseCode.protocolVersionMismatch);
        return;
      }
      if (acknowledgement.instanceId !== this.connection.instanceId) {
        this.failAuthentication(RuntimeWebSocketCloseCode.authenticationFailed);
        return;
      }
      this.authenticationState = "authenticated";
      this.clearAuthenticationTimer();
      this.onopen?.({ type: "runtime-websocket-authenticated" });
      return;
    }

    const authenticationError = parseRuntimeWebSocketAuthenticationErrorFrame(frame);
    if (authenticationError) {
      this.failAuthentication(authenticationFailureCloseCode(authenticationError.code));
      return;
    }
    this.failAuthentication(RuntimeWebSocketCloseCode.invalidAuthenticationFrame);
  }

  private failAuthentication(code: RuntimeWebSocketCloseCode): void {
    if (this.authenticationState !== "pending") return;
    this.authenticationState = "failed";
    this.clearAuthenticationTimer();
    const event: RuntimeWebSocketAuthenticationErrorEvent = Object.freeze({
      type: "runtime-websocket-authentication-error",
      code,
    });
    this.onerror?.(event);
    this.socket.close(code, closeReason(code));
  }

  private clearAuthenticationTimer(): void {
    if (this.authenticationTimer === undefined) return;
    this.timers.clearTimeout(this.authenticationTimer);
    this.authenticationTimer = undefined;
  }
}

/**
 * Connects to a Runtime Host endpoint. Same-origin mode returns the native
 * socket untouched; desktop-sidecar mode returns the authenticated wrapper.
 */
export function createRuntimeWebSocket(
  connection: RuntimeConnection,
  path: string,
  options: RuntimeWebSocketOptions = {},
): RuntimeWebSocket {
  const socketFactory = options.webSocketFactory ?? defaultNativeWebSocketFactory;
  const url = resolveRuntimeWebSocketUrl(connection, path).href;
  if (connection.kind === "same-origin") return socketFactory(url);

  const timeout = options.authenticationTimeoutMs ?? DEFAULT_AUTHENTICATION_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > MAX_AUTHENTICATION_TIMEOUT_MS) {
    throw new Error(
      "Runtime WebSocket authentication timeout must be an integer from 1 to 30000 ms.",
    );
  }
  const timers = options.timers ?? browserTimers;
  if (typeof timers.setTimeout !== "function" || typeof timers.clearTimeout !== "function") {
    throw new Error("Runtime WebSocket authentication timers are invalid.");
  }
  const socket = socketFactory(url);
  return new AuthenticatedDesktopRuntimeWebSocket(socket, connection, timers, timeout);
}

/** Creates the path-based factory consumed by the Pi and terminal transports. */
export function createRuntimeWebSocketFactory(
  connection: RuntimeConnection,
  options: RuntimeWebSocketOptions = {},
): (path: string) => RuntimeWebSocket {
  return (path) => createRuntimeWebSocket(connection, path, options);
}
