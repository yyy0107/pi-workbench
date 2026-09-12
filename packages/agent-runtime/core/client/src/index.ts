"use client";

export {
  WORKBENCH_STORAGE_PREFIX,
  workbenchBrowserStorage,
  type WorkbenchAsyncStorage,
} from "./browser/storage";
export { bindSnapshotSelector, type SnapshotSelectorHook } from "./runtime/snapshot-selector";
export {
  WORKBENCH_COMPOSER_ATTACHMENT_ACCEPT,
  composerAttachmentFromFile,
} from "./browser/composer-attachment";
export {
  WorkbenchAgentCapabilityError,
  type WorkbenchAgentCapabilityErrorCode,
  type WorkbenchAgentRuntimeCapabilities,
  type WorkbenchCapabilityRequestOptions,
  type WorkbenchContextCapability,
  type WorkbenchContextCapabilitySnapshot,
  type WorkbenchInteractionCapability,
  type WorkbenchModelSelectionCapability,
  type WorkbenchRuntimeHostCapability,
  type WorkbenchScratchSessionCapability,
  type WorkbenchWorkspaceCapability,
  type WorkbenchWorkspaceFileStreamOptions,
} from "./environment/capabilities";
export {
  type ConversationNodeSelectionOptions,
  useAgentRuntime,
  useConversationSession,
  useConversationNode,
  useConversationNodes,
  useCurrentSession,
  useSessionState,
  useThreadList,
} from "./runtime/hooks";
export { RuntimeProvider } from "./runtime/provider";
export { SessionProvider, type SessionProviderProps } from "./runtime/session-provider";
export type {
  CurrentSessionSnapshot,
  ThreadListActions,
  ThreadListItem,
  ThreadListMove,
  ThreadListSnapshot,
} from "@workbench/agent-runtime-core";
export {
  createWorkbenchParallelToolPresentationMetadata,
  createWorkbenchReasoningPresentationMetadata,
  readWorkbenchParallelToolPresentationMetadata,
  readWorkbenchReasoningPresentationMetadata,
  type WorkbenchParallelToolPresentationMetadata,
  type WorkbenchReasoningPresentationMetadata,
} from "./conversation/presentation-metadata";
export {
  createThreadListReloadCoordinator,
  type ThreadListReloadCoordinator,
} from "./conversation/thread-list-reload";
export { toolResultText, toolStringArg, useCompletedToolCalls } from "./conversation/tool-events";
