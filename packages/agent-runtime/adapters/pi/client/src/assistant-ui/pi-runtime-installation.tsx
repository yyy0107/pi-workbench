"use client";

import type { ReactNode } from "react";

import type { WorkbenchAgentRuntimeInstallation } from "@workbench/agent-runtime-client/installation";
import type { PromptFeedbackPort } from "@workbench/agent-runtime-client/prompt-feedback";
import type { WorkbenchWorkspaceDirectoryStorePort } from "@workbench/agent-runtime-client/workspaces";
import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@workbench/agent-runtime-pi-shared/descriptor";

import type { PiAgentRuntimeCopy } from "./copy";
import { PiAgentRuntimeProvider } from "./pi-runtime-provider";

export interface PiAgentRuntimeInstallationOptions {
  readonly copy: PiAgentRuntimeCopy;
  readonly workspaceDirectoryStore: WorkbenchWorkspaceDirectoryStorePort;
  readonly promptFeedback?: PromptFeedbackPort;
}

/** Bind application-owned inputs to Pi's complete browser lifecycle without creating a registry. */
export function createPiAgentRuntimeInstallation(
  options: PiAgentRuntimeInstallationOptions,
): WorkbenchAgentRuntimeInstallation {
  return {
    descriptor: PI_AGENT_RUNTIME_DESCRIPTOR,
    render(children: ReactNode) {
      return (
        <PiAgentRuntimeProvider
          copy={options.copy}
          promptFeedback={options.promptFeedback}
          workspaceDirectoryStore={options.workspaceDirectoryStore}
        >
          {children}
        </PiAgentRuntimeProvider>
      );
    },
  };
}

export type { PiAgentRuntimeCopy } from "./copy";
