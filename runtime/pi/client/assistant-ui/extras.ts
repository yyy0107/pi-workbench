import type {
  WorkbenchAgentComposerSendError,
  WorkbenchAgentRuntimeExtras,
  WorkbenchAgentWorkspace,
} from "@/runtime/assistant-ui/agent-runtime-adapter";

import type { PiWorkspaceSummary } from "../../contracts/pi";
import {
  visibleResumeCheckpointTerminalMessageId,
  type PiClientSession,
  type PiSessionSnapshot,
} from "../runtime/manager";

/** Project Pi-native state into the small backend-neutral surface consumed by Workbench UI. */
export function projectPiAgentRuntimeExtras({
  session,
  snapshot,
  workspace,
  composerError,
  clearComposerError,
}: Readonly<{
  session: PiClientSession;
  snapshot: PiSessionSnapshot;
  workspace?: PiWorkspaceSummary | WorkbenchAgentWorkspace;
  composerError?: WorkbenchAgentComposerSendError;
  clearComposerError(): void;
}>): WorkbenchAgentRuntimeExtras {
  const supportsResume = typeof session.resume === "function";
  const supportsResumeLatest = typeof session.resumeLatest === "function";

  return {
    ...(workspace
      ? {
          agentThread: {
            workspace: {
              id: workspace.id,
              name: workspace.name,
              rootPath: "cwd" in workspace ? workspace.cwd : workspace.rootPath,
              ...(workspace.pinned === undefined ? {} : { pinned: workspace.pinned }),
            },
          },
        }
      : {}),
    agentQueue: {
      ...session.runtimeExtras.piQueue,
      paused: snapshot.queuePaused,
      rejectedDraft: snapshot.rejectedQueueDraft,
      steeringIds: snapshot.steeringQueueIds,
    },
    agentRun: {
      timing: snapshot.runTiming,
      autoRetry: snapshot.autoRetry,
      resumeCheckpoint: snapshot.resumeCheckpoint
        ? {
            checkpointId: snapshot.resumeCheckpoint.checkpointId,
            terminalMessageId:
              visibleResumeCheckpointTerminalMessageId(snapshot) ??
              snapshot.resumeCheckpoint.terminalMessageId,
            expectedStateId: snapshot.resumeCheckpoint.branchLeafId,
            capability: snapshot.resumeCheckpoint.capability,
          }
        : undefined,
      ...(supportsResume
        ? {
            resume: (checkpointId: string, expectedStateId: string) =>
              session.resume(checkpointId, expectedStateId),
          }
        : {}),
      ...(supportsResumeLatest
        ? {
            resumeLatest: (terminalMessageId: string) => session.resumeLatest(terminalMessageId),
          }
        : {}),
    },
    agentComposer: {
      error: composerError,
      clearError: clearComposerError,
    },
  };
}
