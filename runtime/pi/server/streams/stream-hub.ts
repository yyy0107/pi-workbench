import { randomUUID } from "node:crypto";

import type { RpcError } from "@/runtime/pi/contracts/rpc";
import type {
  HostStreamPayload,
  MuxStreamPayload,
  ServerRequest,
  SessionMessageSnapshotPayload,
  StreamName,
  StreamPayloadMap,
} from "@/runtime/pi/contracts/stream";
import { createServerRequest } from "@/runtime/pi/contracts/stream";

export const STREAM_HUB_SYMBOL = Symbol.for("workbench-ui.pi.stream-hub.v1");
export const DEFAULT_MAX_BOOTSTRAP_BUFFER_FRAMES = 10_000;

export interface StreamFrameInput<Stream extends StreamName> {
  payload: StreamPayloadMap[Stream];
  rpcId?: string;
}

export interface StreamBootstrapContext<Stream extends StreamName> {
  stream: Stream;
  /** Internal hub watermark captured after the subscriber starts buffering. */
  watermark: number;
}

export type StreamBootstrap<Stream extends StreamName> = (
  context: StreamBootstrapContext<Stream>,
) => readonly StreamFrameInput<Stream>[] | Promise<readonly StreamFrameInput<Stream>[]>;

export interface StreamSubscriber<Stream extends StreamName> {
  onFrame(frame: ServerRequest<StreamPayloadMap[Stream]>): void;
  onError(error: RpcError): void;
}

export interface StreamSubscription {
  /** Resolves after bootstrap frames and all buffered post-watermark frames are delivered. */
  readonly ready: Promise<void>;
  close(): void;
}

export interface StreamSubscribeOptions<Stream extends StreamName> {
  bootstrap?: StreamBootstrap<Stream>;
  maxBufferedFrames?: number;
}

export interface StreamPublishOptions {
  /** Required for interactive requests when `/api/respond` must echo a pre-registered id. */
  rpcId?: string;
}

export interface StreamHub {
  publish<Stream extends StreamName>(
    stream: Stream,
    payload: StreamPayloadMap[Stream],
    options?: StreamPublishOptions,
  ): ServerRequest<StreamPayloadMap[Stream]>;
  publishMux(
    payload: MuxStreamPayload,
    options?: StreamPublishOptions,
  ): ServerRequest<MuxStreamPayload>;
  publishHost(
    payload: HostStreamPayload,
    options?: StreamPublishOptions,
  ): ServerRequest<HostStreamPayload>;
  /** Retains one immutable active assistant view; callers replace rather than mutate it. */
  setSessionMessageSnapshot(payload: SessionMessageSnapshotPayload): void;
  /** Clears only the expected generation when `streamId` is provided. */
  clearSessionMessageSnapshot(sessionId: string, streamId?: string): void;
  subscribe<Stream extends StreamName>(
    stream: Stream,
    subscriber: StreamSubscriber<Stream>,
    options?: StreamSubscribeOptions<Stream>,
  ): StreamSubscription;
  fail(stream: StreamName, error: unknown): void;
  watermark(stream: StreamName): number;
}

export interface StreamHubOptions {
  createRpcId?: () => string;
  maxBootstrapBufferFrames?: number;
}

interface StreamRecord<Stream extends StreamName> {
  watermark: number;
  frame: ServerRequest<StreamPayloadMap[Stream]>;
}

interface InternalSubscriber<Stream extends StreamName> {
  stream: Stream;
  listener: StreamSubscriber<Stream>;
  capturedWatermark: number;
  buffered: StreamRecord<Stream>[];
  maxBufferedFrames: number;
  buffering: boolean;
  closed: boolean;
}

interface StreamState<Stream extends StreamName> {
  watermark: number;
  subscribers: Set<InternalSubscriber<Stream>>;
}

