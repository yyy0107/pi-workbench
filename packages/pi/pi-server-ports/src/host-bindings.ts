import type {
  BuiltinResourcePreferenceKey,
  WorkbenchSettingsProtocol,
} from "@workbench/agent-runtime-contracts/settings";
import type { BrowserHost } from "@workbench/pi-browser";
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
  readonly browser?: BrowserHost;
  readonly workbenchSettings?: Pick<WorkbenchSettingsProtocol, "describe" | "update">;
  readonly getDefaultTerminalShell?: () => string;
  readonly workspaceFiles?: Pick<
    import("@workbench/workspace-server/files").WorkspaceFileService,
    "readFile"
  >;
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
