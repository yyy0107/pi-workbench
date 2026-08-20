import { Globe2Icon } from "lucide-react";

import type { WorkspaceSurfaceDefinition } from "@/platform/extensions";
import { defineExtension } from "@/platform/extensions";

import { BrowserMenuItem } from "./browser-menu-item";
import { BrowserRuntimeBridge } from "./browser-runtime-bridge";
import { BrowserSurface, type BrowserSurfaceParams } from "./browser-surface";

export const browserSurfaceDefinition = {
  kind: "browser",
  icon: Globe2Icon,
  cachePolicy: "persistent",
  allowDuplicateResources: false,
  getResourceKey: (params, context) =>
    `browser:${encodeURIComponent(context.threadId ?? "application")}:${encodeURIComponent(params.browserSessionId)}`,
  getDefaultScope: (_params, context) => ({
    type: context.threadId ? "thread" : "application",
    key: context.threadId ?? context.applicationId,
  }),
  render: BrowserSurface,
  menuItem: BrowserMenuItem,
  runtime: BrowserRuntimeBridge,
} satisfies WorkspaceSurfaceDefinition<BrowserSurfaceParams>;

export const workspaceBrowserExtension = defineExtension({
  id: "workbench.workspace-browser",
  name: "Workspace Browser",
  version: "1.0.0",
  setup(context) {
    return context.workspace.register(browserSurfaceDefinition);
  },
});
