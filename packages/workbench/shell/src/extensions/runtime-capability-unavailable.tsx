"use client";

import { useI18n } from "../i18n";

/** Restored surfaces remain readable when their runtime capability is no longer installed. */
export function RuntimeCapabilityUnavailable() {
  const { t } = useI18n();
  return (
    <p role="status" className="text-muted-foreground p-4 text-sm">
      {t("extensions.shared.capabilityUnavailable")}
    </p>
  );
}
