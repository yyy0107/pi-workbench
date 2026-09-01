import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";

import {
  RuntimeHostControlDecodeError,
  RuntimeHostControlNdjsonDecoder,
  RuntimeHostStartupErrorCode,
  createRuntimeHostReadyFrame,
  createRuntimeHostShutdownAckFrame,
  createRuntimeHostStartupErrorFrame,
  encodeRuntimeHostControlOutputFrame,
  parseRuntimeHostControlInputFrame,
  parseRuntimeHostIdentity,
  runtimeHostControlInputErrorCode,
  type RuntimeHostControlOutputFrame,
} from "@workbench/host-contracts/runtime-host-control";

import {
  API_ONLY_RUNTIME_HOST,
  API_ONLY_RUNTIME_PORT,
  RuntimeHostLifecycleReason,
  runtimeHostLifecycleReason,
  type RunningApiOnlyRuntimeHost,
} from "@workbench/host-server/api-only-runtime-host";
import {
  defineDesktopSidecarRuntimeAuthPolicy,
  type DesktopSidecarRuntimeAuthPolicy,
} from "@workbench/host-server/runtime-transport-auth";

export const RuntimeHostControlSessionResultCode = Object.freeze({
  shutdownAcknowledged: "shutdown-acknowledged",
  controlDisconnected: "control-disconnected",
  invalidControl: "invalid-control",
  startupFailed: "startup-failed",
  shutdownFailed: "shutdown-failed",
} as const);

export type RuntimeHostControlSessionResultCode =
  (typeof RuntimeHostControlSessionResultCode)[keyof typeof RuntimeHostControlSessionResultCode];

export interface RuntimeHostControlSessionResult {
  readonly code: RuntimeHostControlSessionResultCode;
}

export interface RuntimeHostControlStartOptions {
  readonly host: typeof API_ONLY_RUNTIME_HOST;
  readonly port: typeof API_ONLY_RUNTIME_PORT;
  readonly desktopSidecarAuth: DesktopSidecarRuntimeAuthPolicy;
}

export interface RuntimeHostControlSessionOptions {
  readonly input: AsyncIterable<Uint8Array>;
  /** Exclusive Host stdout channel; callers must route every non-control write to stderr. */
  readonly output: Writable;
  readonly startHost: (
    options: RuntimeHostControlStartOptions,
  ) => RunningApiOnlyRuntimeHost | Promise<RunningApiOnlyRuntimeHost>;
  readonly createInstanceId?: () => string;
  readonly disconnectedShutdownDeadlineMs?: number;
}

export async function writeRuntimeHostControlFrame(
  output: Writable,
  frame: RuntimeHostControlOutputFrame,
): Promise<void> {
  const encoded = encodeRuntimeHostControlOutputFrame(frame);
  await new Promise<void>((resolve, reject) => {
    output.write(encoded, (error) => (error ? reject(error) : resolve()));
  });
}

async function writeStartupError(
  output: Writable,
  code:
    | typeof RuntimeHostStartupErrorCode.invalidControlFrame
    | typeof RuntimeHostStartupErrorCode.unsupportedControlVersion
    | typeof RuntimeHostStartupErrorCode.startupFailed,
): Promise<void> {
  await writeRuntimeHostControlFrame(output, createRuntimeHostStartupErrorFrame(code));
}

async function stopAfterControlError(host: RunningApiOnlyRuntimeHost): Promise<void> {
  await host.shutdown({ reason: RuntimeHostLifecycleReason.controlError, deadlineMs: 5_000 });
}

