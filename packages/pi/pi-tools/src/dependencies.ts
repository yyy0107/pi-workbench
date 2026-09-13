import type { PiAgentHostBindings } from "@workbench/pi-server-ports/host";
import type { PiToolContextTrace } from "@workbench/pi-server-ports/tool-trace";
import type { BuiltinResourcePreferenceKey } from "@workbench/agent-runtime-contracts/settings";
import type {
  AgentSettingsProtocol,
  AgentSettingsUpdateRequest,
} from "@workbench/pi-resources-server/settings";
import type { RpcValidator } from "@workbench/api/validation";
export interface WorkbenchToolDependencies {
  getHostBindings(): PiAgentHostBindings;
  getSessionContextTrace(sessionId: string): PiToolContextTrace | undefined;
  isBuiltinResourceEnabled(key: BuiltinResourcePreferenceKey): Promise<boolean>;
  createAgentSettingsService(): Pick<AgentSettingsProtocol, "describe" | "update">;
  listWorkspaces(): Promise<readonly { workspaceId: string; path: string }[]>;
  validateSettingsUpdate: RpcValidator<AgentSettingsUpdateRequest>;
}
