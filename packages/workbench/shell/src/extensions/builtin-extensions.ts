import type { WorkbenchExtension } from "@workbench/extension-sdk";

import { archivedChatsExtension } from "./builtin/archived-chats";
import { appearanceExtension } from "./builtin/appearance";
import { hardwareAccelerationExtension } from "./builtin/hardware-acceleration";
import { localeSelectorExtension } from "./builtin/locale-selector";
import { messageActionsExtension } from "./builtin/message-actions";
import { messagePresentationExtension } from "./builtin/message-presentation";
import { messageQueueExtension } from "./builtin/message-queue";
import { settingsExtension } from "./builtin/settings";
import { userMessageIndexExtension } from "./builtin/user-message-index";
import { workbenchBrandExtension } from "./builtin/workbench-brand";
import { workspaceArtifactExtension } from "./builtin/workspace-artifact";
import { workspaceBrowserExtension } from "./builtin/workspace-browser";

/** Stable frame and conversation contributions mounted before runtime-specific setup. */
export const shellCoreExtensions: readonly WorkbenchExtension[] = Object.freeze([
  workbenchBrandExtension,
  appearanceExtension,
  localeSelectorExtension,
  hardwareAccelerationExtension,
  messagePresentationExtension,
  messageActionsExtension,
  userMessageIndexExtension,
  messageQueueExtension,
  archivedChatsExtension,
]);

/** Generic settings host. Applications may replace this group with a factory-built variant. */
export const shellSettingsExtensions: readonly WorkbenchExtension[] = Object.freeze([
  settingsExtension,
]);

/** Generic auxiliary workspace contributions mounted after runtime-owned workspace surfaces. */
export const shellWorkspaceExtensions: readonly WorkbenchExtension[] = Object.freeze([
  workspaceBrowserExtension,
  workspaceArtifactExtension,
]);

export const shellExtensionGroups = Object.freeze({
  core: shellCoreExtensions,
  settings: shellSettingsExtensions,
  workspace: shellWorkspaceExtensions,
});

/** Default runtime-neutral installation for renderers without an app-specific interleave. */
export const shellBuiltinExtensions: readonly WorkbenchExtension[] = Object.freeze([
  ...shellCoreExtensions,
  ...shellSettingsExtensions,
  ...shellWorkspaceExtensions,
]);
