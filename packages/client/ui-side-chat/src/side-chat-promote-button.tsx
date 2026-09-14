"use client";

import { uiSideChatTranslationBundle } from "./i18n";
import { useI18n } from "@workbench/i18n";

import { BookmarkPlusIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";

import {
  useRightWorkspace,
  useWorkspaceContext,
  useWorkspaceSurfaces,
} from "@workbench/ui-workspace/react";
import { TooltipIconButton } from "@workbench/ui";

import { useExtensionErrorReporter } from "@workbench/extension-host";
import type {
  WorkspaceActionsSlotContext,
  WorkspaceSurfaceInstance,
} from "@workbench/extension-sdk";
import { useWorkbenchScratchSessionCapability } from "@workbench/agent-runtime-client/context";
import { useWorkbenchNavigation } from "@workbench/shell-context/navigation";

import { markScratchSessionPromoted } from "../lib/scratch-session-lease";
import { openPromotedSideChatConversation } from "../lib/side-chat-navigation";
import { SIDE_CHAT_SURFACE_KIND, type SideChatSurfaceParams } from "./side-chat-workspace";

export function SideChatPromoteButton({ activeSurfaceId }: WorkspaceActionsSlotContext) {
  const { t } = useI18n(uiSideChatTranslationBundle);
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const navigation = useWorkbenchNavigation();
  const manager = useWorkbenchScratchSessionCapability();
  const reportError = useExtensionErrorReporter();
  const sideChats = useWorkspaceSurfaces(SIDE_CHAT_SURFACE_KIND);
  const [pending, setPending] = useState(false);

  const surface = sideChats.find((candidate) => candidate.id === activeSurfaceId) as
    | WorkspaceSurfaceInstance<SideChatSurfaceParams>
    | undefined;

  if (!manager || !surface) return null;

  return (
    <TooltipIconButton
      type="button"
      disabled={pending}
      aria-label={t(pending ? "extensions.sideChat.promoting" : "extensions.sideChat.promote")}
      tooltip={t(
        pending ? "extensions.sideChat.promoting" : "extensions.sideChat.promoteDescription",
      )}
      onClick={() => {
        if (pending) return;
        setPending(true);
        void manager
          .promoteScratchSession({ sessionId: surface.params.scratchSessionId })
          .then((promoted) => {
            markScratchSessionPromoted(manager, surface.params.scratchSessionId);
            controller.close(surface.id, context);
            openPromotedSideChatConversation(navigation, promoted.sessionId);
          })
          .catch((error: unknown) => {
            reportError(error, {
              source: "workspace",
              contributionId: "workbench.side-chat.promote",
            });
            setPending(false);
          });
      }}
    >
      {pending ? (
        <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
      ) : (
        <BookmarkPlusIcon aria-hidden="true" />
      )}
    </TooltipIconButton>
  );
}
