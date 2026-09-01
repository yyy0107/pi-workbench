import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";

import {
  WebHostControlDecodeError,
  WebHostControlNdjsonDecoder,
  WebHostStartupErrorCode,
  WebHostShutdownReason,
  createWebHostReadyFrame,
  createWebHostShutdownAckFrame,
  createWebHostStartupErrorFrame,
  encodeWebHostControlOutputFrame,
  parseWebHostControlInputFrame,
  webHostControlInputErrorCode,
  type WebHostControlOutputFrame,
  type WebHostShutdownReason as WebHostShutdownReasonValue,
} from "@workbench/host-contracts/web-host-control";

export const WebHostControlSessionResultCode = Object.freeze({
  shutdownAcknowledged: "shutdown-acknowledged",
  controlDisconnected: "control-disconnected",
  invalidControl: "invalid-control",
  startupFailed: "startup-failed",
  shutdownFailed: "shutdown-failed",
} as const);

export type WebHostControlSessionResultCode =
  (typeof WebHostControlSessionResultCode)[keyof typeof WebHostControlSessionResultCode];

export interface WebHostControlSessionResult {
  readonly code: WebHostControlSessionResultCode;
}

export interface RunningWebHostControlOwner {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly httpOrigin: string;
  shutdown(options: {
    readonly reason: WebHostShutdownReasonValue;
    readonly deadlineMs: number;
  }): void | Promise<void>;
}

export interface WebHostControlStartOptions {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly startupSignal: AbortSignal;
}

export interface WebHostControlSessionOptions {
  readonly input: AsyncIterable<Uint8Array>;
  /** Exclusive Host stdout channel; callers must route every non-control write to stderr. */
  readonly output: Writable;
  readonly pid: number;
  readonly startHost: (
    options: WebHostControlStartOptions,
  ) => RunningWebHostControlOwner | Promise<RunningWebHostControlOwner>;
  readonly createInstanceId?: () => string;
  readonly disconnectedShutdownDeadlineMs?: number;
  /** The one controller shared by process signals, startup, and session cleanup. */
  readonly lifecycleController?: AbortController;
}

interface ControlRecordEvent {
  readonly kind: "control-record";
  readonly record: unknown;
}

interface ControlDoneEvent {
  readonly kind: "control-done";
}

interface ControlInvalidEvent {
  readonly kind: "control-invalid";
}

interface ControlErrorEvent {
  readonly kind: "control-error";
}

type ControlEvent = ControlRecordEvent | ControlDoneEvent | ControlInvalidEvent | ControlErrorEvent;

interface LifecycleAbortEvent {
  readonly kind: "lifecycle-abort";
}

interface StartSucceededEvent {
  readonly kind: "start-succeeded";
  readonly owner: unknown;
}

interface StartFailedEvent {
  readonly kind: "start-failed";
}

type StartEvent = StartSucceededEvent | StartFailedEvent;
type SessionEvent = ControlEvent | LifecycleAbortEvent | StartEvent;

interface CleanupRequest {
  readonly reason: WebHostShutdownReasonValue;
  readonly deadlineMs: number;
}

function stableSessionFailure(): Error {
  return new Error("Web Host control session failed.");
}

function result(code: WebHostControlSessionResultCode): WebHostControlSessionResult {
  return Object.freeze({ code });
}

function writeWebHostControlFrame(
  output: Writable,
  frame: WebHostControlOutputFrame,
): Promise<void> {
  const encoded = encodeWebHostControlOutputFrame(frame);
  return new Promise<void>((resolve, reject) => {
    output.write(encoded, (error) => (error ? reject(error) : resolve()));
  });
}

function isRunningOwner(value: unknown): value is RunningWebHostControlOwner {
  try {
    return (
      typeof value === "object" &&
      value !== null &&
      (value as RunningWebHostControlOwner).host === "127.0.0.1" &&
      Number.isInteger((value as RunningWebHostControlOwner).port) &&
      (value as RunningWebHostControlOwner).port > 0 &&
      (value as RunningWebHostControlOwner).port <= 65_535 &&
      (value as RunningWebHostControlOwner).httpOrigin ===
        `http://127.0.0.1:${(value as RunningWebHostControlOwner).port}` &&
      typeof (value as RunningWebHostControlOwner).shutdown === "function"
    );
  } catch {
    return false;
  }
}

