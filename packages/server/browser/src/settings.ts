/* eslint-disable no-control-regex -- Download paths must exclude ASCII control characters. */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  DEFAULT_BROWSER_SETTINGS,
  parseBrowserSettingsPatch,
  type BrowserSettings,
} from "@workbench/browser-contracts";
import { atomicReplaceFile } from "@workbench/server-core/file-persistence";

import { BrowserError } from "./errors";

export class BrowserSettingsStore {
  private readonly stateFile: string;
  private settings: Promise<BrowserSettings>;
  private writing: Promise<unknown> = Promise.resolve();

  constructor(stateFile: string) {
    this.stateFile = stateFile;
    this.settings = this.load();
    // Preserve the load failure for callers without an unhandled constructor rejection.
    void this.settings.catch(() => undefined);
  }

  private async load(): Promise<BrowserSettings> {
    try {
      const content = await readFile(this.stateFile, "utf8");
      const patch = parseBrowserSettingsPatch(JSON.parse(content));
      if (!patch) throw new BrowserError("browser-invalid");
      return this.merge(structuredClone(DEFAULT_BROWSER_SETTINGS), patch);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return structuredClone(DEFAULT_BROWSER_SETTINGS);
      throw new BrowserError("browser-operation-failed");
    }
  }

  private merge(current: BrowserSettings, patch: Partial<BrowserSettings>): BrowserSettings {
    const next = {
      ...current,
      ...patch,
      permissions: { ...current.permissions, ...patch.permissions },
    };
    if (next.downloadDirectory) {
      const expanded =
        next.downloadDirectory === "~"
          ? homedir()
          : /^~[\\/]/.test(next.downloadDirectory)
            ? path.join(homedir(), next.downloadDirectory.slice(2))
            : next.downloadDirectory;
      if (!path.isAbsolute(expanded) || /[\x00-\x1F]/.test(expanded))
        throw new BrowserError("browser-invalid");
      next.downloadDirectory = path.normalize(expanded);
    }
    return next;
  }

  async get(): Promise<BrowserSettings> {
    return structuredClone(await this.settings);
  }

  update(value: Partial<BrowserSettings>): Promise<BrowserSettings> {
    const patch = parseBrowserSettingsPatch(value);
    if (!patch) return Promise.reject(new BrowserError("browser-invalid"));
    const operation = this.writing.then(async () => {
      const next = this.merge(await this.settings, structuredClone(patch));
      await atomicReplaceFile(this.stateFile, `${JSON.stringify(next, null, 2)}\n`, {
        directoryMode: 0o700,
        enforceFileModeAfterReplace: true,
      });
      this.settings = Promise.resolve(next);
      return structuredClone(next);
    });
    this.writing = operation.catch(() => undefined);
    return operation;
  }
}
