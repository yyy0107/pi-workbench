"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo, type ReactNode } from "react";

import {
  WorkbenchNavigationProvider,
  type WorkbenchNavigationOptions,
  type WorkbenchNavigationPort,
} from "@workbench/shell/navigation";

import { conversationIdFromWorkbenchPathname } from "./workbench-routes";

function updateWorkbenchHistory(href: string, options?: WorkbenchNavigationOptions): void {
  if (window.location.pathname === href) return;
  if (options?.replace) window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
}

/** Next-owned adapter for the reusable Shell's semantic conversation navigation contract. */
export function InstalledWorkbenchNavigationProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const openConversation = useCallback(
    (conversationId: string, options?: WorkbenchNavigationOptions) => {
      updateWorkbenchHistory(`/c/${encodeURIComponent(conversationId)}`, options);
    },
    [],
  );
  const openHome = useCallback((options?: WorkbenchNavigationOptions) => {
    updateWorkbenchHistory("/", options);
  }, []);
  const refresh = useCallback(() => router.refresh(), [router]);
  const navigation = useMemo<WorkbenchNavigationPort>(
    () =>
      Object.freeze({
        currentConversationId: conversationIdFromWorkbenchPathname(pathname),
        isHome: pathname === "/",
        openConversation,
        openHome,
        refresh,
      }),
    [openConversation, openHome, pathname, refresh],
  );

  return (
    <WorkbenchNavigationProvider navigation={navigation}>{children}</WorkbenchNavigationProvider>
  );
}
