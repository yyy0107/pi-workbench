import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { ToolCapabilitySettings } from "@workbench/pi-sdk-ports/tools";
import { createTodoRuntime } from "../../../src/rpiv-todo/index";
import { TOOL_NAME } from "../../../src/rpiv-todo/types";
import { bindToolAvailability } from "../../../src/tool-runtime/tool-availability";
export * from "../../../src/rpiv-todo/index";
export function createTodoExtension(settings?: ToolCapabilitySettings): ExtensionFactory {
  return (pi) => {
    const readEnabled = bindToolAvailability(pi, TOOL_NAME, settings, false);
    const { tool, restore, shutdown } = createTodoRuntime(readEnabled);
    pi.on("session_start", restore);
    pi.on("session_compact", restore);
    pi.on("session_tree", restore);
    // Workbench also selects branches directly through SessionManager, including regeneration.
    pi.on("agent_start", restore);
    pi.on("session_shutdown", shutdown);
    pi.registerTool(tool);
  };
}
export const todoExtension = createTodoExtension();
export default todoExtension;
