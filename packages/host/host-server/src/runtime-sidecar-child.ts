import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { Writable } from "node:stream";

import type { RuntimeArtifactManifest } from "@workbench/host-contracts/runtime-artifact-manifest";
import {
  RuntimeHostControlNdjsonDecoder,
  RuntimeHostShutdownReason,
  createRuntimeHostShutdownFrame,
  createRuntimeHostStartFrame,
  encodeRuntimeHostControlInputFrame,
  parseRuntimeHostControlOutputFrame,
  type RuntimeHostReadyFrame,
} from "@workbench/host-contracts/runtime-host-control";

const DEFAULT_RUNTIME_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_RUNTIME_SHUTDOWN_TIMEOUT_MS = 5_000;
const CHILD_RUNTIME_DEADLINE_MS = 4_000;

export interface RuntimeSidecarLaunchConfiguration {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SpawnOptionsWithoutStdio;
  readonly manifest?: RuntimeArtifactManifest;
}

export interface StreamingSecretRedactor {
  write(chunk: Uint8Array): void;
  end(): void;
}

/** Keeps a secret-length tail so credentials split across arbitrary stderr chunks stay removed. */
export function createStreamingSecretRedactor(
  secrets: readonly string[],
  emit: (text: string) => void,
): StreamingSecretRedactor {
  const candidates = [...new Set(secrets.filter(Boolean))].sort(
    (left, right) => right.length - left.length,
  );
  const maximumSecretLength = Math.max(1, ...candidates.map((secret) => secret.length));
  const decoder = new StringDecoder("utf8");
  let pending = "";
  const redact = (value: string) =>
    candidates.reduce((result, secret) => result.split(secret).join("[REDACTED]"), value);
  const safeEmit = (value: string) => {
    try {
      emit(value);
    } catch {
      // Diagnostics must never destabilize the control/lifecycle owner.
    }
  };
  const flush = () => {
    while (pending.length >= maximumSecretLength) {
      const secret = candidates.find((candidate) => pending.startsWith(candidate));
      if (secret) {
        safeEmit("[REDACTED]");
        pending = pending.slice(secret.length);
      } else {
        safeEmit(pending[0]);
        pending = pending.slice(1);
      }
    }
  };
  return Object.freeze({
    write(chunk: Uint8Array) {
      pending += decoder.write(Buffer.from(chunk));
      flush();
    },
    end() {
      pending += decoder.end();
      safeEmit(redact(pending));
      pending = "";
    },
  });
}

function stableRuntimeError(message: string): Error {
  return new Error(message);
}

