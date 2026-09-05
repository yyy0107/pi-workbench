"use client";

import { ArrowUpRightIcon, LoaderCircleIcon, MessagesSquareIcon } from "lucide-react";
import { useState } from "react";

import { useRightWorkspace } from "@workbench/shell/right-workspace/react";
import { Button } from "@workbench/shell/ui";
import { useWorkbenchNavigation } from "@workbench/shell/navigation";
import { useI18n } from "@workbench/shell/i18n";
import { useExtensionErrorReporter } from "@workbench/extension-host";
import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";
import { useWorkbenchScratchSessionCapability } from "@workbench/agent-runtime-client/context";

import { markScratchSessionPromoted } from "./scratch-session-lease";
import { openPromotedSideChatConversation } from "./side-chat-navigation";
import type { SideChatSurfaceParams } from "./side-chat-workspace";

function AvailableSideChatHeader({
  surface,
  context,
}: WorkspaceSurfaceProps<SideChatSurfaceParams>) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const navigation = useWorkbenchNavigation();
  const manager = useWorkbenchScratchSessionCapability();
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
          if (!manager || pending) return;
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
        {pending ? <LoaderCircleIcon className="animate-spin" /> : <ArrowUpRightIcon />}
        {t(pending ? "extensions.sideChat.promoting" : "extensions.sideChat.promote")}
      </Button>
    </div>
  );
}

export function SideChatHeader(props: WorkspaceSurfaceProps<SideChatSurfaceParams>) {
  return useWorkbenchScratchSessionCapability() ? <AvailableSideChatHeader {...props} /> : null;
}
