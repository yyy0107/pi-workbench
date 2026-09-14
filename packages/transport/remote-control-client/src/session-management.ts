import {
  parseRemoteOperationResultV1,
  remoteUtf8ByteLength,
} from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteRunStateV1,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";

import {
  createSessionArchiveOperation,
  createSessionCreateOperation,
  createSessionPinnedOperation,
  createSessionRenameOperation,
  type MobileRemoteOperation,
} from "./operations.ts";

const IDENTIFIER = /^[\x21-\x7e]{1,128}$/u;
const MAXIMUM_SESSIONS = 200;

export interface MobileRemoteSessionLocalState {
  readonly draft: string;
  readonly readMarker?: string;
  readonly unread: boolean;
  readonly runState: RemoteRunStateV1;
}

export interface MobileRemoteSessionConflict {
  readonly sessionId: string;
  readonly operationId: string;
}

export interface MobileRemoteSessionManagementSnapshot {
  readonly machineId: string;
  readonly items: readonly RemoteSessionSummaryV1[];
  readonly activeSessionId?: string;
  readonly localBySession: Readonly<Record<string, MobileRemoteSessionLocalState>>;
  readonly operations: readonly MobileRemoteOperation[];
  readonly conflict?: MobileRemoteSessionConflict;
}

function validSummary(value: RemoteSessionSummaryV1): boolean {
  return (
    IDENTIFIER.test(value.sessionId) &&
    IDENTIFIER.test(value.entityRevision) &&
    (value.title === undefined ||
      (value.title.length > 0 && remoteUtf8ByteLength(value.title) <= 512)) &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    value.updatedAt.endsWith("Z") &&
    typeof value.pinned === "boolean" &&
    typeof value.archived === "boolean"
  );
}

function compareSessions(left: RemoteSessionSummaryV1, right: RemoteSessionSummaryV1): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  const activity = right.updatedAt.localeCompare(left.updatedAt);
  return activity === 0 ? left.sessionId.localeCompare(right.sessionId) : activity;
}

function defaultLocal(summary: RemoteSessionSummaryV1): MobileRemoteSessionLocalState {
  return {
    draft: "",
    unread: summary.attention !== "none",
    runState: summary.runState,
  };
}

