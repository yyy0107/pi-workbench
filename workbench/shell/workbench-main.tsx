import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { MainViewHost } from "@/platform/extensions/hosts/main-view-host";

export function WorkbenchMain({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <main
      data-workbench-surface="main"
      className={cn("bg-background min-h-0 min-w-0 flex-1 overflow-hidden", className)}
    >
      <MainViewHost>{children}</MainViewHost>
    </main>
  );
}
