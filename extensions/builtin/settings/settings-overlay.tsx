"use client";

import { ChevronDownIcon, FileJson2Icon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  openPiSettingsDocument,
  openWorkbenchSettingsDocument,
} from "@/runtime/pi/client/transport/api";

import { settingsOverlayStore } from "./settings-overlay-store";
import { SettingsPanel } from "./settings-panel";

export function SettingsOverlay() {
  const { t } = useI18n();
  const [openingDocument, setOpeningDocument] = useState<"pi" | "workbench" | null>(null);
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
      setOpeningDocument(null);
      setDocumentError(false);
    }
  }, [open]);

  const openDocument = async (target: "pi" | "workbench") => {
    if (openingDocument) return;
    setOpeningDocument(target);
    setDocumentError(false);
    try {
      await (target === "pi" ? openPiSettingsDocument() : openWorkbenchSettingsDocument());
    } catch {
      setDocumentError(true);
    } finally {
      setOpeningDocument(null);
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
          <DropdownMenu>
            <DropdownMenuTrigger
              type="button"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "group",
                documentError && "text-destructive hover:text-destructive",
              )}
              disabled={openingDocument !== null}
              title={
                documentError ? t("extensions.settings.openConfigurationFileFailed") : undefined
              }
            >
              <FileJson2Icon className="size-3.5" />
              {openingDocument
                ? t("extensions.settings.openingConfigurationFile")
                : t("extensions.settings.viewConfigurationFile")}
              <ChevronDownIcon
                aria-hidden="true"
                className="size-3.5 opacity-50 transition-transform group-data-popup-open:rotate-180"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem
                className="min-h-11 gap-2.5 px-2.5 py-2"
                onClick={() => void openDocument("pi")}
              >
                <FileJson2Icon className="text-muted-foreground size-4" />
                <span className="flex min-w-0 flex-col">
                  <span>{t("extensions.settings.piConfigurationFile")}</span>
                  <span className="text-muted-foreground font-mono text-xs">settings.json</span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-11 gap-2.5 px-2.5 py-2"
                onClick={() => void openDocument("workbench")}
              >
                <FileJson2Icon className="text-muted-foreground size-4" />
                <span className="flex min-w-0 flex-col">
                  <span>{t("extensions.settings.workbenchConfigurationFile")}</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    workbench-settings.json
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
