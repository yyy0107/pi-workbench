"use client";

import { SlotHost } from "@/platform/extensions";

export function WorkbenchStatusbar() {
  return (
    <footer className="bg-background text-muted-foreground flex h-7 shrink-0 items-center justify-between gap-3 border-t px-3 text-xs">
      <SlotHost name="statusbar.left" className="flex items-center gap-3" />
      <SlotHost name="statusbar.right" className="flex items-center justify-end gap-3" />
    </footer>
  );
}
