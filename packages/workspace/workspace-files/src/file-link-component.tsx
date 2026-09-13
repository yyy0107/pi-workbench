"use client";

import type { ComponentProps } from "react";
import { useFilesI18n } from "./use-i18n";
import { useOpenerService, useWorkspaceContext } from "@workbench/workspace-runtime/react";
import { openFileLink } from "./file-link";
import { cn } from "@workbench/ui/utils";
import { useToastManager } from "@workbench/ui";
import { FileLinkContextMenu } from "./file-link-menu";

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
  const { t } = useFilesI18n();
  return (
    <FileLinkContextMenu href={href}>
      <a
        {...props}
        href={href}
        className={cn(
          "text-primary no-underline decoration-dashed hover:underline focus-visible:underline",
          className,
        )}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          event.preventDefault();
          void openFileLink(opener, context, href).catch((error: unknown) => {
            console.warn("[file-link] open failed", error);
            notifications.add({ type: "error", title: t("workspaceFiles.openFailed") });
          });
        }}
      >
        {children}
      </a>
    </FileLinkContextMenu>
  );
}

export { FileLinkContextMenu } from "./file-link-menu";
