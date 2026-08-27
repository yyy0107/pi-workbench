"use client";

import { PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

import { useRightWorkspace, useRightWorkspaceState } from "./workspace-context";

export function RightWorkspaceToggleButton({ className }: Readonly<{ className?: string }>) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const open = useRightWorkspaceState((state) => state.open);
  const label = t(open ? "rightWorkspace.collapse" : "rightWorkspace.expand");

  return (
    <Button
      data-workbench-surface="right-workspace-toggle"
      type="button"
      variant="ghost"
      size="icon"
      aria-controls="right-workspace"
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
