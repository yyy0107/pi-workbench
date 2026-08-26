"use client";

import { useI18n } from "@/i18n";

export function AskUserRecommendedMark() {
  const { t } = useI18n();

  return (
    <span className="text-primary bg-primary/10 inline-flex shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none">
      {t("extensions.interactiveRequests.recommended")}
    </span>
  );
}
