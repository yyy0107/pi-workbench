"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  WorkbenchNavigationProvider,
  type WorkbenchNavigationOptions,
  type WorkbenchNavigationPort,
} from "@workbench/shell/navigation";

import { conversationIdFromDesktopUrl, desktopUrlForConversation } from "./desktop-routes";

function updateDesktopHistory(
  conversationId: string | undefined,
  options?: WorkbenchNavigationOptions,
): void {
  const href = desktopUrlForConversation(window.location.href, conversationId);
  if (href === window.location.href) return;
  if (options?.replace) window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
}

/** Static-host navigation keeps conversation identity in the current document's query string. */
export function DesktopNavigationProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [currentConversationId, setCurrentConversationId] = useState<string | undefined>();

  useEffect(() => {
    const synchronize = () =>
      setCurrentConversationId(conversationIdFromDesktopUrl(window.location.href));
    synchronize();
    window.addEventListener("popstate", synchronize);
    return () => window.removeEventListener("popstate", synchronize);
  }, []);

  const openConversation = useCallback(
    (conversationId: string, options?: WorkbenchNavigationOptions) => {
      updateDesktopHistory(conversationId, options);
      setCurrentConversationId(conversationId);
    },
    [],
  );
  const openHome = useCallback((options?: WorkbenchNavigationOptions) => {
    updateDesktopHistory(undefined, options);
    setCurrentConversationId(undefined);
  }, []);
  const refresh = useCallback(() => {
    // Desktop locale and settings changes update their client providers directly.
  }, []);
  const navigation = useMemo<WorkbenchNavigationPort>(
    () =>
      Object.freeze({
        currentConversationId,
        isHome: currentConversationId === undefined,
        openConversation,
        openHome,
        refresh,
      }),
    [currentConversationId, openConversation, openHome, refresh],
  );

  return (
    <WorkbenchNavigationProvider navigation={navigation}>{children}</WorkbenchNavigationProvider>
  );
}
