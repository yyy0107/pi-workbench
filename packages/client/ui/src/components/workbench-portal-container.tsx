"use client";

import { createContext, useContext, type ReactNode, type RefObject } from "react";

export type WorkbenchPortalContainerRef = RefObject<HTMLElement | null>;

const WorkbenchPortalContainerContext = createContext<WorkbenchPortalContainerRef | undefined>(
  undefined,
);

/** Keeps all overlay DOM inside the immutable Workbench installation that created it. */
export function WorkbenchPortalContainerProvider({
  children,
  containerRef,
}: Readonly<{
  children: ReactNode;
  containerRef: WorkbenchPortalContainerRef;
}>) {
  return (
    <WorkbenchPortalContainerContext.Provider value={containerRef}>
      {children}
    </WorkbenchPortalContainerContext.Provider>
  );
}

/** Package-private default for Base UI portals; standalone primitives retain their body fallback. */
export function useWorkbenchPortalContainer(): WorkbenchPortalContainerRef | undefined {
  return useContext(WorkbenchPortalContainerContext);
}
