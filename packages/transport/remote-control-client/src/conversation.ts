import {
  parseRemoteConversationPageV1,
  parseRemoteOperationRequestV1,
  parseRemoteOperationResultV1,
  REMOTE_PROTOCOL_LIMITS,
  remoteUtf8ByteLength,
} from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteConversationItemV1,
  RemoteConversationPageV1,
  RemoteCursor,
  RemoteOperationResultV1,
} from "@workbench/remote-control-contracts/protocol";

import {
  cursorIncludes,
  mergeRemoteConversationItems,
  newestCursor,
} from "../lib/bounded-pages.ts";
import { createTextSendOperation, type MobileRemoteOperation } from "./operations.ts";

export interface MobileRemoteConversationSnapshot {
  readonly machineId: string;
  readonly sessionId: string;
  readonly ready: boolean;
  readonly draft: string;
  readonly items: readonly RemoteConversationItemV1[];
  readonly nextHistoryCursor?: string;
  readonly sessionRevision?: string;
  readonly projectionCursor?: RemoteCursor;
  readonly operations: readonly MobileRemoteOperation[];
}

function streamTimestamp(items: readonly RemoteConversationItemV1[]): string {
  let latest = 0;
  for (const item of items) {
    if (item.type === "ordinary-question") continue;
    latest = Math.max(latest, Date.parse(item.createdAt));
  }
  return new Date(Math.max(0, latest) + 1).toISOString();
}

function appendBoundedAssistantText(current: string, delta: string) {
  const value = `${current}${delta}`;
  if (remoteUtf8ByteLength(value) <= REMOTE_PROTOCOL_LIMITS.assistantTextBytes) {
    return { value, truncated: false } as const;
  }
  const characters: string[] = [];
  let usedBytes = 0;
  for (const character of value) {
    const characterBytes = remoteUtf8ByteLength(character);
    if (usedBytes + characterBytes > REMOTE_PROTOCOL_LIMITS.assistantTextBytes) break;
    characters.push(character);
    usedBytes += characterBytes;
  }
  return { value: characters.join(""), truncated: true } as const;
}

