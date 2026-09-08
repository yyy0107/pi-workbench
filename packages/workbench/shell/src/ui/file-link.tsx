"use client";

import type { ComponentProps } from "react";
import { useI18n } from "../i18n";
import { useOpenerService, useWorkspaceContext } from "../right-workspace-react";
import { openFileLink } from "../workspace-files/file-link";
import { cn } from "../utils";
import { useToastManager } from "./toast";
import { FileLinkContextMenu } from "../extensions/builtin/workspace-file/file-link-menu";

/** Opens a local file in the registered File surface, including files outside the project. */
export function FileLink({
  href,
  children,
  className,
  onClick,
  ...props
}: Omit<ComponentProps<"a">, "href"> & { href: string }) {
  const opener = useOpenerService();
  const context = useWorkspaceContext();
  const notifications = useToastManager();
  const { t } = useI18n();
  return (
    <FileLinkContextMenu href={href}>
      <a
        {...props}
        href={href}
        className={cn(
          "text-primary no-underline hover:underline focus-visible:underline",
          className,
        )}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          event.preventDefault();
          void openFileLink(opener, context, href).catch((error: unknown) => {
            console.warn("[file-link] open failed", error);
            notifications.add({ type: "error", title: t("ui.fileLink.openFailed") });
          });
        }}
      >
        {children}
      </a>
    </FileLinkContextMenu>
  );
}
