import type { WorkbenchExtension } from "@workbench/extension-sdk";

import { archivedChatsExtension } from "./builtin/archived-chats";
import { appearanceExtension } from "./builtin/appearance";
import { localeSelectorExtension } from "./builtin/locale-selector";
import { messageActionsExtension } from "./builtin/message-actions";
import { messagePresentationExtension } from "./builtin/message-presentation";
import { messageQueueExtension } from "./builtin/message-queue";
import { settingsExtension } from "./builtin/settings";
import { terminalExtension } from "./builtin/terminal";
import { userMessageIndexExtension } from "./builtin/user-message-index";
import { workbenchBrandExtension } from "./builtin/workbench-brand";
import { workspaceArtifactExtension } from "./builtin/workspace-artifact";
import { workspaceBrowserExtension } from "./builtin/workspace-browser";
import { workspaceExplorerExtension } from "./builtin/workspace-explorer";
import { workspaceReviewExtension } from "./builtin/workspace-review";
import { workspaceSidebarExtension } from "./builtin/workspace-sidebar";
import { workspaceDirectoryPickerExtension } from "./builtin/workspace-directory-picker";
import { workspaceFileExtension } from "./builtin/workspace-file";
import { gitBranchExtension } from "./builtin/git-branch";

import { interactiveRequestsExtension } from "./builtin/interactive-requests";
import { sideChatExtension } from "./builtin/side-chat";
import { attachmentUnderstandingExtension } from "./builtin/image-understanding";
import { automationExtension } from "./builtin/automation";
import { modelSelectorExtension } from "./builtin/model-selector";
import { tokenUsageExtension } from "./builtin/token-usage";

/** Stable frame and conversation contributions mounted before runtime-specific setup. */
export const shellCoreExtensions: readonly WorkbenchExtension[] = Object.freeze([
  workbenchBrandExtension,
  workspaceSidebarExtension,
  appearanceExtension,
  localeSelectorExtension,
  messagePresentationExtension,
  messageActionsExtension,
  userMessageIndexExtension,
  messageQueueExtension,
  archivedChatsExtension,
]);

/** Generic, static settings host. Feature-specific actions register through their own extensions. */
export const shellSettingsExtensions: readonly WorkbenchExtension[] = Object.freeze([
  settingsExtension,
]);

/** Runtime-neutral workspace surfaces in stable activation order. */
export const shellWorkspaceExtensions: readonly WorkbenchExtension[] = Object.freeze([
  workspaceExplorerExtension,
  workspaceReviewExtension,
  workspaceBrowserExtension,
  workspaceArtifactExtension,
  terminalExtension,
  workspaceDirectoryPickerExtension,
  gitBranchExtension,
]);

/** File presentation follows runtime contributions in the existing application order. */
export const shellFileExtensions: readonly WorkbenchExtension[] = Object.freeze([
  workspaceFileExtension,
]);

export const shellExtensionGroups = Object.freeze({
  core: shellCoreExtensions,
  settings: shellSettingsExtensions,
  workspace: shellWorkspaceExtensions,
  files: shellFileExtensions,
  interactions: Object.freeze([interactiveRequestsExtension, sideChatExtension]),
  attachments: Object.freeze([attachmentUnderstandingExtension]),
  automations: Object.freeze([automationExtension]),
  models: Object.freeze([modelSelectorExtension]),
  context: Object.freeze([tokenUsageExtension]),
});

/** Default runtime-neutral installation for renderers without an app-specific interleave. */
export const shellBuiltinExtensions: readonly WorkbenchExtension[] = Object.freeze([
  ...shellCoreExtensions,
  ...shellSettingsExtensions,
  ...shellWorkspaceExtensions,
  ...shellExtensionGroups.interactions,
  ...shellExtensionGroups.attachments,
  ...shellExtensionGroups.automations,
  ...shellExtensionGroups.models,
  ...shellExtensionGroups.context,
  ...shellFileExtensions,
]);
