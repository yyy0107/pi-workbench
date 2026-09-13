"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { WorkbenchExtension } from "@workbench/extension-sdk";
import { ExtensionManager } from "@workbench/extension-sdk/internal";

import {
  ExtensionReactContext,
  type ExtensionEnvironment,
  type ExtensionErrorHandler,
} from "./extension-context";
import { CommandService } from "./services/command-service";
import { MainViewService } from "./services/main-view-service";
import { NavigationService } from "./services/navigation-service";
import { PanelService, type PanelStorePort } from "./services/panel-service";

export interface ExtensionProviderProps {
  children: ReactNode;
  extensions: readonly WorkbenchExtension[];
  navigation?: NavigationService;
  panelStore: PanelStorePort;
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
  const managerLifecycleRef = useRef(0);
  const [defaultNavigation] = useState(() => new NavigationService());
  const navigation = providedNavigation ?? defaultNavigation;
  const mainViews = useMemo(() => new MainViewService(manager.mainViews), [manager]);
  const panels = useMemo(() => new PanelService(manager.panels, panelStore), [manager, panelStore]);
  const commands = useMemo(
    () => new CommandService(manager.commands, { mainViews, panels, navigation }),
    [mainViews, manager, navigation, panels],
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
  }, [extensions, manager, onError]);

  useLayoutEffect(() => {
    const lifecycle = ++managerLifecycleRef.current;
    return () => {
      // React Strict Effects immediately mounts this effect again in development. Defer the
      // irreversible owner cleanup so that replacement setup can retain the same manager.
      queueMicrotask(() => {
        if (managerLifecycleRef.current !== lifecycle) return;
        mainViews.dispose();
        try {
          manager.dispose();
        } catch (error) {
          reportProviderError(onError, error);
        }
      });
    };
  }, [mainViews, manager, onError]);

  const value = useMemo<ExtensionEnvironment>(
    () => ({ manager, panels, commands, navigation, mainViews, reportError }),
    [commands, mainViews, manager, navigation, panels, reportError],
  );

  return <ExtensionReactContext.Provider value={value}>{children}</ExtensionReactContext.Provider>;
}
