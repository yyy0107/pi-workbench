"use client";

import { ChevronDownIcon, FileJson2Icon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workbench/shell/ui";
import { usePiConfigurationClient } from "@workbench/agent-runtime-pi-client/configuration";
import { useMainViewService } from "@workbench/extension-host";

import { usePiI18n } from "../../i18n";

export type SettingsDocumentKind = "pi" | "workbench";

export interface PiSettingsDocumentClient {
  openAgentSettingsDocument(): Promise<unknown>;
  openWorkbenchSettingsDocument(): Promise<unknown>;
}

export function openSettingsConfigurationDocument(
  client: PiSettingsDocumentClient,
  document: SettingsDocumentKind,
): Promise<unknown> {
  return document === "pi"
    ? client.openAgentSettingsDocument()
    : client.openWorkbenchSettingsDocument();
}

/**
 * Pi Runtime configuration files action. The generic Settings extension chooses when to render
 * this component, so this leaf has no dependency on the Settings main-view or mobile trigger owners.
 */
export function PiSettingsConfigurationMenu() {
  const { t } = usePiI18n();
  const configuration = usePiConfigurationClient();
  const [openingDocument, setOpeningDocument] = useState<SettingsDocumentKind | null>(null);
  const [documentError, setDocumentError] = useState(false);

  const openDocument = async (document: SettingsDocumentKind) => {
    if (openingDocument !== null) return;
    setOpeningDocument(document);
    setDocumentError(false);
    try {
      await openSettingsConfigurationDocument(configuration, document);
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
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={documentError ? "text-destructive hover:text-destructive" : undefined}
              disabled={openingDocument !== null}
              aria-label={t("extensions.settings.configurationFiles")}
              tooltipDelay={0}
              title={
                documentError ? t("extensions.settings.openConfigurationFileFailed") : undefined
              }
            />
          }
        >
          <FileJson2Icon aria-hidden="true" className="size-3.5" />
          <span className="hidden truncate sm:inline">
            {openingDocument
              ? t("extensions.settings.openingConfigurationFile")
              : t("extensions.settings.configurationFiles")}
          </span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" className="min-w-44">
          <DropdownMenuItem onClick={() => void openDocument("pi")}>
            {t("extensions.settings.piConfigurationFile")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void openDocument("workbench")}>
            {t("extensions.settings.workbenchConfigurationFile")}
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

/** Mount the Pi-only action only while the shared Settings main view is active. */
export function PiSettingsHeaderAction() {
  const mainViews = useMainViewService();
  const activeMainView = useSyncExternalStore(
    mainViews.subscribe,
    mainViews.getSnapshot,
    mainViews.getInitialSnapshot,
  );

  return activeMainView?.kind === "settings" ? <PiSettingsConfigurationMenu /> : null;
}
