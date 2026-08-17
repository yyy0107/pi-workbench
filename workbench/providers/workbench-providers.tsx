"use client";

import type { ReactNode } from "react";

import { enabledExtensions } from "@/extensions/enabled-extensions";
import { ExtensionProvider } from "@/platform/extensions";

import { WorkbenchAssistantRuntimeProvider } from "./assistant-runtime-provider";

export function WorkbenchProviders({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <WorkbenchAssistantRuntimeProvider>
      <ExtensionProvider extensions={enabledExtensions}>{children}</ExtensionProvider>
    </WorkbenchAssistantRuntimeProvider>
  );
}
