import {
  request as createClientRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type RequestOptions,
  type ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";

import type {
  WorkbenchRequestHandler,
  WorkbenchWebSocketGateway,
} from "@workbench/host-server/workbench-http-server";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export interface RuntimeSidecarProxyOptions {
  /** Ready-frame loopback HTTP origin. It is never exposed to the public caller. */
  readonly runtimeOrigin: string;
  /** In-memory credential injected only on the root-to-Runtime hop. */
  readonly accessToken: string;
  /** Canonical public Web origin admitted by the outer Host trust fence. */
  readonly publicOrigin: string;
  /** Test-only carrier; production uses node:http.request. */
  readonly createRequest?: typeof createClientRequest;
  /** Receives credential-safe proxy failures only. */
  readonly onUnexpectedError?: (error: Error) => void;
}

export interface RuntimeSidecarProxy extends WorkbenchWebSocketGateway {
  readonly handleHttp: WorkbenchRequestHandler;
  /** Stops new Runtime admissions and destroys all active inner-hop transports. */
  stopAdmission(): void;
  readonly accepting: boolean;
}

function canonicalOrigin(value: string, label: string, protocols: readonly string[]): URL {
  try {
    const parsed = new URL(value);
    if (
      !protocols.includes(parsed.protocol) ||
      !parsed.host ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== "" && parsed.pathname !== "/") ||
      parsed.search ||
      parsed.hash ||
      parsed.origin !== value
    ) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw new Error(`Invalid Runtime sidecar ${label}.`);
  }
}

function safeCredential(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 8_192 &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 32 || codePoint === 127);
    })
  );
}

function connectionNamedHeaders(headers: IncomingHttpHeaders): Set<string> {
  const value = headers.connection;
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return new Set(
    values
      .flatMap((entry) => entry.split(","))
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

function forwardedRequestHeaders(
  headers: IncomingHttpHeaders,
  options: {
    readonly runtimeHost: string;
    readonly accessToken: string;
    readonly publicOrigin: string;
  },
  upgrade: boolean,
): OutgoingHttpHeaders {
  const connectionHeaders = connectionNamedHeaders(headers);
  const forwarded: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (
      value === undefined ||
      HOP_BY_HOP_HEADERS.has(normalized) ||
      connectionHeaders.has(normalized) ||
      normalized === "authorization" ||
      normalized === "origin" ||
      normalized === "sec-fetch-site" ||
      normalized === "host"
    ) {
      continue;
    }
    forwarded[name] = value;
  }
  forwarded.host = options.runtimeHost;
  forwarded.authorization = `Bearer ${options.accessToken}`;
  forwarded.origin = options.publicOrigin;
  forwarded["sec-fetch-site"] = "same-origin";
  if (upgrade) {
    forwarded.connection = "Upgrade";
    forwarded.upgrade = "websocket";
  }
  return forwarded;
}

function responseHeaders(
  headers: IncomingHttpHeaders,
  preserveUpgrade: boolean,
): OutgoingHttpHeaders {
  const connectionHeaders = connectionNamedHeaders(headers);
  const forwarded: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    const requiredUpgradeHeader =
      preserveUpgrade && (normalized === "connection" || normalized === "upgrade");
    if (
      value === undefined ||
      (!requiredUpgradeHeader &&
        (HOP_BY_HOP_HEADERS.has(normalized) || connectionHeaders.has(normalized)))
    ) {
      continue;
    }
    forwarded[name] = value;
  }
  return forwarded;
}

function stableProxyError(): Error {
  return new Error("Runtime sidecar transport failed.");
}

function sendUnavailable(response: ServerResponse): void {
  if (response.headersSent || response.destroyed) {
    response.destroy();
    return;
  }
  response.statusCode = 503;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", "20");
  response.end("Runtime unavailable.");
}

function sendBadGateway(response: ServerResponse): void {
  if (response.headersSent || response.destroyed) {
    response.destroy(stableProxyError());
    return;
  }
  response.statusCode = 502;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", "13");
  response.end("Bad Gateway.\n");
}

function requestOptions(
  request: IncomingMessage,
  runtimeOrigin: URL,
  accessToken: string,
  publicOrigin: string,
  upgrade: boolean,
): RequestOptions {
  return {
    protocol: runtimeOrigin.protocol,
    hostname: runtimeOrigin.hostname,
    port: runtimeOrigin.port,
    method: request.method,
    path: request.url ?? "/",
    headers: forwardedRequestHeaders(
      request.headers,
      { runtimeHost: runtimeOrigin.host, accessToken, publicOrigin },
      upgrade,
    ),
  };
}

function writeUpgradeResponse(socket: Duplex, response: IncomingMessage): void {
  const statusCode = response.statusCode ?? 502;
  const statusMessage = response.statusMessage || "Bad Gateway";
  const headers = responseHeaders(response.headers, true);
  const lines = [`HTTP/${response.httpVersion} ${statusCode} ${statusMessage}`];
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) lines.push(`${name}: ${item}`);
    } else if (value !== undefined) {
      lines.push(`${name}: ${value}`);
    }
  }
  socket.write(`${lines.join("\r\n")}\r\n\r\n`);
}

