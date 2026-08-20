"use client";

import { PanelRightOpenIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

import { useRightWorkspace, useRightWorkspaceState } from "./workspace-context";

export function RightWorkspaceToggleButton() {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const open = useRightWorkspaceState((state) => state.open);

  if (open) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-controls="right-workspace"
      aria-expanded={false}
      aria-label={t("rightWorkspace.expand")}
      title={t("rightWorkspace.expand")}
      className="text-muted-foreground hover:text-foreground -me-px"
      onClick={() => controller.setWorkspaceOpen(true)}
    >
      <PanelRightOpenIcon className="size-[18px]" />
    </Button>
  );
}
