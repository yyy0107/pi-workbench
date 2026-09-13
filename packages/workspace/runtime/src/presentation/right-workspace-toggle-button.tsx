"use client";

import { PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";

import { Button } from "@workbench/ui";
import { useWorkspaceI18n } from "../use-i18n";
import { cn } from "@workbench/ui/utils";

import { useRightWorkspace, useRightWorkspaceState } from "../react";
import { useWorkbenchDomIds } from "@workbench/shell-context/dom";

export function RightWorkspaceToggleButton({ className }: Readonly<{ className?: string }>) {
  const { t } = useWorkspaceI18n();
  const controller = useRightWorkspace();
  const domIds = useWorkbenchDomIds();
  const open = useRightWorkspaceState((state) => state.open);
  const label = t(open ? "rightWorkspace.collapse" : "rightWorkspace.expand");

  return (
    <Button
      data-workbench-surface="right-workspace-toggle"
      type="button"
      variant="ghost"
      size="icon"
      aria-controls={domIds.rightWorkspace}
      aria-expanded={open}
      aria-label={label}
      title={label}
      className={cn(
        "text-muted-foreground hover:text-foreground shrink-0 [app-region:no-drag]",
        className,
      )}
      onClick={() => controller.setWorkspaceOpen(!open)}
    >
      <span aria-hidden="true" className="relative size-[var(--icon-md)] shrink-0">
        <PanelRightOpenIcon className={cn("absolute inset-0", open && "opacity-0")} />
        <PanelRightCloseIcon className={cn("absolute inset-0", !open && "opacity-0")} />
      </span>
    </Button>
  );
}
