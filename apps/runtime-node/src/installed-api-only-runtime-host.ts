import type { WebSocketServer } from "ws";
import type { Writable } from "node:stream";
import {
  isStdoutTakenOver,
  restoreStdout,
  takeOverStdout,
} from "@workbench/agent-runtime-pi-server/installation";

import {
  API_ONLY_RUNTIME_HOST,
  API_ONLY_RUNTIME_PORT,
  RuntimeHostLifecycleReason,
  startApiOnlyRuntimeHost,
  type RunningApiOnlyRuntimeHost,
  type RuntimeHostLifecycle,
} from "@workbench/host-server/api-only-runtime-host";
import {
  RuntimeHostControlSessionResultCode,
  runRuntimeHostControlSession,
} from "@workbench/host-server/runtime-host-control-session";
import type { DesktopSidecarRuntimeAuthPolicy } from "@workbench/host-server/runtime-transport-auth";
import { migrateLegacyWorkbenchMessageTerminationExtension } from "@workbench/agent-runtime-pi-server/legacy";

import { createInstalledRuntimeService } from "./installed-runtime-service";
import { warmRuntimeRpc } from "./runtime-rpc-warmup";
import { claimRuntimeControlStdout } from "./runtime-control-stdout";

const DEFAULT_RUNTIME_HOST_SHUTDOWN_DEADLINE_MS = 5_000;

function requestPathnameForDiagnostic(url: string | undefined): string {
  if (!url) return "the request";
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return "an invalid request path";
  }
}

async function migrateLegacyExtension(): Promise<void> {
  try {
    const migration = await migrateLegacyWorkbenchMessageTerminationExtension();
    if (migration.status === "preserved") {
      console.warn(`Workbench preserved the user-modified Pi extension at ${migration.path}.`);
    }
  } catch (error) {
    console.warn("Workbench could not migrate the legacy Pi message-termination extension.", error);
  }
}

function closeWebSocketServer(
  server: WebSocketServer,
  deadlineMs: number,
  signal: AbortSignal,
): Promise<void> {
  for (const socket of server.clients) {
    try {
      socket.close(1001, "Workbench is shutting down");
    } catch {
      // The bounded forced cleanup below remains authoritative.
    }
  }

  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  const forceClose = () => {
    for (const socket of server.clients) {
      try {
        socket.terminate();
      } catch {
        // A peer may already have completed its close handshake.
      }
    }
  };
  if (deadlineMs === 0 || signal.aborted) forceClose();
  else {
    forceTimer = setTimeout(forceClose, deadlineMs);
    forceTimer.unref?.();
    signal.addEventListener("abort", forceClose, { once: true });
  }

  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (forceTimer) clearTimeout(forceTimer);
      signal.removeEventListener("abort", forceClose);
      if (error) reject(error);
      else resolve();
    });
  });
}

function aggregateErrors(message: string, results: readonly PromiseSettledResult<unknown>[]): void {
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length > 0) throw new AggregateError(errors, message);
}

export interface InstalledApiOnlyRuntimeHostOptions {
  readonly desktopSidecarAuth: DesktopSidecarRuntimeAuthPolicy;
  readonly pid?: number;
}

