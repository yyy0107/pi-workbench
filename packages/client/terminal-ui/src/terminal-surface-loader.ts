import type { WorkspaceSurfaceModule } from "@workbench/extension-sdk";

import type { TerminalTarget } from "./terminal-target";

export async function loadTerminalSurface(): Promise<WorkspaceSurfaceModule<TerminalTarget>> {
  const module = await import("./terminal-surface");
  return { default: module.TerminalSurface };
}
