"use client";

import { PanelLeftOpenIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { SlotHost } from "@/platform/extensions";

function SidebarOpenButton() {
  const { isMobile, state, toggleSidebar } = useSidebar();

  if (!isMobile && state === "expanded") return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={isMobile ? "打开会话侧边栏" : "展开侧边栏"}
      title={isMobile ? "打开会话侧边栏" : "展开侧边栏"}
      onClick={toggleSidebar}
    >
      <PanelLeftOpenIcon className="size-[18px]" />
    </Button>
  );
}

export function WorkbenchHeader() {
  return (
    <header className="bg-background grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b px-3">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarOpenButton />
        <span className="truncate text-sm font-semibold">Workbench</span>
        <SlotHost name="header.left" className="flex items-center gap-2" />
      </div>

      <SlotHost name="header.center" className="flex items-center justify-center gap-2" />

      <SlotHost name="header.right" className="flex min-w-0 items-center justify-end gap-2" />
    </header>
  );
}
