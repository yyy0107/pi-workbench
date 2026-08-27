import type { WorkspaceSurfaceModule } from "@/platform/extensions/authoring";

import type { TerminalTarget } from "./terminal-target";

export async function loadTerminalSurface(): Promise<WorkspaceSurfaceModule<TerminalTarget>> {
  const module = await import("./terminal-surface");
  return { default: module.TerminalSurface };
}
