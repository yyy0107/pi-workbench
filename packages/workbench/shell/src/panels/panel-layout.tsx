import type { ReactNode } from "react";

import { PanelDock } from "./panel-dock";
import { TerminalDrawer } from "./terminal-drawer";

export function PanelLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <PanelDock location="left" />
        {children}
      </div>
      <TerminalDrawer />
    </div>
  );
}
