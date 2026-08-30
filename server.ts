import { createServer } from "node:http";

import next from "next";
import { WebSocketServer } from "ws";
import { STREAM_PATHS } from "@workbench/agent-runtime-pi-protocol/stream";

import { createNoServerWebSocketGateway } from "@workbench/agent-runtime-pi-server/websocket";
import {
  createWorkbenchHttpServer,
  type WorkbenchRequestHandler,
  type WorkbenchWebSocketGateway,
} from "./runtime/server/http/workbench-http-server";
import {
  configuredApiTrustedHosts,
  inspectApiRequestTrust,
} from "@workbench/server-core/request-trust";
import { migrateLegacyWorkbenchMessageTerminationExtension } from "@workbench/agent-runtime-pi-server/legacy";
import { TERMINAL_WEBSOCKET_PATH } from "./runtime/terminal/contracts";
import {
  createTerminalGateway,
  type TerminalSessionManagerLike,
} from "./runtime/terminal/server/terminal-gateway";
import { TerminalSessionManager } from "./runtime/terminal/server/terminal-session-manager";
import { getToolTerminalSessionManager } from "./runtime/terminal/server/tool-terminal-session-manager";
import { createWorkbenchServerShutdown } from "./runtime/server/workbench-server-shutdown";

const WORKBENCH_SHUTDOWN_MESSAGE_TYPE = "workbench:shutdown";
const WORKBENCH_READY_MESSAGE_TYPE = "workbench:ready";
const WORKBENCH_READY_MESSAGE_VERSION = 1;

