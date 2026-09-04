"use client";

import type {
  WorkbenchSettingsPreferences,
  WorkbenchSettingsPreferencesPatch,
} from "@workbench/agent-runtime-contracts/settings";
export { toWorkbenchSettingsJsonObject } from "@workbench/agent-runtime-contracts/settings";
import {
  describeWorkbenchSettings,
  updateWorkbenchSettings,
  type PiRpcCallOptions,
} from "../transport/api";

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

/** One Runtime installation's cached Workbench preferences and mutation queue. */
export class PiWorkbenchSettingsClient {
  private readonly options: Readonly<PiRpcCallOptions>;
  private snapshot: WorkbenchSettingsPreferences | undefined;
  private loadPromise: Promise<WorkbenchSettingsPreferences> | undefined;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(options: Readonly<PiRpcCallOptions>) {
    this.options = options;
  }

  private readonly loadCurrent = (): Promise<WorkbenchSettingsPreferences> => {
    if (this.snapshot) return Promise.resolve(this.snapshot);
    this.loadPromise ??= describeWorkbenchSettings(this.options)
      .then((value) => {
        this.snapshot = value.preferences;
        return this.snapshot;
      })
      .finally(() => {
        this.loadPromise = undefined;
      });
    return this.loadPromise;
  };

  load = async (): Promise<WorkbenchSettingsPreferences> => {
    await this.mutationTail;
    return this.loadCurrent();
  };

  update = (patch: WorkbenchSettingsPreferencesPatch): Promise<void> => {
    const operation = async (): Promise<void> => {
      const current = await this.loadCurrent();
      await updateWorkbenchSettings({ patch }, this.options);
      this.snapshot = applyPatch(current, patch);
    };
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.catch(() => undefined);
    return result;
  };
}
