"use client";

import { PanelRightCloseIcon } from "lucide-react";
import { Fragment } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { SlotHost } from "@/platform/extensions";

import { RightPanelAddMenu } from "./right-panel-add-menu";
import { RightPanelTab } from "./right-panel-tab";
import { useRightPanelController } from "./use-right-panel-controller";

export function RightPanelTabs() {
  const { t } = useI18n();
  const { activePanelId, close, collapse, panels, select } = useRightPanelController();

  if (!activePanelId) return null;

  return (
    <header
      data-slot="workbench-right-panel-tabs"
      className="flex h-10 shrink-0 items-center border-b bg-transparent pr-2 pl-3"
    >
      <div className="flex h-full min-w-0 flex-1 items-center overflow-hidden">
        <div
          role="tablist"
          aria-label={t("workbench.panels.rightExtensions")}
          aria-orientation="horizontal"
          className="flex min-w-0 items-center overflow-x-auto"
        >
          {panels.map((panel, index) => {
            const isActive = panel.id === activePanelId;

            return (
              <Fragment key={panel.id}>
                {index > 0 ? (
                  <span aria-hidden="true" className="bg-border mx-2 h-5 w-px shrink-0" />
                ) : null}
                <RightPanelTab
                  definition={panel}
                  isActive={isActive}
                  onSelect={() => select(panel.id)}
                  onClose={() => close(panel.id)}
                />
              </Fragment>
            );
          })}
        </div>

        <RightPanelAddMenu activePanelId={activePanelId} />
      </div>

      <SlotHost
        name="panel.right.actions"
        context={{ activePanelId }}
        className="ml-2 flex shrink-0 items-center gap-1"
      />

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("workbench.panels.collapseRight")}
        title={t("workbench.panels.collapseRight")}
        className="text-muted-foreground hover:bg-muted hover:text-foreground ml-1 shrink-0 rounded-xl"
        onClick={collapse}
      >
        <PanelRightCloseIcon className="size-4" />
      </Button>
    </header>
  );
}
