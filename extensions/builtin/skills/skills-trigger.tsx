"use client";

import { SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { type ComposerDrawerSlotContext, usePanelService } from "@/platform/extensions";

import { SKILL_COUNT } from "./skills-panel";

export function SkillsTrigger({ isRunning }: ComposerDrawerSlotContext) {
  const { t } = useI18n();
  const panels = usePanelService();

  return (
    <Button
      type="button"
      aria-label={t("extensions.skills.toggle")}
      data-streaming={isRunning || undefined}
      variant="ghost"
      size="sm"
      className="bg-muted/55 text-muted-foreground hover:bg-muted hover:text-foreground h-8 gap-1.5 rounded-xl px-2.5 text-xs font-normal"
      onClick={() => panels.open("skills")}
    >
      <SparklesIcon className="size-3.5" />
      {t("extensions.skills.summary", { count: SKILL_COUNT })}
    </Button>
  );
}
