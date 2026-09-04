import type { ElementType, ReactNode } from "react";
import { XIcon } from "lucide-react";

import { TooltipIconButton } from "../ui/tooltip-icon-button";
import { useI18n } from "../i18n";
import { cn } from "../utils";

export interface PanelHeaderProps {
  title: ReactNode;
  icon?: ElementType<{ className?: string }>;
  onClose?: () => void;
  className?: string;
}

export function PanelHeader({ title, icon: Icon, onClose, className }: PanelHeaderProps) {
  const { t } = useI18n();

  return (
    <header
      data-slot="workbench-panel-header"
      className={cn("flex h-10 shrink-0 items-center gap-2 border-b px-3", className)}
    >
      {Icon ? <Icon className="text-muted-foreground size-4" /> : null}
      <h2 className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">{title}</h2>
      {onClose ? (
        <TooltipIconButton
          tooltip={t("workbench.panels.closePanel")}
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
        >
          <XIcon className="size-4" />
        </TooltipIconButton>
      ) : null}
    </header>
  );
}
