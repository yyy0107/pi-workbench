"use client";

import { useAui } from "@assistant-ui/react";
import { ArrowUpRightIcon, LoaderCircleIcon, MessagesSquareIcon } from "lucide-react";
import { useState } from "react";

import { useRightWorkspace } from "@workbench/shell/right-workspace/react";
import { Button } from "@workbench/shell/ui";
import { useWorkbenchNavigation } from "@workbench/shell/navigation";
import { usePiI18n } from "../../i18n";
import { useExtensionErrorReporter } from "@workbench/extension-host";
import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";
import { usePiSideChatClient } from "@workbench/agent-runtime-pi-client/side-chat";

import { markScratchSessionPromoted } from "./scratch-session-lease";
import { openPromotedSideChatConversation } from "./side-chat-navigation";
import type { SideChatSurfaceParams } from "./side-chat-workspace";

export function SideChatHeader({ surface }: WorkspaceSurfaceProps<SideChatSurfaceParams>) {
  const { t } = usePiI18n();
  const aui = useAui();
  const controller = useRightWorkspace();
  const navigation = useWorkbenchNavigation();
  const manager = usePiSideChatClient();
  const reportError = useExtensionErrorReporter();
  const [pending, setPending] = useState(false);

  return (
    <div className="flex size-full items-center gap-2 px-2 text-xs">
      <MessagesSquareIcon className="text-muted-foreground size-[var(--icon-size-sm)] shrink-0" />
      <span className="min-w-0 flex-1 truncate font-medium">
        {Number.isSafeInteger(surface.params.sequence)
          ? t("extensions.sideChat.indexedTitle", { sequence: surface.params.sequence })
          : t("extensions.sideChat.title")}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={pending}
        aria-label={t("extensions.sideChat.promote")}
        title={t("extensions.sideChat.promoteDescription")}
        onClick={() => {
          if (pending) return;
          setPending(true);
          void manager
            .promoteScratchSession({ sessionId: surface.params.scratchSessionId })
            .then(async (promoted) => {
              markScratchSessionPromoted(manager, surface.params.scratchSessionId);
              controller.close(surface.id);
              await aui.threads.reload();
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
        {pending ? <LoaderCircleIcon className="animate-spin" /> : <ArrowUpRightIcon />}
        {t(pending ? "extensions.sideChat.promoting" : "extensions.sideChat.promote")}
      </Button>
    </div>
  );
}
