"use client";

import type {
  WorkbenchSettingsJsonValue,
  WorkbenchSettingsPreferences,
  WorkbenchSettingsPreferencesPatch,
} from "../../rpc-contracts";
import { describeWorkbenchSettings, updateWorkbenchSettings } from "../transport/api";

let snapshot: WorkbenchSettingsPreferences | undefined;
let loadPromise: Promise<WorkbenchSettingsPreferences> | undefined;
let mutationTail: Promise<void> = Promise.resolve();

export function toWorkbenchSettingsJsonObject(
  value: object,
): Record<string, WorkbenchSettingsJsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, WorkbenchSettingsJsonValue>;
}

function applyPatch(
  current: WorkbenchSettingsPreferences,
  patch: WorkbenchSettingsPreferencesPatch,
): WorkbenchSettingsPreferences {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key as keyof WorkbenchSettingsPreferences];
    else if (value !== undefined) {
      Object.assign(next, { [key]: value });
    }
  }
  return next;
}

export function loadWorkbenchSettingsPreferences(): Promise<WorkbenchSettingsPreferences> {
  if (snapshot) return Promise.resolve(snapshot);
  loadPromise ??= describeWorkbenchSettings()
    .then((value) => {
      snapshot = value.preferences;
      return snapshot;
    })
    .finally(() => {
      loadPromise = undefined;
    });
  return loadPromise;
}

export function updateWorkbenchSettingsPreferences(
  patch: WorkbenchSettingsPreferencesPatch,
): Promise<void> {
  const operation = async (): Promise<void> => {
    const current = await loadWorkbenchSettingsPreferences();
    await updateWorkbenchSettings({ patch });
    snapshot = applyPatch(current, patch);
  };
  const result = mutationTail.then(operation, operation);
  mutationTail = result.catch(() => undefined);
  return result;
}
