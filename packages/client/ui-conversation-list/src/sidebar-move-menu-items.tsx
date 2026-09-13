"use client";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { DropdownMenuItem } from "@workbench/ui";
import { useTranslationBundle } from "@workbench/i18n";
import { sidebarTranslationBundle } from "./i18n";
import type { useWorkspaceSidebarItem } from "./workspace-sidebar-item";
export function SidebarMoveMenuItems({
  controls,
}: {
  controls: ReturnType<typeof useWorkspaceSidebarItem>;
}) {
  const { t } = useTranslationBundle(sidebarTranslationBundle);
  return (
    <>
      <DropdownMenuItem disabled={!controls.canMoveUp} onClick={controls.moveUp}>
        <ArrowUpIcon />
        {t("workbench.sidebar.moveUp")}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!controls.canMoveDown} onClick={controls.moveDown}>
        <ArrowDownIcon />
        {t("workbench.sidebar.moveDown")}
      </DropdownMenuItem>
    </>
  );
}
