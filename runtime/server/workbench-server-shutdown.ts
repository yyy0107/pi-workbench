import type { Server } from "node:http";

import type { WebSocket, WebSocketServer } from "ws";

import { runWorkbenchShutdownHooks } from "./shutdown-hooks";

const DEFAULT_GRACE_PERIOD_MS = 4_000;
const DEFAULT_FORCE_PERIOD_MS = 250;

export interface WorkbenchServerShutdownResult {
  forced: boolean;
  errors: readonly unknown[];
}

export interface WorkbenchServerShutdownOptions {
  httpServer: Pick<Server, "close"> &
    Partial<Pick<Server, "closeAllConnections" | "closeIdleConnections">>;
  webSocketServers: readonly Pick<WebSocketServer, "clients" | "close">[];
  disposeRuntime(): void;
  closeApplication(): void | Promise<void>;
  runShutdownHooks?: () => Promise<unknown[]>;
  gracePeriodMs?: number;
  forcePeriodMs?: number;
}

type ShutdownTaskResult = { errors: unknown[] };

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function closeHttpServer(server: WorkbenchServerShutdownOptions["httpServer"]): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (!error || errorCode(error) === "ERR_SERVER_NOT_RUNNING") resolve();
      else reject(error);
    });
    server.closeIdleConnections?.();
  });
}

function closeWebSocketServer(
  server: WorkbenchServerShutdownOptions["webSocketServers"][number],
): Promise<void> {
  for (const socket of server.clients) {
    try {
      socket.close(1001, "Workbench is shutting down");
    } catch {
      // Forced cleanup below remains authoritative.
    }
  }
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function forceCloseWebSockets(servers: WorkbenchServerShutdownOptions["webSocketServers"]): void {
  for (const server of servers) {
    for (const socket of server.clients as Set<WebSocket>) {
      try {
        socket.terminate();
      } catch {
        // The socket may already have completed its close handshake.
      }
    }
  }
}

function settledErrors(results: readonly PromiseSettledResult<unknown>[]): unknown[] {
  return results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
}

async function performShutdown(
  options: WorkbenchServerShutdownOptions,
): Promise<WorkbenchServerShutdownResult> {
  const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
  const forcePeriodMs = options.forcePeriodMs ?? DEFAULT_FORCE_PERIOD_MS;
  if (!Number.isFinite(gracePeriodMs) || gracePeriodMs < 0) {
    throw new RangeError("gracePeriodMs must be a non-negative finite number.");
  }
  if (!Number.isFinite(forcePeriodMs) || forcePeriodMs < 0) {
    throw new RangeError("forcePeriodMs must be a non-negative finite number.");
  }

  const immediateErrors: unknown[] = [];
  try {
    options.disposeRuntime();
  } catch (error) {
    immediateErrors.push(error);
  }

  const tasks: Promise<unknown>[] = [
    closeHttpServer(options.httpServer),
    ...options.webSocketServers.map(closeWebSocketServer),
    Promise.resolve().then(options.closeApplication),
    (options.runShutdownHooks ?? runWorkbenchShutdownHooks)().then((errors) => {
      immediateErrors.push(...errors);
    }),
  ];
  const settled = Promise.allSettled(tasks).then<ShutdownTaskResult>((results) => ({
    errors: settledErrors(results),
  }));
  const graceful = await Promise.race([
    settled.then((result) => ({ completed: true as const, result })),
    delay(gracePeriodMs).then(() => ({ completed: false as const })),
  ]);

  if (graceful.completed) {
    return { forced: false, errors: [...immediateErrors, ...graceful.result.errors] };
  }

  forceCloseWebSockets(options.webSocketServers);
  options.httpServer.closeAllConnections?.();
  const forced = await Promise.race([
    settled.then((result) => result),
    delay(forcePeriodMs).then<ShutdownTaskResult>(() => ({ errors: [] })),
  ]);
  return { forced: true, errors: [...immediateErrors, ...forced.errors] };
}

/** Create an idempotent shutdown operation for a single Workbench server. */
export function createWorkbenchServerShutdown(
  options: WorkbenchServerShutdownOptions,
): () => Promise<WorkbenchServerShutdownResult> {
  let shutdown: Promise<WorkbenchServerShutdownResult> | undefined;
  return () => (shutdown ??= performShutdown(options));
}
