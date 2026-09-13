import type {
  BuiltinResourcePreferenceKey,
  WorkbenchSettingsProtocol,
} from "@workbench/agent-runtime-contracts/settings";
import type { WorkspaceFileReader } from "@workbench/agent-runtime-contracts/runtime-capabilities";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
  BuiltinToolSettings,
  ToolCapabilitySettings,
  AskUserCapabilitySettings,
} from "./tool-settings";
export interface PiBashToolFactoryInput {
  readonly cwd: string;
  readonly sessionId: string;
  readonly commandPrefix?: string;
  readonly shellPath?: string;
}

export interface PiAgentHostBindings {
  readonly workbenchSettings?: Pick<WorkbenchSettingsProtocol, "describe" | "update">;
  readonly getDefaultTerminalShell?: () => string;
  readonly workspaceFiles?: WorkspaceFileReader;
  readonly createBashToolOverride?: (input: PiBashToolFactoryInput) => ToolDefinition;
  readonly askUserSettings?: AskUserCapabilitySettings;
  readonly todoSettings?: ToolCapabilitySettings;
  readonly workbenchSettingsToolSettings?: ToolCapabilitySettings;
  readonly readBuiltinResourceEnabled?: (key: BuiltinResourcePreferenceKey) => Promise<boolean>;
  readonly builtinToolSettings?: BuiltinToolSettings;
  readonly readSessionPreferences?: () => Promise<{
    enhancedSearch: boolean;
    retainAllModelIO: boolean;
  }>;
}
