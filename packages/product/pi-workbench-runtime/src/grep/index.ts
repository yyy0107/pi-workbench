import { createGrepToolDefinition } from "@earendil-works/pi-coding-agent";
import { withMultiRootSearch } from "../../lib/multi-root-search";

export function createWorkbenchGrepTool(cwd: string) {
  return withMultiRootSearch(cwd, createGrepToolDefinition(cwd));
}
