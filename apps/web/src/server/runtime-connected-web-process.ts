import {
  RuntimeConnectedWebMode,
  parseRuntimeConnectedWebStartMessage,
  type RuntimeConnectedWebStartMessage,
} from "@workbench/host-contracts/runtime-connected-web-control";
import {
  createWorkbenchHostReadyMessage,
  isWorkbenchHostShutdownMessage,
} from "@workbench/host-contracts/host-control";
import { WebHostShutdownReason } from "@workbench/host-contracts/web-host-control";

import {
  RUNTIME_CONNECTED_WEB_HOST,
  startRuntimeConnectedWebHost,
  type RunningRuntimeConnectedWebHost,
} from "./runtime-connected-web-host";
import { resolveWebRoot } from "./web-root";

const WEB_STARTUP_TIMEOUT_MS = 90_000;
const WEB_STARTUP_CLEANUP_TIMEOUT_MS = 8_000;
const WEB_SHUTDOWN_TIMEOUT_MS = 10_000;

function stableError(message: string): Error {
  return new Error(message);
}

function bounded<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(stableError(`${label} timed out.`)), timeoutMs);
      timeout.unref?.();
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export interface RuntimeConnectedWebProcessControl {
  readonly pid: number;
  exitCode?: number;
  readonly connected?: boolean;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
  send?(message: unknown, callback?: (error: Error | null) => void): unknown;
  disconnect?(): void;
}

interface ControlOutcome {
  readonly failed: boolean;
  readonly source: "disconnect" | "invalid-control" | "ipc" | "SIGINT" | "SIGTERM";
}

function sendReady(
  processControl: RuntimeConnectedWebProcessControl,
  running: RunningRuntimeConnectedWebHost,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (processControl.connected === false || typeof processControl.send !== "function") {
      reject(stableError("Runtime-connected Web control IPC is unavailable."));
      return;
    }
    try {
      processControl.send(
        createWorkbenchHostReadyMessage({
          host: running.host,
          port: running.port,
          pid: processControl.pid,
        }),
        (error) => {
          if (error) reject(stableError("Runtime-connected Web ready IPC failed."));
          else resolve();
        },
      );
    } catch {
      reject(stableError("Runtime-connected Web ready IPC failed."));
    }
  });
}

export interface RunRuntimeConnectedWebProcessOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly forceExit?: (code: 0 | 1) => void;
  readonly processControl?: RuntimeConnectedWebProcessControl;
  readonly startHost?: typeof startRuntimeConnectedWebHost;
  readonly startupTimeoutMs?: number;
  readonly startupCleanupTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
}

/**
 * Runs the browser Web process over a root-owned Runtime connection. One exact IPC start frame is
 * accepted before bind; every later frame is either the shared shutdown request or a fatal control
 * violation. Runtime lifecycle never crosses into this process.
 */
