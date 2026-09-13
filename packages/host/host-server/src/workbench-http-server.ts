import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import {
  configuredApiTrustedHosts,
  inspectApiRequestTrust,
} from "@workbench/server-core/request-trust";

import {
  applyDesktopRuntimeCorsHeaders,
  applyDesktopRuntimeWebSocketUpgradeAuthorization,
  authorizeDesktopRuntimeHttpRequest,
  authorizeDesktopRuntimeWebSocketUpgrade,
  canonicalizeAuthorizedDesktopRuntimeRequest,
  sendDesktopRuntimeAuthorizationFailure,
  sendDesktopRuntimePreflight,
  type DesktopSidecarRuntimeAuthPolicy,
} from "@workbench/host-server/runtime-transport-auth";

const UPGRADE_REQUIRED_BODY = "Upgrade Required";

export type WorkbenchRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

export interface WorkbenchWebSocketGateway {
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean;
}

/**
 * Application-provided handler for upgrades outside Runtime-owned paths.
 * A combined web/Runtime launcher currently uses this for its web relay;
 * API-only Runtime Hosts can omit it.
 */
export interface NonRuntimeUpgradeRelay {
  emit(event: "upgrade", request: IncomingMessage, socket: Duplex, head: Buffer): boolean;
}

export interface WorkbenchHttpServerOptions {
  requestHandler: WorkbenchRequestHandler;
  webSocketGateway: WorkbenchWebSocketGateway;
  nonRuntimeUpgradeRelay?: NonRuntimeUpgradeRelay;
  upgradeRequiredPaths: readonly string[];
  desktopSidecarAuth?: DesktopSidecarRuntimeAuthPolicy;
  onRequestError?: (error: unknown) => void;
  onUpgradeRelayMissing?: (request: IncomingMessage) => void;
}

function requestPathname(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return undefined;
  }
}

export function isUpgradeRequiredHttpRequest(
  request: Pick<IncomingMessage, "method" | "url">,
  upgradeRequiredPaths: ReadonlySet<string>,
): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const pathname = requestPathname(request.url);
  return pathname !== undefined && upgradeRequiredPaths.has(pathname);
}

export function isApiHttpRequest(request: Pick<IncomingMessage, "url">): boolean {
  const target = request.url;
  // The public listener is not a forward proxy. Treat missing/absolute/network-path request targets
  // as Runtime-owned so ambiguous syntax can never be normalized by Next ahead of the API fence.
  if (!target || !target.startsWith("/")) return true;
  const delimiter = target.search(/[?#]/u);
  let candidate = delimiter < 0 ? target : target.slice(0, delimiter);
  if (candidate.startsWith("//")) return true;

  // Next and WHATWG route matching normalize dot segments, slash-like backslashes, and decoded
  // path segments at different layers. Iterate to a fixed input-derived bound so nested encodings
  // such as `%2561pi` and `%252e` cannot escape the Host authentication/trust boundary.
  for (let iteration = 0; iteration <= candidate.length; iteration += 1) {
    if (candidate.includes("\0") || candidate.includes("?") || candidate.includes("#")) return true;
    const separated = candidate.replaceAll("\\", "/").replace(/\/{2,}/gu, "/");
    try {
      candidate = new URL(separated, "http://localhost").pathname;
    } catch {
      return true;
    }
    if (candidate === "/api" || candidate.startsWith("/api/")) return true;
    if (!candidate.includes("%")) return false;
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) return false;
      candidate = decoded;
    } catch {
      return true;
    }
  }
  return true;
}

export function sendUpgradeRequired(
  request: Pick<IncomingMessage, "method">,
  response: ServerResponse,
): void {
  response.statusCode = 426;
  response.statusMessage = UPGRADE_REQUIRED_BODY;
  response.setHeader("Connection", "Upgrade");
  response.setHeader("Upgrade", "websocket");
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(UPGRADE_REQUIRED_BODY));
  response.end(request.method === "HEAD" ? undefined : UPGRADE_REQUIRED_BODY);
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.append(name, value);
    }
  }
  return headers;
}

function hasTrustedRequestAuthority(
  request: IncomingMessage,
  trustedHosts: readonly string[],
): boolean {
  const headers = requestHeaders(request);
  headers.delete("origin");
  headers.delete("sec-fetch-site");
  return inspectApiRequestTrust({ headers }, { trustedHosts }).trusted;
}

