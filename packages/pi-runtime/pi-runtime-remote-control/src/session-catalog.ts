import { remoteUtf8ByteLength } from "@workbench/remote-control-contracts/codecs";
import type { RemoteSessionSummaryV1 } from "@workbench/remote-control-contracts/protocol";

import { sanitizeSessionCatalogEntry, sanitizeWorkspaceCatalog } from "../lib/session-sanitizer.ts";

const MAXIMUM_ITEMS = 200;
const MAXIMUM_BYTES = 192 * 1024;

export interface RemoteSessionCatalogProjectionInput {
  readonly sessions: readonly unknown[];
  readonly workspaces: readonly unknown[];
}

export interface RemoteSessionCatalogProjection {
  readonly items: readonly RemoteSessionSummaryV1[];
}

function compareSessions(left: RemoteSessionSummaryV1, right: RemoteSessionSummaryV1): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  const byActivity = right.updatedAt.localeCompare(left.updatedAt);
  return byActivity === 0 ? left.sessionId.localeCompare(right.sessionId) : byActivity;
}

export function projectRemoteSessionCatalog(
  input: RemoteSessionCatalogProjectionInput,
): RemoteSessionCatalogProjection {
  const workspaces = sanitizeWorkspaceCatalog(input.workspaces);
  const candidates = input.sessions
    .map((session) => sanitizeSessionCatalogEntry(session, workspaces))
    .filter((session): session is RemoteSessionSummaryV1 => Boolean(session && !session.archived))
    .sort(compareSessions);
  const items: RemoteSessionSummaryV1[] = [];
  for (const candidate of candidates) {
    if (items.length >= MAXIMUM_ITEMS) break;
    const next = [...items, candidate];
    if (remoteUtf8ByteLength(JSON.stringify({ items: next })) > MAXIMUM_BYTES) break;
    items.push(candidate);
  }
  return Object.freeze({ items: Object.freeze(items) });
}
