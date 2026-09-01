"use client";

import { FileJson2Icon } from "lucide-react";
import { useState } from "react";

import { Button } from "@workbench/shell/ui";
import { usePiConfigurationClient } from "@workbench/agent-runtime-pi-client/configuration";

import { usePiI18n } from "../../i18n";

export interface PiSettingsDocumentClient {
  openAgentSettingsDocument(): Promise<unknown>;
}

export function openPiSettingsConfigurationDocument(
  client: PiSettingsDocumentClient,
): Promise<unknown> {
  return client.openAgentSettingsDocument();
}

/**
 * Pi-only configuration files action. The generic Settings extension chooses when to render this
 * component, so this leaf has no dependency on the Settings main-view or mobile trigger owners.
 */
export function PiSettingsConfigurationMenu() {
  const { t } = usePiI18n();
  const configuration = usePiConfigurationClient();
  const [openingDocument, setOpeningDocument] = useState(false);
  const [documentError, setDocumentError] = useState(false);

  const openDocument = async () => {
    if (openingDocument) return;
    setOpeningDocument(true);
    setDocumentError(false);
    try {
      await openPiSettingsConfigurationDocument(configuration);
    } catch {
      setDocumentError(true);
    } finally {
      setOpeningDocument(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={documentError ? "text-destructive hover:text-destructive" : undefined}
        disabled={openingDocument}
        aria-label={t("extensions.settings.viewConfigurationFile")}
        title={documentError ? t("extensions.settings.openConfigurationFileFailed") : undefined}
        onClick={() => void openDocument()}
      >
        <FileJson2Icon aria-hidden="true" className="size-3.5" />
        <span className="hidden truncate sm:inline">
          {openingDocument
            ? t("extensions.settings.openingConfigurationFile")
            : t("extensions.settings.piConfigurationFile")}
        </span>
      </Button>
      {documentError ? (
        <p className="sr-only" role="alert">
          {t("extensions.settings.openConfigurationFileFailed")}
        </p>
      ) : null}
    </>
  );
}
