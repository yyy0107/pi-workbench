import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import next from "next";

import type {
  NonRuntimeUpgradeRelay,
  WorkbenchRequestHandler,
} from "@workbench/host-server/workbench-http-server";

export interface NextWebHandlerOptions {
  readonly dev: boolean;
  readonly hostname: string;
  readonly port: number;
  readonly webRoot: string;
}

export interface NextWebHandler {
  readonly requestHandler: WorkbenchRequestHandler;
  readonly upgradeRelay: NonRuntimeUpgradeRelay;
  close(): Promise<void>;
}

interface NextCustomApplication {
  getRequestHandler(): (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  prepare(): Promise<void>;
  close(): Promise<void>;
}

interface NextCustomApplicationFactoryOptions {
  readonly dev: boolean;
  readonly dir: string;
  readonly hostname: string;
  readonly httpServer: Server;
  readonly port: number;
  readonly turbopack: boolean;
}

type NextCustomApplicationFactory = (
  options: NextCustomApplicationFactoryOptions,
) => NextCustomApplication;

const createDefaultNextApplication: NextCustomApplicationFactory = (options) => next(options);

/** Prepares only the Web application; Runtime HTTP, WebSocket, and lifecycle stay outside Next. */
export async function createNextWebHandler(
  { dev, hostname, port, webRoot }: NextWebHandlerOptions,
  createApplication: NextCustomApplicationFactory = createDefaultNextApplication,
): Promise<NextWebHandler> {
  // NextCustomServer lazily installs its own listener on the first ordinary request. Give that
  // listener an inert carrier so it can never bypass the combined Host's upgrade dispatcher.
  const nextUpgradeCarrier = createServer();
  const app = createApplication({
    dev,
    dir: webRoot,
    hostname,
    port,
    httpServer: nextUpgradeCarrier,
    turbopack: dev,
  });
  const requestHandler = app.getRequestHandler();
  try {
    await app.prepare();
  } catch (prepareError) {
    nextUpgradeCarrier.removeAllListeners("upgrade");
    try {
      await app.close();
    } catch (closeError) {
      throw new AggregateError(
        [prepareError, closeError],
        "Next.js preparation and cleanup both failed.",
      );
    }
    throw prepareError;
  }

  let closed = false;
  let closeOperation: Promise<void> | undefined;
  const upgradeRelay: NonRuntimeUpgradeRelay = Object.freeze({
    emit(_event: "upgrade", request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
      if (closed) return false;
      return nextUpgradeCarrier.emit("upgrade", request, socket, head);
    },
  });

  return Object.freeze({
    requestHandler,
    upgradeRelay,
    close(): Promise<void> {
      if (closeOperation) return closeOperation;
      closed = true;
      nextUpgradeCarrier.removeAllListeners("upgrade");
      closeOperation = (async () => {
        try {
          await app.close();
        } finally {
          // A request already admitted while close began may have installed the lazy listener.
          nextUpgradeCarrier.removeAllListeners("upgrade");
        }
      })();
      return closeOperation;
    },
  });
}
