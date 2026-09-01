import type { Server } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";

import {
  createRuntimeSidecarProxy,
  type RuntimeSidecarProxy,
} from "@workbench/host-server/runtime-sidecar-proxy";
import {
  createWorkbenchHttpServer,
  isApiHttpRequest,
  type NonRuntimeUpgradeRelay,
  type WorkbenchHttpServerOptions,
  type WorkbenchRequestHandler,
  type WorkbenchWebSocketGateway,
} from "@workbench/host-server/workbench-http-server";
import {
  WEB_HOST_CONTROL_MAX_SHUTDOWN_DEADLINE_MS,
  WebHostShutdownReason,
  type WebHostShutdownReason as WebHostShutdownReasonValue,
} from "@workbench/host-contracts/web-host-control";
import {
  parseRuntimeConnection,
  type DesktopSidecarRuntimeConnection,
} from "@workbench/host-contracts/runtime-connection";

import { createNextWebHandler, type NextWebHandler } from "./next-web-handler";

export const WEB_APPLICATION_HOST = "127.0.0.1" as const;
const STARTUP_CLEANUP_DEADLINE_MS = 5_000;

export interface WebApplicationHostShutdownOptions {
  readonly deadlineMs: number;
  readonly reason: WebHostShutdownReasonValue;
}

export interface WebApplicationRuntimeProxyOptions {
  readonly connection: DesktopSidecarRuntimeConnection;
  readonly publicOrigin: string;
  readonly upgradeRequiredPaths: readonly string[];
}

export interface StartWebApplicationHostOptions {
  readonly dev: boolean;
  readonly hostname: typeof WEB_APPLICATION_HOST;
  readonly port: number;
  readonly runtime?: WebApplicationRuntimeProxyOptions;
  readonly startupSignal?: AbortSignal;
  readonly webRoot: string;
}

export interface RunningWebApplicationHost {
  readonly host: typeof WEB_APPLICATION_HOST;
  readonly port: number;
  readonly httpOrigin: string;
  shutdown(options: WebApplicationHostShutdownOptions): Promise<void>;
}

export interface WebApplicationHostDependencies {
  readonly createNext?: (options: {
    readonly dev: boolean;
    readonly hostname: typeof WEB_APPLICATION_HOST;
    readonly port: number;
    readonly webRoot: string;
  }) => Promise<NextWebHandler>;
  readonly createProxy?: typeof createRuntimeSidecarProxy;
  readonly createPublicServer?: (options: WorkbenchHttpServerOptions) => Server;
}

export function isWebApplicationPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 65_535;
}

function isDeadline(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= WEB_HOST_CONTROL_MAX_SHUTDOWN_DEADLINE_MS
  );
}

function isShutdownReason(value: unknown): value is WebHostShutdownReasonValue {
  return Object.values(WebHostShutdownReason).includes(value as WebHostShutdownReasonValue);
}

function isCanonicalPublicOrigin(value: string, port: number): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "http:" &&
      parsed.hostname === WEB_APPLICATION_HOST &&
      Number(parsed.port) === port &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}

function serviceUnavailable(
  request: Parameters<WorkbenchRequestHandler>[0],
  response: Parameters<WorkbenchRequestHandler>[1],
): void {
  const body = "Runtime unavailable.";
  response.statusCode = 503;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", String(Buffer.byteLength(body)));
  response.end(request.method === "HEAD" ? undefined : body);
}

function webUnavailable(
  request: Parameters<WorkbenchRequestHandler>[0],
  response: Parameters<WorkbenchRequestHandler>[1],
): void {
  const body = "Web Host unavailable.";
  response.statusCode = 503;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Connection", "close");
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", String(Buffer.byteLength(body)));
  response.end(request.method === "HEAD" ? undefined : body);
}

