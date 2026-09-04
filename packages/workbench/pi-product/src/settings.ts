import type { WorkbenchSettingsPort } from "@workbench/agent-runtime-contracts/settings";
import {
  createWorkbenchSettingsClient,
  type WorkbenchSettingsClientOptions,
} from "@workbench/services-client/settings";
import { createRuntimeFetch, type RuntimeFetchImplementation } from "@workbench/host-client";
import type { RuntimeConnection } from "@workbench/host-contracts";
import { snapshotRuntimeConnection } from "@workbench/shell/runtime-connection";

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
