"use client";

import { PlusIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useI18n } from "@/i18n";
import { type ComposerSlotContext, usePanelService } from "@/platform/extensions";

export function SkillsTrigger({ isRunning }: ComposerSlotContext) {
  const { t } = useI18n();
  const panels = usePanelService();

  return (
    <TooltipIconButton
      type="button"
      tooltip={t("extensions.skills.add")}
      aria-label={t("extensions.skills.toggle")}
      data-streaming={isRunning || undefined}
      variant="ghost"
      className="text-muted-foreground hover:text-foreground size-9 rounded-full"
      onClick={() => panels.toggle("skills")}
    >
      <PlusIcon className="size-5" />
    </TooltipIconButton>
  );
}