export function createRemoteSessionManagementState(input: { readonly machineId: string }) {
  let items: readonly RemoteSessionSummaryV1[] = Object.freeze([]);
  let activeSessionId: string | undefined;
  const local = new Map<string, MobileRemoteSessionLocalState>();
  let operations: readonly MobileRemoteOperation[] = Object.freeze([]);
  let conflict: MobileRemoteSessionConflict | undefined;

  const session = (sessionId: string): RemoteSessionSummaryV1 => {
    const value = items.find((candidate) => candidate.sessionId === sessionId);
    if (!value) throw new Error("session_not_found");
    return value;
  };

  const updateLocal = (
    sessionId: string,
    update: (current: MobileRemoteSessionLocalState) => MobileRemoteSessionLocalState,
  ) => {
    const current = local.get(sessionId) ?? defaultLocal(session(sessionId));
    local.set(sessionId, Object.freeze(update(current)));
  };

  const track = (operation: MobileRemoteOperation): MobileRemoteOperation => {
    if (operations.some(({ operationId }) => operationId === operation.operationId)) {
      throw new Error("operation_id_conflict");
    }
    operations = Object.freeze([...operations, operation]);
    return operation;
  };

  const revision = (sessionId: string) => session(sessionId).entityRevision;

  const snapshot = (): MobileRemoteSessionManagementSnapshot => {
    const localBySession: Record<string, MobileRemoteSessionLocalState> = {};
    for (const [sessionId, value] of local) localBySession[sessionId] = value;
    return Object.freeze({
      machineId: input.machineId,
      items,
      ...(activeSessionId === undefined ? {} : { activeSessionId }),
      localBySession: Object.freeze(localBySession),
      operations,
      ...(conflict === undefined ? {} : { conflict }),
    });
  };

  return {
    snapshot,
    replaceCatalog(values: readonly RemoteSessionSummaryV1[]): void {
      if (
        values.length > MAXIMUM_SESSIONS ||
        values.some((value) => !validSummary(value)) ||
        new Set(values.map(({ sessionId }) => sessionId)).size !== values.length
      ) {
        throw new Error("session_catalog_invalid");
      }
      items = Object.freeze(
        values
          .filter(({ archived }) => !archived)
          .map((value) => Object.freeze({ ...value }))
          .sort(compareSessions),
      );
      for (const value of items) {
        const current = local.get(value.sessionId) ?? defaultLocal(value);
        local.set(
          value.sessionId,
          Object.freeze({
            ...current,
            unread: value.sessionId === activeSessionId ? false : value.attention !== "none",
            runState: value.runState,
          }),
        );
      }
      operations = Object.freeze(
        operations.filter((operation) => {
          const result = operation.result;
          if (result?.state !== "succeeded" || !result.value) return true;
          const resultValue = result.value;
          if (resultValue.type === "session-created") {
            return !items.some(({ sessionId }) => sessionId === resultValue.sessionId);
          }
          if (resultValue.type === "session-state") {
            return !items.some(
              ({ sessionId, entityRevision }) =>
                sessionId === resultValue.sessionId &&
                entityRevision === resultValue.entityRevision,
            );
          }
          return true;
        }),
      );
    },
    open(sessionId: string): void {
      session(sessionId);
      activeSessionId = sessionId;
      updateLocal(sessionId, (current) => ({ ...current, unread: false }));
    },
    setDraft(sessionId: string, draft: string): void {
      if (remoteUtf8ByteLength(draft) > 64 * 1024) throw new Error("draft_too_large");
      updateLocal(sessionId, (current) => ({ ...current, draft }));
    },
    setReadMarker(sessionId: string, readMarker: string): void {
      if (!IDENTIFIER.test(readMarker)) throw new Error("read_marker_invalid");
      updateLocal(sessionId, (current) => ({ ...current, readMarker, unread: false }));
    },
    prepareCreate(value: Parameters<typeof createSessionCreateOperation>[0]) {
      return track(createSessionCreateOperation(value));
    },
    prepareRename(
      value: Omit<Parameters<typeof createSessionRenameOperation>[0], "expectedEntityRevision">,
    ) {
      return track(
        createSessionRenameOperation({
          ...value,
          expectedEntityRevision: revision(value.sessionId),
        }),
      );
    },
    prepareSetPinned(
      value: Omit<Parameters<typeof createSessionPinnedOperation>[0], "expectedEntityRevision">,
    ) {
      return track(
        createSessionPinnedOperation({
          ...value,
          expectedEntityRevision: revision(value.sessionId),
        }),
      );
    },
    prepareArchive(
      value: Omit<Parameters<typeof createSessionArchiveOperation>[0], "expectedEntityRevision">,
    ) {
      return track(
        createSessionArchiveOperation({
          ...value,
          expectedEntityRevision: revision(value.sessionId),
        }),
      );
    },
    applyOperationResult(value: unknown): void {
      const result = parseRemoteOperationResultV1(value);
      if (!result) throw new Error("operation_result_invalid");
      const operation = operations.find(({ operationId }) => operationId === result.operationId);
      if (!operation) return;
      if (result.state === "accepted") {
        operations = Object.freeze(
          operations.map((current) =>
            current.operationId === result.operationId
              ? { ...current, status: "accepted" as const, result }
              : current,
          ),
        );
        return;
      }
      if (result.code === "entity_revision_conflict" && "sessionId" in operation.request.command) {
        conflict = Object.freeze({
          sessionId: operation.request.command.sessionId,
          operationId: operation.operationId,
        });
      }
      if (result.state === "succeeded" && result.value) {
        operations = Object.freeze(
          operations.map((current) =>
            current.operationId === result.operationId
              ? {
                  ...current,
                  status: "awaiting-projection" as const,
                  result,
                  ...(result.appliedCursor === undefined
                    ? {}
                    : { appliedCursor: result.appliedCursor }),
                }
              : current,
          ),
        );
        return;
      }
      operations = Object.freeze(
        operations.filter(({ operationId }) => operationId !== result.operationId),
      );
    },
  };
}
