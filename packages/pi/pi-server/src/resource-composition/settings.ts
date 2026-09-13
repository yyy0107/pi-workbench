import * as Settings from "@workbench/pi-resources-server/settings";
import { resolvePiWorkspaceRoot } from "../workspaces/workspace-registry";
export class AgentSettingsService extends Settings.AgentSettingsService {
  constructor(options: Settings.AgentSettingsServiceOptions = {}) {
    super({ resolveWorkspaceRoot: resolvePiWorkspaceRoot, ...options });
  }
}
