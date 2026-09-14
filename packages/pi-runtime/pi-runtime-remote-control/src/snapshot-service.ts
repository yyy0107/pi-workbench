import {
  parseRemoteEventV1,
  parseRemoteSnapshotChunkV1,
  parseRemoteSnapshotCompleteV1,
  remoteUtf8ByteLength,
} from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteCursor,
  RemoteEventV1,
  RemoteSessionSummaryV1,
  RemoteSnapshotChunkV1,
  RemoteSnapshotCompleteV1,
} from "@workbench/remote-control-contracts/protocol";

const MAXIMUM_CHUNK_SESSIONS = 50;
const MAXIMUM_CHUNK_BYTES = 192 * 1024;

function chunks(snapshotId: string, sessions: readonly RemoteSessionSummaryV1[]) {
  const groups: RemoteSessionSummaryV1[][] = [];
  let current: RemoteSessionSummaryV1[] = [];
  for (const session of sessions.slice(0, 200)) {
    const candidate = [...current, session];
    const probe = {
      type: "snapshot.chunk",
      snapshotId,
      partIndex: 0,
      partCount: 1,
      sessions: candidate,
    } as const;
    if (
      current.length > 0 &&
      (candidate.length > MAXIMUM_CHUNK_SESSIONS ||
        remoteUtf8ByteLength(JSON.stringify(probe)) > MAXIMUM_CHUNK_BYTES)
    ) {
      groups.push(current);
      current = [session];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0 || groups.length === 0) groups.push(current);
  return Object.freeze(
    groups.map((items, partIndex) => {
      const value: RemoteSnapshotChunkV1 = {
        type: "snapshot.chunk",
        snapshotId,
        partIndex,
        partCount: groups.length,
        sessions: Object.freeze(items),
      };
      if (!parseRemoteSnapshotChunkV1(value)) throw new Error("snapshot_required");
      return Object.freeze(value);
    }),
  );
}

export function createRemoteSnapshotService(options: {
  readonly id: () => string;
  readonly currentCursor: () => RemoteCursor;
  readonly readSessions: () => Promise<readonly RemoteSessionSummaryV1[]>;
  readonly maximumBufferedEvents?: number;
  readonly maximumBufferedBytes?: number;
}) {
  const maximumBufferedEvents = options.maximumBufferedEvents ?? 1_000;
  const maximumBufferedBytes = options.maximumBufferedBytes ?? 1024 * 1024;
  let active: { readonly events: RemoteEventV1[]; bytes: number; overflowed: boolean } | undefined;

  return {
    buffer(event: RemoteEventV1): void {
      if (!active) return;
      const parsed = parseRemoteEventV1(event);
      if (!parsed) {
        active.overflowed = true;
        return;
      }
      const bytes = remoteUtf8ByteLength(JSON.stringify(parsed));
      active.events.push(parsed);
      active.bytes += bytes;
      if (active.events.length > maximumBufferedEvents || active.bytes > maximumBufferedBytes) {
        active.overflowed = true;
      }
    },
    async create() {
      if (active) throw new Error("snapshot_required");
      const baseCursor = options.currentCursor();
      const snapshotId = options.id();
      const pending = { events: [] as RemoteEventV1[], bytes: 0, overflowed: false };
      active = pending;
      try {
        const sessions = await options.readSessions();
        if (pending.overflowed) throw new Error("snapshot_required");
        const complete: RemoteSnapshotCompleteV1 = {
          type: "snapshot.complete",
          snapshotId,
          baseCursor,
        };
        if (!parseRemoteSnapshotCompleteV1(complete)) throw new Error("snapshot_required");
        return Object.freeze({
          chunks: chunks(snapshotId, sessions),
          complete: Object.freeze(complete),
          replay: Object.freeze([...pending.events]),
        });
      } finally {
        if (active === pending) active = undefined;
      }
    },
  };
}
