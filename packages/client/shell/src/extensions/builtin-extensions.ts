import type { WorkbenchExtension } from "@workbench/extension-sdk";

import { archivedChatsExtension } from "@workbench/ui-settings-archived-chats";
import { appearanceExtension } from "@workbench/ui-theme";
import { localeSelectorExtension } from "@workbench/ui-settings-general";
import { messageActionsExtension } from "@workbench/ui-message-actions";
import { messagePresentationExtension } from "@workbench/ui-conversation-nodes/message-presentation";
import { messageQueueExtension } from "@workbench/ui-message-queue";
import { todoPanelExtension } from "@workbench/ui-todo";
import { createSettingsExtension } from "@workbench/ui-settings";
import { registerGeneralSettings } from "@workbench/ui-settings-general";

export const settingsExtension = createSettingsExtension(registerGeneralSettings);
import { terminalExtension } from "@workbench/ui-terminal";
import { userMessageIndexExtension } from "@workbench/ui-user-message-index";
import { workbenchBrandExtension } from "@workbench/ui-layout/extension";
import { workspaceArtifactExtension } from "@workbench/workspace-artifact";
import { workspaceBrowserExtension } from "@workbench/workspace-browser";
import { workspaceExplorerExtension } from "@workbench/workspace-explorer";
import { workspaceReviewExtension } from "@workbench/workspace-review";
import { workspaceSidebarExtension } from "@workbench/ui-conversation-list/extension";
import { workspaceDirectoryPickerExtension } from "@workbench/workspace-directory-picker";
import { workspaceFileExtension } from "@workbench/workspace-file-view";
import { gitBranchExtension } from "@workbench/workspace-git-branch";

import { interactiveRequestsExtension } from "@workbench/ui-user-questions";
import { sideChatExtension } from "@workbench/ui-side-chat";
import { automationExtension } from "@workbench/ui-automation";
import { modelSelectorExtension } from "@workbench/ui-model-selection";
import { tokenUsageExtension } from "@workbench/ui-token-usage";

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
  todoPanelExtension,
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
  ...shellExtensionGroups.automations,
  ...shellExtensionGroups.models,
  ...shellExtensionGroups.context,
  ...shellFileExtensions,
]);
