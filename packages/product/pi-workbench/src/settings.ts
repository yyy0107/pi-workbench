import type { WorkbenchSettingsPort } from "@workbench/agent-runtime-contracts/settings";
import {
  createWorkbenchSettingsClient,
  type WorkbenchSettingsClientOptions,
} from "@workbench/services-client/settings";
import {
  createRuntimeFetch,
  type RuntimeFetchImplementation,
} from "@workbench/runtime-transport-client";
import type { RuntimeConnection } from "@workbench/runtime-contracts";
import { snapshotRuntimeConnection } from "@workbench/shell-context/runtime-connection";

export function createInstalledWorkbenchSettingsService(
  connection: RuntimeConnection,
  fetchImplementation?: RuntimeFetchImplementation,
): WorkbenchSettingsPort {
  const runtimeConnection = snapshotRuntimeConnection(connection);
  const options: WorkbenchSettingsClientOptions = Object.freeze({
    transport: createRuntimeFetch(runtimeConnection, fetchImplementation),
  });
  return createWorkbenchSettingsClient(options);
}
