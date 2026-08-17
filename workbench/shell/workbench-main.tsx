import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function WorkbenchMain({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <main className={cn("bg-background min-h-0 min-w-0 flex-1 overflow-hidden", className)}>
      {children}
    </main>
  );
}
