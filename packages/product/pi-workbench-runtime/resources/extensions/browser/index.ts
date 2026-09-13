import type { ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { BrowserHost } from "@workbench/browser-contracts/host";
import { createBrowserToolRuntime } from "../../../src/browser/index";
import { createHarnessTools } from "../../../src/browser/tools";
import { createBrowserHostResolver } from "../../../src/browser/standalone-host";

export function createBrowserExtension(
  resolveHost: (context: ExtensionContext) => BrowserHost | undefined,
): ExtensionFactory {
  return (pi) => {
    const { tool, releaseControl } = createBrowserToolRuntime(resolveHost);
    pi.on("agent_settled", releaseControl);
    const { tools, resetSelection } = createHarnessTools(tool, resolveHost);
    for (const definition of tools) pi.registerTool(definition);
    pi.on("session_shutdown", () => {
      releaseControl();
      resetSelection();
    });
    pi.registerTool(tool);
  };
}
const browserExtension: ExtensionFactory = (pi) =>
  createBrowserExtension(createBrowserHostResolver(pi))(pi);
export default browserExtension;
