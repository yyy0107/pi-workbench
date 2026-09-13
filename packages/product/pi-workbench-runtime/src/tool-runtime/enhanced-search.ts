import { createWorkbenchGrepTool } from "../grep/index";
import { createWorkbenchFindTool } from "../find/index";

/** Keep the existing platform policy and ordering for enhanced search overrides. */
export function createEnhancedSearchTools(cwd: string) {
  return [
    createWorkbenchGrepTool(cwd),
    ...(process.platform === "win32" ? [] : [createWorkbenchFindTool(cwd)]),
  ];
}
