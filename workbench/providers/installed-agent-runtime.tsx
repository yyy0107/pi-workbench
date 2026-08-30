"use client";

import type { WorkbenchAgentRuntimeInstallation } from "@workbench/agent-runtime-client/installation";
import type { PromptFeedbackPort } from "@workbench/agent-runtime-client/prompt-feedback";
import {
  createPiAgentRuntimeInstallation,
  type PiAgentRuntimeCopy,
} from "@workbench/agent-runtime-pi-client/installation";
import { workspaceDirectoryStorePort } from "@/workbench/workspaces/workspace-directory-store";

/**
 * The singular Agent Runtime installation selected by this Workbench build.
 *
 * Keep concrete Runtime imports in this application composition point. A registry and user-facing
 * selection policy belong here only after a second production implementation exists.
 */
export function createInstalledAgentRuntime(
  options: Readonly<{ copy: PiAgentRuntimeCopy; promptFeedback: PromptFeedbackPort }>,
): WorkbenchAgentRuntimeInstallation {
  return createPiAgentRuntimeInstallation({
    ...options,
    workspaceDirectoryStore: workspaceDirectoryStorePort,
  });
}
