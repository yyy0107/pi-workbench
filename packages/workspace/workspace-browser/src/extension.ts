import { Globe2Icon } from "lucide-react";

import {
  createLazyWorkspaceSurface,
  defineExtension,
  type WorkspaceSurfaceDefinition,
} from "@workbench/extension-sdk";

import { BrowserEventsOverlay } from "./browser-events-overlay";
import { createBrowserFileOpener } from "./browser-file-opener";
import { BrowserRuntimeBridge } from "./browser-runtime-bridge";
import { BrowserMenuItem } from "./browser-menu-item";
import { BrowserTabIndicator } from "./browser-control-indicator";
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
  tabIndicator: BrowserTabIndicator,
  menuItem: BrowserMenuItem,
  runtime: BrowserRuntimeBridge,
} satisfies WorkspaceSurfaceDefinition<BrowserSurfaceParams>;

export const workspaceBrowserExtension = defineExtension({
  id: "workbench.workspace-browser",
  name: "Workspace Browser",
  version: "1.0.0",
  setup(context) {
    const fileOpener = createBrowserFileOpener();
    return [
      context.openers.register(fileOpener.handler),
      context.slots.register("shell.overlay", {
        id: "browser-file-opener",
        component: fileOpener.Runtime,
      }),
      context.workspace.register(browserSurfaceDefinition),
      context.slots.register("shell.overlay", {
        id: "browser-events",
        component: BrowserEventsOverlay,
      }),
    ];
  },
});
