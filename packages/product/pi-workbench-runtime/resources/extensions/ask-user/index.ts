import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { AskUserCapabilitySettings } from "@workbench/pi-sdk-ports/tools";
import { ASK_USER_TOOL_NAME, createAskUserTool } from "../../../src/ask-user/index";
import { bindToolAvailability } from "../../../src/tool-runtime/tool-availability";
export * from "../../../src/ask-user/index";
export function createAskUserExtension(settings?: AskUserCapabilitySettings): ExtensionFactory {
  return (pi) => {
    const readEnabled = bindToolAvailability(pi, ASK_USER_TOOL_NAME, settings, false);
    pi.registerTool(createAskUserTool(readEnabled));
  };
}
export const askUserExtension = createAskUserExtension();
export default askUserExtension;
