import type { PiSessionSummary } from "@/runtime/pi/contracts/pi";
import {
  AgentThreadStoreError,
  type AgentThreadStoreErrorCode,
  type AgentThreadStorePort,
  type AgentThreadSummary,
} from "@/runtime/server/agent-thread-store-port";

import {
  createSession,
  deleteSession,
  forkSession,
  listSessionSearchText,
  listSessions,
  renameSession,
} from "../sessions/session-registry";

export interface PiAgentThreadStoreDependencies {
  listSessions(): Promise<{ sessions: PiSessionSummary[]; runningSessionIds: string[] }>;
  listSessionSearchText(): Promise<Array<{ sessionId: string; allMessagesText: string }>>;
  createSession(cwd: string, sessionId?: string): Promise<{ id: string }>;
  renameSession(sessionId: string, title: string): Promise<number | void>;
  forkSession(sessionId: string, atSeq?: number): Promise<{ id: string }>;
  deleteSession(sessionId: string): Promise<void>;
}

function defaultDependencies(): PiAgentThreadStoreDependencies {
  return {
    listSessions,
    listSessionSearchText,
    createSession,
    renameSession,
    forkSession,
    deleteSession,
  };
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function existingRootPath(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("existingCwd" in error)) return undefined;
  return typeof error.existingCwd === "string" ? error.existingCwd : undefined;
}

const PI_THREAD_STORE_ERROR_CODE_MAP: Readonly<Record<string, AgentThreadStoreErrorCode>> = {
  pi_session_not_found: "thread-not-found",
  pi_session_conflict: "thread-id-conflict",
  pi_workspace_path_required: "invalid-root",
  pi_workspace_not_directory: "invalid-root",
  pi_workspace_not_found: "invalid-root",
  pi_session_busy: "busy",
  pi_fork_unavailable: "fork-unavailable",
};

export function translatePiThreadStoreError(error: unknown): never {
  if (error instanceof AgentThreadStoreError) throw error;
  const code = errorCode(error);
  const translated =
    code === undefined ? "internal" : (PI_THREAD_STORE_ERROR_CODE_MAP[code] ?? "internal");
  const rootPath = translated === "thread-id-conflict" ? existingRootPath(error) : undefined;

  throw new AgentThreadStoreError(
    translated,
    "The Pi Agent thread store operation failed.",
    rootPath === undefined ? {} : { existingRootPath: rootPath },
    { cause: error },
  );
}

export function projectPiSessionSummary(summary: PiSessionSummary): AgentThreadSummary {
  return {
    threadId: summary.id,
    rootPath: summary.cwd,
    ...(summary.name === undefined ? {} : { title: summary.name }),
    createdAt: summary.created,
    updatedAt: summary.modified,
    messageCount: summary.messageCount,
    firstMessage: summary.firstMessage,
    transient: summary.transient,
    running: summary.running,
    ...(summary.waitingForUserInput === undefined
      ? {}
      : { waitingForUserInput: summary.waitingForUserInput }),
    ...(summary.runTiming === undefined ? {} : { runTiming: summary.runTiming }),
    ...(summary.automationOrigin === undefined
      ? {}
      : { automationOrigin: summary.automationOrigin }),
    ...(summary.executionOrigin === undefined ? {} : { executionOrigin: summary.executionOrigin }),
  };
}

export function createPiAgentThreadStoreAdapter(
  dependencies: Partial<PiAgentThreadStoreDependencies> = {},
): AgentThreadStorePort {
  const implementation = { ...defaultDependencies(), ...dependencies };

  return {
    capabilities: {
      requestedThreadId: true,
      preset: false,
    },

    async list() {
      try {
        const { sessions } = await implementation.listSessions();
        return sessions.map(projectPiSessionSummary);
      } catch (error) {
        translatePiThreadStoreError(error);
      }
    },

    async listSearchDocuments() {
      try {
        return (await implementation.listSessionSearchText()).map(
          ({ sessionId, allMessagesText }) => ({
            threadId: sessionId,
            text: allMessagesText,
          }),
        );
      } catch (error) {
        translatePiThreadStoreError(error);
      }
    },

    async create(input) {
      if (input.preset !== undefined) {
        throw new AgentThreadStoreError(
          "unsupported",
          "Pi does not support selecting a preset when a thread is created.",
        );
      }
      try {
        const session = await implementation.createSession(input.rootPath, input.requestedThreadId);
        return { threadId: session.id };
      } catch (error) {
        translatePiThreadStoreError(error);
      }
    },

    async rename({ threadId, title }) {
      try {
        const revision = await implementation.renameSession(threadId, title);
        return revision === undefined ? {} : { revision };
      } catch (error) {
        translatePiThreadStoreError(error);
      }
    },

    async fork({ threadId, atEventRevision }) {
      try {
        const session = await implementation.forkSession(threadId, atEventRevision);
        return { threadId: session.id };
      } catch (error) {
        translatePiThreadStoreError(error);
      }
    },

    async delete({ threadId }) {
      try {
        await implementation.deleteSession(threadId);
      } catch (error) {
        translatePiThreadStoreError(error);
      }
    },
  };
}
