"use client";

import { useToolCapabilityPreferences } from "../../../tool-capability-preferences";

export {
  ASK_USER_PREFERENCES_STORAGE_KEY,
  createToolCapabilityPreferences as createAskUserPreferences,
  parseAskUserEnabled,
  type ToolCapabilityPreferenceSnapshot as AskUserPreferenceSnapshot,
  type ToolCapabilityPreferences as AskUserPreferences,
} from "../../../tool-capability-preferences";

export function useAskUserPreferences() {
  return useToolCapabilityPreferences("askUserEnabled");
}