/**
 * A transport-only reverse proxy for an already-admitted Runtime API sidecar.
 * It owns neither the public request trust decision nor any Runtime business
 * graph; callers must admit public traffic before invoking either handler.
 */
export function createRuntimeSidecarProxy(
  options: RuntimeSidecarProxyOptions,
): RuntimeSidecarProxy {
  const runtimeOrigin = canonicalOrigin(options.runtimeOrigin, "origin", ["http:"]);
  if (runtimeOrigin.hostname !== "127.0.0.1") {
    throw new Error("Invalid Runtime sidecar origin.");
  }
  const publicOrigin = canonicalOrigin(options.publicOrigin, "public origin", [
    "http:",
    "https:",
  ]).origin;
  if (!safeCredential(options.accessToken)) throw new Error("Invalid Runtime sidecar credential.");
  const createRequest = options.createRequest ?? createClientRequest;
  const activeRequests = new Set<ClientRequest>();
  const activeSockets = new Set<Duplex>();
  const intentionallyAbortedRequests = new WeakSet<ClientRequest>();
  let accepting = true;

  const reportFailure = () => options.onUnexpectedError?.(stableProxyError());
  const abortRequest = (upstream: ClientRequest) => {
    intentionallyAbortedRequests.add(upstream);
    if (!upstream.destroyed) upstream.destroy(stableProxyError());
  };
  const stopAdmission = () => {
    if (!accepting) return;
    accepting = false;
    for (const upstream of activeRequests) abortRequest(upstream);
    for (const socket of activeSockets) socket.destroy();
  };

  const handleHttp: WorkbenchRequestHandler = (request, response) => {
    if (!accepting) {
      sendUnavailable(response);
      return;
    }
    let upstream: ClientRequest;
    try {
      upstream = createRequest(
        requestOptions(request, runtimeOrigin, options.accessToken, publicOrigin, false),
        (upstreamResponse) => {
          const headers = responseHeaders(upstreamResponse.headers, false);
          if (upstreamResponse.statusMessage) {
            response.writeHead(
              upstreamResponse.statusCode ?? 502,
              upstreamResponse.statusMessage,
              headers,
            );
          } else {
            response.writeHead(upstreamResponse.statusCode ?? 502, headers);
          }
          upstreamResponse.pipe(response);
          upstreamResponse.once("end", () => activeRequests.delete(upstream));
          upstreamResponse.once("error", () => {
            activeRequests.delete(upstream);
            reportFailure();
            response.destroy(stableProxyError());
          });
        },
      );
    } catch {
      reportFailure();
      sendBadGateway(response);
      return;
    }
    activeRequests.add(upstream);
    const abort = () => abortRequest(upstream);
    request.once("aborted", abort);
    request.once("error", abort);
    response.once("close", () => {
      if (!response.writableEnded) abort();
    });
    upstream.once("error", () => {
      activeRequests.delete(upstream);
      if (intentionallyAbortedRequests.has(upstream)) return;
      reportFailure();
      sendBadGateway(response);
    });
    upstream.once("close", () => activeRequests.delete(upstream));
    request.pipe(upstream);
  };

  const handleUpgrade: WorkbenchWebSocketGateway["handleUpgrade"] = (request, socket, head) => {
    if (!accepting) {
      socket.destroy();
      return true;
    }
    let upstream: ClientRequest;
    try {
      upstream = createRequest(
        requestOptions(request, runtimeOrigin, options.accessToken, publicOrigin, true),
      );
    } catch {
      reportFailure();
      socket.destroy();
      return true;
    }
    activeRequests.add(upstream);
    activeSockets.add(socket);
    const cleanup = () => {
      activeRequests.delete(upstream);
      activeSockets.delete(socket);
    };
    const fail = () => {
      cleanup();
      if (intentionallyAbortedRequests.has(upstream)) return;
      reportFailure();
      socket.destroy();
      abortRequest(upstream);
    };
    upstream.once("error", fail);
    upstream.once("response", (upstreamResponse) => {
      upstream.off("error", fail);
      cleanup();
      activeSockets.add(socket);
      socket.once("close", () => activeSockets.delete(socket));
      writeUpgradeResponse(socket, upstreamResponse);
      upstreamResponse.pipe(socket);
      upstreamResponse.once("error", () => socket.destroy());
    });
    upstream.once("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
      upstream.off("error", fail);
      cleanup();
      activeSockets.add(upstreamSocket);
      const close = () => {
        activeSockets.delete(socket);
        activeSockets.delete(upstreamSocket);
      };
      socket.once("close", close);
      upstreamSocket.once("close", close);
      socket.once("error", () => upstreamSocket.destroy());
      upstreamSocket.once("error", () => socket.destroy());
      writeUpgradeResponse(socket, upstreamResponse);
      if (head.length > 0) upstreamSocket.write(head);
      if (upstreamHead.length > 0) socket.write(upstreamHead);
      socket.pipe(upstreamSocket).pipe(socket);
    });
    upstream.end();
    return true;
  };

  return Object.freeze({
    handleHttp,
    handleUpgrade,
    stopAdmission,
    get accepting() {
      return accepting;
    },
  });
}