async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, WEB_APPLICATION_HOST, () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (
    !address ||
    typeof address === "string" ||
    address.address !== WEB_APPLICATION_HOST ||
    !isWebApplicationPort(address.port) ||
    address.port === 0
  ) {
    throw new Error("Web application Host did not bind the required loopback address.");
  }
  return address.port;
}

function serverErrorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

/** Stops public accepts and every HTTP/Upgrade socket before the Next application is closed. */
function closePublicServer(server: Server, sockets: ReadonlySet<Socket>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      for (const socket of sockets) socket.destroy();
      resolve();
      return;
    }
    server.close((error) => {
      if (!error || serverErrorCode(error) === "ERR_SERVER_NOT_RUNNING") resolve();
      else reject(error);
    });
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    // `closeAllConnections` intentionally does not own upgraded sockets. The connection set does.
    for (const socket of sockets) socket.destroy();
  });
}

function bounded<T>(operation: Promise<T>, deadlineMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} deadline expired.`)), deadlineMs);
      timer.unref?.();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function validatedRuntimeOptions(
  value: WebApplicationRuntimeProxyOptions | undefined,
): WebApplicationRuntimeProxyOptions | undefined {
  if (!value) return undefined;
  const connection = parseRuntimeConnection(value.connection);
  if (
    connection?.kind !== "desktop-sidecar" ||
    !Array.isArray(value.upgradeRequiredPaths) ||
    !value.upgradeRequiredPaths.every(
      (entry) => typeof entry === "string" && entry.startsWith("/api/"),
    ) ||
    new Set(value.upgradeRequiredPaths).size !== value.upgradeRequiredPaths.length
  ) {
    throw new Error("Invalid Runtime-connected Web Host options.");
  }
  return Object.freeze({
    connection,
    publicOrigin: value.publicOrigin,
    upgradeRequiredPaths: Object.freeze([...value.upgradeRequiredPaths]),
  });
}

/**
 * Owns the single public Next listener used by both the packaged Web-only child and the browser
 * Web process. When an already-admitted Runtime connection is present, this owner adds only the
 * transport proxy; it never imports, constructs, launches, or shuts down the Runtime app graph.
 */
export async function startWebApplicationHost(
  options: StartWebApplicationHostOptions,
  dependencies: WebApplicationHostDependencies = {},
): Promise<RunningWebApplicationHost> {
  if (
    typeof options.dev !== "boolean" ||
    options.hostname !== WEB_APPLICATION_HOST ||
    !isWebApplicationPort(options.port) ||
    !path.isAbsolute(options.webRoot) ||
    options.startupSignal?.aborted
  ) {
    throw new Error("Invalid Web application Host start options.");
  }
  const runtimeOptions = validatedRuntimeOptions(options.runtime);

  const createNext = dependencies.createNext ?? ((input) => createNextWebHandler(input));
  const createProxy = dependencies.createProxy ?? createRuntimeSidecarProxy;
  const createPublicServer = dependencies.createPublicServer ?? createWorkbenchHttpServer;
  const sockets = new Set<Socket>();
  let accepting = false;
  let nextWeb: NextWebHandler | undefined;
  let runtimeProxy: RuntimeSidecarProxy | undefined;
  let shutdownOperation: Promise<void> | undefined;

  const requestHandler: WorkbenchRequestHandler = (request, response) => {
    if (!accepting || !nextWeb) {
      webUnavailable(request, response);
      return;
    }
    if (isApiHttpRequest(request)) {
      if (runtimeProxy) return runtimeProxy.handleHttp(request, response);
      serviceUnavailable(request, response);
      return;
    }
    return nextWeb.requestHandler(request, response);
  };
  const webSocketGateway: WorkbenchWebSocketGateway = Object.freeze({
    handleUpgrade(
      request: Parameters<WorkbenchWebSocketGateway["handleUpgrade"]>[0],
      socket: Parameters<WorkbenchWebSocketGateway["handleUpgrade"]>[1],
      head: Parameters<WorkbenchWebSocketGateway["handleUpgrade"]>[2],
    ) {
      return accepting && runtimeProxy ? runtimeProxy.handleUpgrade(request, socket, head) : false;
    },
  });
  const nextUpgradeRelay: NonRuntimeUpgradeRelay = Object.freeze({
    emit(
      event: Parameters<NonRuntimeUpgradeRelay["emit"]>[0],
      request: Parameters<NonRuntimeUpgradeRelay["emit"]>[1],
      socket: Parameters<NonRuntimeUpgradeRelay["emit"]>[2],
      head: Parameters<NonRuntimeUpgradeRelay["emit"]>[3],
    ) {
      return accepting && nextWeb ? nextWeb.upgradeRelay.emit(event, request, socket, head) : false;
    },
  });
  const publicServer = createPublicServer({
    requestHandler,
    webSocketGateway,
    nonRuntimeUpgradeRelay: nextUpgradeRelay,
    upgradeRequiredPaths: runtimeOptions?.upgradeRequiredPaths ?? [],
    onRequestError: () => console.error("Web application Host public request failed."),
    onUpgradeRelayMissing: () => console.error("Web application Host Upgrade was not accepted."),
  });
  publicServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  const stop = (deadlineMs: number): Promise<void> => {
    if (shutdownOperation) return shutdownOperation;
    accepting = false;
    runtimeProxy?.stopAdmission();
    // `server.close` runs synchronously inside this call, before any asynchronous Next cleanup.
    const publicClose = closePublicServer(publicServer, sockets);
    shutdownOperation = bounded(
      (async () => {
        await publicClose;
        await nextWeb?.close();
      })(),
      deadlineMs,
      "Web application Host shutdown",
    );
    return shutdownOperation;
  };

  const onStartupAbort = () => {
    void stop(STARTUP_CLEANUP_DEADLINE_MS).catch(() => undefined);
  };
  options.startupSignal?.addEventListener("abort", onStartupAbort, { once: true });

  try {
    const port = await listen(publicServer, options.port);
    if (
      options.startupSignal?.aborted ||
      (runtimeOptions && !isCanonicalPublicOrigin(runtimeOptions.publicOrigin, port))
    ) {
      throw new Error("Web application Host startup configuration changed.");
    }
    const preparedNext = await createNext({
      dev: options.dev,
      hostname: options.hostname,
      port,
      webRoot: options.webRoot,
    });
    if (options.startupSignal?.aborted || shutdownOperation) {
      await bounded(
        Promise.resolve().then(() => preparedNext.close()),
        STARTUP_CLEANUP_DEADLINE_MS,
        "Web application Host late startup cleanup",
      ).catch(() => undefined);
      throw new Error("Web application Host startup was interrupted.");
    }
    nextWeb = preparedNext;
    if (runtimeOptions) {
      runtimeProxy = createProxy({
        runtimeOrigin: runtimeOptions.connection.httpOrigin,
        accessToken: runtimeOptions.connection.accessToken,
        publicOrigin: runtimeOptions.publicOrigin,
        onUnexpectedError: () => console.error("Runtime sidecar proxy failed."),
      });
    }
    accepting = true;
    return Object.freeze({
      host: WEB_APPLICATION_HOST,
      port,
      httpOrigin: `http://${WEB_APPLICATION_HOST}:${port}`,
      shutdown({ deadlineMs, reason }: WebApplicationHostShutdownOptions): Promise<void> {
        if (!isDeadline(deadlineMs) || !isShutdownReason(reason)) {
          return Promise.reject(new Error("Invalid Web application Host shutdown request."));
        }
        return stop(deadlineMs);
      },
    });
  } catch {
    await stop(STARTUP_CLEANUP_DEADLINE_MS).catch(() => undefined);
    throw new Error("Web application Host startup failed.");
  } finally {
    options.startupSignal?.removeEventListener("abort", onStartupAbort);
  }
}
