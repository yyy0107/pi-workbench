"use client";

import { createElement, useSyncExternalStore, type ComponentType } from "react";

import { useMainViewService } from "@workbench/extension-host";

import { SETTINGS_MAIN_VIEW_KIND } from "./settings-main-view";
import { MobileSettingsTrigger } from "./settings-trigger";

function EmptySettingsViewHeaderAction() {
  return null;
}

/** Keep Host-backed rendering outside the pure extension authoring module. */
export function createSettingsHeaderAction(
  SettingsViewHeaderAction?: ComponentType,
): ComponentType {
  return function SettingsHeaderAction() {
    const mainViews = useMainViewService();
    const activeMainView = useSyncExternalStore(
      mainViews.subscribe,
      mainViews.getSnapshot,
      mainViews.getInitialSnapshot,
    );
    const ActiveSettingsAction = SettingsViewHeaderAction ?? EmptySettingsViewHeaderAction;

    return createElement(
      activeMainView?.kind === SETTINGS_MAIN_VIEW_KIND
        ? ActiveSettingsAction
        : MobileSettingsTrigger,
    );
  };
}
