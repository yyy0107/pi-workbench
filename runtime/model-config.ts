export const WORKBENCH_CHAT_ENDPOINT = "/api/chat";

export interface WorkbenchModelConfig {
  modelName: string;
  reasoningEffort?: string;
}

export const DEFAULT_WORKBENCH_MODEL_CONFIG = {
  modelName: "gpt-5.6-luna",
  reasoningEffort: "medium",
} as const satisfies WorkbenchModelConfig;
