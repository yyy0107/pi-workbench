import { Globe2Icon } from "lucide-react";

import type { WorkspaceSurfaceDefinition } from "@/platform/extensions";
import { createLazyWorkspaceSurface, defineExtension } from "@/platform/extensions";

import { BrowserRuntimeBridge } from "./browser-runtime-bridge";
import type { BrowserSurfaceParams } from "./browser-surface";

const BrowserSurface = createLazyWorkspaceSurface(async () => {
  const module = await import("./browser-surface");
  return { default: module.BrowserSurface };
});

export const browserSurfaceDefinition = {
  kind: "browser",
  icon: Globe2Icon,
  cachePolicy: "keep-alive",
  persistence: "session",
  allowDuplicateResources: false,
  getResourceKey: (params, context) =>
    `browser:${encodeURIComponent(context.threadId ?? "application")}:${encodeURIComponent(params.browserSessionId)}`,
  getDefaultScope: (_params, context) => ({
    type: context.threadId ? "thread" : "application",
    key: context.threadId ?? context.applicationId,
  }),
  render: BrowserSurface,
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
