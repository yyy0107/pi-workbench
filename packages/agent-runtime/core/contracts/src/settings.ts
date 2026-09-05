import type { Locale } from "@workbench/contracts/locale";

export type WorkbenchSettingsJsonValue =
  | null
  | boolean
  | number
  | string
  | WorkbenchSettingsJsonValue[]
  | { [key: string]: WorkbenchSettingsJsonValue };

export interface WorkbenchBackgroundImagePreference {
  readonly name: string;
  readonly mimeType: string;
  /** Base64-encoded image bytes without a data URL prefix. */
  readonly data: string;
}

export interface WorkbenchModelSelectorPreference {
  readonly modelId: string;
  readonly reasoningEffort?: string;
}

export type WorkbenchSidebarThreadSortMode = "priority" | "recent" | "manual";

export type WorkbenchToolboxScopePreference =
  | Readonly<{ kind: "user" }>
  | Readonly<{ kind: "project"; workspaceId: string }>;

/** Workbench-owned preferences. Runtime adapters provide persistence, not the schema. */
export interface WorkbenchSettingsPreferences {
  appearance?: Record<string, WorkbenchSettingsJsonValue>;
  askUserEnabled?: boolean;
  todoEnabled?: boolean;
  runningMessageMode?: "queue" | "steer";
  showReasoning?: boolean;
  groupParallelTools?: boolean;
  enhancedSearch?: boolean;
  askUserAutoContinue?: boolean;
  retainAllModelIO?: boolean;
  showTodos?: boolean;
  groupExplorationTools?: boolean;
  groupTerminalTools?: boolean;
  groupFileChanges?: boolean;
  backgroundImage?: WorkbenchBackgroundImagePreference;
  locale?: Locale;
  modelSelector?: WorkbenchModelSelectorPreference;
  sidebarExpandedWorkspaceIds?: string[];
  sidebarSelectedThreadId?: string;
  sidebarThreadOrderByScope?: Record<string, string[]>;
  sidebarThreadSortMode?: WorkbenchSidebarThreadSortMode;
  toolboxPins?: string[];
  toolboxScope?: WorkbenchToolboxScopePreference;
  rightWorkspace?: Record<string, WorkbenchSettingsJsonValue>;
  sidebarOpen?: boolean;
}

export type WorkbenchSettingsPreferencesPatch = {
  [Key in keyof WorkbenchSettingsPreferences]?: WorkbenchSettingsPreferences[Key] | null;
};

export interface WorkbenchSettingsSnapshot {
  readonly revision: number;
  readonly preferences: WorkbenchSettingsPreferences;
}

export interface WorkbenchSettingsUpdate {
  readonly patch: WorkbenchSettingsPreferencesPatch;
}

export interface WorkbenchSettingsUpdateResult {
  readonly revision: number;
}

/** Host-side settings operations shared by transports and persistence implementations. */
export interface WorkbenchSettingsProtocol {
  describe(): Promise<WorkbenchSettingsSnapshot>;
  prepareDocument(): Promise<string>;
  update(payload: WorkbenchSettingsUpdate): Promise<WorkbenchSettingsUpdateResult>;
}

export interface WorkbenchSettingsPort {
  load(): Promise<WorkbenchSettingsPreferences>;
  update(patch: WorkbenchSettingsPreferencesPatch): Promise<void>;
}

export function toWorkbenchSettingsJsonObject(
  value: object,
): Record<string, WorkbenchSettingsJsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, WorkbenchSettingsJsonValue>;
}
