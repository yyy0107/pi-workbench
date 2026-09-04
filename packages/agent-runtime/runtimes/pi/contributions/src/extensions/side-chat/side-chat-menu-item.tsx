"use client";

import { LoaderCircleIcon, MessagesSquareIcon } from "lucide-react";
import { useState } from "react";

import {
  useRightWorkspace,
  useWorkspaceContext,
  useWorkspaceSurfaces,
} from "@workbench/shell/right-workspace/react";
import { DropdownMenuItem, DropdownMenuSeparator } from "@workbench/shell/ui";
import { usePiI18n } from "../../i18n";
import { useExtensionErrorReporter } from "@workbench/extension-host";
import type { ThreadMenuSlotContext } from "@workbench/extension-sdk";
import { usePiSideChatClient } from "@workbench/agent-runtime-pi-client/side-chat";

import {
  nextSideChatSequence,
  revealSideChat,
  SIDE_CHAT_SURFACE_KIND,
} from "./side-chat-workspace";

function useSideChatLauncher({
  sourceSessionId,
  closeMenu,
  contributionId,
}: {
  sourceSessionId?: string;
  closeMenu(): void;
  contributionId: string;
}) {
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const sideChats = useWorkspaceSurfaces(SIDE_CHAT_SURFACE_KIND);
  const manager = usePiSideChatClient();
  const reportError = useExtensionErrorReporter();
  const [pending, setPending] = useState(false);

  const openSideChat = () => {
    if (!sourceSessionId || pending) return;
    const sequence = nextSideChatSequence(sideChats, sourceSessionId);
    setPending(true);
    void manager
      .createScratchSession({ sourceSessionId })
      .then((scratch) => {
        revealSideChat({
          controller,
          context,
          params: {
            scratchSessionId: scratch.sessionId,
            sourceSessionId: scratch.sourceSessionId,
            expiresAt: scratch.expiresAt,
            sequence,
          },
        });
        closeMenu();
      })
      .catch((error: unknown) => {
        reportError(error, {
          source: "workspace",
          contributionId,
        });
      })
      .finally(() => setPending(false));
  };

  return { openSideChat, pending };
}

export function SideChatThreadMenuItem({ threadId, closeMenu }: ThreadMenuSlotContext) {
  const { t } = usePiI18n();
  const { openSideChat, pending } = useSideChatLauncher({
    sourceSessionId: threadId,
    closeMenu,
    contributionId: "workbench.side-chat.thread-menu",
  });

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={pending} className="gap-2.5 px-2.5" onClick={openSideChat}>
        {pending ? (
          <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
        ) : (
          <MessagesSquareIcon aria-hidden="true" />
        )}
        {t(pending ? "extensions.sideChat.creating" : "extensions.sideChat.open")}
      </DropdownMenuItem>
    </>
  );
}
