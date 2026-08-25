"use client";

import { useMemo, type ReactNode } from "react";

import { RightWorkspaceProvider } from "@/components/right-workspace";
import { useInstalledComponentExtensions } from "@/extensions/component-extension-installation";
import { builtinExtensions } from "@/extensions/enabled-extensions";
import {
  ExtensionProvider,
  useOpenerRegistry,
  useWorkspaceSurfaceRegistry,
} from "@/platform/extensions/internal";

import { WorkbenchAssistantRuntimeProvider } from "./assistant-runtime-provider";

function RightWorkspaceProviders({ children }: Readonly<{ children: ReactNode }>) {
  const openers = useOpenerRegistry();
  const registry = useWorkspaceSurfaceRegistry();

  return (
    <RightWorkspaceProvider openers={openers} registry={registry}>
      <WorkbenchAssistantRuntimeProvider>{children}</WorkbenchAssistantRuntimeProvider>
    </RightWorkspaceProvider>
  );
}

export function WorkbenchProviders({ children }: Readonly<{ children: ReactNode }>) {
  const installedComponentExtensions = useInstalledComponentExtensions();
  const activeExtensions = useMemo(
    () => [...builtinExtensions, ...installedComponentExtensions],
    [installedComponentExtensions],
  );

  return (
    <ExtensionProvider extensions={activeExtensions}>
      <RightWorkspaceProviders>{children}</RightWorkspaceProviders>
    </ExtensionProvider>
  );
}
