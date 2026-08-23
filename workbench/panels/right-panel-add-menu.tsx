"use client";

import { PlusIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n";
import { SlotHost } from "@/platform/extensions";

export interface RightPanelAddMenuProps {
  activePanelId: string;
}

export function RightPanelAddMenu({ activePanelId }: RightPanelAddMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const closeMenu = useCallback(() => setOpen(false), []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("workbench.panels.addTab")}
            title={t("workbench.panels.addTab")}
            className="text-muted-foreground hover:text-foreground ml-1 rounded-xl"
          />
        }
      >
        <PlusIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        role="menu"
        aria-label={t("workbench.panels.addTab")}
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-72 gap-1 rounded-2xl p-2"
      >
        <SlotHost
          name="panel.right.add-menu"
          context={{ activePanelId, closeMenu }}
          className="flex flex-col gap-1"
          emptyFallback={
            <p className="text-muted-foreground px-2 py-3 text-center text-xs">
              {t("workbench.panels.noTabs")}
            </p>
          }
        />
      </PopoverContent>
    </Popover>
  );
}
