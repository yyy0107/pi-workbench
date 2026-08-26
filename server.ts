import { createServer } from "node:http";

import next from "next";
import { WebSocketServer } from "ws";

import { createNoServerWebSocketGateway } from "./runtime/pi/server/streams/websocket-gateway";
import {
  createWorkbenchHttpServer,
  type WorkbenchRequestHandler,
  type WorkbenchWebSocketGateway,
} from "./runtime/pi/server/transport/custom-server";
import { migrateLegacyWorkbenchMessageTerminationExtension } from "./runtime/pi/server/internal-extensions/legacy-message-termination";
import {
  createTerminalGateway,
  type TerminalSessionManagerLike,
} from "./runtime/terminal/server/terminal-gateway";
import { TerminalSessionManager } from "./runtime/terminal/server/terminal-session-manager";
import { getToolTerminalSessionManager } from "./runtime/terminal/server/tool-terminal-session-manager";

function configuredPort(): number {
  const raw = process.env.PORT?.trim() || "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError(
      `PORT must be an integer from 1 to 65535; received ${JSON.stringify(raw)}.`,
    );
  }
  return port;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function warmServerStateViaRoute(requestHandler: WorkbenchRequestHandler): Promise<void> {
  // The Pi registry is ESM-only while this launcher enters through tsx's CommonJS path.
  // Warming through Next's bundled route keeps that boundary intact, compiles the RPC before the
  // public listener starts accepting requests, and starts the package-catalog cache in the same
  // module graph that will serve later requests.
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
      throw new Error("Session metadata warmup server did not bind a TCP port.");
    }
    const warmRpc = async (method: string): Promise<void> => {
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
    };

    await warmRpc("session.list");
    try {
      await warmRpc("packageCatalog.search");
    } catch (error) {
      console.warn("Workbench could not warm the Pi package catalog cache.", error);
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
  await warmServerStateViaRoute(requestHandler);

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
    onRequestError: (error) => console.error("Workbench request failed.", error),
    onUpgradeRelayMissing: (request) =>
      console.error(`No Next.js upgrade handler accepted ${request.url ?? "the request"}.`),
  });
  publicServer.on("close", () => {
    terminalSessions.dispose();
    toolTerminalSessions.dispose();
  });

  publicServer.listen(port, hostname, () => {
    console.log(`> Workbench ready at http://${hostname}:${port}`);
  });
}

void main().catch((error: unknown) => {
  console.error("Failed to start Workbench.", error);
  process.exitCode = 1;
});
