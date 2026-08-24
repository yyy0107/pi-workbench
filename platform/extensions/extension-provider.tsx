"use client";

import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

import { CommandService } from "@/services/command-service";
import { NavigationService } from "@/services/navigation-service";
import { MainViewService } from "@/services/main-view-service";
import { PanelService } from "@/services/panel-service";
import type { PanelStoreApi } from "@/stores/panel-store";

import type { WorkbenchExtension } from "./api/extension";
import {
  ExtensionReactContext,
  type ExtensionEnvironment,
  type ExtensionErrorHandler,
} from "./extension-context";
import { ExtensionManager } from "./extension-manager";

export interface ExtensionProviderProps {
  children: ReactNode;
  extensions: readonly WorkbenchExtension[];
  navigation?: NavigationService;
  panelStore?: PanelStoreApi;
  onError?: ExtensionErrorHandler;
}

function reportProviderError(
  handler: ExtensionErrorHandler | undefined,
  error: unknown,
  extensionId?: string,
): void {
  if (handler) {
    handler(error, { source: "setup", extensionId });
    return;
  }
  console.error(error);
}

function synchronizeExtensions(
  manager: ExtensionManager,
  extensions: readonly WorkbenchExtension[],
  onError?: ExtensionErrorHandler,
): void {
  const nextById = new Map<string, WorkbenchExtension>();
  for (const extension of extensions) {
    if (nextById.has(extension.id)) {
      reportProviderError(
        onError,
        new Error(`Duplicate extension id "${extension.id}"`),
        extension.id,
      );
      continue;
    }
    nextById.set(extension.id, extension);
  }

  for (const active of manager.getExtensions()) {
    const next = nextById.get(active.id);
    if (next && next === active) continue;
    try {
      manager.deactivate(active.id);
    } catch (error) {
      reportProviderError(onError, error, active.id);
    }
  }

  for (const extension of nextById.values()) {
    if (manager.isActive(extension.id)) continue;
    try {
      manager.activate(extension);
    } catch (error) {
      reportProviderError(onError, error, extension.id);
    }
  }
}

export function ExtensionProvider({
  children,
  extensions,
  navigation: providedNavigation,
  panelStore,
  onError,
}: ExtensionProviderProps) {
  const [manager] = useState(() => new ExtensionManager());
  const [defaultNavigation] = useState(() => new NavigationService());
  const navigation = providedNavigation ?? defaultNavigation;
  const mainViews = useMemo(() => new MainViewService(manager.mainViews), [manager]);
  const panels = useMemo(() => new PanelService(manager.panels, panelStore), [manager, panelStore]);
  const commands = useMemo(
    () => new CommandService(manager.commands, { panels, navigation }),
    [manager, navigation, panels],
  );

  const reportError = useCallback<ExtensionErrorHandler>(
    (error, details) => {
      if (onError) onError(error, details);
      else console.error(error);
    },
    [onError],
  );

  useLayoutEffect(() => {
    synchronizeExtensions(manager, extensions, onError);
    return () => {
      try {
        manager.dispose();
      } catch (error) {
        reportProviderError(onError, error);
      }
    };
  }, [extensions, manager, onError]);

  useLayoutEffect(() => () => mainViews.dispose(), [mainViews]);

  const value = useMemo<ExtensionEnvironment>(
    () => ({ manager, panels, commands, navigation, mainViews, reportError }),
    [commands, mainViews, manager, navigation, panels, reportError],
  );

  return <ExtensionReactContext.Provider value={value}>{children}</ExtensionReactContext.Provider>;
}
