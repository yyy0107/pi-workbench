import type {
  WorkbenchSettingsPreferences,
  WorkbenchSettingsPreferencesPatch,
  WorkbenchSettingsPort,
} from "@workbench/agent-runtime-contracts/settings";
import type { RuntimeFetch } from "@workbench/host-client";
export { toWorkbenchSettingsJsonObject } from "@workbench/agent-runtime-contracts/settings";
import type {
  WorkbenchSettingsSnapshot as WorkbenchSettingsDescribeValue,
  WorkbenchSettingsUpdate as WorkbenchSettingsUpdatePayload,
  WorkbenchSettingsUpdateResult as WorkbenchSettingsUpdateValue,
} from "@workbench/agent-runtime-contracts/settings";
import { callServiceRpc } from "./errors";
import type { RpcCallOptions } from "@workbench/host-client/rpc";

export function describeWorkbenchSettings(
  options?: RpcCallOptions,
): Promise<WorkbenchSettingsDescribeValue> {
  return callServiceRpc("workbenchSettings.describe", {}, options);
}

export function openWorkbenchSettingsDocument(options?: RpcCallOptions): Promise<{ opened: true }> {
  return callServiceRpc("workbenchSettings.openDocument", {}, options);
}

export function updateWorkbenchSettings(
  payload: WorkbenchSettingsUpdatePayload,
  options?: RpcCallOptions,
): Promise<WorkbenchSettingsUpdateValue> {
  return callServiceRpc("workbenchSettings.update", payload, options);
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

/** One Runtime installation's cached Workbench preferences and mutation queue. */
export class WorkbenchSettingsClient {
  private readonly options: Readonly<RpcCallOptions>;
  private snapshot: WorkbenchSettingsPreferences | undefined;
  private loadPromise: Promise<WorkbenchSettingsPreferences> | undefined;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(options: Readonly<RpcCallOptions>) {
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

export interface WorkbenchSettingsClientOptions {
  readonly transport?: RuntimeFetch;
}

/** Create one cached Workbench settings client bound to an immutable Runtime transport. */
export function createWorkbenchSettingsClient(
  callerOptions: WorkbenchSettingsClientOptions = {},
): WorkbenchSettingsPort {
  const transport = callerOptions.transport;
  const options: WorkbenchSettingsClientOptions = Object.freeze(
    transport === undefined ? {} : { transport },
  );
  return new WorkbenchSettingsClient(options);
}
