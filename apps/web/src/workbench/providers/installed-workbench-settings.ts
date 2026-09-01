import type { WorkbenchSettingsPort } from "@workbench/agent-runtime-contracts/settings";
import {
  createPiWorkbenchSettingsClient,
  type PiWorkbenchSettingsClientOptions,
} from "@workbench/agent-runtime-pi-client/workbench-settings";
import { createRuntimeFetch, type RuntimeFetchImplementation } from "@workbench/host-client";
import type { RuntimeConnection } from "@workbench/host-contracts";
import { snapshotRuntimeConnection } from "@workbench/shell/runtime-connection";

export function createInstalledWorkbenchSettingsService(
  connection: RuntimeConnection,
  fetchImplementation?: RuntimeFetchImplementation,
): WorkbenchSettingsPort {
  const runtimeConnection = snapshotRuntimeConnection(connection);
  const options: PiWorkbenchSettingsClientOptions = Object.freeze({
    transport: createRuntimeFetch(runtimeConnection, fetchImplementation),
  });
  return createPiWorkbenchSettingsClient(options);
}