export async function disposeInstalledRuntimeLifecycleWithinDeadline(options: {
  readonly lifecycle: RuntimeHostLifecycle;
  readonly reason: RuntimeHostLifecycleReason;
  readonly deadlineMs: number;
}): Promise<void> {
  const controller = new AbortController();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = Promise.resolve()
    .then(() =>
      options.lifecycle.dispose({
        reason: options.reason,
        deadlineMs: options.deadlineMs,
        signal: controller.signal,
      }),
    )
    .catch(() => undefined);
  const deadline = new Promise<void>((resolve) => {
    deadlineTimer = setTimeout(() => {
      controller.abort(new Error("Runtime Host startup cleanup deadline expired."));
      resolve();
    }, options.deadlineMs);
  });
  try {
    await Promise.race([cleanup, deadline]);
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

/** Installs the same Pi/Terminal graph behind the generic authenticated API-only listener. */
export async function startInstalledApiOnlyRuntimeHost({
  desktopSidecarAuth,
  pid = process.pid,
}: InstalledApiOnlyRuntimeHostOptions): Promise<RunningApiOnlyRuntimeHost> {
  await migrateLegacyExtension();
  const runtimeService = createInstalledRuntimeService({ desktopSidecarAuth });
  const packageCatalogWarmupController = new AbortController();
  let disposePromise: Promise<void> | undefined;
  const lifecycle: RuntimeHostLifecycle = {
    dispose({ deadlineMs, signal }) {
      return (disposePromise ??= (async () => {
        packageCatalogWarmupController.abort();
        const results = await Promise.allSettled([
          ...runtimeService.webSocketServers.map((server) =>
            closeWebSocketServer(server, deadlineMs, signal),
          ),
          runtimeService.dispose(signal),
        ]);
        aggregateErrors("API-only Runtime lifecycle cleanup failed.", results);
      })());
    },
  };

  try {
    await warmRuntimeRpc(runtimeService.handleHttpRequest, "session.list");
    const running = await startApiOnlyRuntimeHost({
      host: API_ONLY_RUNTIME_HOST,
      port: API_ONLY_RUNTIME_PORT,
      pid,
      desktopSidecarAuth,
      runtimeApi: runtimeService.handleHttpRequest,
      webSocketGateway: runtimeService.webSocketGateway,
      upgradeRequiredPaths: runtimeService.upgradeRequiredPaths,
      lifecycle,
      onRequestError: (error) => console.error("Runtime Host request failed.", error),
      onUpgradeRelayMissing: (request) =>
        console.error(
          `No Runtime WebSocket gateway accepted ${requestPathnameForDiagnostic(request.url)}.`,
        ),
    });
    void warmRuntimeRpc(
      runtimeService.handleHttpRequest,
      "packageCatalog.search",
      packageCatalogWarmupController.signal,
    ).catch(() => {
      if (packageCatalogWarmupController.signal.aborted) return;
      console.warn(
        "[workbench-pi] Pi package catalog warmup deferred; it will retry automatically.",
      );
    });
    return running;
  } catch (error) {
    await disposeInstalledRuntimeLifecycleWithinDeadline({
      lifecycle,
      reason: RuntimeHostLifecycleReason.startupFailed,
      deadlineMs: DEFAULT_RUNTIME_HOST_SHUTDOWN_DEADLINE_MS,
    });
    throw error;
  }
}

function redirectControlConsoleToStderr(): () => void {
  const original = {
    debug: console.debug,
    info: console.info,
    log: console.log,
  };
  console.debug = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);
  console.log = (...args: unknown[]) => console.error(...args);
  return () => {
    console.debug = original.debug;
    console.info = original.info;
    console.log = original.log;
  };
}

/** Runs the production stdin/stdout NDJSON mode without loading or calling Next. */
export interface RunInstalledRuntimeHostControlOptions {
  readonly input?: NodeJS.ReadableStream & AsyncIterable<Uint8Array>;
  readonly output?: Writable;
  /** Production-only process boundary; omitted by injected tests and library callers. */
  readonly forceExit?: (code: 0 | 1) => void;
  /** Managed children defer terminal signals to their supervisor's ordered control shutdown. */
  readonly managedChild?: boolean;
  readonly runControlSession?: typeof runRuntimeHostControlSession;
}

export async function runInstalledRuntimeHostControl({
  input = process.stdin,
  output = process.stdout,
  forceExit,
  managedChild = process.env.WORKBENCH_RUNTIME_MANAGED_CHILD === "1",
  runControlSession = runRuntimeHostControlSession,
}: RunInstalledRuntimeHostControlOptions = {}): Promise<void> {
  const controlStdout = output === process.stdout ? claimRuntimeControlStdout() : undefined;
  const ownsPiStdout = !isStdoutTakenOver();
  // Pi's package commands consult this state before inheriting OS descriptors. Redirecting
  // process.stdout.write alone cannot keep npm/git output off the NDJSON control channel.
  if (ownsPiStdout) takeOverStdout();
  const restoreConsole = redirectControlConsoleToStderr();
  let activeHost: RunningApiOnlyRuntimeHost | undefined;
  let signalShutdown = false;
  const handleSignal = () => {
    if (signalShutdown) return;
    signalShutdown = true;
    if (!activeHost) {
      process.exitCode = 0;
      forceExit?.(0);
      return;
    }
    void activeHost
      .shutdown({
        reason: "container-exit",
        deadlineMs: DEFAULT_RUNTIME_HOST_SHUTDOWN_DEADLINE_MS,
      })
      .finally(() => {
        process.exitCode = 0;
        forceExit?.(0);
      });
  };
  const deferManagedSignal = () => undefined;
  const signalHandler = managedChild ? deferManagedSignal : handleSignal;
  // A managed child shares its supervisor's foreground process group. Keeping persistent no-op
  // handlers prevents terminal signals from bypassing the supervisor's NDJSON shutdown order.
  process.on("SIGINT", signalHandler);
  process.on("SIGTERM", signalHandler);

  try {
    let result: Awaited<ReturnType<typeof runRuntimeHostControlSession>>;
    try {
      result = await runControlSession({
        input,
        output: controlStdout?.output ?? output,
        async startHost({ desktopSidecarAuth }) {
          activeHost = await startInstalledApiOnlyRuntimeHost({ desktopSidecarAuth });
          return activeHost;
        },
      });
    } catch (error) {
      process.exitCode = 1;
      forceExit?.(1);
      throw error;
    }
    if (!result) throw new Error("Runtime Host control session returned no result.");
    process.exitCode =
      result.code === RuntimeHostControlSessionResultCode.shutdownAcknowledged ||
      result.code === RuntimeHostControlSessionResultCode.controlDisconnected
        ? 0
        : 1;
    // Keep diagnostics redirected through process.exit(), including synchronous exit hooks.
    // Disposal is complete; node-pty can still retain internal worker handles on Windows.
    forceExit?.(process.exitCode === 0 ? 0 : 1);
  } finally {
    process.off("SIGINT", signalHandler);
    process.off("SIGTERM", signalHandler);
    restoreConsole();
    if (ownsPiStdout) restoreStdout();
    controlStdout?.release();
  }
}