/** Runs a strict one-start/one-shutdown NDJSON session without reading process globals. */
export async function runRuntimeHostControlSession({
  input,
  output,
  startHost,
  createInstanceId = randomUUID,
  disconnectedShutdownDeadlineMs = 5_000,
}: RuntimeHostControlSessionOptions): Promise<RuntimeHostControlSessionResult> {
  if (
    !Number.isSafeInteger(disconnectedShutdownDeadlineMs) ||
    disconnectedShutdownDeadlineMs <= 0 ||
    disconnectedShutdownDeadlineMs > 60_000
  ) {
    throw new Error("Invalid disconnected Runtime Host shutdown deadline.");
  }
  const decoder = new RuntimeHostControlNdjsonDecoder();
  let running: RunningApiOnlyRuntimeHost | undefined;
  let runningStopped = false;

  try {
    for await (const chunk of input) {
      const records = decoder.push(chunk);
      for (const record of records) {
        const frame = parseRuntimeHostControlInputFrame(record);
        if (!frame) {
          if (running) {
            try {
              await stopAfterControlError(running);
            } catch {
              return Object.freeze({ code: RuntimeHostControlSessionResultCode.shutdownFailed });
            }
          } else {
            await writeStartupError(output, runtimeHostControlInputErrorCode(record));
          }
          return Object.freeze({ code: RuntimeHostControlSessionResultCode.invalidControl });
        }

        if (!running) {
          if (frame.type !== "start") {
            await writeStartupError(output, RuntimeHostStartupErrorCode.invalidControlFrame);
            return Object.freeze({ code: RuntimeHostControlSessionResultCode.invalidControl });
          }
          let authPolicy: DesktopSidecarRuntimeAuthPolicy;
          let readyFrame: ReturnType<typeof createRuntimeHostReadyFrame>;
          try {
            const instanceId = createInstanceId();
            if (instanceId === frame.accessToken) {
              throw new Error("Runtime Host instance identity must be credential-independent.");
            }
            authPolicy = defineDesktopSidecarRuntimeAuthPolicy({
              instanceId,
              accessToken: frame.accessToken,
              allowedOrigins: frame.allowedOrigins,
            });
            running = await startHost({
              host: API_ONLY_RUNTIME_HOST,
              port: API_ONLY_RUNTIME_PORT,
              desktopSidecarAuth: authPolicy,
            });
            const identity = parseRuntimeHostIdentity(running.identity);
            if (
              !identity ||
              !running.server.listening ||
              running.host !== API_ONLY_RUNTIME_HOST ||
              identity.instanceId !== authPolicy.instanceId ||
              !Number.isInteger(running.port) ||
              running.port <= 0 ||
              running.port > 65_535 ||
              running.httpOrigin !== `http://127.0.0.1:${running.port}`
            ) {
              throw new Error("Runtime Host start result is invalid.");
            }
            readyFrame = createRuntimeHostReadyFrame({
              instanceId: identity.instanceId,
              pid: identity.pid,
              httpOrigin: running.httpOrigin,
            });
          } catch {
            if (running) {
              try {
                await stopAfterControlError(running);
              } catch {
                return Object.freeze({ code: RuntimeHostControlSessionResultCode.shutdownFailed });
              }
            }
            await writeStartupError(output, RuntimeHostStartupErrorCode.startupFailed);
            return Object.freeze({ code: RuntimeHostControlSessionResultCode.startupFailed });
          }
          await writeRuntimeHostControlFrame(output, readyFrame);
          continue;
        }

        if (frame.type !== "shutdown") {
          try {
            await stopAfterControlError(running);
          } catch {
            return Object.freeze({ code: RuntimeHostControlSessionResultCode.shutdownFailed });
          }
          return Object.freeze({ code: RuntimeHostControlSessionResultCode.invalidControl });
        }
        try {
          await running.shutdown({
            reason: runtimeHostLifecycleReason(frame.reason),
            deadlineMs: frame.deadlineMs,
          });
          runningStopped = true;
        } catch {
          return Object.freeze({ code: RuntimeHostControlSessionResultCode.shutdownFailed });
        }
        await writeRuntimeHostControlFrame(output, createRuntimeHostShutdownAckFrame());
        return Object.freeze({ code: RuntimeHostControlSessionResultCode.shutdownAcknowledged });
      }
    }
    decoder.finish();
  } catch (error) {
    if (error instanceof RuntimeHostControlDecodeError) {
      if (running) {
        try {
          await stopAfterControlError(running);
        } catch {
          return Object.freeze({ code: RuntimeHostControlSessionResultCode.shutdownFailed });
        }
      } else {
        try {
          await writeStartupError(output, RuntimeHostStartupErrorCode.invalidControlFrame);
        } catch {
          throw new Error("Runtime Host control output failed.");
        }
      }
      return Object.freeze({ code: RuntimeHostControlSessionResultCode.invalidControl });
    }

    if (running && !runningStopped) {
      try {
        await stopAfterControlError(running);
      } catch {
        throw new Error("Runtime Host control failure cleanup failed.");
      }
    }
    throw new Error("Runtime Host control session failed.");
  }

  if (running) {
    try {
      await running.shutdown({
        reason: RuntimeHostLifecycleReason.containerExit,
        deadlineMs: disconnectedShutdownDeadlineMs,
      });
    } catch {
      return Object.freeze({ code: RuntimeHostControlSessionResultCode.shutdownFailed });
    }
  }
  return Object.freeze({ code: RuntimeHostControlSessionResultCode.controlDisconnected });
}