function isShutdownCapable(value: unknown): value is Pick<RunningWebHostControlOwner, "shutdown"> {
  try {
    return (
      (typeof value === "object" || typeof value === "function") &&
      value !== null &&
      typeof (value as RunningWebHostControlOwner).shutdown === "function"
    );
  } catch {
    return false;
  }
}

function waitUntil<T>(
  operation: Promise<T>,
  deadlineAt: number,
): Promise<{ readonly settled: true; readonly value: T } | { readonly settled: false }> {
  const remainingMs = Math.max(0, deadlineAt - Date.now());
  if (remainingMs === 0) return Promise.resolve({ settled: false });
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation.then((value) => ({ settled: true, value }) as const),
    new Promise<{ readonly settled: false }>((resolve) => {
      timer = setTimeout(() => resolve({ settled: false }), remainingMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Runs a strict one-start/one-shutdown session with one abort and one cleanup deadline. */
export async function runWebHostControlSession({
  input,
  output,
  pid,
  startHost,
  createInstanceId = randomUUID,
  disconnectedShutdownDeadlineMs = 5_000,
  lifecycleController = new AbortController(),
}: WebHostControlSessionOptions): Promise<WebHostControlSessionResult> {
  if (
    !Number.isSafeInteger(disconnectedShutdownDeadlineMs) ||
    disconnectedShutdownDeadlineMs <= 0 ||
    disconnectedShutdownDeadlineMs > 60_000
  ) {
    throw new Error("Invalid disconnected Web Host shutdown deadline.");
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("Invalid Web Host process identifier.");
  }

  const decoder = new WebHostControlNdjsonDecoder();
  const iterator = input[Symbol.asyncIterator]();
  const decodedRecords: unknown[] = [];
  const lifecycleSignal = lifecycleController.signal;
  let resolveLifecycleAbort!: (event: LifecycleAbortEvent) => void;
  const lifecycleAbort = new Promise<LifecycleAbortEvent>((resolve) => {
    resolveLifecycleAbort = resolve;
  });
  const onLifecycleAbort = () => resolveLifecycleAbort({ kind: "lifecycle-abort" });
  if (lifecycleSignal.aborted) onLifecycleAbort();
  else lifecycleSignal.addEventListener("abort", onLifecycleAbort, { once: true });

  let controlOperation: Promise<ControlEvent> | undefined;
  let startOperation: Promise<StartEvent> | undefined;
  let instanceId: string | undefined;
  let cleanupRequest: CleanupRequest | undefined;
  let cleanupDeadlineAt: number | undefined;
  let cleanupOperation: Promise<boolean> | undefined;
  let shutdownOperation: Promise<boolean> | undefined;
  let readyWritten = false;
  let terminalWritten = false;

  const abortLifecycle = () => {
    if (!lifecycleSignal.aborted) lifecycleController.abort();
  };

  const pullControl = async (): Promise<ControlEvent> => {
    while (decodedRecords.length === 0) {
      let next: IteratorResult<Uint8Array>;
      try {
        next = await iterator.next();
      } catch {
        return { kind: "control-error" };
      }
      if (next.done) {
        try {
          decoder.finish();
          return { kind: "control-done" };
        } catch (error) {
          return error instanceof WebHostControlDecodeError
            ? { kind: "control-invalid" }
            : { kind: "control-error" };
        }
      }
      try {
        decodedRecords.push(...decoder.push(next.value));
      } catch (error) {
        return error instanceof WebHostControlDecodeError
          ? { kind: "control-invalid" }
          : { kind: "control-error" };
      }
    }
    return { kind: "control-record", record: decodedRecords.shift() };
  };

  const nextControl = (): Promise<ControlEvent> => {
    controlOperation ??= pullControl();
    return controlOperation;
  };

  const consumeControl = () => {
    controlOperation = undefined;
  };

  const writeTerminal = async (frame: WebHostControlOutputFrame): Promise<void> => {
    if (terminalWritten) throw stableSessionFailure();
    terminalWritten = true;
    await writeWebHostControlFrame(output, frame);
  };

  const beginShutdown = (
    owner: Pick<RunningWebHostControlOwner, "shutdown">,
    request: CleanupRequest,
  ): Promise<boolean> => {
    shutdownOperation ??= Promise.resolve()
      .then(() => owner.shutdown(request))
      .then(
        () => true,
        () => false,
      );
    return shutdownOperation;
  };

  const beginCleanup = (request: CleanupRequest): Promise<boolean> => {
    abortLifecycle();
    cleanupRequest ??= request;
    cleanupDeadlineAt ??= Date.now() + request.deadlineMs;
    cleanupOperation ??= Promise.resolve(startOperation)
      .then(async (start) => {
        if (!start || start.kind === "start-failed") return true;
        if (!isShutdownCapable(start.owner)) return false;
        return beginShutdown(start.owner, cleanupRequest!);
      })
      .then(
        (cleaned) => cleaned,
        () => false,
      );
    return cleanupOperation;
  };

  const awaitCleanup = async (request: CleanupRequest): Promise<boolean> => {
    const operation = beginCleanup(request);
    const settled = await waitUntil(operation, cleanupDeadlineAt!);
    return settled.settled && settled.value;
  };

  const disconnectedCleanup = (): Promise<boolean> =>
    awaitCleanup({
      reason: WebHostShutdownReason.containerExit,
      deadlineMs: disconnectedShutdownDeadlineMs,
    });

  const interruptForInvalidControl = async (
    code:
      | typeof WebHostStartupErrorCode.invalidControlFrame
      | typeof WebHostStartupErrorCode.unsupportedControlVersion,
  ): Promise<WebHostControlSessionResult> => {
    const cleanup = beginCleanup({
      reason: WebHostShutdownReason.containerExit,
      deadlineMs: disconnectedShutdownDeadlineMs,
    });
    await writeTerminal(createWebHostStartupErrorFrame(code));
    const settled = await waitUntil(cleanup, cleanupDeadlineAt!);
    return result(
      settled.settled && settled.value
        ? WebHostControlSessionResultCode.invalidControl
        : WebHostControlSessionResultCode.shutdownFailed,
    );
  };

  try {
    while (!startOperation) {
      const pendingControl = nextControl();
      const event: ControlEvent | LifecycleAbortEvent = await Promise.race([
        pendingControl,
        lifecycleAbort,
      ]);
      if (event.kind === "lifecycle-abort") {
        return result(WebHostControlSessionResultCode.controlDisconnected);
      }
      consumeControl();
      if (event.kind === "control-error") throw stableSessionFailure();
      if (event.kind === "control-done") {
        abortLifecycle();
        return result(WebHostControlSessionResultCode.controlDisconnected);
      }
      if (event.kind === "control-invalid") {
        return interruptForInvalidControl(WebHostStartupErrorCode.invalidControlFrame);
      }

      const frame = parseWebHostControlInputFrame(event.record);
      if (!frame || frame.type !== "start") {
        return interruptForInvalidControl(
          frame
            ? WebHostStartupErrorCode.invalidControlFrame
            : webHostControlInputErrorCode(event.record),
        );
      }
      try {
        instanceId = createInstanceId();
        startOperation = Promise.resolve()
          .then(() =>
            startHost({
              host: frame.host,
              port: frame.port,
              startupSignal: lifecycleSignal,
            }),
          )
          .then(
            (owner) => ({ kind: "start-succeeded", owner }) as const,
            () => ({ kind: "start-failed" }) as const,
          );
      } catch {
        startOperation = Promise.resolve({ kind: "start-failed" });
      }
    }

    while (!readyWritten) {
      const pendingControl = nextControl();
      const event: SessionEvent = await Promise.race([
        startOperation,
        pendingControl,
        lifecycleAbort,
      ]);

      if (event.kind === "lifecycle-abort") {
        const cleaned = await disconnectedCleanup();
        return result(
          cleaned
            ? WebHostControlSessionResultCode.controlDisconnected
            : WebHostControlSessionResultCode.shutdownFailed,
        );
      }

      if (event.kind === "start-failed") {
        beginCleanup({
          reason: WebHostShutdownReason.containerExit,
          deadlineMs: disconnectedShutdownDeadlineMs,
        });
        await writeTerminal(createWebHostStartupErrorFrame(WebHostStartupErrorCode.startupFailed));
        return result(WebHostControlSessionResultCode.startupFailed);
      }

      if (event.kind === "start-succeeded") {
        if (lifecycleSignal.aborted) {
          const cleaned = await disconnectedCleanup();
          return result(
            cleaned
              ? WebHostControlSessionResultCode.controlDisconnected
              : WebHostControlSessionResultCode.shutdownFailed,
          );
        }
        if (!isRunningOwner(event.owner)) {
          const cleanup = beginCleanup({
            reason: WebHostShutdownReason.containerExit,
            deadlineMs: disconnectedShutdownDeadlineMs,
          });
          await writeTerminal(
            createWebHostStartupErrorFrame(WebHostStartupErrorCode.startupFailed),
          );
          const settled = await waitUntil(cleanup, cleanupDeadlineAt!);
          return result(
            settled.settled && settled.value
              ? WebHostControlSessionResultCode.startupFailed
              : WebHostControlSessionResultCode.shutdownFailed,
          );
        }
        await writeWebHostControlFrame(
          output,
          createWebHostReadyFrame({
            instanceId: instanceId!,
            pid,
            httpOrigin: event.owner.httpOrigin,
          }),
        );
        readyWritten = true;
        break;
      }

      consumeControl();
      if (event.kind === "control-error") {
        await disconnectedCleanup();
        throw stableSessionFailure();
      }
      if (event.kind === "control-done") {
        const cleaned = await disconnectedCleanup();
        return result(
          cleaned
            ? WebHostControlSessionResultCode.controlDisconnected
            : WebHostControlSessionResultCode.shutdownFailed,
        );
      }
      if (event.kind === "control-invalid") {
        return interruptForInvalidControl(WebHostStartupErrorCode.invalidControlFrame);
      }

      const frame = parseWebHostControlInputFrame(event.record);
      if (!frame) {
        return interruptForInvalidControl(webHostControlInputErrorCode(event.record));
      }
      if (frame.type === "start") {
        return interruptForInvalidControl(WebHostStartupErrorCode.invalidControlFrame);
      }

      const cleaned = await awaitCleanup({
        reason: frame.reason,
        deadlineMs: frame.deadlineMs,
      });
      if (!cleaned) return result(WebHostControlSessionResultCode.shutdownFailed);
      await writeTerminal(createWebHostShutdownAckFrame());
      return result(WebHostControlSessionResultCode.shutdownAcknowledged);
    }

    while (true) {
      const pendingControl = nextControl();
      const event: ControlEvent | LifecycleAbortEvent = await Promise.race([
        pendingControl,
        lifecycleAbort,
      ]);
      if (event.kind === "lifecycle-abort") {
        const cleaned = await disconnectedCleanup();
        return result(
          cleaned
            ? WebHostControlSessionResultCode.controlDisconnected
            : WebHostControlSessionResultCode.shutdownFailed,
        );
      }

      consumeControl();
      if (event.kind === "control-error") {
        await disconnectedCleanup();
        throw stableSessionFailure();
      }
      if (event.kind === "control-done") {
        const cleaned = await disconnectedCleanup();
        return result(
          cleaned
            ? WebHostControlSessionResultCode.controlDisconnected
            : WebHostControlSessionResultCode.shutdownFailed,
        );
      }
      if (event.kind === "control-invalid") {
        const cleaned = await disconnectedCleanup();
        return result(
          cleaned
            ? WebHostControlSessionResultCode.invalidControl
            : WebHostControlSessionResultCode.shutdownFailed,
        );
      }

      const frame = parseWebHostControlInputFrame(event.record);
      if (!frame || frame.type !== "shutdown") {
        const cleaned = await disconnectedCleanup();
        return result(
          cleaned
            ? WebHostControlSessionResultCode.invalidControl
            : WebHostControlSessionResultCode.shutdownFailed,
        );
      }

      const cleaned = await awaitCleanup({
        reason: frame.reason,
        deadlineMs: frame.deadlineMs,
      });
      if (!cleaned) return result(WebHostControlSessionResultCode.shutdownFailed);
      await writeTerminal(createWebHostShutdownAckFrame());
      return result(WebHostControlSessionResultCode.shutdownAcknowledged);
    }
  } catch {
    await disconnectedCleanup();
    throw stableSessionFailure();
  } finally {
    lifecycleSignal.removeEventListener("abort", onLifecycleAbort);
    try {
      void Promise.resolve(iterator.return?.()).catch(() => undefined);
    } catch {
      // The control channel is already terminal; iterator cleanup is best effort.
    }
  }
}
