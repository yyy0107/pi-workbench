import {
  parseRemoteCursor,
  parseRemoteEventV1,
  parseRemoteSnapshotChunkV1,
  parseRemoteSnapshotCompleteV1,
} from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteCursor,
  RemoteEventV1,
  RemoteSessionSummaryV1,
  RemoteSnapshotChunkV1,
  RemoteSnapshotCompleteV1,
} from "@workbench/remote-control-contracts/protocol";

import { classifyRemoteCursor } from "./cursor.ts";

export interface RemoteSynchronizationProjectionPort {
  applyEvent(event: RemoteEventV1): Promise<void>;
  replaceSnapshot(sessions: readonly RemoteSessionSummaryV1[], cursor: RemoteCursor): Promise<void>;
}

export function createRemoteSynchronizationState(options: {
  readonly initialCursor?: RemoteCursor;
  readonly projection: RemoteSynchronizationProjectionPort;
}) {
  let cursor = options.initialCursor;
  if (cursor && !parseRemoteCursor(cursor)) throw new Error("cursor_invalid");
  let status: "replaying" | "snapshot" | "snapshot-required" | "ready" = cursor
    ? "replaying"
    : "snapshot-required";
  let assembly:
    | {
        readonly snapshotId: string;
        readonly partCount: number;
        readonly parts: Map<number, readonly RemoteSessionSummaryV1[]>;
      }
    | undefined;

  return {
    snapshot() {
      return Object.freeze({ status, ...(cursor ? { cursor } : {}) });
    },
    requireSnapshot(): void {
      status = "snapshot-required";
      assembly = undefined;
    },
    async receiveEvent(event: RemoteEventV1) {
      const parsed = parseRemoteEventV1(event);
      if (!parsed) throw new Error("sync_event_invalid");
      const relation = classifyRemoteCursor(cursor, parsed.cursor);
      if (relation === "duplicate") return Object.freeze({ kind: "duplicate" as const });
      if (relation === "gap" || relation === "epoch-changed") {
        status = "snapshot-required";
        assembly = undefined;
        return Object.freeze({ kind: "snapshot-required" as const, reason: relation });
      }
      await options.projection.applyEvent(parsed);
      cursor = parsed.cursor;
      status = "ready";
      return Object.freeze({ kind: "applied" as const, cursor });
    },
    receiveSnapshotChunk(chunk: RemoteSnapshotChunkV1): void {
      const parsed = parseRemoteSnapshotChunkV1(chunk);
      if (!parsed) throw new Error("snapshot_required");
      if (!assembly) {
        assembly = {
          snapshotId: parsed.snapshotId,
          partCount: parsed.partCount,
          parts: new Map(),
        };
      }
      if (assembly.snapshotId !== parsed.snapshotId || assembly.partCount !== parsed.partCount) {
        assembly = undefined;
        status = "snapshot-required";
        throw new Error("snapshot_required");
      }
      const existing = assembly.parts.get(parsed.partIndex);
      if (existing && JSON.stringify(existing) !== JSON.stringify(parsed.sessions)) {
        assembly = undefined;
        status = "snapshot-required";
        throw new Error("snapshot_required");
      }
      assembly.parts.set(parsed.partIndex, parsed.sessions);
      status = "snapshot";
    },
    async completeSnapshot(complete: RemoteSnapshotCompleteV1): Promise<void> {
      const parsed = parseRemoteSnapshotCompleteV1(complete);
      const current = assembly;
      if (
        !parsed ||
        !current ||
        current.snapshotId !== parsed.snapshotId ||
        current.parts.size !== current.partCount
      ) {
        assembly = undefined;
        status = "snapshot-required";
        throw new Error("snapshot_required");
      }
      const sessions = Array.from({ length: current.partCount }, (_, index) =>
        current.parts.get(index),
      ).flatMap((items) => items ?? []);
      if (sessions.length > 200) {
        assembly = undefined;
        status = "snapshot-required";
        throw new Error("snapshot_required");
      }
      await options.projection.replaceSnapshot(Object.freeze(sessions), parsed.baseCursor);
      cursor = parsed.baseCursor;
      assembly = undefined;
      status = "ready";
    },
  };
}