function sendForbidden(response: ServerResponse): void {
  const body = "Forbidden";
  response.statusCode = 403;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

export function createUpgradeDispatcher(
  options: Pick<
    WorkbenchHttpServerOptions,
    "webSocketGateway" | "nonRuntimeUpgradeRelay" | "onUpgradeRelayMissing"
  > &
    Partial<Pick<WorkbenchHttpServerOptions, "desktopSidecarAuth" | "upgradeRequiredPaths">>,
): (request: IncomingMessage, socket: Duplex, head: Buffer) => void {
  const runtimeUpgradePaths = new Set(options.upgradeRequiredPaths ?? []);
  const trustedHosts = configuredApiTrustedHosts();
  return (request, socket, head) => {
    const pathname = requestPathname(request.url);
    const exactRuntimeUpgrade = pathname !== undefined && runtimeUpgradePaths.has(pathname);
    const runtimeOwned = exactRuntimeUpgrade || isApiHttpRequest(request);
    if (runtimeOwned) {
      if (!options.desktopSidecarAuth) {
        // Public same-origin mode has no Bearer at this boundary. Apply the
        // complete Host/Origin/Sec-Fetch-Site fence before a proxy can inject
        // sidecar credentials on its private inner hop.
        if (
          !inspectApiRequestTrust({ headers: requestHeaders(request) }, { trustedHosts }).trusted
        ) {
          const body = "Forbidden";
          try {
            socket.write(
              `HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
            );
          } finally {
            socket.destroy();
          }
          return;
        }
      } else {
        // The child sidecar has a second, explicit allowed-origin policy.
        // This authority-only probe intentionally removes Origin/fetch-site;
        // `authorizeDesktopRuntimeWebSocketUpgrade` below validates them.
        if (!hasTrustedRequestAuthority(request, trustedHosts)) {
          const body = "Forbidden";
          try {
            socket.write(
              `HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
            );
          } finally {
            socket.destroy();
          }
          return;
        }
        const admission = authorizeDesktopRuntimeWebSocketUpgrade(
          request,
          options.desktopSidecarAuth,
        );
        if (admission.kind === "rejected") {
          const body = "Forbidden";
          try {
            socket.write(
              `HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
            );
          } finally {
            socket.destroy();
          }
          return;
        }
        if (
          admission.kind === "preauthorized" &&
          !applyDesktopRuntimeWebSocketUpgradeAuthorization(request, admission.authorization)
        ) {
          socket.destroy();
          return;
        }
        canonicalizeAuthorizedDesktopRuntimeRequest(request);
      }
      if (exactRuntimeUpgrade && options.webSocketGateway.handleUpgrade(request, socket, head)) {
        return;
      }

      options.onUpgradeRelayMissing?.(request);
      socket.destroy();
      return;
    }

    const relayed = options.nonRuntimeUpgradeRelay?.emit("upgrade", request, socket, head) ?? false;
    if (!relayed) {
      options.onUpgradeRelayMissing?.(request);
      socket.destroy();
    }
  };
}

export function createWorkbenchHttpServer(options: WorkbenchHttpServerOptions): Server {
  const trustedHosts = configuredApiTrustedHosts();
  const upgradeRequiredPaths = new Set(options.upgradeRequiredPaths);
  const server = createServer((request, response) => {
    if (isApiHttpRequest(request)) {
      if (options.desktopSidecarAuth) {
        if (!hasTrustedRequestAuthority(request, trustedHosts)) {
          sendForbidden(response);
          return;
        }
        const authorization = authorizeDesktopRuntimeHttpRequest(
          request,
          options.desktopSidecarAuth,
        );
        if (authorization.kind === "rejected") {
          if (authorization.origin) {
            applyDesktopRuntimeCorsHeaders(response, authorization.origin);
          }
          sendDesktopRuntimeAuthorizationFailure(response, authorization.status);
          return;
        }
        if (authorization.kind === "preflight") {
          sendDesktopRuntimePreflight(response, authorization.origin);
          return;
        }
        if (authorization.origin) applyDesktopRuntimeCorsHeaders(response, authorization.origin);
        canonicalizeAuthorizedDesktopRuntimeRequest(request);
      } else if (
        !inspectApiRequestTrust({ headers: requestHeaders(request) }, { trustedHosts }).trusted
      ) {
        sendForbidden(response);
        return;
      }
    }
    if (isUpgradeRequiredHttpRequest(request, upgradeRequiredPaths)) {
      sendUpgradeRequired(request, response);
      return;
    }

    void Promise.resolve(options.requestHandler(request, response)).catch((error: unknown) => {
      options.onRequestError?.(error);
      if (!response.headersSent) {
        response.statusCode = 500;
        response.end("Internal Server Error");
      } else {
        response.destroy(error instanceof Error ? error : new Error("Request handler failed."));
      }
    });
  });

  server.on("upgrade", createUpgradeDispatcher(options));
  return server;
}
