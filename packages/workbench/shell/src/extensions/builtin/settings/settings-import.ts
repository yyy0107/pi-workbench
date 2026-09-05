import type {
  WorkbenchSettingsPreferences,
  WorkbenchSettingsPreferencesPatch,
} from "../../../settings";

const PORTABLE_KEYS = [
  "appearance",
  "backgroundImage",
  "locale",
  "modelSelector",
  "askUserEnabled",
  "runningMessageMode",
  "showReasoning",
  "groupParallelTools",
  "enhancedSearch",
  "askUserAutoContinue",
  "retainAllModelIO",
  "showTodos",
  "groupExplorationTools",
  "groupTerminalTools",
  "groupFileChanges",
] as const satisfies readonly (keyof WorkbenchSettingsPreferences)[];

/** Import portable preferences only. The settings service validates every value before atomic save. */
export function readSettingsImport(text: string): WorkbenchSettingsPreferencesPatch {
  const document: unknown = JSON.parse(text);
  if (!document || typeof document !== "object" || Array.isArray(document))
    throw new Error("invalid-settings-import");
  if ("version" in document && document.version !== 1)
    throw new Error("unsupported-settings-version");
  const preferences = "preferences" in document ? document.preferences : document;
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences))
    throw new Error("invalid-settings-import");
  const entries = Object.entries(preferences).filter(([key]) =>
    PORTABLE_KEYS.includes(key as (typeof PORTABLE_KEYS)[number]),
  );
  if (entries.length === 0) throw new Error("empty-settings-import");
  return Object.fromEntries(entries) as WorkbenchSettingsPreferencesPatch;
}
