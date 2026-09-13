import { createFindToolDefinition } from "@earendil-works/pi-coding-agent";
import { withMultiRootSearch } from "../../lib/multi-root-search";

export function createWorkbenchFindTool(cwd: string) {
  return withMultiRootSearch(cwd, createFindToolDefinition(cwd));
}
