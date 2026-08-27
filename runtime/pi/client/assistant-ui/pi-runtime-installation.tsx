"use client";

import type { ReactNode } from "react";

import type { WorkbenchAgentRuntimeInstallation } from "@/runtime/assistant-ui/agent-runtime-installation";
import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@/runtime/pi/descriptor";
import type { PromptFeedbackPort } from "@/services/workspace-feedback-service";

import { PiAgentRuntimeProvider } from "./pi-runtime-provider";

export interface PiAgentRuntimeInstallationOptions {
  readonly promptFeedback?: PromptFeedbackPort;
}

/** Bind application-owned inputs to Pi's complete browser lifecycle without creating a registry. */
export function createPiAgentRuntimeInstallation(
  options: PiAgentRuntimeInstallationOptions = {},
): WorkbenchAgentRuntimeInstallation {
  return {
    descriptor: PI_AGENT_RUNTIME_DESCRIPTOR,
    render(children: ReactNode) {
      return (
        <PiAgentRuntimeProvider promptFeedback={options.promptFeedback}>
          {children}
        </PiAgentRuntimeProvider>
      );
    },
  };
}
