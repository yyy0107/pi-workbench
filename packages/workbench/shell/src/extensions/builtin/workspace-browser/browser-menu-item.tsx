"use client";

import { Globe2Icon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";

import { useExtensionErrorReporter } from "@workbench/extension-host";
import type { WorkspaceSurfaceMenuItemProps } from "@workbench/extension-sdk";

import { defineMessage, useI18n } from "../../../i18n";
import { useRightWorkspace, useWorkspaceContext } from "../../../right-workspace-react";
import { Button } from "../../../ui/button";
import { useBrowserSessionService } from "./browser-session-service";

export function BrowserMenuItem({ closeMenu }: WorkspaceSurfaceMenuItemProps) {
  const { t } = useI18n();
  const browser = useBrowserSessionService();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const reportError = useExtensionErrorReporter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      className="w-full justify-start font-normal"
      disabled={pending}
      onClick={() => {
        if (pending) return;
        setPending(true);
        void browser
          .create({
            projectId: context.projectId ?? context.applicationId,
            threadId: context.threadId,
          })
          .then((session) => {
            controller.reveal({
              kind: "browser",
              title: defineMessage("extensions.workspaceBrowser.title"),
              params: { browserSessionId: session.id, url: session.url },
              context,
              status: "ready",
              policy: "force-focus",
            });
            closeMenu();
          })
          .catch((error: unknown) => {
            reportError(error, { source: "workspace", contributionId: "browser" });
          })
          .finally(() => setPending(false));
      }}
    >
      {pending ? (
        <LoaderCircleIcon className="animate-spin text-muted-foreground" />
      ) : (
        <Globe2Icon className="text-muted-foreground" />
      )}
      {t("extensions.workspaceBrowser.title")}
    </Button>
  );
}
