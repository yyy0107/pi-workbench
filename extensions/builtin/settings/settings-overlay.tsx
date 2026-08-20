"use client";

import { useSyncExternalStore } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n";

import { settingsOverlayStore } from "./settings-overlay-store";
import { SettingsPanel } from "./settings-panel";

export function SettingsOverlay() {
  const { t } = useI18n();
  const open = useSyncExternalStore(
    settingsOverlayStore.subscribe,
    settingsOverlayStore.getSnapshot,
    settingsOverlayStore.getServerSnapshot,
  );

  return (
    <Dialog open={open} onOpenChange={settingsOverlayStore.setOpen}>
      <DialogContent
        id="workbench-settings-dialog"
        closeLabel={t("extensions.settings.close")}
        className="h-[min(42rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-4xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-4xl"
      >
        <DialogHeader className="h-12 justify-center px-5 pr-12">
          <DialogTitle>{t("extensions.settings.title")}</DialogTitle>
        </DialogHeader>
        <SettingsPanel />
      </DialogContent>
    </Dialog>
  );
}
