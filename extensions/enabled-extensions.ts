import type { WorkbenchExtension } from "@/platform/extensions";

import { connectionStatusExtension } from "./builtin/connection-status";
import { modelSelectorExtension } from "./builtin/model-selector";
import { skillsExtension } from "./builtin/skills";
import { terminalExtension } from "./builtin/terminal";
import { tokenUsageExtension } from "./builtin/token-usage";
import { workbenchBrandExtension } from "./builtin/workbench-brand";
import { workspaceDirectoryPickerExtension } from "./builtin/workspace-directory-picker";

export const enabledExtensions = [
  workbenchBrandExtension,
  workspaceDirectoryPickerExtension,
  modelSelectorExtension,
  connectionStatusExtension,
  tokenUsageExtension,
  skillsExtension,
  terminalExtension,
] satisfies readonly WorkbenchExtension[];
