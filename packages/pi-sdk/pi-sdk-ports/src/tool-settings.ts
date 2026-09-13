import type { BuiltinToolName } from "@workbench/agent-runtime-contracts/settings";
export interface ToolCapabilitySettings {
  readEnabled(): Promise<boolean>;
  subscribe(listener: (enabled: boolean) => void): () => void;
}
export interface AskUserCapabilitySettings extends ToolCapabilitySettings {
  readAutoContinue?(): Promise<boolean>;
  subscribeAutoContinue?(listener: (enabled: boolean) => void): () => void;
}
export type BuiltinToolSettings = (name: BuiltinToolName) => ToolCapabilitySettings;
