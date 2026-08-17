"use client";

import { FileCode2Icon } from "lucide-react";

import { useI18n } from "@/i18n";
import type { PanelTabComponentProps } from "@/platform/extensions";

export function CodeEditorTab({ panelId }: PanelTabComponentProps) {
  const { t } = useI18n();

  return (
    <>
      <FileCode2Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left" data-panel-tab-id={panelId}>
        {t("extensions.codeEditor.title")}
      </span>
    </>
  );
}
