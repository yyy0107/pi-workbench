import type { WorkbenchExtension } from "@/platform/extensions";

import { appearanceExtension } from "./builtin/appearance";
import { codeEditorExtension } from "./builtin/code-editor";
import { connectionStatusExtension } from "./builtin/connection-status";
import { interactiveRequestsExtension } from "./builtin/interactive-requests";
import { localeSelectorExtension } from "./builtin/locale-selector";
import { messageActionsExtension } from "./builtin/message-actions";
import { messagePresentationExtension } from "./builtin/message-presentation";
import { messageQueueExtension } from "./builtin/message-queue";
import { modelSelectorExtension } from "./builtin/model-selector";
import { settingsExtension } from "./builtin/settings";
import { skillsExtension } from "./builtin/skills";
import { terminalExtension } from "./builtin/terminal";
import { tokenUsageExtension } from "./builtin/token-usage";
import { workbenchBrandExtension } from "./builtin/workbench-brand";
import { workspaceDirectoryPickerExtension } from "./builtin/workspace-directory-picker";

export const enabledExtensions = [
  workbenchBrandExtension,
  workspaceDirectoryPickerExtension,
  settingsExtension,
  interactiveRequestsExtension,
  appearanceExtension,
  localeSelectorExtension,
  messagePresentationExtension,
  messageActionsExtension,
  messageQueueExtension,
  modelSelectorExtension,
  connectionStatusExtension,
  tokenUsageExtension,
  codeEditorExtension,
  skillsExtension,
  terminalExtension,
] satisfies readonly WorkbenchExtension[];
