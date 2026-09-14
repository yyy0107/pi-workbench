import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { deriveSessionDisplayTitle } from "@workbench/pi-runtime-adapters/sessions";

export const SESSION_TITLE_ORIGIN_CUSTOM_TYPE = "workbench.session-title-origin.v1";

export type SessionTitleOrigin = "generated" | "explicit";

type SessionTitleManager = Pick<
  SessionManager,
  "appendCustomEntry" | "appendSessionInfo" | "getEntries" | "getSessionName"
>;

interface SessionTitleOriginMarker {
  readonly version: 1;
  readonly origin: SessionTitleOrigin;
}

export function sessionTitleOriginMarker(entry: {
  readonly type?: unknown;
  readonly customType?: unknown;
  readonly data?: unknown;
}): SessionTitleOriginMarker | undefined {
  if (entry.type !== "custom" || entry.customType !== SESSION_TITLE_ORIGIN_CUSTOM_TYPE) {
    return undefined;
  }
  const data = entry.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const marker = data as { version?: unknown; origin?: unknown };
  if (marker.version !== 1 || (marker.origin !== "generated" && marker.origin !== "explicit")) {
    return undefined;
  }
  return marker as SessionTitleOriginMarker;
}

export function sessionTitleOriginFromEntries(
  entries: readonly SessionEntry[],
): SessionTitleOrigin | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const marker = sessionTitleOriginMarker(entries[index]!);
    if (marker) return marker.origin;
  }
  return undefined;
}

export function appendSessionTitleOrigin(
  manager: Pick<SessionManager, "appendCustomEntry">,
  origin: SessionTitleOrigin,
): void {
  manager.appendCustomEntry(SESSION_TITLE_ORIGIN_CUSTOM_TYPE, {
    version: 1,
    origin,
  } satisfies SessionTitleOriginMarker);
}

/**
 * Persist the first-message title exactly once. Existing names are preserved even when an older
 * session predates the origin marker. An explicit marker also protects a deliberately unnamed
 * session from later automatic writes.
 */
export function persistGeneratedSessionTitle(
  manager: SessionTitleManager,
  firstMessage: string,
): string | undefined {
  if (manager.getSessionName() !== undefined) return undefined;
  if (sessionTitleOriginFromEntries(manager.getEntries()) === "explicit") return undefined;
  const title = deriveSessionDisplayTitle(firstMessage);
  if (!title) return undefined;
  manager.appendSessionInfo(title);
  appendSessionTitleOrigin(manager, "generated");
  return title;
}