const MUX_TYPES = new Set<string>([
  "session/event",
  "session/message-snapshot",
  "session/message-update",
  "session/subscribed",
  "session/prompt-accepted",
  "approval/requested",
  "approval/resolved",
  "question/requested",
  "question/resolved",
  "session/queue",
  "session/jobs",
  "session/projection",
  "session/context-trace",
  "stream/error",
]);

const HOST_TYPES = new Set<string>([
  "host/session-added",
  "host/session-changed",
  "host/session-removed",
  "host/session-status",
  "host/session-interaction-status",
  "host/agent-error",
  "host/workspace-changed",
  "host/workspace-removed",
  "host/workspace-order-changed",
  "host/workspace-pinned-changed",
  "host/session-archive-changed",
  "host/session-pinned-changed",
  "host/remote-event",
  "stream/error",
]);

function isPayloadForStream(stream: StreamName, payload: { type: string }): boolean {
  return (stream === "mux" ? MUX_TYPES : HOST_TYPES).has(payload.type);
}

function diagnosticMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The event stream failed.";
}

export function toStreamRpcError(error: unknown): RpcError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string" &&
    "details" in error &&
    typeof error.details === "object" &&
    error.details !== null &&
    !Array.isArray(error.details)
  ) {
    return {
      code: error.code,
      message: error.message,
      details: { ...(error.details as Record<string, unknown>) },
    };
  }

  return { code: "internal", message: diagnosticMessage(error), details: {} };
}

function plainJsonClone<Value>(value: Value): Value {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Stream frames must be JSON serializable.");
  return JSON.parse(serialized) as Value;
}

function assertStreamPayload(stream: StreamName, payload: { type: string }): void {
  if (!isPayloadForStream(stream, payload)) {
    throw new TypeError(
      `Payload type ${JSON.stringify(payload.type)} does not belong to ${stream}.`,
    );
  }
}

