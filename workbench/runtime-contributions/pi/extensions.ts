import type { WorkbenchExtension } from "@/platform/extensions";

import { agentConfigurationExtension } from "@/extensions/builtin/agent-configuration";
import { connectionStatusExtension } from "@/extensions/builtin/connection-status";
import { contextTraceExtension } from "@/extensions/builtin/context-trace";
import { executionExtension } from "@/extensions/builtin/execution";
import { externalSessionImportExtension } from "@/extensions/builtin/external-session-import";
import { gitBranchExtension } from "@/extensions/builtin/git-branch";
import { attachmentUnderstandingExtension } from "@/extensions/builtin/image-understanding";
import { interactiveRequestsExtension } from "@/extensions/builtin/interactive-requests";
import { modelSelectorExtension } from "@/extensions/builtin/model-selector";
import { piExtensionsExtension } from "@/extensions/builtin/pi-extensions";
import { settingModelConfigExtension } from "@/extensions/builtin/setting-model-config";
import { settingsExtension } from "@/extensions/builtin/settings";
import { sideChatExtension } from "@/extensions/builtin/side-chat";
import { skillsExtension } from "@/extensions/builtin/skills";
import { tokenUsageExtension } from "@/extensions/builtin/token-usage";
import { toolboxExtension } from "@/extensions/builtin/toolbox";
import { workspaceDirectoryPickerExtension } from "@/extensions/builtin/workspace-directory-picker";
import { workspaceFileExtension } from "@/extensions/builtin/workspace-file";

/**
 * UI contributions supplied by the statically selected Pi runtime.
 *
 * Keeping this list beside the Pi application boundary prevents runtime-specific capabilities from
 * becoming unconditional Workbench Core dependencies. A future adapter supplies a sibling list.
 */
export const piAgentRuntimeExtensions = [
  workspaceDirectoryPickerExtension,
  gitBranchExtension,
  settingsExtension,
  agentConfigurationExtension,
  interactiveRequestsExtension,
  sideChatExtension,
  settingModelConfigExtension,
  attachmentUnderstandingExtension,
  skillsExtension,
  piExtensionsExtension,
  toolboxExtension,
  executionExtension,
  modelSelectorExtension,
  connectionStatusExtension,
  contextTraceExtension,
  externalSessionImportExtension,
  tokenUsageExtension,
  workspaceFileExtension,
] satisfies readonly WorkbenchExtension[];
