import type { AgentThreadSummary } from "@workbench/agent-runtime-server/threads";

import {
  projectPiSessionSummary,
  translatePiThreadStoreError,
} from "../agent-runtime/pi-agent-thread-store-adapter";
import {
  createScratchSession,
  getRunningSessionIds,
  getScratchSessionRecord,
  getScratchSessionSummary,
  promoteScratchSession,
  releaseScratchSession,
} from "./session-registry";
import type { SessionRpcScratchRecord, SessionRpcScratchStore } from "./session-rpc-service";

function projectRecord(
  summary: AgentThreadSummary,
  record: NonNullable<ReturnType<typeof getScratchSessionRecord>>,
): SessionRpcScratchRecord {
  return {
    summary,
    sourceSessionId: record.sourceSessionId,
    ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
    expiresAt: record.expiresAt,
  };
}

export function createPiScratchSessionStore(): SessionRpcScratchStore {
  return {
    async get(sessionId) {
      const record = getScratchSessionRecord(sessionId);
      if (!record) return undefined;
      try {
        const summary = await getScratchSessionSummary(sessionId);
        return summary ? projectRecord(projectPiSessionSummary(summary), record) : undefined;
      } catch (error) {
        translatePiThreadStoreError(error);
      }
    },

    async runningSessionIds() {
      return getRunningSessionIds().filter((sessionId) => getScratchSessionRecord(sessionId));
    },

    async create({ sourceSessionId, atEventRevision, workspaceId }) {
      try {
        const { host, record } = await createScratchSession(sourceSessionId, atEventRevision, {
          workspaceId,
        });
        return projectRecord(projectPiSessionSummary(host.summary()), record);
      } catch (error) {
        translatePiThreadStoreError(error);
      }
    },

    async release(sessionId) {
      try {
        await releaseScratchSession(sessionId);
      } catch (error) {
        translatePiThreadStoreError(error);
      }
    },

    async promote(sessionId, title) {
      try {
        const promoted = await promoteScratchSession(sessionId, title);
        return {
          summary: projectPiSessionSummary(promoted.host.summary()),
          sourceSessionId: promoted.sourceSessionId,
          ...(promoted.workspaceId ? { workspaceId: promoted.workspaceId } : {}),
        };
      } catch (error) {
        translatePiThreadStoreError(error);
      }
    },
  };
}
