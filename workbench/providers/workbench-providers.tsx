"use client";

import type { ReactNode } from "react";

import { RightWorkspaceProvider, WorkspaceSurfaceRuntimeHost } from "@/components/right-workspace";
import { enabledExtensions } from "@/extensions/enabled-extensions";
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
      <WorkbenchAssistantRuntimeProvider>
        <WorkspaceSurfaceRuntimeHost />
        {children}
      </WorkbenchAssistantRuntimeProvider>
    </RightWorkspaceProvider>
  );
}

export function WorkbenchProviders({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ExtensionProvider extensions={enabledExtensions}>
      <RightWorkspaceProviders>{children}</RightWorkspaceProviders>
    </ExtensionProvider>
  );
}
