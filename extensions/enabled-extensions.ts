import type { WorkbenchExtension } from "@/platform/extensions";

import { archivedChatsExtension } from "./builtin/archived-chats";
import { appearanceExtension } from "./builtin/appearance";
import { hardwareAccelerationExtension } from "./builtin/hardware-acceleration";
import { localeSelectorExtension } from "./builtin/locale-selector";
import { messageActionsExtension } from "./builtin/message-actions";
import { messagePresentationExtension } from "./builtin/message-presentation";
import { messageQueueExtension } from "./builtin/message-queue";
import { terminalExtension } from "./builtin/terminal";
import { userMessageIndexExtension } from "./builtin/user-message-index";
import { workbenchBrandExtension } from "./builtin/workbench-brand";
import { workspaceArtifactExtension } from "./builtin/workspace-artifact";
import { workspaceBrowserExtension } from "./builtin/workspace-browser";
import { workspaceExplorerExtension } from "./builtin/workspace-explorer";
import { workspaceReviewExtension } from "./builtin/workspace-review";

/** Runtime-neutral extensions that remain mounted when the selected Agent Runtime changes. */
export const builtinExtensions = [
  workbenchBrandExtension,
  appearanceExtension,
  localeSelectorExtension,
  hardwareAccelerationExtension,
  messagePresentationExtension,
  messageActionsExtension,
  userMessageIndexExtension,
  messageQueueExtension,
  archivedChatsExtension,
  workspaceExplorerExtension,
  workspaceReviewExtension,
  workspaceBrowserExtension,
  workspaceArtifactExtension,
  terminalExtension,
] satisfies readonly WorkbenchExtension[];
