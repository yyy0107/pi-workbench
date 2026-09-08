import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocket } from "ws";

import {
  BROWSER_WEBSOCKET_PATH,
  MAX_BROWSER_MESSAGE_BYTES,
  parseBrowserClientFrame,
  type BrowserServerFrame,
} from "@workbench/browser-contracts";
import { BrowserError, type BrowserManager } from "@workbench/browser-server";
import type { NoServerWebSocketServerLike } from "@workbench/host-server/runtime-transport-auth";
import type { WorkbenchWebSocketGateway } from "@workbench/host-server/workbench-http-server";
import { inspectApiRequestTrust } from "@workbench/server-core/request-trust";

export const MAX_BROWSER_CLIENT_MESSAGE_BYTES = MAX_BROWSER_MESSAGE_BYTES;
const MAX_BROWSER_SERVER_MESSAGE_BYTES = Math.ceil((64 * 1024 * 1024 * 4) / 3) + 64 * 1024;
const MAX_BROWSER_BUFFERED_BYTES = 128 * 1024 * 1024;
const MAX_PENDING_COMMANDS = 64;

export interface BrowserGatewayOptions {
  readonly webSocketServer: NoServerWebSocketServerLike<IncomingMessage, Duplex, Buffer, WebSocket>;
  readonly manager: Pick<BrowserManager, "handle" | "subscribe">;
  readonly trustedHosts?: readonly string[];
  readonly onUnexpectedError?: (error: unknown) => void;
}

function acceptBrowserSocket(socket: WebSocket, manager: BrowserGatewayOptions["manager"]): void {
  let closed = false;
  let unsubscribe: (() => void) | undefined;
  const pending = new Set<string>();
  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsubscribe?.();
  };
  const close = (code: number, reason: string) => {
    cleanup();
    socket.close(code, reason);
  };
  const send = (frame: BrowserServerFrame): void => {
    if (closed || socket.readyState !== 1) return;
    // ponytail: discard stale screen frames under backpressure; reliable commands/files stay ordered.
    if (frame.type === "frame" && socket.bufferedAmount > 1024 * 1024) return;
    try {
      const serialized = JSON.stringify(frame);
      const size = Buffer.byteLength(serialized);
      if (size > MAX_BROWSER_SERVER_MESSAGE_BYTES) {
        socket.send(
          JSON.stringify({
            type: "error",
            ...("id" in frame ? { id: frame.id } : {}),
            code: "browser-file-too-large",
          }),
        );
        return;
      }
      if (socket.bufferedAmount + size > MAX_BROWSER_BUFFERED_BYTES) {
        close(1013, "Browser client is too slow.");
        return;
      }
      socket.send(serialized, (error) => {
        if (error) close(1011, "Browser response could not be delivered.");
      });
    } catch {
      close(1011, "Browser response could not be delivered.");
    }
  };

  socket.on("close", cleanup);
  socket.on("error", cleanup);
  unsubscribe = manager.subscribe(send);
  if (closed) unsubscribe();
  socket.on("message", (raw, isBinary) => {
    if (closed) return;
    let value: unknown;
    try {
      const bytes = Array.isArray(raw)
        ? Buffer.concat(raw)
        : raw instanceof ArrayBuffer
          ? Buffer.from(raw)
          : raw;
      if (isBinary || bytes.byteLength > MAX_BROWSER_CLIENT_MESSAGE_BYTES) {
        close(1009, "Browser request exceeds the supported message size or format.");
        return;
      }
      value = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      close(1008, "Invalid browser request.");
      return;
    }
    const frame = parseBrowserClientFrame(value);
    if (!frame || pending.has(frame.id)) {
      close(1008, "Invalid browser request.");
      return;
    }
    if (pending.size >= MAX_PENDING_COMMANDS) {
      send({ type: "error", id: frame.id, code: "browser-operation-failed" });
      return;
    }
    pending.add(frame.id);
    void Promise.resolve()
      .then(() => manager.handle(frame.command, { source: frame.source ?? "user" }))
      .then((result) => send({ type: "result", id: frame.id, result }))
      .catch((error: unknown) => {
        send({
          type: "error",
          id: frame.id,
          code: error instanceof BrowserError ? error.code : "browser-operation-failed",
        });
      })
      .finally(() => pending.delete(frame.id));
  });
}

/** Owns public ingress/auth framing; Chrome and raw CDP remain behind the Browser service. */
export function createBrowserGateway(options: BrowserGatewayOptions): WorkbenchWebSocketGateway {
  return {
    handleUpgrade(request, socket, head) {
      let url: URL;
      try {
        url = new URL(request.url ?? "", "http://localhost");
      } catch {
        return false;
      }
      if (url.pathname !== BROWSER_WEBSOCKET_PATH) return false;
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) for (const item of value) headers.append(name, item);
        else if (value !== undefined) headers.set(name, value);
      }
      if (
        request.url !== BROWSER_WEBSOCKET_PATH ||
        !inspectApiRequestTrust({ headers }, { trustedHosts: options.trustedHosts }).trusted
      ) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return true;
      }
      try {
        options.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
          acceptBrowserSocket(webSocket, options.manager);
        });
      } catch (error) {
        options.onUnexpectedError?.(error);
        socket.destroy();
      }
      return true;
    },
  };
}
