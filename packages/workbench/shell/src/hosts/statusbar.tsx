"use client";

import { SessionProvider } from "@workbench/agent-runtime-client";
import { SlotHost } from "@workbench/extension-host/hosts/slot-host";

export function WorkbenchStatusbar() {
  return (
    <footer
      data-workbench-surface="statusbar"
      className="@container/statusbar bg-background text-muted-foreground flex h-(--workbench-statusbar-height) shrink-0 items-center justify-between gap-2 overflow-hidden border-t px-2 text-xs sm:px-3"
    >
      <SessionProvider>
        <SlotHost name="statusbar.left" className="flex min-w-0 shrink-0 items-center gap-2" />
        <SlotHost
          name="statusbar.right"
          className="@container/statusbar-right flex min-w-0 flex-1 items-center justify-end gap-2 overflow-hidden"
        />
      </SessionProvider>
    </footer>
  );
}
