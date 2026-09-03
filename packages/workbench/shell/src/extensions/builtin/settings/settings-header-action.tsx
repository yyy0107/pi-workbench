"use client";

import { useSyncExternalStore } from "react";

import { useMainViewService } from "@workbench/extension-host";

import { SETTINGS_MAIN_VIEW_KIND } from "./settings-main-view";
import { MobileSettingsTrigger } from "./settings-trigger";

/** Render the Shell-owned mobile trigger outside Settings; feature actions use their own slots. */
export function SettingsHeaderAction() {
  const mainViews = useMainViewService();
  const activeMainView = useSyncExternalStore(
    mainViews.subscribe,
    mainViews.getSnapshot,
    mainViews.getInitialSnapshot,
  );

  return activeMainView?.kind === SETTINGS_MAIN_VIEW_KIND ? null : <MobileSettingsTrigger />;
}
