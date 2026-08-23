"use client";

import { createContext, useContext } from "react";

import type { CommandService } from "@/services/command-service";
import type { NavigationService } from "@/services/navigation-service";
import type { PanelService } from "@/services/panel-service";

import type { SettingsRegistry } from "./api/settings";
import type { ComposerCommandRegistry } from "./api/composer-command";
import type { OpenerRegistry } from "./api/opener";
import type { WorkspaceSurfaceRegistry } from "./api/workspace-surface";

import type { ExtensionManager } from "./extension-manager";

export type ExtensionErrorSource =
  | "command"
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

export function useSettingsRegistry(): SettingsRegistry {
  return useExtensionEnvironment().manager.settings;
}

export function useWorkspaceSurfaceRegistry(): WorkspaceSurfaceRegistry {
  return useExtensionEnvironment().manager.workspace;
}
