import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { workbenchToolSourceDirectory } from "@workbench/pi-tools/resources";
import { ensureWorkbenchBuiltinResources as ensureBuiltinResources } from "@workbench/pi-resources-server/builtin-resources";
export function ensureWorkbenchBuiltinResources(agentDir = getAgentDir()) {
  return ensureBuiltinResources(agentDir, workbenchToolSourceDirectory());
}
