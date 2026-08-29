import { defineMessage } from "@/i18n";
import type {
  RightWorkspaceController,
  WorkspaceContext,
  WorkspaceSurfaceInstance,
} from "@/components/right-workspace";

export const SIDE_CHAT_SURFACE_KIND = "side-chat";

export interface SideChatSurfaceParams extends Record<string, unknown> {
  scratchSessionId: string;
  sourceSessionId: string;
  expiresAt: number;
  sequence: number;
}

export function sideChatSurfaceTitle(sequence: number) {
  return defineMessage("extensions.sideChat.indexedTitle", { sequence });
}

export function nextSideChatSequence(
  surfaces: readonly Pick<WorkspaceSurfaceInstance, "kind" | "params">[],
  sourceSessionId: string,
): number {
  const largestSequence = surfaces.reduce((largest, surface) => {
    if (surface.kind !== SIDE_CHAT_SURFACE_KIND) return largest;
    const params = surface.params as Partial<SideChatSurfaceParams>;
    if (params.sourceSessionId !== sourceSessionId) return largest;
    const sequence = params.sequence;
    return typeof sequence === "number" && Number.isSafeInteger(sequence) && sequence > largest
      ? sequence
      : largest;
  }, 0);
  return largestSequence + 1;
}

/** Each scratch session is an independent side-chat resource, even under the same source thread. */
export function sideChatResourceKey(params: SideChatSurfaceParams): string {
  return `side-chat:${encodeURIComponent(params.scratchSessionId)}`;
}

export function revealSideChat(input: {
  controller: RightWorkspaceController;
  context: WorkspaceContext;
  params: SideChatSurfaceParams;
}): string {
  return input.controller.reveal({
    kind: SIDE_CHAT_SURFACE_KIND,
    title: sideChatSurfaceTitle(input.params.sequence),
    params: input.params,
    context: input.context,
    scope: { type: "thread", key: input.params.sourceSessionId },
    status: "ready",
    policy: "force-focus",
  });
}