function waitUntil<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(stableRuntimeError(`${label} timed out.`)), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function forceRuntimeProcessTree(
  child: ChildProcessWithoutNullStreams,
  {
    platform = process.platform,
    listProcesses = () =>
      String(
        spawnSync("ps", ["-eo", "pid=,ppid="], {
          encoding: "utf8",
          windowsHide: true,
        }).stdout ?? "",
      ),
    killProcess = process.kill,
    killWindowsTree = (pid: number) => {
      const result = spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        encoding: "utf8",
        windowsHide: true,
      });
      if (result.error || result.status !== 0) throw result.error ?? new Error("taskkill failed");
      return result;
    },
  }: {
    readonly platform?: NodeJS.Platform;
    readonly listProcesses?: () => string;
    readonly killProcess?: typeof process.kill;
    readonly killWindowsTree?: (pid: number) => unknown;
  } = {},
): void {
  const rootPid = child.pid;
  if (!rootPid || rootPid === process.pid) {
    try {
      child.kill("SIGKILL");
    } catch {
      // No safe process-tree address is available.
    }
    return;
  }
  if (platform === "win32") {
    try {
      killWindowsTree(rootPid);
      return;
    } catch {
      // Fall back to the exact child below.
    }
  } else {
    try {
      const children = new Map<number, number[]>();
      for (const line of listProcesses().split(/\r?\n/u)) {
        const match = line.trim().match(/^(\d+)\s+(\d+)$/u);
        if (!match) continue;
        const pid = Number(match[1]);
        const parentPid = Number(match[2]);
        const entries = children.get(parentPid) ?? [];
        entries.push(pid);
        children.set(parentPid, entries);
      }
      const ordered: number[] = [];
      const visit = (pid: number) => {
        for (const descendant of children.get(pid) ?? []) visit(descendant);
        ordered.push(pid);
      };
      visit(rootPid);
      for (const pid of ordered) {
        try {
          killProcess(pid, "SIGKILL");
        } catch {
          // A descendant may exit while the tree is being walked.
        }
      }
      return;
    } catch {
      // Fall back to the exact child below.
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // The exit waiter reports whether the process actually completed.
  }
}

/** Generic alias for repository orchestrators supervising non-Runtime child trees. */
export const forceManagedChildProcessTree = forceRuntimeProcessTree;

function writeControlInput(output: Writable, encoded: string): Promise<void> {
  return new Promise((resolve, reject) => {
    output.write(encoded, (error) => {
      if (error) reject(stableRuntimeError("Runtime Host control input failed."));
      else resolve();
    });
  });
}

export interface RuntimeSidecarShutdownResult {
  readonly forced: boolean;
  readonly errors: readonly unknown[];
}

export interface RunningRuntimeSidecar {
  readonly httpOrigin: string;
  readonly instanceId: string;
  readonly pid: number;
  shutdown(): Promise<RuntimeSidecarShutdownResult>;
}

export interface StartRuntimeSidecarOptions {
  readonly launch: RuntimeSidecarLaunchConfiguration;
  readonly accessToken: string;
  readonly publicOrigin: string;
  readonly spawnImpl?: typeof spawn;
  readonly startupTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly onUnexpectedExit?: () => void;
  readonly onStderr?: (text: string) => void;
  readonly platform?: NodeJS.Platform;
  readonly forceProcessTree?: (child: ChildProcessWithoutNullStreams) => void;
  readonly startupSignal?: AbortSignal;
}

/** Owns one Runtime process generation through its strict NDJSON control and bounded cleanup. */
export async function startRuntimeSidecar({
  launch,
  accessToken,
  publicOrigin,
  spawnImpl = spawn,
  startupTimeoutMs = DEFAULT_RUNTIME_STARTUP_TIMEOUT_MS,
  shutdownTimeoutMs = DEFAULT_RUNTIME_SHUTDOWN_TIMEOUT_MS,
  onUnexpectedExit,
  onStderr = (text) => process.stderr.write(text),
  platform = process.platform,
  forceProcessTree = (child) => forceRuntimeProcessTree(child, { platform }),
  startupSignal,
}: StartRuntimeSidecarOptions): Promise<RunningRuntimeSidecar> {
  if (startupSignal?.aborted) throw stableRuntimeError("Runtime Host startup was interrupted.");
  const child = spawnImpl(launch.command, [...launch.args], {
    ...launch.options,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  const decoder = new RuntimeHostControlNdjsonDecoder();
  const stderr = createStreamingSecretRedactor([accessToken], onStderr);
  child.stderr.on("data", (chunk: Buffer) => stderr.write(chunk));
  child.stderr.once("end", () => stderr.end());

  let readyFrame: RuntimeHostReadyFrame | undefined;
  let readyResolve!: (frame: RuntimeHostReadyFrame) => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<RuntimeHostReadyFrame>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  let ackResolve!: () => void;
  let ackReject!: (error: Error) => void;
  const shutdownAck = new Promise<void>((resolve, reject) => {
    ackResolve = resolve;
    ackReject = reject;
  });
  void shutdownAck.catch(() => undefined);
  let exitResolve!: () => void;
  const exited = new Promise<void>((resolve) => (exitResolve = resolve));
  let shutdownRequested = false;
  let protocolFailed = false;
  let shutdownAcknowledged = false;
  let unexpectedExitReported = false;
  const reportUnexpectedExit = () => {
    if (unexpectedExitReported) return;
    unexpectedExitReported = true;
    try {
      onUnexpectedExit?.();
    } catch {
      // A container diagnostic callback must not take over child lifecycle ownership.
    }
  };
  const failProtocol = (message: string) => {
    if (protocolFailed) return;
    protocolFailed = true;
    const error = stableRuntimeError(message);
    if (!readyFrame) readyReject(error);
    else {
      ackReject(error);
      if (!shutdownRequested) reportUnexpectedExit();
      try {
        forceProcessTree(child);
      } catch {
        // The bounded exit waiter below remains the source of cleanup truth.
      }
    }
  };
  const interruptStartup = () => failProtocol("Runtime Host startup was interrupted.");
  startupSignal?.addEventListener("abort", interruptStartup, { once: true });
  if (startupSignal?.aborted) interruptStartup();

  child.stdout.on("data", (chunk: Buffer) => {
    try {
      for (const record of decoder.push(chunk)) {
        const frame = parseRuntimeHostControlOutputFrame(record);
        if (!frame) {
          failProtocol("Runtime Host emitted an invalid control frame.");
          continue;
        }
        if (!readyFrame) {
          if (frame.type !== "ready" || frame.pid !== child.pid) {
            failProtocol("Runtime Host did not emit the expected ready frame.");
            continue;
          }
          readyFrame = frame;
          readyResolve(frame);
          continue;
        }
        if (!shutdownRequested || frame.type !== "shutdown-ack" || shutdownAcknowledged) {
          failProtocol("Runtime Host emitted an unexpected control frame.");
          continue;
        }
        shutdownAcknowledged = true;
        ackResolve();
      }
    } catch {
      failProtocol("Runtime Host control output is invalid.");
    }
  });
  child.stdout.once("end", () => {
    try {
      decoder.finish();
    } catch {
      failProtocol("Runtime Host control output is incomplete.");
      return;
    }
    setImmediate(() => {
      if (!(shutdownRequested && shutdownAcknowledged)) {
        failProtocol("Runtime Host control output disconnected.");
      }
    });
  });
  child.stdout.once("error", () => failProtocol("Runtime Host control output failed."));
  child.stderr.once("error", () => failProtocol("Runtime Host diagnostic output failed."));
  child.once("error", () => failProtocol("Runtime Host process failed."));
  child.stdin.on("error", () => failProtocol("Runtime Host control input failed."));
  child.once("exit", () => {
    exitResolve();
    if (!readyFrame) readyReject(stableRuntimeError("Runtime Host exited before ready."));
    else if (!shutdownRequested) reportUnexpectedExit();
    else ackReject(stableRuntimeError("Runtime Host exited before shutdown acknowledgement."));
  });
  void ready.catch(() => undefined);

  try {
    await waitUntil(
      Promise.all([
        writeControlInput(
          child.stdin,
          encodeRuntimeHostControlInputFrame(
            createRuntimeHostStartFrame({ accessToken, allowedOrigins: [publicOrigin] }),
          ),
        ),
        ready,
      ]).then(([, frame]) => frame),
      startupTimeoutMs,
      "Runtime Host startup",
    );
  } catch (error) {
    try {
      forceProcessTree(child);
    } catch {
      // The cleanup waiter below records whether the child actually exited.
    }
    await waitUntil(exited, 1_000, "Runtime Host forced startup cleanup").catch(() => undefined);
    throw error;
  } finally {
    startupSignal?.removeEventListener("abort", interruptStartup);
  }
  const runningReady = await ready;
  if (runningReady.instanceId === accessToken) {
    try {
      forceProcessTree(child);
    } catch {
      // The cleanup waiter below records whether the child actually exited.
    }
    await waitUntil(exited, 1_000, "Runtime Host identity cleanup").catch(() => undefined);
    throw stableRuntimeError("Runtime Host ready identity is invalid.");
  }

  let shutdownOperation: Promise<RuntimeSidecarShutdownResult> | undefined;
  const shutdown = () => {
    if (shutdownOperation) return shutdownOperation;
    let resolveShutdown!: (result: RuntimeSidecarShutdownResult) => void;
    const operation = new Promise<RuntimeSidecarShutdownResult>((resolve) => {
      resolveShutdown = resolve;
    });
    shutdownOperation = operation;
    shutdownRequested = true;
    void (async () => {
      const errors: unknown[] = [];
      let forced = false;
      try {
        await waitUntil(
          Promise.all([
            writeControlInput(
              child.stdin,
              encodeRuntimeHostControlInputFrame(
                createRuntimeHostShutdownFrame({
                  reason: RuntimeHostShutdownReason.containerExit,
                  deadlineMs: CHILD_RUNTIME_DEADLINE_MS,
                }),
              ),
            ),
            shutdownAck,
            exited,
          ]).then(() => undefined),
          shutdownTimeoutMs,
          "Runtime Host shutdown",
        );
      } catch (error) {
        errors.push(error);
        forced = true;
        try {
          forceProcessTree(child);
        } catch (forceError) {
          errors.push(forceError);
        }
        await waitUntil(exited, 1_000, "Runtime Host forced shutdown cleanup").catch(
          (forceError) => {
            errors.push(forceError);
          },
        );
      } finally {
        child.stdin.end();
      }
      return Object.freeze({ forced, errors: Object.freeze(errors) });
    })().then(resolveShutdown);
    return operation;
  };

  return Object.freeze({
    httpOrigin: runningReady.httpOrigin,
    instanceId: runningReady.instanceId,
    pid: runningReady.pid,
    shutdown,
  });
}
