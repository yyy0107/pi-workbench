"use client";

import { PlusIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { type ComposerSlotContext, usePanelService } from "@/platform/extensions";

export function SkillsTrigger({ isRunning }: ComposerSlotContext) {
  const panels = usePanelService();

  return (
    <TooltipIconButton
      type="button"
      tooltip="Add skills"
      aria-label="Toggle skills panel"
      data-streaming={isRunning || undefined}
      variant="ghost"
      className="text-muted-foreground hover:text-foreground size-9 rounded-full"
      onClick={() => panels.toggle("skills")}
    >
      <PlusIcon className="size-5" />
    </TooltipIconButton>
  );
}
