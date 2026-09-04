"use client";

import type { ReactNode } from "react";

import type { AgentRuntime } from "@workbench/agent-runtime-core";

import { RuntimeContext } from "./runtime-context";

/** Install one stable Headless Runtime without copying its changing snapshots into Context. */
export function RuntimeProvider({
  runtime,
  children,
}: Readonly<{ runtime: AgentRuntime; children: ReactNode }>) {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}
