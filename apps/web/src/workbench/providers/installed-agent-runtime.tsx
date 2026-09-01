"use client";

import type { WorkbenchAgentRuntimeInstallation } from "@workbench/agent-runtime-client/installation";
import type { PromptFeedbackPort } from "@workbench/agent-runtime-client/prompt-feedback";
import {
  createPiAgentRuntimeInstallation,
  type PiAgentRuntimeCopy,
} from "@workbench/agent-runtime-pi-client/installation";
import {
  createRuntimeFetch,
  createRuntimeWebSocketFactory,
  type RuntimeFetchImplementation,
  type RuntimeWebSocketOptions,
} from "@workbench/host-client";
import type { RuntimeConnection } from "@workbench/host-contracts";
import { snapshotRuntimeConnection } from "@workbench/shell/runtime-connection";
import type { WorkbenchWorkspaceDirectoryStorePort } from "@workbench/agent-runtime-client/workspaces";

export function createInstalledAgentRuntimeTransport(
  connection: RuntimeConnection,
  options: Readonly<{
    fetchImplementation?: RuntimeFetchImplementation;
    webSocket?: RuntimeWebSocketOptions;
  }> = {},
) {
  const runtimeConnection = snapshotRuntimeConnection(connection);
  return Object.freeze({
    http: createRuntimeFetch(runtimeConnection, options.fetchImplementation),
    webSocketFactory: createRuntimeWebSocketFactory(runtimeConnection, options.webSocket),
  });
}

/**
 * The singular Agent Runtime installation selected by this Workbench build.
 *
 * Keep concrete Runtime imports in this application composition point. A registry and user-facing
 * selection policy belong here only after a second production implementation exists.
 */
export function createInstalledAgentRuntime(
  options: Readonly<{
    copy: PiAgentRuntimeCopy;
    promptFeedback: PromptFeedbackPort;
    runtimeConnection: RuntimeConnection;
    workspaceDirectoryStore: WorkbenchWorkspaceDirectoryStorePort;
  }>,
): WorkbenchAgentRuntimeInstallation {
  return createPiAgentRuntimeInstallation({
    copy: options.copy,
    promptFeedback: options.promptFeedback,
    transport: createInstalledAgentRuntimeTransport(options.runtimeConnection),
    workspaceDirectoryStore: options.workspaceDirectoryStore,
  });
}
