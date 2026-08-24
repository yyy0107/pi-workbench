"use client";

import { Globe2Icon } from "lucide-react";

import { useRightWorkspace, useWorkspaceContext } from "@/components/right-workspace";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { WorkspaceSurfaceMenuItemProps } from "@/platform/extensions";

import { browserSessionService } from "./browser-session-service";

export function BrowserMenuItem({ closeMenu }: WorkspaceSurfaceMenuItemProps) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();

  return (
    <Button
      type="button"
      variant="ghost"
      className="w-full justify-start font-normal"
      onClick={() => {
        void browserSessionService
          .create({ projectId: context.projectId ?? context.applicationId })
          .then((session) => {
            controller.reveal({
              kind: "browser",
              title: t("extensions.workspaceBrowser.newSession"),
              params: { browserSessionId: session.id, url: session.url },
              context,
              status: "ready",
            });
            closeMenu();
          })
          .catch((error: unknown) => console.error(error));
      }}
    >
      <Globe2Icon className="text-muted-foreground size-4" />
      {t("extensions.workspaceBrowser.title")}
    </Button>
  );
}