export async function runRuntimeConnectedWebProcess({
  environment = process.env,
  forceExit = (code) => process.exit(code),
  processControl = process as unknown as RuntimeConnectedWebProcessControl,
  startHost = startRuntimeConnectedWebHost,
  startupTimeoutMs = WEB_STARTUP_TIMEOUT_MS,
  startupCleanupTimeoutMs = WEB_STARTUP_CLEANUP_TIMEOUT_MS,
  shutdownTimeoutMs = WEB_SHUTDOWN_TIMEOUT_MS,
}: RunRuntimeConnectedWebProcessOptions = {}): Promise<void> {
  const startupController = new AbortController();
  let configured = false;
  let running: RunningRuntimeConnectedWebHost | undefined;
  let hostShutdownOperation: Promise<void> | undefined;
  let controlSettled = false;
  let resolveStart!: (message: RuntimeConnectedWebStartMessage) => void;
  let rejectStart!: (error: Error) => void;
  const startConfiguration = new Promise<RuntimeConnectedWebStartMessage>((resolve, reject) => {
    resolveStart = resolve;
    rejectStart = reject;
  });
  let resolveControl!: (outcome: ControlOutcome) => void;
  const control = new Promise<ControlOutcome>((resolve) => {
    resolveControl = resolve;
  });
  const settleControl = (outcome: ControlOutcome) => {
    if (controlSettled) return;
    controlSettled = true;
    startupController.abort();
    resolveControl(outcome);
  };
  const interruptBeforeConfiguration = (source: ControlOutcome["source"]) => {
    if (configured) {
      settleControl({ source, failed: false });
      return;
    }
    configured = true;
    settleControl({ source, failed: false });
    rejectStart(stableError("Runtime-connected Web startup was interrupted."));
  };
  const onMessage = (value: unknown) => {
    if (!configured) {
      configured = true;
      const message = parseRuntimeConnectedWebStartMessage(value);
      if (!message) {
        settleControl({ source: "invalid-control", failed: true });
        rejectStart(stableError("Invalid Runtime-connected Web control message."));
        return;
      }
      resolveStart(message);
      return;
    }
    if (isWorkbenchHostShutdownMessage(value)) {
      settleControl({ source: "ipc", failed: false });
      return;
    }
    settleControl({ source: "invalid-control", failed: true });
  };
  const onDisconnect = () => interruptBeforeConfiguration("disconnect");
  const onSigint = () => interruptBeforeConfiguration("SIGINT");
  const onSigterm = () => interruptBeforeConfiguration("SIGTERM");
  const shutdownHost = (
    host: RunningRuntimeConnectedWebHost,
    reason: (typeof WebHostShutdownReason)[keyof typeof WebHostShutdownReason],
  ) => {
    hostShutdownOperation ??= host.shutdown({ reason, deadlineMs: shutdownTimeoutMs });
    return hostShutdownOperation;
  };
  const removeListeners = () => {
    processControl.off("message", onMessage as (...args: unknown[]) => void);
    processControl.off("disconnect", onDisconnect);
    processControl.off("SIGINT", onSigint);
    processControl.off("SIGTERM", onSigterm);
  };
  processControl.on("message", onMessage as (...args: unknown[]) => void);
  processControl.once("disconnect", onDisconnect);
  processControl.once("SIGINT", onSigint);
  processControl.once("SIGTERM", onSigterm);
  if (processControl.connected === false) onDisconnect();

  let startupOperation: Promise<RunningRuntimeConnectedWebHost> | undefined;
  try {
    let message: RuntimeConnectedWebStartMessage;
    try {
      message = await bounded(
        startConfiguration,
        startupTimeoutMs,
        "Runtime-connected Web configuration",
      );
    } catch {
      if (!controlSettled) {
        settleControl({ source: "invalid-control", failed: true });
      }
      const outcome = await control;
      processControl.exitCode = outcome.failed ? 1 : 0;
      if (outcome.failed) throw stableError("Runtime-connected Web process failed.");
      forceExit(0);
      return;
    }

    const publicUrl = new URL(message.publicOrigin);
    startupOperation = startHost({
      dev: message.mode === RuntimeConnectedWebMode.development,
      hostname: RUNTIME_CONNECTED_WEB_HOST,
      port: Number(publicUrl.port),
      publicOrigin: message.publicOrigin,
      runtimeConnection: message.runtimeConnection,
      startupSignal: startupController.signal,
      webRoot: resolveWebRoot({
        configuredRoot: environment.WORKBENCH_WEB_ROOT,
        workingDirectory: process.cwd(),
      }),
    });
    const startup = await Promise.race([
      bounded(startupOperation, startupTimeoutMs, "Runtime-connected Web startup").then((host) => ({
        kind: "ready" as const,
        host,
      })),
      control.then((outcome) => ({ kind: "control" as const, outcome })),
    ]);
    if (startup.kind === "control") {
      await bounded(
        startupOperation.then((lateHost) =>
          shutdownHost(lateHost, WebHostShutdownReason.requested),
        ),
        startupCleanupTimeoutMs,
        "Runtime-connected Web interrupted startup cleanup",
      ).catch(() => undefined);
      processControl.exitCode = startup.outcome.failed ? 1 : 0;
      if (startup.outcome.failed) throw stableError("Runtime-connected Web process failed.");
      forceExit(0);
      return;
    }
    running = startup.host;
    await sendReady(processControl, running);
    console.log(`> Workbench ready at ${running.httpOrigin}`);
    const outcome = await control;
    await shutdownHost(running, WebHostShutdownReason.requested);
    processControl.exitCode = outcome.failed ? 1 : 0;
    if (processControl.connected) {
      try {
        processControl.disconnect?.();
      } catch {
        processControl.exitCode = 1;
      }
    }
    if (outcome.failed) throw stableError("Runtime-connected Web process failed.");
    forceExit(processControl.exitCode === 1 ? 1 : 0);
  } catch (error) {
    startupController.abort();
    if (running) {
      await shutdownHost(running, WebHostShutdownReason.containerExit).catch(() => undefined);
    } else if (startupOperation) {
      await bounded(
        startupOperation.then((lateHost) =>
          shutdownHost(lateHost, WebHostShutdownReason.containerExit),
        ),
        startupCleanupTimeoutMs,
        "Runtime-connected Web failed startup cleanup",
      ).catch(() => undefined);
    }
    processControl.exitCode = 1;
    forceExit(1);
    throw error;
  } finally {
    removeListeners();
  }
}
