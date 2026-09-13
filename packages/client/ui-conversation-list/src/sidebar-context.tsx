"use client";
import { createContext, useContext, useState, useLayoutEffect, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { WorkspaceSidebarState } from "./sidebar-contracts";
import { useWorkspaceSidebarController } from "./use-workspace-sidebar-controller";
const WorkspaceSidebarContext = createContext<StoreApi<WorkspaceSidebarState> | null>(null);

export function WorkspaceSidebarProvider({
  searchQuery,
  children,
}: {
  searchQuery: string;
  children: ReactNode;
}) {
  const value = useWorkspaceSidebarController(searchQuery);
  const [store] = useState(() => createStore(() => value));
  useLayoutEffect(() => store.setState(value, true), [store, value]);
  return (
    <WorkspaceSidebarContext.Provider value={store}>{children}</WorkspaceSidebarContext.Provider>
  );
}

export function useWorkspaceSidebar<T>(selector: (state: WorkspaceSidebarState) => T): T {
  const context = useContext(WorkspaceSidebarContext);
  if (!context) throw new Error("Workspace sidebar rows require WorkspaceSidebarProvider");
  return useStore(context, selector);
}
