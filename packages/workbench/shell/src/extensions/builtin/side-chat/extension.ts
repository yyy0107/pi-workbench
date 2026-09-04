import { MessagesSquareIcon } from "lucide-react";

import {
  createLazyWorkspaceSurface,
  defineExtension,
  type WorkspaceSurfaceDefinition,
} from "@workbench/extension-sdk";

import { SideChatHeader } from "./side-chat-header";
import { SideChatThreadMenuItem } from "./side-chat-menu-item";
import { SideChatRuntimeBridge } from "./side-chat-runtime-bridge";
import {
  sideChatResourceKey,
  SIDE_CHAT_SURFACE_KIND,
  type SideChatSurfaceParams,
} from "./side-chat-workspace";

const SideChatSurface = createLazyWorkspaceSurface(async () => {
  const module = await import("./side-chat-surface");
  return { default: module.SideChatSurface };
});

export const sideChatSurfaceDefinition = {
  kind: SIDE_CHAT_SURFACE_KIND,
  icon: MessagesSquareIcon,
  cachePolicy: "keep-alive",
  persistence: "session",
  defaultPlacement: "primary",
  allowDuplicateResources: false,
  getResourceKey: sideChatResourceKey,
  getDefaultScope: (params) => ({ type: "thread", key: params.sourceSessionId }),
  header: SideChatHeader,
  render: SideChatSurface,
  runtime: SideChatRuntimeBridge,
} satisfies WorkspaceSurfaceDefinition<SideChatSurfaceParams>;

export const sideChatExtension = defineExtension({
  id: "workbench.side-chat",
  name: "Side Chat",
  version: "1.0.0",
  setup(context) {
    const surface = context.workspace.register(sideChatSurfaceDefinition);
    const threadMenu = context.slots.register("thread.menu", {
      id: "workbench.side-chat.thread-menu",
      order: 40,
      component: SideChatThreadMenuItem,
    });
    return [surface, threadMenu];
  },
});
