"use client";

import { FileJson2Icon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { openPiSettingsDocument } from "@/runtime/pi/client/transport/api";

import { settingsOverlayStore } from "./settings-overlay-store";
import { SettingsPanel } from "./settings-panel";

export function SettingsOverlay() {
  const { t } = useI18n();
  const [openingDocument, setOpeningDocument] = useState(false);
  const [documentError, setDocumentError] = useState(false);
  const open = useSyncExternalStore(
    settingsOverlayStore.subscribe,
    settingsOverlayStore.getSnapshot,
    settingsOverlayStore.getServerSnapshot,
  );
  const [hasOpened, setHasOpened] = useState(open);

  useEffect(() => {
    if (open) setHasOpened(true);
    if (!open) {
      setOpeningDocument(false);
      setDocumentError(false);
    }
  }, [open]);

  const openDocument = async () => {
    if (openingDocument) return;
    setOpeningDocument(true);
    setDocumentError(false);
    try {
      await openPiSettingsDocument();
    } catch {
      setDocumentError(true);
    } finally {
      setOpeningDocument(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={settingsOverlayStore.setOpen}>
      <DialogContent
        id="workbench-settings-dialog"
        closeLabel={t("extensions.settings.close")}
        keepMounted
        className="h-[min(42rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-4xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-4xl"
      >
        <DialogHeader className="h-12 flex-row items-center gap-3 px-5 pr-12">
          <DialogTitle className="min-w-0 flex-1 truncate">
            {t("extensions.settings.title")}
          </DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={documentError ? "text-destructive hover:text-destructive" : undefined}
            disabled={openingDocument}
            title={documentError ? t("extensions.settings.openConfigurationFileFailed") : undefined}
            onClick={() => void openDocument()}
          >
            <FileJson2Icon className="size-3.5" />
            {openingDocument
              ? t("extensions.settings.openingConfigurationFile")
              : t("extensions.settings.viewConfigurationFile")}
          </Button>
        </DialogHeader>
        {documentError ? (
          <p className="sr-only" role="alert">
            {t("extensions.settings.openConfigurationFileFailed")}
          </p>
        ) : null}
        {hasOpened || open ? <SettingsPanel /> : null}
      </DialogContent>
    </Dialog>
  );
}
