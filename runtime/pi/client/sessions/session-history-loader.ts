import type { SessionHistoryPayload, SessionHistoryValue } from "../../rpc-contracts";

export const INITIAL_SESSION_HISTORY_MESSAGES = 8;
export const BACKFILL_SESSION_HISTORY_MESSAGES = 50;

type FetchSessionHistoryPage = (payload: SessionHistoryPayload) => Promise<SessionHistoryValue>;

export interface ProgressiveSessionHistoryOptions {
  initialMaxMessages?: number;
  backfillMaxMessages?: number;
  onInitialPage?: (history: SessionHistoryValue) => void;
}

export class SessionHistoryPaginationError extends Error {
  constructor() {
    super("Session history pagination did not advance.");
    this.name = "SessionHistoryPaginationError";
  }
}

function nextBeforeSeq(page: SessionHistoryValue, previous?: number): number {
  const next = page.events[0]?.event.seq;
  if (next === undefined || (previous !== undefined && next >= previous)) {
    throw new SessionHistoryPaginationError();
  }
  return next;
}

/**
 * Paint the newest history page immediately, then fetch the older pages in the background.
 * The returned promise still resolves to the complete ordered history for authoritative replay.
 */
export async function fetchProgressiveSessionHistory(
  sessionId: string,
  fetchPage: FetchSessionHistoryPage,
  options: ProgressiveSessionHistoryOptions = {},
): Promise<SessionHistoryValue> {
  const initialPage = await fetchPage({
    sessionId,
    maxMessages: options.initialMaxMessages ?? INITIAL_SESSION_HISTORY_MESSAGES,
  });
  let beforeSeq = initialPage.hasMore ? nextBeforeSeq(initialPage) : undefined;
  options.onInitialPage?.(initialPage);
  if (beforeSeq === undefined) return initialPage;

  const events = [...initialPage.events];
  for (;;) {
    const page = await fetchPage({
      sessionId,
      beforeSeq,
      maxMessages: options.backfillMaxMessages ?? BACKFILL_SESSION_HISTORY_MESSAGES,
    });
    events.unshift(...page.events);
    if (!page.hasMore) {
      return {
        events,
        hasMore: false,
        ...(initialPage.projections === undefined ? {} : { projections: initialPage.projections }),
        ...(initialPage.branches === undefined ? {} : { branches: initialPage.branches }),
      };
    }
    beforeSeq = nextBeforeSeq(page, beforeSeq);
  }
}
