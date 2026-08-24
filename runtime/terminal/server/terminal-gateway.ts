import {
  configuredApiTrustedHosts,
  inspectApiRequestTrust,
  type ApiRequestTrustOptions,
  type ApiRequestTrustResult,
} from "../../pi/server/transport/local-api-request-trust";
import {
  parseTerminalClientFrame,
  TERMINAL_WEBSOCKET_PATH,
  type TerminalErrorCode,
  type TerminalServerFrame,
} from "../contracts";
import {
  TerminalSessionError,
  type AttachedTerminalSession,
  type TerminalSessionManager,
  type TerminalSessionSubscription,
} from "./terminal-session-manager";

const WEB_SOCKET_OPEN = 1;
const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024;

type SocketListener = (...args: unknown[]) => void;

export interface TerminalWebSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string, callback?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  on(event: "message" | "close" | "error", listener: SocketListener): unknown;
}

export interface TerminalUpgradeRequest {
  url?: string;
  headers: Headers | Record<string, string | string[] | undefined>;
}

export interface TerminalUpgradeSocket {
  write(data: string): unknown;
  destroy(error?: Error): unknown;
}

export interface NoServerTerminalWebSocketServer<
  Request extends TerminalUpgradeRequest,
  Socket extends TerminalUpgradeSocket,
  Head,
> {
  handleUpgrade(
    request: Request,
    socket: Socket,
    head: Head,
    callback: (webSocket: TerminalWebSocket, request: Request) => void,
  ): void;
}

export interface TerminalSessionManagerLike {
  attach(options: {
    sessionId: string;
    toolCallId?: string;
    cwd?: string;
    cols?: number;
    rows?: number;
  }): Promise<AttachedTerminalSession>;
}

export type InspectTerminalUpgradeTrust = (
  request: { headers: Headers },
  options?: ApiRequestTrustOptions,
) => ApiRequestTrustResult;

export interface TerminalGatewayOptions<
  Request extends TerminalUpgradeRequest,
  Socket extends TerminalUpgradeSocket,
  Head,
> {
  webSocketServer: NoServerTerminalWebSocketServer<Request, Socket, Head>;
  sessions: TerminalSessionManager | TerminalSessionManagerLike;
  trustedHosts?: readonly string[];
  inspectTrust?: InspectTerminalUpgradeTrust;
  maxBufferedBytes?: number;
  onUnexpectedError?: (error: unknown) => void;
}

export interface TerminalGateway<
  Request extends TerminalUpgradeRequest,
  Socket extends TerminalUpgradeSocket,
  Head,
> {
  handleUpgrade(request: Request, socket: Socket, head: Head): boolean;
}

interface TerminalUpgradeOptions {
  sessionId: string;
  toolCallId?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  observe?: "interaction";
}

function requestHeaders(source: TerminalUpgradeRequest["headers"]): Headers {
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

function parseDimension(value: string | null, min: number, max: number): number | undefined | null {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) return true;
  }
  return false;
}

export function terminalOptionsForUpgradeUrl(
  url: string | undefined,
): TerminalUpgradeOptions | undefined | null {
  if (!url || url.length > 8192) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url, "http://localhost");
  } catch {
    return undefined;
  }
  if (parsed.pathname !== TERMINAL_WEBSOCKET_PATH) return undefined;

  const sessionId = parsed.searchParams.get("sessionId") ?? "";
  const toolCallId = parsed.searchParams.get("toolCallId")?.trim() || undefined;
  const cwd = parsed.searchParams.get("cwd")?.trim() || undefined;
  const cols = parseDimension(parsed.searchParams.get("cols"), 2, 500);
  const rows = parseDimension(parsed.searchParams.get("rows"), 1, 300);
  const observeValue = parsed.searchParams.get("observe");
  const observe =
    observeValue === null ? undefined : observeValue === "interaction" ? observeValue : null;
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(sessionId) || cols === null || rows === null) return null;
  if (observe === null) return null;
  if (cwd && cwd.length > 4096) return null;
  if (toolCallId && (toolCallId.length > 512 || hasControlCharacters(toolCallId))) {
    return null;
  }
  return {
    sessionId,
    ...(toolCallId ? { toolCallId } : {}),
    ...(cwd ? { cwd } : {}),
    ...(cols === undefined ? {} : { cols }),
    ...(rows === undefined ? {} : { rows }),
    ...(observe === undefined ? {} : { observe }),
  };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function rejectUpgrade(socket: TerminalUpgradeSocket, status: 400 | 403): void {
  const reason = status === 403 ? "Forbidden" : "Bad Request";
  try {
    socket.write(
      `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${byteLength(reason)}\r\n\r\n${reason}`,
    );
  } finally {
    socket.destroy();
  }
}

function rawMessageText(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  if (Array.isArray(raw) && raw.every((part) => Buffer.isBuffer(part))) {
    return Buffer.concat(raw).toString("utf8");
  }
  return undefined;
}

function errorCode(error: unknown): TerminalErrorCode {
  return error instanceof TerminalSessionError ? error.code : "internal-error";
}

