"use client";

import { useTranslationBundle } from "@workbench/i18n";
import { uiTranslationBundle } from "../i18n";

/** Restored surfaces remain readable when their runtime capability is no longer installed. */
export function RuntimeCapabilityUnavailable() {
  const { t } = useTranslationBundle(uiTranslationBundle);
  return (
    <p role="status" className="text-muted-foreground p-4 text-sm">
      {t("ui.capabilityUnavailable")}
    </p>
  );
}
