import {
  parseRemoteConversationItemV1,
  parseRemoteConversationPageV1,
  remoteUtf8ByteLength,
} from "@workbench/remote-control-contracts/codecs";
import type {
  RemoteConversationItemV1,
  RemoteConversationPageV1,
  RemoteCursor,
} from "@workbench/remote-control-contracts/protocol";

import { sanitizePiConversationEntry } from "../lib/conversation-sanitizer.ts";

const MAXIMUM_ITEMS = 50;
const MAXIMUM_BYTES = 192 * 1024;

export interface RemoteConversationProjectionInput {
  readonly sessionId: string;
  readonly entries: readonly unknown[];
  readonly historyCursor: string;
  readonly nextCursor?: string;
  readonly sessionRevision: string;
  readonly projectionCursor: RemoteCursor;
}

export interface RemoteConversationDeltaInput {
  readonly sessionId: string;
  readonly streamId: string;
  readonly revision: string;
  readonly delta: string;
}

export function projectRemoteConversationDelta(input: RemoteConversationDeltaInput) {
  if (
    !/^[\x21-\x7e]{1,128}$/u.test(input.sessionId) ||
    !/^[\x21-\x7e]{1,128}$/u.test(input.streamId) ||
    !/^[\x21-\x7e]{1,128}$/u.test(input.revision) ||
    input.delta.length === 0 ||
    remoteUtf8ByteLength(input.delta) > 16 * 1024
  ) {
    throw new Error("conversation_delta_invalid");
  }
  return Object.freeze({ type: "session.messageDelta" as const, ...input });
}

export function projectRemoteConversationPage(
  input: RemoteConversationProjectionInput,
): RemoteConversationPageV1 {
  const fallbackTimestamp = new Date(0).toISOString();
  const items: RemoteConversationItemV1[] = [];
  for (const [index, entry] of input.entries.entries()) {
    for (const candidate of sanitizePiConversationEntry({
      entry,
      index,
      sessionId: input.sessionId,
      fallbackTimestamp,
    })) {
      if (items.length >= MAXIMUM_ITEMS) break;
      if (!parseRemoteConversationItemV1(candidate)) continue;
      const next = [...items, candidate];
      const page = {
        sessionId: input.sessionId,
        items: next,
        historyCursor: input.historyCursor,
        ...(input.nextCursor ? { nextCursor: input.nextCursor } : {}),
        sessionRevision: input.sessionRevision,
        projectionCursor: input.projectionCursor,
      };
      if (remoteUtf8ByteLength(JSON.stringify(page)) > MAXIMUM_BYTES) break;
      items.push(candidate);
    }
    if (items.length >= MAXIMUM_ITEMS) break;
  }
  const page: RemoteConversationPageV1 = Object.freeze({
    sessionId: input.sessionId,
    items: Object.freeze(items),
    historyCursor: input.historyCursor,
    ...(input.nextCursor ? { nextCursor: input.nextCursor } : {}),
    sessionRevision: input.sessionRevision,
    projectionCursor: input.projectionCursor,
  });
  if (!parseRemoteConversationPageV1(page)) throw new Error("conversation_projection_invalid");
  return page;
}
