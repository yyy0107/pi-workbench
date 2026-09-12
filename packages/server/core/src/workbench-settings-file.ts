import { readFile } from "node:fs/promises";
import path from "node:path";

import { atomicReplaceFile } from "./file-persistence";

export const WORKBENCH_SETTINGS_VERSION = 1 as const;

export interface WorkbenchSettingsDocument {
  version: typeof WORKBENCH_SETTINGS_VERSION;
  revision: number;
  preferences?: unknown;
  workspaces?: unknown;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError("workbench settings revision must be a non-negative integer");
  }
  return value as number;
}

export function emptyWorkbenchSettingsDocument(): WorkbenchSettingsDocument {
  return { version: WORKBENCH_SETTINGS_VERSION, revision: 0 };
}

export function parseWorkbenchSettingsDocument(value: unknown): WorkbenchSettingsDocument {
  if (!isRecord(value)) throw new TypeError("workbench settings must be an object");
  if (value.version !== WORKBENCH_SETTINGS_VERSION) {
    throw new TypeError(`unsupported workbench settings version: ${String(value.version)}`);
  }
  return {
    ...value,
    version: WORKBENCH_SETTINGS_VERSION,
    revision: revision(value.revision),
  };
}

export async function readWorkbenchSettingsDocument(
  stateFile: string,
): Promise<WorkbenchSettingsDocument> {
  try {
    return parseWorkbenchSettingsDocument(JSON.parse(await readFile(stateFile, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyWorkbenchSettingsDocument();
    }
    throw error;
  }
}

export function nextWorkbenchSettingsDocument(
  current: WorkbenchSettingsDocument,
  patch: Partial<WorkbenchSettingsDocument>,
): WorkbenchSettingsDocument {
  if (current.revision === Number.MAX_SAFE_INTEGER) {
    throw new TypeError("workbench settings revision is exhausted");
  }
  return {
    ...current,
    ...patch,
    version: WORKBENCH_SETTINGS_VERSION,
    revision: current.revision + 1,
  };
}

export async function writeWorkbenchSettingsDocument(
  stateFile: string,
  document: WorkbenchSettingsDocument,
): Promise<void> {
  await atomicReplaceFile(stateFile, `${JSON.stringify(document, null, 2)}\n`, {
    directoryMode: 0o700,
    fileMode: 0o600,
    enforceFileModeAfterReplace: true,
  });
}

export interface WorkbenchSettingsFileOptions {
  readonly defaultDirectory: string;
  readonly configuredFile?: string;
}

/** Resolves host configuration without owning the installed runtime's default directory policy. */
export function configuredWorkbenchSettingsFile({
  defaultDirectory,
  configuredFile,
}: WorkbenchSettingsFileOptions): string {
  const explicit = configuredFile?.trim();
  return explicit
    ? path.resolve(explicit)
    : path.join(path.resolve(defaultDirectory), "workbench-settings.json");
}