async function acceptTerminalWebSocket(
  socket: TerminalWebSocket,
  request: TerminalUpgradeOptions,
  sessions: TerminalSessionManagerLike,
  maxBufferedBytes: number,
  onUnexpectedError?: (error: unknown) => void,
): Promise<void> {
  let closed = false;
  let readySent = false;
  let subscription: TerminalSessionSubscription | undefined;
  let terminal: AttachedTerminalSession | undefined;
  const pendingFrames: TerminalServerFrame[] = [];

  const close = (code: number, reason: string) => {
    if (closed) return;
    closed = true;
    subscription?.detach();
    try {
      socket.close(code, reason);
    } catch {
      // The transport may already be gone.
    }
  };
  const send = (frame: TerminalServerFrame): boolean => {
    if (closed || socket.readyState !== WEB_SOCKET_OPEN) return false;
    const serialized = JSON.stringify(frame);
    if (socket.bufferedAmount + byteLength(serialized) > maxBufferedBytes) {
      close(1011, "terminal client too slow");
      return false;
    }
    try {
      socket.send(serialized, (error) => {
        if (error) close(1011, "terminal send failed");
      });
      return true;
    } catch {
      close(1011, "terminal send failed");
      return false;
    }
  };
  const publish = (frame: TerminalServerFrame): boolean => {
    if (!readySent) {
      pendingFrames.push(frame);
      return true;
    }
    return send(frame);
  };

  socket.on("close", () => {
    closed = true;
    subscription?.detach();
  });
  socket.on("error", () => {
    closed = true;
    subscription?.detach();
  });

  try {
    const { observe, ...attachOptions } = request;
    terminal = await sessions.attach(attachOptions);
    if (closed) {
      terminal.subscribe({ onOutput: () => {}, onExit: () => {} }).detach();
      return;
    }

    subscription = terminal.subscribe({
      onOutput: (delta) =>
        observe === "interaction" ? undefined : publish({ type: "process/output-delta", delta }),
      onStateChange: (snapshot) =>
        publish({
          type: "process/state",
          processHandle: snapshot.processHandle,
          processState: snapshot.processState,
          interactionState: snapshot.interactionState,
          attachmentState: snapshot.attachmentState,
        }),
      onExit: (exit) => {
        publish({ type: "process/exited", exit });
        close(1000, "terminal exited");
      },
    });
    const snapshot = terminal.snapshot();
    if (!send({ type: "process/ready", process: snapshot })) {
      subscription.detach();
      return;
    }
    readySent = true;
    if (observe !== "interaction" && subscription.replay.data) {
      send({
        type: "process/output-delta",
        delta: {
          processHandle: snapshot.processHandle,
          sequence: subscription.replay.sequence,
          stream: "terminal",
          data: subscription.replay.data,
          outputBytes: subscription.replay.outputBytes,
          outputCapReached: subscription.replay.outputCapReached,
        },
      });
    }
    for (const frame of pendingFrames.splice(0)) send(frame);

    socket.on("message", (raw) => {
      if (observe === "interaction") {
        send({
          type: "process/error",
          ...(terminal ? { processHandle: terminal.processHandle } : {}),
          code: "invalid-message",
        });
        close(1008, "interaction observer is read-only");
        return;
      }
      const text = rawMessageText(raw);
      let value: unknown;
      try {
        value = text && byteLength(text) <= 65_536 ? JSON.parse(text) : undefined;
      } catch {
        value = undefined;
      }
      const frame = parseTerminalClientFrame(value);
      if (!frame || !terminal || frame.processHandle !== terminal.processHandle) {
        send({
          type: "process/error",
          ...(terminal ? { processHandle: terminal.processHandle } : {}),
          code: "invalid-message",
        });
        close(1008, "invalid terminal message");
        return;
      }
      try {
        if (frame.type === "process/write-stdin") terminal.writeStdin(frame.data);
        else if (frame.type === "process/resize") terminal.resizePty(frame.cols, frame.rows);
        else if (frame.type === "process/interrupt") terminal.interrupt();
        else if (frame.type === "process/terminate") terminal.terminate();
        else terminal.run(frame.command);
      } catch (error) {
        onUnexpectedError?.(error);
        send({
          type: "process/error",
          processHandle: terminal.processHandle,
          code: "internal-error",
        });
        close(1011, "terminal operation failed");
      }
    });
  } catch (error) {
    if (!(error instanceof TerminalSessionError)) onUnexpectedError?.(error);
    send({ type: "process/error", code: errorCode(error) });
    close(error instanceof TerminalSessionError ? 1008 : 1011, "terminal unavailable");
  }
}

export function createTerminalGateway<
  Request extends TerminalUpgradeRequest,
  Socket extends TerminalUpgradeSocket,
  Head,
>(options: TerminalGatewayOptions<Request, Socket, Head>): TerminalGateway<Request, Socket, Head> {
  const inspectTrust = options.inspectTrust ?? inspectApiRequestTrust;
  const maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  if (!Number.isInteger(maxBufferedBytes) || maxBufferedBytes < 1) {
    throw new RangeError("maxBufferedBytes must be a positive integer.");
  }

  return {
    handleUpgrade(request, socket, head) {
      const terminalOptions = terminalOptionsForUpgradeUrl(request.url);
      if (terminalOptions === undefined) return false;
      if (terminalOptions === null) {
        rejectUpgrade(socket, 400);
        return true;
      }

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
          void acceptTerminalWebSocket(
            webSocket,
            terminalOptions,
            options.sessions,
            maxBufferedBytes,
            options.onUnexpectedError,
          );
        });
      } catch (error) {
        options.onUnexpectedError?.(error);
        rejectUpgrade(socket, 400);
      }
      return true;
    },
  };
}
