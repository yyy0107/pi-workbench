import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createBrowserExtension } from "@workbench/pi-browser";
import { getPiAgentHostBindings } from "../../agent-runtime/pi-agent-host-bindings";

export const browserExtension: ExtensionFactory = (pi) => {
  if (!getPiAgentHostBindings().browser) return;
  return createBrowserExtension(() => getPiAgentHostBindings().browser)(pi);
};
