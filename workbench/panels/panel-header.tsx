import type { ElementType, ReactNode } from "react";
import { XIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { cn } from "@/lib/utils";

export interface PanelHeaderProps {
  title: ReactNode;
  icon?: ElementType<{ className?: string }>;
  onClose?: () => void;
  className?: string;
}

export function PanelHeader({ title, icon: Icon, onClose, className }: PanelHeaderProps) {
  return (
    <header
      data-slot="workbench-panel-header"
      className={cn("flex h-10 shrink-0 items-center gap-2 border-b px-3", className)}
    >
      {Icon ? <Icon className="text-muted-foreground size-4" /> : null}
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
      {onClose ? (
        <TooltipIconButton
          tooltip="Close panel"
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onClose}
        >
          <XIcon className="size-4" />
        </TooltipIconButton>
      ) : null}
    </header>
  );
}
