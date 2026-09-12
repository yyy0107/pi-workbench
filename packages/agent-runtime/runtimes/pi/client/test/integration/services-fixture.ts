import type { WorkbenchServicesCapabilities } from "@workbench/agent-runtime-client/capabilities";
import type { RpcCallOptions } from "@workbench/host-client/rpc";
import { createWorkbenchSettingsClient } from "@workbench/services-client/settings";
import { createHostClient } from "@workbench/services-client/host";
import { createWorkspaceClient } from "@workbench/services-client/workspace";
import { createAutomationClient } from "@workbench/services-client/automation";
export function createTestServices(options: RpcCallOptions = {}): WorkbenchServicesCapabilities {
  return {
    settings: createWorkbenchSettingsClient(options),
    host: createHostClient(options),
    workspace: createWorkspaceClient(options),
    automation: createAutomationClient(options),
  };
}
