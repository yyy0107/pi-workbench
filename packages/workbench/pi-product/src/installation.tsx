"use client";
import type { WorkbenchSettingsPort } from "@workbench/agent-runtime-contracts/settings";
import { createWorkbenchSettingsClient } from "@workbench/services-client/settings";
import { createHostClient } from "@workbench/services-client/host";
import { createWorkspaceClient } from "@workbench/services-client/workspace";
import { createAutomationClient } from "@workbench/services-client/automation";

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

/** Installs one Pi product runtime with its own connection and services. */
export function createInstalledAgentRuntime(
  options: Readonly<{
    copy: PiAgentRuntimeCopy;
    settings?: WorkbenchSettingsPort;
    promptFeedback: PromptFeedbackPort;
    runtimeConnection: RuntimeConnection;
    workspaceDirectoryStore: WorkbenchWorkspaceDirectoryStorePort;
  }>,
): WorkbenchAgentRuntimeInstallation {
  const transport = createInstalledAgentRuntimeTransport(options.runtimeConnection);
  const rpcOptions = Object.freeze({ transport: transport.http });
  return createPiAgentRuntimeInstallation({
    services: Object.freeze({
      host: createHostClient(rpcOptions),
      workspace: createWorkspaceClient(rpcOptions),
      automation: createAutomationClient(rpcOptions),
      settings: options.settings ?? createWorkbenchSettingsClient(rpcOptions),
    }),
    copy: options.copy,
    promptFeedback: options.promptFeedback,
    transport,
    workspaceDirectoryStore: options.workspaceDirectoryStore,
  });
}
