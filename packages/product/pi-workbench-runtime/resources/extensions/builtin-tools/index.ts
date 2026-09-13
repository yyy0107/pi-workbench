import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { BuiltinToolSettings } from "@workbench/pi-sdk-ports/tools";
import {
  BUILTIN_TOOL_PREFERENCE_KEYS,
  builtinToolEnabled,
  type BuiltinToolName,
} from "@workbench/agent-runtime-contracts/settings";
import { bindToolAvailability } from "../../../src/tool-runtime/tool-availability";
export * from "../../../src/tool-runtime/builtin-tools";
export function createBuiltinToolExtensions(settings?: BuiltinToolSettings) {
  return (Object.keys(BUILTIN_TOOL_PREFERENCE_KEYS) as BuiltinToolName[]).map((name) => {
    return {
      name: `workbench.tool.${name}`,
      hidden: true,
      factory(pi) {
        const readEnabled = bindToolAvailability(
          pi,
          name,
          settings?.(name),
          builtinToolEnabled(name, {}),
        );
        pi.on("tool_call", async (event) => {
          if (event.toolName === name && !(await readEnabled()))
            return { block: true, reason: `${name} is disabled in Workbench settings.` };
        });
      },
    } satisfies InlineExtension;
  });
}
