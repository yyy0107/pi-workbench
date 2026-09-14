import {
  parseRemoteCursor,
  parseRemoteEventV1,
  parseRemoteSnapshotChunkV1,
} from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteCursor,
  RemoteEventV1,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";
import { classifyRemoteCursor } from "@workbench/remote-control-client/cursor";

export interface MobileProjectionPersistenceValue {
  readonly sessions: readonly RemoteSessionSummaryV1[];
  readonly cursor: RemoteCursor;
  readonly stale: boolean;
}

export interface MobileProjectionPersistencePort {
  load(machineId: string): Promise<MobileProjectionPersistenceValue | undefined>;
  replace(machineId: string, value: MobileProjectionPersistenceValue): Promise<void>;
  markStale(machineId: string): Promise<void>;
}

function validateSnapshot(sessions: readonly RemoteSessionSummaryV1[], cursor: RemoteCursor): void {
  if (
    !parseRemoteCursor(cursor) ||
    !parseRemoteSnapshotChunkV1({
      type: "snapshot.chunk",
      snapshotId: "mobile-validation",
      partIndex: 0,
      partCount: 1,
      sessions,
    })
  ) {
    throw new Error("snapshot_required");
  }
}

function applyEvent(sessions: Map<string, RemoteSessionSummaryV1>, event: RemoteEventV1): void {
  const payload = event.payload;
  if (payload.type === "session.upserted") sessions.set(payload.session.sessionId, payload.session);
  else if (payload.type === "session.removed") sessions.delete(payload.sessionId);
  else if (payload.type === "session.runChanged") {
    const current = sessions.get(payload.sessionId);
    if (current) sessions.set(payload.sessionId, { ...current, runState: payload.runState });
  }
}

export function createMobileProjectionStore(options: {
  readonly persistence: MobileProjectionPersistencePort;
}) {
  return {
    load: (machineId: string) => options.persistence.load(machineId),
    async replaceSnapshot(
      machineId: string,
      sessions: readonly RemoteSessionSummaryV1[],
      cursor: RemoteCursor,
    ): Promise<void> {
      validateSnapshot(sessions, cursor);
      await options.persistence.replace(machineId, {
        sessions: Object.freeze([...sessions]),
        cursor: Object.freeze({ ...cursor }),
        stale: false,
      });
    },
    async applyEvents(machineId: string, events: readonly RemoteEventV1[]): Promise<void> {
      const current = await options.persistence.load(machineId);
      if (!current) throw new Error("snapshot_required");
      let cursor = current.cursor;
      const sessions = new Map(current.sessions.map((session) => [session.sessionId, session]));
      let changed = false;
      for (const value of events) {
        const event = parseRemoteEventV1(value);
        if (!event) throw new Error("sync_event_invalid");
        const relation = classifyRemoteCursor(cursor, event.cursor);
        if (relation === "duplicate") continue;
        if (relation !== "exact-next") throw new Error("snapshot_required");
        applyEvent(sessions, event);
        cursor = event.cursor;
        changed = true;
      }
      if (!changed) return;
      const nextSessions = [...sessions.values()].filter(({ archived }) => !archived).slice(0, 200);
      validateSnapshot(nextSessions, cursor);
      await options.persistence.replace(machineId, {
        sessions: Object.freeze(nextSessions),
        cursor,
        stale: false,
      });
    },
    markStale: (machineId: string) => options.persistence.markStale(machineId),
  };
}
