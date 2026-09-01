"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface SidebarDragSession {
  isClickSuppressed(now: number): boolean;
  suppressClicksUntil(deadline: number): void;
}

export function createSidebarDragSession(): SidebarDragSession {
  let clickSuppressionDeadline = 0;
  return Object.freeze({
    isClickSuppressed(now: number): boolean {
      if (now <= clickSuppressionDeadline) return true;
      clickSuppressionDeadline = 0;
      return false;
    },
    suppressClicksUntil(deadline: number): void {
      clickSuppressionDeadline = deadline;
    },
  });
}

const SidebarDragSessionContext = createContext<SidebarDragSession | undefined>(undefined);

/** Keeps post-drag click suppression inside one Workbench sidebar installation. */
export function SidebarDragSessionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [session] = useState(createSidebarDragSession);
  return (
    <SidebarDragSessionContext.Provider value={session}>
      {children}
    </SidebarDragSessionContext.Provider>
  );
}

export function useSidebarDragSession(): SidebarDragSession {
  const session = useContext(SidebarDragSessionContext);
  if (!session) throw new Error("WorkbenchSidebar requires its Shell drag-session installation");
  return session;
}
