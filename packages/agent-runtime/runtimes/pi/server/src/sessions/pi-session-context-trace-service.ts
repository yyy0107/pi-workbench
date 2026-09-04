import type {
  SessionContextTraceActivationsPayload,
  SessionContextTraceActivationsValue,
  SessionContextTraceEvent,
  SessionContextTraceListPayload,
  SessionContextTraceListValue,
  SessionContextTracePromptPartsPayload,
  SessionContextTracePromptPartsValue,
  SessionContextTraceReadPayload,
  SessionContextTraceReadValue,
} from "@workbench/agent-runtime-pi-protocol/rpc";
import { RpcDomainError } from "@workbench/server-core/rpc-domain-error";

import {
  getSessionContextTrace,
  readSessionContextTracePromptParts,
  type SessionContextTrace,
} from "./session-context-trace";
import { SessionContextTraceJournalError } from "./session-context-trace-journal";
import { getOrStartSession, listSessions } from "./session-registry";

export type PiSessionContextTraceReader = Pick<
  SessionContextTrace,
  "activationId" | "activations" | "listActivation" | "readAny"
>;

export interface PiSessionContextTraceServiceDependencies {
  listSessions(): Promise<{ sessions: readonly { id: string }[] }>;
  startSession(sessionId: string): Promise<unknown>;
  getTrace(sessionId: string): PiSessionContextTraceReader | undefined;
  readPromptParts(sessionId: string): Promise<SessionContextTracePromptPartsValue>;
}

export interface PiSessionContextTraceService {
  list(payload: SessionContextTraceListPayload): Promise<SessionContextTraceListValue>;
  activations(
    payload: SessionContextTraceActivationsPayload,
  ): Promise<SessionContextTraceActivationsValue>;
  promptParts(
    payload: SessionContextTracePromptPartsPayload,
  ): Promise<SessionContextTracePromptPartsValue>;
  read(payload: SessionContextTraceReadPayload): Promise<SessionContextTraceReadValue>;
}

export type PiSessionContextTraceServiceErrorCode =
  | "session-not-found"
  | "context-trace-unavailable"
  | "context-trace-not-found"
  | "context-trace-journal-corrupt"
  | "context-trace-journal-io";

export interface PiSessionContextTraceServiceErrorDetails {
  sessionId: string;
  activationId?: string;
  traceId?: string;
}

export class PiSessionContextTraceServiceError extends RpcDomainError<
  PiSessionContextTraceServiceErrorCode,
  PiSessionContextTraceServiceErrorDetails
> {
  readonly code: PiSessionContextTraceServiceErrorCode;
  readonly details: PiSessionContextTraceServiceErrorDetails;

  constructor(
    code: PiSessionContextTraceServiceErrorCode,
    message: string,
    details: PiSessionContextTraceServiceErrorDetails,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PiSessionContextTraceServiceError";
    this.code = code;
    this.details = details;
  }
}

function defaultDependencies(): PiSessionContextTraceServiceDependencies {
  return {
    listSessions,
    startSession: getOrStartSession,
    getTrace: getSessionContextTrace,
    readPromptParts: readSessionContextTracePromptParts,
  };
}

function traceDetails(
  sessionId: string,
  options: { activationId?: string; traceId?: string } = {},
): PiSessionContextTraceServiceErrorDetails {
  return {
    sessionId,
    ...(options.activationId === undefined ? {} : { activationId: options.activationId }),
    ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
  };
}

function translateJournalError(
  error: unknown,
  details: PiSessionContextTraceServiceErrorDetails,
): never {
  if (!(error instanceof SessionContextTraceJournalError)) throw error;
  throw new PiSessionContextTraceServiceError(error.code, error.message, details, {
    cause: error,
  });
}

export function createPiSessionContextTraceService(
  dependencies: Partial<PiSessionContextTraceServiceDependencies> = {},
): PiSessionContextTraceService {
  const implementation = { ...defaultDependencies(), ...dependencies };

  async function requireLiveTrace(sessionId: string): Promise<PiSessionContextTraceReader> {
    const { sessions } = await implementation.listSessions();
    if (!sessions.some((session) => session.id === sessionId)) {
      throw new PiSessionContextTraceServiceError(
        "session-not-found",
        "The session does not exist.",
        { sessionId },
      );
    }

    await implementation.startSession(sessionId);
    const trace = implementation.getTrace(sessionId);
    if (!trace) {
      throw new PiSessionContextTraceServiceError(
        "context-trace-unavailable",
        "The session context trace is not available.",
        { sessionId },
      );
    }
    return trace;
  }

  return {
    async list({ sessionId, activationId, afterSeq, limit }) {
      const trace = await requireLiveTrace(sessionId);
      try {
        return await trace.listActivation(activationId, afterSeq, limit);
      } catch (error) {
        translateJournalError(error, traceDetails(sessionId, { activationId }));
      }
    },

    async activations({ sessionId }) {
      const trace = await requireLiveTrace(sessionId);
      try {
        return await trace.activations();
      } catch (error) {
        translateJournalError(error, { sessionId });
      }
    },

    async promptParts({ sessionId }) {
      try {
        return await implementation.readPromptParts(sessionId);
      } catch (error) {
        translateJournalError(error, { sessionId });
      }
    },

    async read({ sessionId, traceId }) {
      const trace = await requireLiveTrace(sessionId);
      let event: SessionContextTraceEvent | undefined;
      try {
        event = await trace.readAny(traceId);
      } catch (error) {
        translateJournalError(error, traceDetails(sessionId, { traceId }));
      }
      if (!event) {
        throw new PiSessionContextTraceServiceError(
          "context-trace-not-found",
          "The requested context trace detail is no longer retained.",
          { sessionId, traceId, activationId: trace.activationId },
        );
      }
      return { event };
    },
  };
}
