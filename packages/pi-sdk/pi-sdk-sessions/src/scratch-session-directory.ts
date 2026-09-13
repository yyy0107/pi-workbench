import { existsSync, mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ScratchSessionStateRecord } from "./session-registry-state";
import { ScratchSessionRegistryState } from "./session-registry-state";

export const SCRATCH_EXPIRY_BUSY_RETRY_MS = 60 * 1000;
export const SCRATCH_SESSION_DIRECTORY_PREFIX = "pi-workbench-scratch-";

export interface ScratchSessionDirectoryOptions {
  isBusy(id: string): boolean;
  release(id: string): Promise<void>;
  invalidateFile(filePath: string): void;
  readonly now?: () => number;
  readonly retryDelayMs?: number;
  readonly directoryPrefix?: string;
}

export class ScratchSessionDirectory {
  private readonly options: ScratchSessionDirectoryOptions;
  private readonly state: ScratchSessionRegistryState;

  constructor(state: ScratchSessionRegistryState, options: ScratchSessionDirectoryOptions) {
    this.state = state;
    this.options = options;
  }

  directory(): string {
    this.state.directory ??= mkdtempSync(
      path.join(os.tmpdir(), this.options.directoryPrefix ?? SCRATCH_SESSION_DIRECTORY_PREFIX),
    );
    return this.state.directory;
  }

  get(id: string): ScratchSessionStateRecord | undefined {
    return this.state.get(id);
  }

  set(record: ScratchSessionStateRecord): void {
    this.state.set(record);
  }

  delete(id: string): boolean {
    return this.state.delete(id);
  }

  clearExpiry(record: ScratchSessionStateRecord): void {
    if (!record.expiryTimer) return;
    clearTimeout(record.expiryTimer);
    record.expiryTimer = undefined;
  }

  scheduleExpiry(record: ScratchSessionStateRecord): void {
    this.clearExpiry(record);
    const now = this.options.now ?? Date.now;
    const delay = Math.max(0, record.expiresAt - now());
    record.expiryTimer = setTimeout(() => {
      const current = this.state.get(record.id);
      if (current !== record) return;
      if (this.options.isBusy(record.id)) {
        record.expiresAt = now() + (this.options.retryDelayMs ?? SCRATCH_EXPIRY_BUSY_RETRY_MS);
        this.scheduleExpiry(record);
        return;
      }
      void this.options.release(record.id).catch((error: unknown) => {
        console.error("[workbench-pi] scratch session expiry failed", error);
      });
    }, delay);
    record.expiryTimer.unref?.();
  }

  async shutdown(): Promise<void> {
    for (const record of this.state.sessions.values()) {
      this.clearExpiry(record);
      this.options.invalidateFile(record.filePath);
      if (existsSync(record.filePath)) unlinkSync(record.filePath);
    }
    this.state.sessions.clear();
    if (this.state.directory && existsSync(this.state.directory)) {
      try {
        rmdirSync(this.state.directory);
      } catch {
        // Failed fork artifacts remain isolated in the operating system temp directory.
      }
    }
    this.state.directory = undefined;
  }
}
