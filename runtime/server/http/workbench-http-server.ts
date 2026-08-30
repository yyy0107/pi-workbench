import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import {
  configuredApiTrustedHosts,
  inspectApiRequestTrust,
} from "@workbench/server-core/request-trust";

const UPGRADE_REQUIRED_BODY = "Upgrade Required";

export type WorkbenchRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

export interface WorkbenchWebSocketGateway {
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean;
}

export interface NextUpgradeRelay {
  emit(event: "upgrade", request: IncomingMessage, socket: Duplex, head: Buffer): boolean;
}

export interface WorkbenchHttpServerOptions {
  requestHandler: WorkbenchRequestHandler;
  webSocketGateway: WorkbenchWebSocketGateway;
  nextUpgradeRelay: NextUpgradeRelay;
  upgradeRequiredPaths: readonly string[];
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
  const pathname = requestPathname(request.url);
  return pathname === "/api" || pathname?.startsWith("/api/") === true;
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
    "webSocketGateway" | "nextUpgradeRelay" | "onUpgradeRelayMissing"
  >,
): (request: IncomingMessage, socket: Duplex, head: Buffer) => void {
  return (request, socket, head) => {
    if (options.webSocketGateway.handleUpgrade(request, socket, head)) return;

    const relayed = options.nextUpgradeRelay.emit("upgrade", request, socket, head);
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
    if (
      isApiHttpRequest(request) &&
      !inspectApiRequestTrust({ headers: requestHeaders(request) }, { trustedHosts }).trusted
    ) {
      sendForbidden(response);
      return;
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
