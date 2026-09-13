import * as Settings from "@workbench/pi-sdk-resources/settings";
import { resolvePiWorkspaceRoot } from "../workspaces/workspace-registry";
export class AgentSettingsService extends Settings.AgentSettingsService {
  constructor(options: Settings.AgentSettingsServiceOptions = {}) {
    super({ resolveWorkspaceRoot: resolvePiWorkspaceRoot, ...options });
  }
}
