"use client";

import { useEffect } from "react";
import { useThreadList } from "@workbench/agent-runtime-client";
import { readDesktopSettingsPort } from "@workbench/desktop-contracts";
import { useI18n } from "@workbench/shell/i18n";
import { useWorkbenchNavigation } from "@workbench/shell/navigation";
import { playNotificationSound, stopNotificationSound } from "./notification-sounds";

export function DesktopTaskNotifications() {
  const catalog = useThreadList();
  const { locale } = useI18n();
  const navigation = useWorkbenchNavigation();
  useEffect(() => {
    const port = readDesktopSettingsPort(window.workbenchDesktop?.settings);
    const unsubscribe = port?.onNotificationSound?.((sound) => {
      void playNotificationSound(sound).catch((error) => {
        console.warn("Could not play the task notification sound.", error);
      });
    });
    return () => {
      unsubscribe?.();
      stopNotificationSound();
    };
  }, []);
  useEffect(() => {
    const port = readDesktopSettingsPort(window.workbenchDesktop?.settings);
    if (!port || catalog.isLoading || catalog.error) return;
    const sync = () => {
      void port
        .syncTasks({
          locale,
          tasks: catalog.threads.map((thread) => ({
            id: thread.threadId,
            title: (thread.title ?? "").slice(0, 1000),
            running: thread.isRunning,
            waiting: thread.isWaitingForInput,
            failed: thread.lastRunFailed === true,
          })),
        })
        .catch(() => {
          /* Main treats missing activity reports as busy. */
        });
    };
    sync();
    const interval = setInterval(sync, 15_000);
    return () => clearInterval(interval);
  }, [catalog, locale]);
  useEffect(
    () =>
      readDesktopSettingsPort(window.workbenchDesktop?.settings)?.onOpenTask((id) =>
        navigation.openConversation(id),
      ),
    [navigation],
  );
  return null;
}
