import { createServer } from "node:http";

import next from "next";
import { WebSocketServer } from "ws";

import { createNoServerWebSocketGateway } from "./runtime/pi/server/streams/websocket-gateway";
import { createWorkbenchHttpServer } from "./runtime/pi/server/transport/custom-server";

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

async function main(): Promise<void> {
  const dev = process.argv.includes("--dev") || process.env.NODE_ENV === "development";
  const hostname = process.env.WORKBENCH_HOST?.trim() || "127.0.0.1";
  const port = configuredPort();

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

  const webSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  });
  const webSocketGateway = createNoServerWebSocketGateway({ webSocketServer });
  const publicServer = createWorkbenchHttpServer({
    requestHandler,
    webSocketGateway,
    nextUpgradeRelay,
    onRequestError: (error) => console.error("Workbench request failed.", error),
    onUpgradeRelayMissing: (request) =>
      console.error(`No Next.js upgrade handler accepted ${request.url ?? "the request"}.`),
  });

  publicServer.listen(port, hostname, () => {
    console.log(`> Workbench ready at http://${hostname}:${port}`);
  });
}

void main().catch((error: unknown) => {
  console.error("Failed to start Workbench.", error);
  process.exitCode = 1;
});
