"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

import type {
  ComposerCommandRegistry,
  MainViewRegistry,
  OpenerRegistry,
  PanelRegistry,
  SettingsRegistry,
  WorkbenchExtension,
  WorkspaceSurfaceRegistry,
} from "@workbench/extension-sdk";
import type { ExtensionManager } from "@workbench/extension-sdk/internal";

import type { CommandService } from "./services/command-service";
import type { MainViewService } from "./services/main-view-service";
import type { NavigationService } from "./services/navigation-service";
import type { PanelService } from "./services/panel-service";

const EMPTY_WORKBENCH_EXTENSIONS = Object.freeze([]) as readonly WorkbenchExtension[];

export type ExtensionErrorSource =
  | "command"
  | "main-view"
  | "composer-command"
  | "panel"
  | "renderer"
  | "setting"
  | "setup"
  | "slot"
  | "workspace";

export interface ExtensionErrorDetails {
  source: ExtensionErrorSource;
  contributionId?: string;
  extensionId?: string;
  commandId?: string;
  componentStack?: string | null;
}

export type ExtensionErrorHandler = (error: unknown, details: ExtensionErrorDetails) => void;

export interface ExtensionEnvironment {
  readonly manager: ExtensionManager;
  readonly panels: PanelService;
  readonly commands: CommandService;
  readonly navigation: NavigationService;
  readonly mainViews: MainViewService;
  readonly reportError: ExtensionErrorHandler;
}

export const ExtensionReactContext = createContext<ExtensionEnvironment | null>(null);

export function useExtensionEnvironment(): ExtensionEnvironment {
  const context = useContext(ExtensionReactContext);
  if (!context) {
    throw new Error("Extension hooks must be used inside an <ExtensionProvider>");
  }
  return context;
}

export function useExtensionManager(): ExtensionManager {
  return useExtensionEnvironment().manager;
}

/** 返回当前活动扩展的稳定快照，供工具箱等通用 Host 构建能力目录。 */
export function useWorkbenchExtensions(): readonly WorkbenchExtension[] {
  const manager = useExtensionManager();
  return useSyncExternalStore(
    manager.subscribe,
    () => manager.getExtensions(),
    () => EMPTY_WORKBENCH_EXTENSIONS,
  );
}

export function usePanelService(): PanelService {
  return useExtensionEnvironment().panels;
}

export function useCommandService(): CommandService {
  return useExtensionEnvironment().commands;
}

export function useExtensionErrorReporter(): ExtensionErrorHandler {
  return useExtensionEnvironment().reportError;
}

export function useOpenerRegistry(): OpenerRegistry {
  return useExtensionEnvironment().manager.openers;
}

export function useComposerCommandRegistry(): ComposerCommandRegistry {
  return useExtensionEnvironment().manager.composerCommands;
}

export function useNavigationService(): NavigationService {
  return useExtensionEnvironment().navigation;
}

export function useMainViewService(): MainViewService {
  return useExtensionEnvironment().mainViews;
}

export function useMainViewRegistry(): MainViewRegistry {
  return useExtensionEnvironment().manager.mainViews;
}

export function usePanelRegistry(): PanelRegistry {
  return useExtensionEnvironment().manager.panels;
}

export function useSettingsRegistry(): SettingsRegistry {
  return useExtensionEnvironment().manager.settings;
}

export function useWorkspaceSurfaceRegistry(): WorkspaceSurfaceRegistry {
  return useExtensionEnvironment().manager.workspace;
}
