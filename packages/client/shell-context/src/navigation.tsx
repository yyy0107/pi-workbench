"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { NewThreadLayoutProvider } from "./layout/new-thread-layout";

export interface WorkbenchNavigationOptions {
  readonly replace?: boolean;
}

/** Semantic application navigation required by the reusable Workbench shell. */
export interface WorkbenchNavigationPort {
  readonly currentConversationId: string | undefined;
  readonly isHome: boolean;
  openConversation(conversationId: string, options?: WorkbenchNavigationOptions): void;
  openHome(options?: WorkbenchNavigationOptions): void;
  refresh(): void;
}

const WorkbenchNavigationContext = createContext<WorkbenchNavigationPort | undefined>(undefined);

export function WorkbenchNavigationProvider({
  children,
  navigation,
}: Readonly<{ children: ReactNode; navigation: WorkbenchNavigationPort }>) {
  const installedNavigation = useMemo<WorkbenchNavigationPort>(
    () => Object.freeze({ ...navigation }),
    [navigation],
  );

  return (
    <WorkbenchNavigationContext.Provider value={installedNavigation}>
      <NewThreadLayoutProvider>{children}</NewThreadLayoutProvider>
    </WorkbenchNavigationContext.Provider>
  );
}

export function useWorkbenchNavigation(): WorkbenchNavigationPort {
  const navigation = useContext(WorkbenchNavigationContext);
  if (!navigation) {
    throw new Error(
      "Workbench navigation is unavailable. Install WorkbenchNavigationProvider in the application composition.",
    );
  }
  return navigation;
}