export function createRemoteConversationState(input: {
  readonly machineId: string;
  readonly sessionId: string;
}) {
  let ready = false;
  let draft = "";
  let items: readonly RemoteConversationItemV1[] = Object.freeze([]);
  let nextHistoryCursor: string | undefined;
  let sessionRevision: string | undefined;
  let projectionCursor: RemoteCursor | undefined;
  let operations: readonly MobileRemoteOperation[] = Object.freeze([]);
  const loadedHistoryCursors = new Set<string>();
  const streamRevisions = new Map<string, Set<string>>();

  const snapshot = (): MobileRemoteConversationSnapshot =>
    Object.freeze({
      machineId: input.machineId,
      sessionId: input.sessionId,
      ready,
      draft,
      items,
      ...(nextHistoryCursor ? { nextHistoryCursor } : {}),
      ...(sessionRevision ? { sessionRevision } : {}),
      ...(projectionCursor ? { projectionCursor } : {}),
      operations,
    });

  const settleVisibleOperations = (): void => {
    operations = Object.freeze(
      operations.filter(
        (operation) =>
          operation.status !== "awaiting-projection" ||
          !operation.appliedCursor ||
          !cursorIncludes(projectionCursor, operation.appliedCursor),
      ),
    );
  };

  return {
    snapshot,
    setReady(value: boolean): void {
      ready = value;
    },
    setDraft(value: string): void {
      if (remoteUtf8ByteLength(value) > 64 * 1024) throw new Error("draft_too_large");
      draft = value;
    },
    restoreOperations(values: readonly MobileRemoteOperation[]): void {
      if (
        values.length > 100 ||
        values.some(
          (operation) =>
            !parseRemoteOperationRequestV1(operation.request) ||
            operation.operationId !== operation.request.operationId ||
            ("sessionId" in operation.request.command &&
              operation.request.command.sessionId !== input.sessionId) ||
            (operation.result !== undefined && !parseRemoteOperationResultV1(operation.result)),
        )
      ) {
        throw new Error("operation_restore_invalid");
      }
      operations = Object.freeze(values.map((operation) => Object.freeze({ ...operation })));
    },
    trackOperation(operation: MobileRemoteOperation): void {
      if (
        !parseRemoteOperationRequestV1(operation.request) ||
        operation.operationId !== operation.request.operationId ||
        ("sessionId" in operation.request.command &&
          operation.request.command.sessionId !== input.sessionId) ||
        operations.some((current) => current.operationId === operation.operationId)
      ) {
        throw new Error("operation_id_conflict");
      }
      operations = Object.freeze([...operations, Object.freeze({ ...operation })]);
    },
    markOperationSending(operationId: string): void {
      operations = Object.freeze(
        operations.map((operation) =>
          operation.operationId === operationId
            ? { ...operation, status: "sending" as const }
            : operation,
        ),
      );
    },
    applyHistoryPage(page: RemoteConversationPageV1): void {
      if (!parseRemoteConversationPageV1(page) || page.sessionId !== input.sessionId) {
        throw new Error("conversation_page_invalid");
      }
      if (loadedHistoryCursors.has(page.historyCursor)) return;
      const direction =
        items.length > 0 && page.historyCursor === nextHistoryCursor ? "prepend" : "append";
      items = mergeRemoteConversationItems({ current: items, page: page.items, direction });
      loadedHistoryCursors.add(page.historyCursor);
      nextHistoryCursor = page.nextCursor;
      sessionRevision = page.sessionRevision;
      projectionCursor = newestCursor(projectionCursor, page.projectionCursor);
      settleVisibleOperations();
    },
    applyMessageDelta(delta: {
      readonly sessionId: string;
      readonly streamId: string;
      readonly revision: string;
      readonly delta: string;
    }): void {
      if (
        delta.sessionId !== input.sessionId ||
        !/^[\x21-\x7e]{1,128}$/u.test(delta.streamId) ||
        !/^[\x21-\x7e]{1,128}$/u.test(delta.revision) ||
        delta.delta.length === 0 ||
        remoteUtf8ByteLength(delta.delta) > 16 * 1024
      ) {
        throw new Error("conversation_delta_invalid");
      }
      const seen = streamRevisions.get(delta.streamId) ?? new Set<string>();
      if (seen.has(delta.revision)) return;
      seen.add(delta.revision);
      streamRevisions.set(delta.streamId, seen);
      const existing = items.find(
        (item) => item.type === "assistant-message" && item.itemId === delta.streamId,
      );
      const streamedText = appendBoundedAssistantText(
        existing?.type === "assistant-message" ? (existing.text ?? "") : "",
        delta.delta,
      );
      const next: RemoteConversationItemV1 =
        existing?.type === "assistant-message"
          ? {
              ...existing,
              text: streamedText.value,
              ...(existing.textTruncated || streamedText.truncated ? { textTruncated: true } : {}),
              state: "streaming",
            }
          : {
              type: "assistant-message",
              itemId: delta.streamId,
              createdAt: streamTimestamp(items),
              text: streamedText.value,
              ...(streamedText.truncated ? { textTruncated: true } : {}),
              state: "streaming",
            };
      items = mergeRemoteConversationItems({ current: items, page: [next], direction: "append" });
    },
    prepareTextSend(time: {
      readonly operationId: string;
      readonly issuedAt: string;
      readonly expiresAt: string;
    }) {
      if (!ready) return { kind: "draft-only", reason: "offline" } as const;
      const operation = createTextSendOperation({
        ...time,
        sessionId: input.sessionId,
        text: draft,
      });
      if (operations.some((current) => current.operationId === operation.operationId)) {
        throw new Error("operation_id_conflict");
      }
      operations = Object.freeze([...operations, operation]);
      return { kind: "operation", request: operation.request } as const;
    },
    applyOperationResult(result: RemoteOperationResultV1): void {
      if (!parseRemoteOperationResultV1(result)) throw new Error("operation_result_invalid");
      const current = operations.find((operation) => operation.operationId === result.operationId);
      if (!current) return;
      if (result.state === "accepted") {
        operations = Object.freeze(
          operations.map((operation) =>
            operation.operationId === result.operationId
              ? { ...operation, status: "accepted" as const, result }
              : operation,
          ),
        );
        if (
          current.request.command.type === "session.send" &&
          current.request.command.text === draft
        ) {
          draft = "";
        }
        return;
      }
      if (result.appliedCursor && !cursorIncludes(projectionCursor, result.appliedCursor)) {
        operations = Object.freeze(
          operations.map((operation) =>
            operation.operationId === result.operationId
              ? {
                  ...operation,
                  status: "awaiting-projection" as const,
                  result,
                  appliedCursor: result.appliedCursor,
                }
              : operation,
          ),
        );
      } else {
        operations = Object.freeze(
          operations.filter((operation) => operation.operationId !== result.operationId),
        );
      }
    },
    advanceProjectionCursor(cursor: RemoteCursor): void {
      projectionCursor = newestCursor(projectionCursor, cursor);
      settleVisibleOperations();
    },
    markDisconnected(): void {
      ready = false;
      operations = Object.freeze(
        operations.map((operation) =>
          operation.status === "sending" || operation.status === "accepted"
            ? { ...operation, status: "outcome-unknown" as const }
            : operation,
        ),
      );
    },
  };
}
