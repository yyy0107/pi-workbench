import type { BrowserCommand } from "./index";

export interface BrowserHost {
  command(
    command: BrowserCommand,
    signal?: AbortSignal,
    controlSignal?: AbortSignal,
  ): Promise<unknown>;
  resolveProjectId?(cwd: string): Promise<string>;
}
