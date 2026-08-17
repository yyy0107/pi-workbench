"use client";

import { PanelRightOpenIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

import { useRightPanelController } from "./use-right-panel-controller";

export function RightPanelToggleButton() {
  const { t } = useI18n();
  const { canToggle, isOpen, toggle } = useRightPanelController();

  if (isOpen) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={!canToggle}
      aria-label={t("workbench.panels.expandRight")}
      title={t("workbench.panels.expandRight")}
      data-state="closed"
      className="text-muted-foreground hover:text-foreground"
      onClick={toggle}
    >
      <PanelRightOpenIcon className="size-[18px]" />
    </Button>
  );
}
