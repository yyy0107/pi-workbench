import { defineMessage } from "@/i18n";
import type { RightWorkspaceController, WorkspaceContext } from "@/components/right-workspace";

export const SIDE_CHAT_SURFACE_KIND = "side-chat";
export const SIDE_CHAT_SURFACE_TITLE = defineMessage("extensions.sideChat.title");

export interface SideChatSurfaceParams extends Record<string, unknown> {
  scratchSessionId: string;
  sourceSessionId: string;
  expiresAt: number;
}

export function revealSideChat(input: {
  controller: RightWorkspaceController;
  context: WorkspaceContext;
  params: SideChatSurfaceParams;
}): string {
  return input.controller.reveal({
    kind: SIDE_CHAT_SURFACE_KIND,
    title: SIDE_CHAT_SURFACE_TITLE,
    params: input.params,
    context: input.context,
    scope: { type: "thread", key: input.params.sourceSessionId },
    status: "ready",
    policy: "force-focus",
  });
}
