"use client";

import { ChevronDownIcon, FileJson2Icon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useMainViewService } from "@/platform/extensions";
import {
  openPiSettingsDocument,
  openWorkbenchSettingsDocument,
} from "@/workbench/runtime-contributions/pi/client/configuration";

import { SETTINGS_MAIN_VIEW_KIND } from "./settings-main-view";
import { MobileSettingsTrigger } from "./settings-trigger";

function SettingsConfigurationMenu() {
  const { t } = useI18n();
  const [openingDocument, setOpeningDocument] = useState<"pi" | "workbench" | null>(null);
  const [documentError, setDocumentError] = useState(false);

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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "group min-w-0",
            documentError && "text-destructive hover:text-destructive",
          )}
          disabled={openingDocument !== null}
          aria-label={t("extensions.settings.viewConfigurationFile")}
          title={documentError ? t("extensions.settings.openConfigurationFileFailed") : undefined}
        >
          <FileJson2Icon aria-hidden="true" className="size-3.5" />
          <span className="hidden truncate sm:inline">
            {openingDocument
              ? t("extensions.settings.openingConfigurationFile")
              : t("extensions.settings.viewConfigurationFile")}
          </span>
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
            <FileJson2Icon aria-hidden="true" className="text-muted-foreground size-4" />
            <span className="flex min-w-0 flex-col">
              <span>{t("extensions.settings.piConfigurationFile")}</span>
              <span className="text-muted-foreground font-mono text-xs">settings.json</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11 gap-2.5 px-2.5 py-2"
            onClick={() => void openDocument("workbench")}
          >
            <FileJson2Icon aria-hidden="true" className="text-muted-foreground size-4" />
            <span className="flex min-w-0 flex-col">
              <span>{t("extensions.settings.workbenchConfigurationFile")}</span>
              <span className="text-muted-foreground font-mono text-xs">
                workbench-settings.json
              </span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {documentError ? (
        <p className="sr-only" role="alert">
          {t("extensions.settings.openConfigurationFileFailed")}
        </p>
      ) : null}
    </>
  );
}

export function SettingsHeaderAction() {
  const mainViews = useMainViewService();
  const activeMainView = useSyncExternalStore(
    mainViews.subscribe,
    mainViews.getSnapshot,
    mainViews.getInitialSnapshot,
  );

  return activeMainView?.kind === SETTINGS_MAIN_VIEW_KIND ? (
    <SettingsConfigurationMenu />
  ) : (
    <MobileSettingsTrigger />
  );
}
