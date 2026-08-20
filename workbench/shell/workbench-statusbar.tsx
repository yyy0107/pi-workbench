"use client";

import { SlotHost } from "@/platform/extensions";

export function WorkbenchStatusbar() {
  return (
    <footer
      data-workbench-surface="statusbar"
      className="bg-background text-muted-foreground flex h-7 shrink-0 items-center justify-between gap-3 overflow-hidden border-t px-3 text-xs"
    >
      <SlotHost name="statusbar.left" className="flex shrink-0 items-center gap-3" />
      <SlotHost
        name="statusbar.right"
        className="flex min-w-0 flex-1 items-center justify-end gap-3 overflow-hidden"
      />
    </footer>
  );
}
