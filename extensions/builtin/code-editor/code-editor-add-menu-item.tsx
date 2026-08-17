"use client";

import { FileCode2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { type RightPanelAddMenuSlotContext, usePanelService } from "@/platform/extensions";

export function CodeEditorAddMenuItem({ activePanelId, closeMenu }: RightPanelAddMenuSlotContext) {
  const { t } = useI18n();
  const panels = usePanelService();

  return (
    <Button
      type="button"
      role="menuitem"
      variant="ghost"
      aria-current={activePanelId === "code-editor" ? "page" : undefined}
      className="h-9 w-full justify-start gap-3 rounded-xl px-2.5 font-normal"
      onClick={() => {
        panels.open("code-editor");
        closeMenu();
      }}
    >
      <FileCode2Icon className="text-muted-foreground size-4" />
      <span className="min-w-0 flex-1 truncate text-left">{t("extensions.codeEditor.title")}</span>
    </Button>
  );
}
