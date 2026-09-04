"use client";

import type { WorkbenchServicesCapabilities } from "@workbench/agent-runtime-client/capabilities";

import type { ReactNode } from "react";

import type { WorkbenchAgentRuntimeInstallation } from "@workbench/agent-runtime-client/installation";
import type { PromptFeedbackPort } from "@workbench/agent-runtime-client/prompt-feedback";
import type { WorkbenchWorkspaceDirectoryStorePort } from "@workbench/agent-runtime-client/workspaces";
import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@workbench/agent-runtime-pi-shared/descriptor";

import type { PiAgentRuntimeCopy } from "./copy";
import { PiAgentRuntimeProvider } from "./pi-runtime-provider";
import { snapshotPiClientTransport, type PiClientTransport } from "../transport/client-transport";

export interface PiAgentRuntimeInstallationOptions {
  readonly copy: PiAgentRuntimeCopy;
  readonly services: WorkbenchServicesCapabilities;
  readonly workspaceDirectoryStore: WorkbenchWorkspaceDirectoryStorePort;
  readonly promptFeedback?: PromptFeedbackPort;
  readonly transport?: PiClientTransport;
}

/** Bind application-owned inputs to Pi's complete browser lifecycle without creating a registry. */
export function createPiAgentRuntimeInstallation(
  options: PiAgentRuntimeInstallationOptions,
): WorkbenchAgentRuntimeInstallation {
  const transport = snapshotPiClientTransport(options.transport);
  return {
    descriptor: PI_AGENT_RUNTIME_DESCRIPTOR,
    render(children: ReactNode) {
      return (
        <PiAgentRuntimeProvider
          copy={options.copy}
          services={options.services}
          promptFeedback={options.promptFeedback}
          transport={transport}
          workspaceDirectoryStore={options.workspaceDirectoryStore}
        >
          {children}
        </PiAgentRuntimeProvider>
      );
    },
  };
}

export type { PiAgentRuntimeCopy } from "./copy";
export type { PiClientTransport } from "../transport/client-transport";
