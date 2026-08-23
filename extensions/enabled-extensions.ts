import type { WorkbenchExtension } from "@/platform/extensions";

import { agentConfigurationExtension } from "./builtin/agent-configuration";
import { archivedChatsExtension } from "./builtin/archived-chats";
import { appearanceExtension } from "./builtin/appearance";
import { connectionStatusExtension } from "./builtin/connection-status";
import { imageUnderstandingExtension } from "./builtin/image-understanding";
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
import { tokenUsageExtension } from "./builtin/token-usage";
import { userMessageIndexExtension } from "./builtin/user-message-index";
import { workbenchBrandExtension } from "./builtin/workbench-brand";
import { workspaceDirectoryPickerExtension } from "./builtin/workspace-directory-picker";
import { workspaceArtifactExtension } from "./builtin/workspace-artifact";
import { workspaceBrowserExtension } from "./builtin/workspace-browser";
import { workspaceExplorerExtension } from "./builtin/workspace-explorer";
import { workspaceFileExtension } from "./builtin/workspace-file";
import { workspaceReviewExtension } from "./builtin/workspace-review";

export const enabledExtensions = [
  workbenchBrandExtension,
  workspaceDirectoryPickerExtension,
  settingsExtension,
  agentConfigurationExtension,
  interactiveRequestsExtension,
  appearanceExtension,
  localeSelectorExtension,
  messagePresentationExtension,
  messageActionsExtension,
  userMessageIndexExtension,
  messageQueueExtension,
  settingModelConfigExtension,
  imageUnderstandingExtension,
  skillsExtension,
  piExtensionsExtension,
  archivedChatsExtension,
  modelSelectorExtension,
  connectionStatusExtension,
  tokenUsageExtension,
  workspaceFileExtension,
  workspaceExplorerExtension,
  workspaceReviewExtension,
  workspaceBrowserExtension,
  workspaceArtifactExtension,
  terminalExtension,
] satisfies readonly WorkbenchExtension[];
