"use client";

import type { WorkbenchSettingsPort } from "@workbench/agent-runtime-contracts/settings";
import type { RuntimeFetch } from "@workbench/host-client";

import { PiWorkbenchSettingsClient } from "../settings/workbench-settings-client";

export interface PiWorkbenchSettingsClientOptions {
  readonly transport?: RuntimeFetch;
}

/** Create one cached Workbench settings client bound to an immutable Runtime transport. */
export function createPiWorkbenchSettingsClient(
  callerOptions: PiWorkbenchSettingsClientOptions = {},
): WorkbenchSettingsPort {
  const transport = callerOptions.transport;
  const options: PiWorkbenchSettingsClientOptions = Object.freeze(
    transport === undefined ? {} : { transport },
  );
  return new PiWorkbenchSettingsClient(options);
}
