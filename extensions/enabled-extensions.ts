import type { WorkbenchExtension } from "@/platform/extensions";

import { agentConfigurationExtension } from "./builtin/agent-configuration";
import { archivedChatsExtension } from "./builtin/archived-chats";
import { appearanceExtension } from "./builtin/appearance";
import { connectionStatusExtension } from "./builtin/connection-status";
import { contextTraceExtension } from "./builtin/context-trace";
import { externalSessionImportExtension } from "./builtin/external-session-import";
import { gitBranchExtension } from "./builtin/git-branch";
import { hardwareAccelerationExtension } from "./builtin/hardware-acceleration";
import { attachmentUnderstandingExtension } from "./builtin/image-understanding";
import { interactiveRequestsExtension } from "./builtin/interactive-requests";
import { localeSelectorExtension } from "./builtin/locale-selector";
import { messageActionsExtension } from "./builtin/message-actions";
import { messagePresentationExtension } from "./builtin/message-presentation";
import { messageQueueExtension } from "./builtin/message-queue";
import { modelSelectorExtension } from "./builtin/model-selector";
import { piExtensionsExtension } from "./builtin/pi-extensions";
import { settingModelConfigExtension } from "./builtin/setting-model-config";
import { settingsExtension } from "./builtin/settings";
import { skillsExtension } from "./builtin/skills";
import { terminalExtension } from "./builtin/terminal";
import { toolboxExtension } from "./builtin/toolbox";
import { tokenUsageExtension } from "./builtin/token-usage";
import { userMessageIndexExtension } from "./builtin/user-message-index";
import { workbenchBrandExtension } from "./builtin/workbench-brand";
import { workspaceDirectoryPickerExtension } from "./builtin/workspace-directory-picker";
import { workspaceArtifactExtension } from "./builtin/workspace-artifact";
import { workspaceBrowserExtension } from "./builtin/workspace-browser";
import { workspaceExplorerExtension } from "./builtin/workspace-explorer";
import { workspaceFileExtension } from "./builtin/workspace-file";
import { workspaceReviewExtension } from "./builtin/workspace-review";
import { workflowsExtension } from "./builtin/workflows";

/** 随 Workbench 固定启用、不可由用户卸载的内建扩展。 */
export const builtinExtensions = [
  workbenchBrandExtension,
  workspaceDirectoryPickerExtension,
  gitBranchExtension,
  settingsExtension,
  agentConfigurationExtension,
  interactiveRequestsExtension,
  appearanceExtension,
  localeSelectorExtension,
  hardwareAccelerationExtension,
  messagePresentationExtension,
  messageActionsExtension,
  userMessageIndexExtension,
  messageQueueExtension,
  settingModelConfigExtension,
  attachmentUnderstandingExtension,
  skillsExtension,
  piExtensionsExtension,
  toolboxExtension,
  workflowsExtension,
  archivedChatsExtension,
  modelSelectorExtension,
  connectionStatusExtension,
  contextTraceExtension,
  externalSessionImportExtension,
  tokenUsageExtension,
  workspaceFileExtension,
  workspaceExplorerExtension,
  workspaceReviewExtension,
  workspaceBrowserExtension,
  workspaceArtifactExtension,
  terminalExtension,
] satisfies readonly WorkbenchExtension[];
