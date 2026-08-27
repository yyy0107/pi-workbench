"use client";

import type { WorkbenchAgentRuntimeInstallation } from "@/runtime/assistant-ui/agent-runtime-installation";
import { createPiAgentRuntimeInstallation } from "@/runtime/pi/client/assistant-ui/pi-runtime-installation";
import type { PromptFeedbackPort } from "@/services/workspace-feedback-service";

/**
 * The singular Agent Runtime installation selected by this Workbench build.
 *
 * Keep concrete Runtime imports in this application composition point. A registry and user-facing
 * selection policy belong here only after a second production implementation exists.
 */
export function createInstalledAgentRuntime(
  promptFeedback: PromptFeedbackPort,
): WorkbenchAgentRuntimeInstallation {
  return createPiAgentRuntimeInstallation({ promptFeedback });
}
