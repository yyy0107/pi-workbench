"use client";

import { createContext, useContext } from "react";

import type { CommandService } from "@/services/command-service";
import type { NavigationService } from "@/services/navigation-service";
import type { PanelService } from "@/services/panel-service";

import type { ExtensionManager } from "./extension-manager";

export type ExtensionErrorSource = "command" | "panel" | "renderer" | "setup" | "slot";

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

export function useNavigationService(): NavigationService {
  return useExtensionEnvironment().navigation;
}
