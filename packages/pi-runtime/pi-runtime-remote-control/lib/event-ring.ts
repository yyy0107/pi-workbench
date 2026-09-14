import {
  parseRemoteCursor,
  parseRemoteEventV1,
  remoteUtf8ByteLength,
} from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteCursor,
  RemoteEventPayloadV1,
  RemoteEventV1,
} from "@workbench/remote-control-contracts/protocol";

const DEFAULT_MAXIMUM_EVENTS = 10_000;
const DEFAULT_MAXIMUM_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAXIMUM_AGE_MS = 15 * 60 * 1_000;
const MAXIMUM_UINT64 = BigInt("18446744073709551615");
const ONE = BigInt(1);

export type RemoteReplayResult =
  | {
      readonly kind: "events";
      readonly events: readonly RemoteEventV1[];
      readonly currentCursor: RemoteCursor;
    }
  | {
      readonly kind: "cursor-expired" | "cursor-gap" | "epoch-changed";
      readonly currentCursor: RemoteCursor;
    };

export function createRemoteEventRing(options: {
  readonly epoch: string;
  readonly clock: { now(): Date };
  readonly id: () => string;
  readonly initialOffset?: string;
  readonly maximumEvents?: number;
  readonly maximumBytes?: number;
  readonly maximumAgeMs?: number;
}) {
  const maximumEvents = options.maximumEvents ?? DEFAULT_MAXIMUM_EVENTS;
  const maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;
  const maximumAgeMs = options.maximumAgeMs ?? DEFAULT_MAXIMUM_AGE_MS;
  const initial = parseRemoteCursor({ epoch: options.epoch, offset: options.initialOffset ?? "0" });
  if (
    !initial ||
    !Number.isSafeInteger(maximumEvents) ||
    maximumEvents < 1 ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    !Number.isSafeInteger(maximumAgeMs) ||
    maximumAgeMs < 1
  ) {
    throw new Error("event_ring_configuration_invalid");
  }
  let offset = BigInt(initial.offset);
  let retainedBytes = 0;
  const entries: Array<{ readonly event: RemoteEventV1; readonly bytes: number }> = [];

  const cursor = (): RemoteCursor =>
    Object.freeze({ epoch: options.epoch, offset: offset.toString() });
  const removeOldest = () => {
    const removed = entries.shift();
    if (removed) retainedBytes -= removed.bytes;
  };
  const prune = (now: number) => {
    while (
      entries.length > 0 &&
      (entries.length > maximumEvents ||
        retainedBytes > maximumBytes ||
        now - Date.parse(entries[0]!.event.createdAt) > maximumAgeMs)
    ) {
      removeOldest();
    }
  };

  return {
    currentCursor: cursor,
    append(payload: RemoteEventPayloadV1): RemoteEventV1 {
      if (offset >= MAXIMUM_UINT64) throw new Error("cursor_exhausted");
      const createdAt = options.clock.now().toISOString();
      const event: RemoteEventV1 = {
        type: "sync.event",
        eventId: options.id(),
        cursor: { epoch: options.epoch, offset: (offset + ONE).toString() },
        createdAt,
        payload,
      };
      if (!parseRemoteEventV1(event)) throw new Error("projection_event_invalid");
      const bytes = remoteUtf8ByteLength(JSON.stringify(event));
      offset += ONE;
      entries.push({ event: Object.freeze(event), bytes });
      retainedBytes += bytes;
      prune(options.clock.now().getTime());
      return event;
    },
    replayAfter(
      requested: RemoteCursor,
    ): RemoteReplayResult & { readonly events?: readonly RemoteEventV1[] } {
      const parsed = parseRemoteCursor(requested);
      const currentCursor = cursor();
      if (!parsed || parsed.epoch !== options.epoch) {
        return Object.freeze({ kind: "epoch-changed" as const, currentCursor });
      }
      const requestedOffset = BigInt(parsed.offset);
      if (requestedOffset > offset) {
        return Object.freeze({ kind: "cursor-gap" as const, currentCursor });
      }
      const oldest = entries[0] ? BigInt(entries[0].event.cursor.offset) : offset + ONE;
      if (requestedOffset < oldest - ONE) {
        return Object.freeze({ kind: "cursor-expired" as const, currentCursor });
      }
      return Object.freeze({
        kind: "events" as const,
        events: Object.freeze(
          entries
            .filter(({ event }) => BigInt(event.cursor.offset) > requestedOffset)
            .map(({ event }) => event),
        ),
        currentCursor,
      });
    },
    snapshot() {
      return Object.freeze({
        events: Object.freeze(entries.map(({ event }) => event)),
        retainedBytes,
        currentCursor: cursor(),
      });
    },
  };
}
