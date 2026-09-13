import type { WorkbenchExtension } from "@workbench/extension-sdk";

import { archivedChatsExtension } from "@workbench/conversation/archived-chats";
import { appearanceExtension } from "@workbench/settings-ui";
import { localeSelectorExtension } from "@workbench/settings-ui";
import { messageActionsExtension } from "@workbench/conversation/message-actions";
import { messagePresentationExtension } from "@workbench/conversation/message-presentation";
import { messageQueueExtension } from "@workbench/conversation/message-queue";
import { todoPanelExtension } from "@workbench/conversation/todo-panel";
import { settingsExtension } from "@workbench/settings-ui";
import { terminalExtension } from "@workbench/terminal-ui";
import { userMessageIndexExtension } from "@workbench/conversation/user-message-index";
import { workbenchBrandExtension } from "./workbench-brand";
import { workspaceArtifactExtension } from "@workbench/workspace-artifact";
import { workspaceBrowserExtension } from "@workbench/workspace-browser";
import { workspaceExplorerExtension } from "@workbench/workspace-explorer";
import { workspaceReviewExtension } from "@workbench/workspace-review";
import { workspaceSidebarExtension } from "./workspace-sidebar";
import { workspaceDirectoryPickerExtension } from "@workbench/workspace-directory-picker";
import { workspaceFileExtension } from "@workbench/workspace-file-view";
import { gitBranchExtension } from "@workbench/workspace-git-branch";

import { interactiveRequestsExtension } from "@workbench/conversation/interactive-requests";
import { sideChatExtension } from "@workbench/conversation/side-chat";
import { automationExtension } from "@workbench/automation-ui";
import { modelSelectorExtension } from "@workbench/agent-controls";
import { tokenUsageExtension } from "@workbench/agent-controls";

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