export function createStreamHub(options: StreamHubOptions = {}): StreamHub {
  const createRpcId = options.createRpcId ?? randomUUID;
  const defaultBufferLimit =
    options.maxBootstrapBufferFrames ?? DEFAULT_MAX_BOOTSTRAP_BUFFER_FRAMES;
  if (!Number.isInteger(defaultBufferLimit) || defaultBufferLimit < 1) {
    throw new RangeError("maxBootstrapBufferFrames must be a positive integer.");
  }

  const states: { [Stream in StreamName]: StreamState<Stream> } = {
    mux: { watermark: 0, subscribers: new Set() },
    host: { watermark: 0, subscribers: new Set() },
  };
  const sessionWatermarks = new Map<string, number>();
  const retainedSessionMessageSnapshots = new Map<string, SessionMessageSnapshotPayload>();
  const retainedSessionQueues = new Map<string, ServerRequest<MuxStreamPayload>>();
  const retainedMuxRequests = new Map<string, ServerRequest<MuxStreamPayload>>();

  const closeSubscriber = <Stream extends StreamName>(
    subscriber: InternalSubscriber<Stream>,
  ): void => {
    if (subscriber.closed) return;
    subscriber.closed = true;
    subscriber.buffered.length = 0;
    states[subscriber.stream].subscribers.delete(subscriber as never);
  };

  const failSubscriber = <Stream extends StreamName>(
    subscriber: InternalSubscriber<Stream>,
    error: unknown,
  ): void => {
    if (subscriber.closed) return;
    let rpcError: RpcError;
    try {
      rpcError = plainJsonClone(toStreamRpcError(error));
    } catch {
      rpcError = {
        code: "internal",
        message: "The stream error was not JSON serializable.",
        details: {},
      };
    }
    closeSubscriber(subscriber);
    try {
      subscriber.listener.onError(rpcError);
    } catch {
      // A broken transport must not poison the shared hub.
    }
  };

  const deliver = <Stream extends StreamName>(
    subscriber: InternalSubscriber<Stream>,
    frame: ServerRequest<StreamPayloadMap[Stream]>,
  ): void => {
    if (subscriber.closed) return;
    try {
      subscriber.listener.onFrame(frame);
    } catch (error) {
      failSubscriber(subscriber, error);
    }
  };

  const makeFrame = <Stream extends StreamName>(
    stream: Stream,
    input: StreamFrameInput<Stream>,
  ): ServerRequest<StreamPayloadMap[Stream]> => {
    assertStreamPayload(stream, input.payload);
    return plainJsonClone(createServerRequest(input.rpcId ?? createRpcId(), input.payload));
  };

  const publish = <Stream extends StreamName>(
    stream: Stream,
    payload: StreamPayloadMap[Stream],
    publishOptions: StreamPublishOptions = {},
  ): ServerRequest<StreamPayloadMap[Stream]> => {
    let frame: ServerRequest<StreamPayloadMap[Stream]>;
    try {
      frame = makeFrame(stream, { payload, rpcId: publishOptions.rpcId });
    } catch (error) {
      hub.fail(stream, error);
      throw error;
    }

    const state = states[stream];
    if (stream === "mux") {
      const muxPayload = payload as MuxStreamPayload;
      if (muxPayload.type === "session/subscribed") {
        sessionWatermarks.set(muxPayload.sessionId, muxPayload.lastSeq);
        retainedSessionMessageSnapshots.delete(muxPayload.sessionId);
      } else if (muxPayload.type === "session/event") {
        sessionWatermarks.set(
          muxPayload.sessionId,
          Math.max(sessionWatermarks.get(muxPayload.sessionId) ?? -1, muxPayload.event.seq),
        );
      } else if (muxPayload.type === "session/queue") {
        retainedSessionQueues.set(
          muxPayload.sessionId,
          plainJsonClone(frame as ServerRequest<MuxStreamPayload>),
        );
      } else if (
        muxPayload.type === "question/requested" ||
        muxPayload.type === "approval/requested"
      ) {
        retainedMuxRequests.set(
          frame.rpcId,
          plainJsonClone(frame as ServerRequest<MuxStreamPayload>),
        );
      } else if (muxPayload.type === "question/resolved") {
        retainedMuxRequests.delete(muxPayload.questionRpcId);
      } else if (muxPayload.type === "approval/resolved") {
        for (const [rpcId, retained] of retainedMuxRequests) {
          if (
            retained.payload.type === "approval/requested" &&
            retained.payload.sessionId === muxPayload.sessionId &&
            retained.payload.approvalId === muxPayload.approvalId
          ) {
            retainedMuxRequests.delete(rpcId);
          }
        }
      }
    } else {
      const hostPayload = payload as HostStreamPayload;
      if (hostPayload.type === "host/session-removed") {
        sessionWatermarks.delete(hostPayload.sessionId);
        retainedSessionMessageSnapshots.delete(hostPayload.sessionId);
        retainedSessionQueues.delete(hostPayload.sessionId);
      }
    }
    const record = { watermark: ++state.watermark, frame };
    // Snapshotting prevents listeners added reentrantly from receiving a pre-subscription frame.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const rawSubscriber of [...state.subscribers]) {
      const subscriber = rawSubscriber as InternalSubscriber<Stream>;
      if (subscriber.closed) continue;
      if (subscriber.buffering) {
        if (subscriber.buffered.length >= subscriber.maxBufferedFrames) {
          failSubscriber(subscriber, new Error("Stream bootstrap buffer limit exceeded."));
        } else {
          subscriber.buffered.push(record);
        }
      } else {
        deliver(subscriber, frame);
      }
    }
    return frame;
  };

  const subscribe = <Stream extends StreamName>(
    stream: Stream,
    listener: StreamSubscriber<Stream>,
    subscribeOptions: StreamSubscribeOptions<Stream> = {},
  ): StreamSubscription => {
    const state = states[stream];
    const maxBufferedFrames = subscribeOptions.maxBufferedFrames ?? defaultBufferLimit;
    if (!Number.isInteger(maxBufferedFrames) || maxBufferedFrames < 1) {
      throw new RangeError("maxBufferedFrames must be a positive integer.");
    }

    const subscriber: InternalSubscriber<Stream> = {
      stream,
      listener,
      capturedWatermark: state.watermark,
      buffered: [],
      maxBufferedFrames,
      buffering: true,
      closed: false,
    };
    state.subscribers.add(subscriber);
    const retainedSessions =
      stream === "mux"
        ? [...sessionWatermarks.entries()].map(([sessionId, lastSeq]) => ({
            payload: {
              type: "session/subscribed" as const,
              sessionId,
              lastSeq,
            },
          }))
        : [];
    const retainedInteractions =
      stream === "mux"
        ? [...retainedMuxRequests.values()].map((frame) => ({
            rpcId: frame.rpcId,
            payload: frame.payload,
          }))
        : [];
    // Capture the active-message cut synchronously with `capturedWatermark`. Any later delta is
    // already buffered by this subscriber, so snapshot revision de-duplication is sufficient.
    const retainedMessageSnapshots =
      stream === "mux"
        ? [...retainedSessionMessageSnapshots.values()].map((payload) => ({
            payload: plainJsonClone(payload),
          }))
        : [];
    const retainedQueues =
      stream === "mux"
        ? [...retainedSessionQueues.values()].map((frame) => ({
            rpcId: frame.rpcId,
            payload: frame.payload,
          }))
        : [];

    const ready = Promise.resolve()
      .then(async () => {
        const customBootstrap = await subscribeOptions.bootstrap?.({
          stream,
          watermark: subscriber.capturedWatermark,
        });
        const inputs = [
          ...(customBootstrap ??
            (retainedSessions as unknown as readonly StreamFrameInput<Stream>[])),
          ...(retainedMessageSnapshots as unknown as readonly StreamFrameInput<Stream>[]),
          ...(retainedQueues as unknown as readonly StreamFrameInput<Stream>[]),
          ...(retainedInteractions as unknown as readonly StreamFrameInput<Stream>[]),
        ];
        const bootstrapFrames = inputs.map((input) => makeFrame(stream, input));

        for (const frame of bootstrapFrames) {
          deliver(subscriber, frame);
          if (subscriber.closed) return;
        }

        while (!subscriber.closed && subscriber.buffered.length > 0) {
          const record = subscriber.buffered.shift();
          if (record && record.watermark > subscriber.capturedWatermark) {
            deliver(subscriber, record.frame);
          }
        }
        subscriber.buffering = false;
      })
      .catch((error: unknown) => failSubscriber(subscriber, error));

    return {
      ready,
      close: () => closeSubscriber(subscriber),
    };
  };

  const hub: StreamHub = {
    publish,
    publishMux: (payload, publishOptions) => publish("mux", payload, publishOptions),
    publishHost: (payload, publishOptions) => publish("host", payload, publishOptions),
    setSessionMessageSnapshot(payload) {
      retainedSessionMessageSnapshots.set(payload.sessionId, payload);
    },
    clearSessionMessageSnapshot(sessionId, streamId) {
      const retained = retainedSessionMessageSnapshots.get(sessionId);
      if (!retained || (streamId !== undefined && retained.streamId !== streamId)) return;
      retainedSessionMessageSnapshots.delete(sessionId);
    },
    subscribe,
    fail(stream, error) {
      const state = states[stream] as StreamState<StreamName>;
      // Snapshotting prevents an onError callback from failing a replacement subscription.
      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const subscriber of [...state.subscribers]) failSubscriber(subscriber, error);
    },
    watermark: (stream) => states[stream].watermark,
  };

  return hub;
}

interface StreamHubGlobalRegistry {
  [key: symbol]: unknown;
}

export function getStreamHub(): StreamHub {
  const registry = globalThis as typeof globalThis & StreamHubGlobalRegistry;
  const existing = registry[STREAM_HUB_SYMBOL];
  if (existing) return existing as StreamHub;

  const hub = createStreamHub();
  registry[STREAM_HUB_SYMBOL] = hub;
  return hub;
}
