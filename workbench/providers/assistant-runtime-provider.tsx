"use client";

import type { ReactNode } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";

import { useWorkbenchRuntime } from "@/runtime/use-workbench-runtime";

export function WorkbenchAssistantRuntimeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const runtime = useWorkbenchRuntime();

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
