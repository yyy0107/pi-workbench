export { PiServerError } from "@workbench/pi-server-ports/errors";
export {
  admitInlineImages,
  InlineImageAdmissionError,
} from "@workbench/pi-session-server/inline-image-admission";
export { piErrorResponse } from "../transport/responses";
export { readTrustedJsonPost } from "@workbench/host-server/rpc";
export { RPC_REQUEST_BODY_LIMITS } from "../transport/rpc-request-budgets";
export {
  migrateLegacyWorkbenchMessageTerminationExtension,
  type LegacyWorkbenchMessageTerminationMigrationResult,
  type LegacyWorkbenchMessageTerminationMigrationStatus,
} from "@workbench/pi-tools/legacy-message-termination";

type SessionRegistryModule = typeof import("../session-composition/registry");
type LegacySseModule = typeof import("../streams/legacy-sse");
type WorkspacePathsModule = typeof import("@workbench/pi-resources-server/workspace-paths");

export async function cancelSession(...args: Parameters<SessionRegistryModule["cancelSession"]>) {
  const { cancelSession: implementation } = await import("../session-composition/registry");
  return implementation(...args);
}

export async function createSession(...args: Parameters<SessionRegistryModule["createSession"]>) {
  const { createSession: implementation } = await import("../session-composition/registry");
  return implementation(...args);
}

export async function deleteSession(...args: Parameters<SessionRegistryModule["deleteSession"]>) {
  const { deleteSession: implementation } = await import("../session-composition/registry");
  return implementation(...args);
}

export async function getSessionHistory(
  ...args: Parameters<SessionRegistryModule["getSessionHistory"]>
) {
  const { getSessionHistory: implementation } = await import("../session-composition/registry");
  return implementation(...args);
}

export async function listModels(...args: Parameters<SessionRegistryModule["listModels"]>) {
  const { listModels: implementation } = await import("../session-composition/registry");
  return implementation(...args);
}

export async function listSessions(...args: Parameters<SessionRegistryModule["listSessions"]>) {
  const { listSessions: implementation } = await import("../session-composition/registry");
  return implementation(...args);
}

export async function queuePrompt(...args: Parameters<SessionRegistryModule["queuePrompt"]>) {
  const { queuePrompt: implementation } = await import("../session-composition/registry");
  return implementation(...args);
}

export async function renameSession(...args: Parameters<SessionRegistryModule["renameSession"]>) {
  const { renameSession: implementation } = await import("../session-composition/registry");
  return implementation(...args);
}

export async function replacePromptQueue(
  ...args: Parameters<SessionRegistryModule["replacePromptQueue"]>
) {
  const { replacePromptQueue: implementation } = await import("../session-composition/registry");
  return implementation(...args);
}

export async function sendPrompt(...args: Parameters<SessionRegistryModule["sendPrompt"]>) {
  const { sendPrompt: implementation } = await import("../session-composition/registry");
  return implementation(...args);
}

export async function setPromptQueuePaused(
  ...args: Parameters<SessionRegistryModule["setPromptQueuePaused"]>
) {
  const { setPromptQueuePaused: implementation } = await import("../session-composition/registry");
  return implementation(...args);
}

export async function steerQueuedPrompt(
  ...args: Parameters<SessionRegistryModule["steerQueuedPrompt"]>
) {
  const { steerQueuedPrompt: implementation } = await import("../session-composition/registry");
  return implementation(...args);
}

export async function createRunningEventResponse(
  ...args: Parameters<LegacySseModule["createRunningEventResponse"]>
) {
  const { createRunningEventResponse: implementation } = await import("../streams/legacy-sse");
  return implementation(...args);
}

export async function createSessionEventResponse(
  ...args: Parameters<LegacySseModule["createSessionEventResponse"]>
) {
  const { createSessionEventResponse: implementation } = await import("../streams/legacy-sse");
  return implementation(...args);
}

export async function pickWorkspaceDirectory(
  ...args: Parameters<WorkspacePathsModule["pickWorkspaceDirectory"]>
) {
  const { pickWorkspaceDirectory: implementation } =
    await import("@workbench/pi-resources-server/workspace-paths");
  return implementation(...args);
}
