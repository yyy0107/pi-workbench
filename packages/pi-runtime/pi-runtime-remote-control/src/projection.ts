import type {
  RemoteEventPayloadV1,
  RemoteRunStateV1,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";

import { createRemoteEventRing } from "../lib/event-ring.ts";

function compareSessions(left: RemoteSessionSummaryV1, right: RemoteSessionSummaryV1): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  const recent = right.updatedAt.localeCompare(left.updatedAt);
  return recent === 0 ? left.sessionId.localeCompare(right.sessionId) : recent;
}

export function createRemoteProjection(options: {
  readonly epoch: string;
  readonly clock: { now(): Date };
  readonly id: () => string;
}) {
  const ring = createRemoteEventRing(options);
  const sessions = new Map<string, RemoteSessionSummaryV1>();

  const commit = (payload: RemoteEventPayloadV1, effect: () => void) => {
    const event = ring.append(payload);
    effect();
    return event;
  };

  return {
    currentCursor: ring.currentCursor,
    replayAfter: ring.replayAfter,
    appendEvent(payload: RemoteEventPayloadV1) {
      return ring.append(payload);
    },
    upsertSession(session: RemoteSessionSummaryV1) {
      return commit({ type: "session.upserted", session }, () => {
        sessions.set(session.sessionId, Object.freeze({ ...session }));
      });
    },
    removeSession(sessionId: string) {
      return commit({ type: "session.removed", sessionId }, () => {
        sessions.delete(sessionId);
      });
    },
    changeRunState(sessionId: string, runState: RemoteRunStateV1) {
      const current = sessions.get(sessionId);
      if (!current) throw new Error("session_not_found");
      return commit({ type: "session.runChanged", sessionId, runState }, () => {
        sessions.set(sessionId, Object.freeze({ ...current, runState }));
      });
    },
    replaceSnapshot(values: readonly RemoteSessionSummaryV1[]): void {
      const replacement = new Map(
        values.map((value) => [value.sessionId, Object.freeze({ ...value })]),
      );
      sessions.clear();
      for (const [sessionId, value] of replacement) sessions.set(sessionId, value);
    },
    snapshot() {
      return Object.freeze({
        sessions: Object.freeze(
          [...sessions.values()]
            .filter(({ archived }) => !archived)
            .sort(compareSessions)
            .slice(0, 200),
        ),
        cursor: ring.currentCursor(),
      });
    },
  };
}
