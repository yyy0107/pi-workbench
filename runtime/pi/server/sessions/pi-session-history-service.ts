import type { PiAgentMessage, PiSessionHistory } from "@/runtime/pi/contracts/pi";
import type { SessionEvent, SessionHistoryValue } from "@/runtime/pi/contracts/rpc";

import {
  getSessionEventBranches,
  getSessionEvents,
  getSessionHistory,
  getSessionResumeState,
} from "./session-registry";

export interface PiSessionHistoryServiceDependencies {
  getSessionEventBranches(sessionId: string): Promise<SessionHistoryValue["branches"]>;
  getSessionEvents(sessionId: string): Promise<SessionEvent[]>;
  getSessionHistory(sessionId: string): Promise<PiSessionHistory>;
  getSessionResumeState(sessionId: string): Promise<SessionHistoryValue["resume"]>;
}

export interface PiSessionHistoryPageInput {
  sessionId: string;
  beforeSeq?: number;
  maxMessages: number;
}

export interface PiSessionHistoryService {
  searchText(sessionId: string): Promise<string>;
  page(input: PiSessionHistoryPageInput): Promise<SessionHistoryValue>;
  latestEventRevision(sessionId: string): Promise<number | undefined>;
}

export type PiSessionHistoryServiceErrorCode = "session-not-found" | "internal";

export class PiSessionHistoryServiceError extends Error {
  readonly code: PiSessionHistoryServiceErrorCode;

  constructor(code: PiSessionHistoryServiceErrorCode, options?: ErrorOptions) {
    super("The Pi session history operation failed.", options);
    this.name = "PiSessionHistoryServiceError";
    this.code = code;
  }
}

function defaultDependencies(): PiSessionHistoryServiceDependencies {
  return {
    getSessionEventBranches,
    getSessionEvents,
    getSessionHistory,
    getSessionResumeState,
  };
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function translatePiHistoryError(error: unknown): never {
  if (error instanceof PiSessionHistoryServiceError) throw error;
  throw new PiSessionHistoryServiceError(
    errorCode(error) === "pi_session_not_found" ? "session-not-found" : "internal",
    { cause: error },
  );
}

function textContent(message: PiAgentMessage): string {
  if (message.role !== "user" && message.role !== "assistant") return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
    .join("\n");
}

function historySearchText(history: PiSessionHistory): string {
  return history.context.messages.map(textContent).filter(Boolean).join(" ");
}

function paginateSessionEvents(
  events: readonly SessionEvent[],
  beforeSeq: number | undefined,
  maxMessages: number,
): { events: SessionEvent[]; hasMore: boolean } {
  const window =
    beforeSeq === undefined ? [...events] : events.filter((event) => event.seq < beforeSeq);
  let messageCount = 0;
  let unmatchedMessageEnds = 0;
  let targetEndDepth: number | undefined;
  let cut = 0;

  for (let index = window.length - 1; index >= 0; index -= 1) {
    const event = window[index]!;
    if (event.type === "message") {
      messageCount += 1;
      if (messageCount >= maxMessages) {
        cut = index;
        break;
      }
      continue;
    }
    if (event.type === "message_end") {
      unmatchedMessageEnds += 1;
      messageCount += 1;
      if (messageCount >= maxMessages && targetEndDepth === undefined) {
        targetEndDepth = unmatchedMessageEnds;
      }
      continue;
    }
    if (event.type !== "message_start") continue;
    if (unmatchedMessageEnds > 0) {
      if (targetEndDepth === unmatchedMessageEnds) {
        cut = index;
        break;
      }
      unmatchedMessageEnds -= 1;
      continue;
    }

    // The tail of an in-progress group, or an explicit beforeSeq inside a group,
    // has no message_end in this window. Its message_start still owns the group.
    messageCount += 1;
    if (messageCount >= maxMessages) {
      cut = index;
      break;
    }
  }

  return { events: window.slice(cut), hasMore: cut > 0 };
}

export function createPiSessionHistoryService(
  dependencies: Partial<PiSessionHistoryServiceDependencies> = {},
): PiSessionHistoryService {
  const defaults = defaultDependencies();
  const hasAlternateEventSource = dependencies.getSessionEvents !== undefined;
  const implementation: PiSessionHistoryServiceDependencies = {
    ...defaults,
    ...dependencies,
    // An alternate canonical event source cannot safely reuse branches or resume state from the
    // default Pi registry. Callers can opt back in by supplying the matching projections too.
    ...(hasAlternateEventSource && dependencies.getSessionEventBranches === undefined
      ? { getSessionEventBranches: async () => ({ headLeafId: null, items: [] }) }
      : {}),
    ...(hasAlternateEventSource && dependencies.getSessionResumeState === undefined
      ? { getSessionResumeState: async () => ({}) }
      : {}),
  };

  return {
    async searchText(sessionId) {
      try {
        return historySearchText(await implementation.getSessionHistory(sessionId));
      } catch (error) {
        translatePiHistoryError(error);
      }
    },

    async page({ sessionId, beforeSeq, maxMessages }) {
      try {
        const allEvents = await implementation.getSessionEvents(sessionId);
        const page = paginateSessionEvents(allEvents, beforeSeq, maxMessages);
        const isTailPage = beforeSeq === undefined;
        let branches: SessionHistoryValue["branches"];
        let resume: SessionHistoryValue["resume"];
        if (isTailPage) {
          // Resume lookup may repair a legacy/HMR-retained session by appending a checkpoint.
          // Project branches afterwards so both projections observe the same durable leaf.
          resume = await implementation.getSessionResumeState(sessionId);
          branches = await implementation.getSessionEventBranches(sessionId);
        }
        return {
          events: page.events.map((event) => ({ event })),
          hasMore: page.hasMore,
          ...(isTailPage
            ? { projections: { asOfSeq: allEvents.at(-1)?.seq ?? -1, values: {} } }
            : {}),
          ...(branches?.items.length ? { branches } : {}),
          ...(isTailPage && resume?.checkpoint ? { resume } : {}),
        };
      } catch (error) {
        translatePiHistoryError(error);
      }
    },

    async latestEventRevision(sessionId) {
      try {
        return (await implementation.getSessionEvents(sessionId)).at(-1)?.seq;
      } catch (error) {
        translatePiHistoryError(error);
      }
    },
  };
}
