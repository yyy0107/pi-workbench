import { Globe2Icon } from "lucide-react";

import {
  createLazyWorkspaceSurface,
  defineExtension,
  type WorkspaceSurfaceDefinition,
} from "@workbench/extension-sdk";

import { defineMessage } from "../../../i18n";
import { BrowserSettingsItem, BROWSER_SETTINGS_SECTION_ID } from "./browser-settings";
import { BrowserEventsOverlay } from "./browser-events-overlay";
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
    return [
      context.workspace.register(browserSurfaceDefinition),
      context.slots.register("shell.overlay", {
        id: "browser-events",
        component: BrowserEventsOverlay,
      }),
      context.settings.registerSection({
        id: BROWSER_SETTINGS_SECTION_ID,
        title: defineMessage("extensions.workspaceBrowser.settings.title"),
        description: defineMessage("extensions.workspaceBrowser.settings.description"),
        icon: Globe2Icon,
        group: {
          id: "capabilities",
          title: defineMessage("extensions.settings.groups.capabilities"),
        },
        order: 50,
      }),
      context.settings.registerItem({
        sectionId: BROWSER_SETTINGS_SECTION_ID,
        id: "preferences",
        title: defineMessage("extensions.workspaceBrowser.settings.title"),
        description: defineMessage("extensions.workspaceBrowser.settings.description"),
        keywords: [
          defineMessage("extensions.workspaceBrowser.settings.passwords"),
          defineMessage("extensions.workspaceBrowser.settings.downloads"),
          defineMessage("extensions.workspaceBrowser.settings.permissions"),
        ],
        component: BrowserSettingsItem,
      }),
    ];
  },
});
