"use client";

import type { ReactNode } from "react";

import { RightWorkspaceProvider, WorkspaceSurfaceRuntimeHost } from "@/components/right-workspace";
import { enabledExtensions } from "@/extensions/enabled-extensions";
import { ExtensionProvider, useWorkspaceSurfaceRegistry } from "@/platform/extensions";

import { WorkbenchAssistantRuntimeProvider } from "./assistant-runtime-provider";

function RightWorkspaceProviders({ children }: Readonly<{ children: ReactNode }>) {
  const registry = useWorkspaceSurfaceRegistry();

  return (
    <RightWorkspaceProvider registry={registry}>
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