function configuredPort(): number {
  const raw = process.env.PORT?.trim() || "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError(
      `PORT must be an integer from 0 to 65535; received ${JSON.stringify(raw)}.`,
    );
  }
  return port;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function callWarmupRpcViaRoute(
  requestHandler: WorkbenchRequestHandler,
  method: "packageCatalog.search" | "session.list",
  signal?: AbortSignal,
): Promise<void> {
  // Warming through Next's bundled route shares the same ESM module graph that serves later
  // requests. Local session metadata calls this before the public listener; the optional external
  // catalog calls it only after the listener reports ready.
  const warmupServer = createServer(requestHandler);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    warmupServer.once("error", onError);
    warmupServer.listen(0, "127.0.0.1", () => {
      warmupServer.off("error", onError);
      resolve();
    });
  });

  try {
    const address = warmupServer.address();
    if (!address || typeof address === "string") {
      throw new Error("RPC warmup server did not bind a TCP port.");
    }
    const rpcId = `startup-${method}-warmup`;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId,
        method,
        payload: {},
      }),
      signal,
    });
    const body: unknown = await response.json();
    if (
      !response.ok ||
      !isRecord(body) ||
      body.type !== "server-response" ||
      body.rpcId !== rpcId ||
      !isRecord(body.result) ||
      body.result.ok !== true
    ) {
      throw new Error(`${method} warmup failed with HTTP ${response.status}.`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      warmupServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function main(): Promise<void> {
  const dev = process.argv.includes("--dev") || process.env.NODE_ENV === "development";
  const hostname = process.env.WORKBENCH_HOST?.trim() || "127.0.0.1";
  const port = configuredPort();

  try {
    const migration = await migrateLegacyWorkbenchMessageTerminationExtension();
    if (migration.status === "preserved") {
      console.warn(`Workbench preserved the user-modified Pi extension at ${migration.path}.`);
    }
  } catch (error) {
    console.warn("Workbench could not migrate the legacy Pi message-termination extension.", error);
  }

  // Next installs its own upgrade listener here. This relay never listens on a
  // network interface; the public server below remains the single dispatcher.
  const nextUpgradeRelay = createServer();
  const app = next({
    dev,
    hostname,
    port,
    httpServer: nextUpgradeRelay,
    turbopack: dev,
  });
  const requestHandler = app.getRequestHandler();
  await app.prepare();
  await callWarmupRpcViaRoute(requestHandler, "session.list");

  const piWebSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  });
  const piWebSocketGateway = createNoServerWebSocketGateway({
    webSocketServer: piWebSocketServer,
  });
  const terminalWebSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  });
  const terminalSessions = new TerminalSessionManager();
  const toolTerminalSessions = getToolTerminalSessionManager();
  const gatewayTerminalSessions: TerminalSessionManagerLike = {
    attach: (options) =>
      options.toolCallId
        ? toolTerminalSessions.attach({
            sessionId: options.sessionId,
            toolCallId: options.toolCallId,
            ...(options.cols === undefined ? {} : { cols: options.cols }),
            ...(options.rows === undefined ? {} : { rows: options.rows }),
          })
        : terminalSessions.attach(options),
  };
  const terminalGateway = createTerminalGateway({
    webSocketServer: terminalWebSocketServer,
    sessions: gatewayTerminalSessions,
    trustedHosts: configuredApiTrustedHosts(),
    inspectTrust: inspectApiRequestTrust,
    onUnexpectedError: (error) => console.error("Workbench terminal failed.", error),
  });
  const webSocketGatewayForPi = piWebSocketGateway.handleUpgrade.bind(piWebSocketGateway);
  const webSocketGateway = {
    handleUpgrade(request, socket, head) {
      return (
        terminalGateway.handleUpgrade(request, socket, head) ||
        webSocketGatewayForPi(request, socket, head)
      );
    },
  } satisfies WorkbenchWebSocketGateway;
  const publicServer = createWorkbenchHttpServer({
    requestHandler,
    webSocketGateway,
    nextUpgradeRelay,
    upgradeRequiredPaths: [STREAM_PATHS.mux, STREAM_PATHS.host, TERMINAL_WEBSOCKET_PATH],
    onRequestError: (error) => console.error("Workbench request failed.", error),
    onUpgradeRelayMissing: (request) =>
      console.error(`No Next.js upgrade handler accepted ${request.url ?? "the request"}.`),
  });
  const packageCatalogWarmupController = new AbortController();
  let runtimeDisposed = false;
  const disposeRuntime = () => {
    if (runtimeDisposed) return;
    runtimeDisposed = true;
    packageCatalogWarmupController.abort();
    terminalSessions.dispose();
    toolTerminalSessions.dispose();
  };
  publicServer.on("close", disposeRuntime);

  const shutdown = createWorkbenchServerShutdown({
    httpServer: publicServer,
    webSocketServers: [piWebSocketServer, terminalWebSocketServer],
    disposeRuntime,
    closeApplication: () => app.close(),
  });
  const requestShutdown = (source: "ipc" | NodeJS.Signals) => {
    void shutdown()
      .then((result) => {
        if (result.forced)
          console.warn(`[workbench] Forced remaining connections closed (${source}).`);
        for (const error of result.errors)
          console.error("[workbench] Shutdown cleanup failed.", error);
      })
      .catch((error: unknown) => {
        console.error("[workbench] Graceful shutdown failed.", error);
      })
      .finally(() => process.exit(0));
  };
  process.once("SIGINT", () => requestShutdown("SIGINT"));
  process.once("SIGTERM", () => requestShutdown("SIGTERM"));
  process.on("message", (message: unknown) => {
    if (isRecord(message) && message.type === WORKBENCH_SHUTDOWN_MESSAGE_TYPE) {
      requestShutdown("ipc");
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    publicServer.once("error", onError);
    publicServer.listen(port, hostname, () => {
      publicServer.off("error", onError);
      resolve();
    });
  });
  const address = publicServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Workbench public server did not bind a TCP port.");
  }
  const readyUrl = `http://${hostname}:${address.port}`;
  console.log(`> Workbench ready at ${readyUrl}`);
  process.send?.({
    type: WORKBENCH_READY_MESSAGE_TYPE,
    version: WORKBENCH_READY_MESSAGE_VERSION,
    host: hostname,
    port: address.port,
    pid: process.pid,
  });
  void callWarmupRpcViaRoute(
    requestHandler,
    "packageCatalog.search",
    packageCatalogWarmupController.signal,
  ).catch(() => {
    if (packageCatalogWarmupController.signal.aborted) return;
    console.warn("[workbench-pi] Pi package catalog warmup deferred; it will retry automatically.");
  });
}

void main().catch((error: unknown) => {
  console.error("Failed to start Workbench.", error);
  process.exitCode = 1;
});
