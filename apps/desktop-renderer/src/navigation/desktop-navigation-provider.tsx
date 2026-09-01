"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  WorkbenchNavigationProvider,
  type WorkbenchNavigationOptions,
  type WorkbenchNavigationPort,
} from "@workbench/shell/navigation";
import { useWorkbenchSettingsService } from "@workbench/shell/settings";

import {
  conversationIdFromDesktopUrl,
  desktopConversationIdForLaunch,
  desktopUrlForConversation,
} from "./desktop-routes";

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
  const settings = useWorkbenchSettingsService();
  const [currentConversationId, setCurrentConversationId] = useState<string | undefined>();
  const navigationRevision = useRef(0);
  const persistConversation = useCallback(
    (conversationId: string | undefined) => {
      void settings
        .update({ sidebarSelectedThreadId: conversationId ?? null })
        .catch((error) =>
          console.error("[workbench-desktop] failed to persist selected conversation", error),
        );
    },
    [settings],
  );

  useEffect(() => {
    let active = true;
    const revision = navigationRevision.current;
    const urlConversationId = conversationIdFromDesktopUrl(window.location.href);
    setCurrentConversationId(urlConversationId);
    void settings
      .load()
      .then((preferences) => {
        if (!active || navigationRevision.current !== revision) return;
        const conversationId = desktopConversationIdForLaunch(
          window.location.href,
          preferences.sidebarSelectedThreadId,
        );
        if (conversationId !== urlConversationId) {
          updateDesktopHistory(conversationId, { replace: true });
        }
        setCurrentConversationId(conversationId);
        if (conversationId !== preferences.sidebarSelectedThreadId) {
          persistConversation(conversationId);
        }
      })
      .catch((error) =>
        console.error("[workbench-desktop] failed to restore selected conversation", error),
      );
    const synchronize = () => {
      navigationRevision.current += 1;
      const conversationId = conversationIdFromDesktopUrl(window.location.href);
      setCurrentConversationId(conversationId);
      persistConversation(conversationId);
    };
    window.addEventListener("popstate", synchronize);
    return () => {
      active = false;
      window.removeEventListener("popstate", synchronize);
    };
  }, [persistConversation, settings]);

  const openConversation = useCallback(
    (conversationId: string, options?: WorkbenchNavigationOptions) => {
      navigationRevision.current += 1;
      updateDesktopHistory(conversationId, options);
      setCurrentConversationId(conversationId);
      persistConversation(conversationId);
    },
    [persistConversation],
  );
  const openHome = useCallback(
    (options?: WorkbenchNavigationOptions) => {
      navigationRevision.current += 1;
      updateDesktopHistory(undefined, options);
      setCurrentConversationId(undefined);
      persistConversation(undefined);
    },
    [persistConversation],
  );
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
