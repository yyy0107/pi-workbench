import { stat } from "node:fs/promises";

import { isLocale } from "@workbench/contracts/locale";
import type {
  WorkbenchBackgroundImagePreference,
  WorkbenchSettingsJsonValue,
  WorkbenchSettingsPreferences,
  WorkbenchSettingsPreferencesPatch,
  WorkbenchSettingsProtocol,
  WorkbenchSettingsSnapshot,
  WorkbenchSettingsUpdate,
  WorkbenchSettingsUpdateResult,
} from "@workbench/agent-runtime-contracts/settings";
import { withCrossProcessFileLock } from "@workbench/server-core/file-persistence";
import { RpcDomainError } from "@workbench/server-core/rpc-domain-error";
import {
  emptyWorkbenchSettingsDocument,
  nextWorkbenchSettingsDocument,
  readWorkbenchSettingsDocument,
  writeWorkbenchSettingsDocument,
} from "./file";

const MAX_APPEARANCE_BYTES = 128 * 1024;
const MAX_RIGHT_WORKSPACE_BYTES = 2 * 1024 * 1024;
const MAX_SIDEBAR_THREAD_ORDER_BYTES = 2 * 1024 * 1024;
const MAX_SIDEBAR_THREAD_ORDER_SCOPES = 2_000;
const MAX_SIDEBAR_THREADS_PER_SCOPE = 10_000;
const MAX_BACKGROUND_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_BACKGROUND_IMAGE_BASE64_LENGTH = Math.ceil(MAX_BACKGROUND_IMAGE_BYTES / 3) * 4;

type WorkbenchSettingsPreferencesListener = (preferences: WorkbenchSettingsPreferences) => void;

const preferenceListenersByStateFile = new Map<string, Set<WorkbenchSettingsPreferencesListener>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown, depth = 0): value is WorkbenchSettingsJsonValue {
  if (depth > 32) return false;
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  return isRecord(value) && Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

function jsonRecord(value: unknown, field: string, maximumBytes: number) {
  if (!isRecord(value) || !isJsonValue(value)) throw new TypeError(`${field} must be JSON data`);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maximumBytes) {
    throw new TypeError(`${field} is too large`);
  }
  return value as Record<string, WorkbenchSettingsJsonValue>;
}

function shortString(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximumLength) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function backgroundImage(value: unknown): WorkbenchBackgroundImagePreference {
  if (!isRecord(value)) throw new TypeError("backgroundImage must be an object");
  const name = shortString(value.name, "backgroundImage.name", 1_024);
  const mimeType = shortString(value.mimeType, "backgroundImage.mimeType", 256);
  if (!mimeType.startsWith("image/")) throw new TypeError("backgroundImage.mimeType is invalid");
  const data = shortString(value.data, "backgroundImage.data", MAX_BACKGROUND_IMAGE_BASE64_LENGTH);
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(data) || data.length % 4 !== 0) {
    throw new TypeError("backgroundImage.data is not valid base64");
  }
  if (Buffer.byteLength(data, "base64") > MAX_BACKGROUND_IMAGE_BYTES) {
    throw new TypeError("backgroundImage.data is too large");
  }
  return { name, mimeType, data };
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 1_000) throw new TypeError(`${field} is invalid`);
  const items = value.map((item) => shortString(item, field, 512));
  return [...new Set(items)];
}

function sidebarThreadOrderByScope(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) throw new TypeError("sidebarThreadOrderByScope must be an object");
  const entries = Object.entries(value);
  if (
    entries.length > MAX_SIDEBAR_THREAD_ORDER_SCOPES ||
    Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_SIDEBAR_THREAD_ORDER_BYTES
  ) {
    throw new TypeError("sidebarThreadOrderByScope is too large");
  }

  return Object.fromEntries(
    entries.map(([scope, threadIds]) => {
      shortString(scope, "sidebarThreadOrderByScope scope", 1_024);
      if (!Array.isArray(threadIds) || threadIds.length > MAX_SIDEBAR_THREADS_PER_SCOPE) {
        throw new TypeError(`sidebarThreadOrderByScope.${scope} is invalid`);
      }
      const orderedIds = threadIds.map((threadId) =>
        shortString(threadId, `sidebarThreadOrderByScope.${scope}`, 512),
      );
      return [scope, [...new Set(orderedIds)]];
    }),
  );
}

function parsePreferences(value: unknown): WorkbenchSettingsPreferences {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new TypeError("preferences must be an object");
  const preferences: WorkbenchSettingsPreferences = {};
  if (value.appearance !== undefined) {
    preferences.appearance = jsonRecord(value.appearance, "appearance", MAX_APPEARANCE_BYTES);
  }
  if (value.askUserEnabled !== undefined) {
    if (typeof value.askUserEnabled !== "boolean") {
      throw new TypeError("askUserEnabled is invalid");
    }
    preferences.askUserEnabled = value.askUserEnabled;
  }
  if (value.backgroundImage !== undefined) {
    preferences.backgroundImage = backgroundImage(value.backgroundImage);
  }
  if (value.locale !== undefined) {
    if (!isLocale(value.locale)) throw new TypeError("locale is invalid");
    preferences.locale = value.locale;
  }
  if (value.modelSelector !== undefined) {
    if (!isRecord(value.modelSelector)) throw new TypeError("modelSelector must be an object");
    preferences.modelSelector = {
      modelId: shortString(value.modelSelector.modelId, "modelSelector.modelId", 512),
      ...(value.modelSelector.reasoningEffort === undefined
        ? {}
        : {
            reasoningEffort: shortString(
              value.modelSelector.reasoningEffort,
              "modelSelector.reasoningEffort",
              128,
            ),
          }),
    };
  }
  if (value.sidebarThreadOrderByScope !== undefined) {
    preferences.sidebarThreadOrderByScope = sidebarThreadOrderByScope(
      value.sidebarThreadOrderByScope,
    );
  }
  if (value.sidebarThreadSortMode !== undefined) {
    if (
      value.sidebarThreadSortMode !== "priority" &&
      value.sidebarThreadSortMode !== "recent" &&
      value.sidebarThreadSortMode !== "manual"
    ) {
      throw new TypeError("sidebarThreadSortMode is invalid");
    }
    preferences.sidebarThreadSortMode = value.sidebarThreadSortMode;
  }
  if (value.toolboxPins !== undefined) {
    preferences.toolboxPins = stringList(value.toolboxPins, "toolboxPins");
  }
  if (value.toolboxScope !== undefined) {
    if (!isRecord(value.toolboxScope)) throw new TypeError("toolboxScope must be an object");
    if (value.toolboxScope.kind === "user") {
      preferences.toolboxScope = { kind: "user" };
    } else if (value.toolboxScope.kind === "project") {
      preferences.toolboxScope = {
        kind: "project",
        workspaceId: shortString(value.toolboxScope.workspaceId, "toolboxScope.workspaceId", 512),
      };
    } else {
      throw new TypeError("toolboxScope.kind is invalid");
    }
  }
  if (value.rightWorkspace !== undefined) {
    preferences.rightWorkspace = jsonRecord(
      value.rightWorkspace,
      "rightWorkspace",
      MAX_RIGHT_WORKSPACE_BYTES,
    );
  }
  if (value.sidebarOpen !== undefined) {
    if (typeof value.sidebarOpen !== "boolean") throw new TypeError("sidebarOpen is invalid");
    preferences.sidebarOpen = value.sidebarOpen;
  }
  return preferences;
}

function applyPatch(
  current: WorkbenchSettingsPreferences,
  patch: WorkbenchSettingsPreferencesPatch,
): WorkbenchSettingsPreferences {
  const candidate: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete candidate[key];
    else if (value !== undefined) candidate[key] = value;
  }
  return parsePreferences(candidate);
}

export type WorkbenchSettingsServiceErrorCode =
  | "workbench-settings-invalid"
  | "workbench-settings-io";

export class WorkbenchSettingsServiceError extends RpcDomainError<
  WorkbenchSettingsServiceErrorCode,
  Record<string, never>
> {
  readonly code: WorkbenchSettingsServiceErrorCode;
  readonly details: Record<string, never> = {};

  constructor(code: WorkbenchSettingsServiceErrorCode) {
    super(
      code === "workbench-settings-invalid"
        ? "Workbench settings are invalid."
        : "Workbench settings could not be read or saved.",
    );
    this.name = "WorkbenchSettingsServiceError";
    this.code = code;
  }
}

export interface WorkbenchSettingsServiceOptions {
  readonly stateFile: string;
}

export class WorkbenchSettingsService implements WorkbenchSettingsProtocol {
  readonly stateFile: string;

  constructor({ stateFile }: WorkbenchSettingsServiceOptions) {
    this.stateFile = stateFile;
  }

  private withLock<Value>(operation: () => Promise<Value>): Promise<Value> {
    return withCrossProcessFileLock({ lockDirectory: `${this.stateFile}.lock` }, operation);
  }

  async describe(): Promise<WorkbenchSettingsSnapshot> {
    try {
      return await this.withLock(async () => {
        const document = await readWorkbenchSettingsDocument(this.stateFile);
        const preferences = parsePreferences(document.preferences);
        return { revision: document.revision, preferences };
      });
    } catch (error) {
      throw new WorkbenchSettingsServiceError(
        error instanceof TypeError || error instanceof SyntaxError
          ? "workbench-settings-invalid"
          : "workbench-settings-io",
      );
    }
  }

  async prepareDocument(): Promise<string> {
    try {
      return await this.withLock(async () => {
        try {
          const file = await stat(this.stateFile);
          if (!file.isFile()) throw new TypeError("workbench settings path must be a file");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          await writeWorkbenchSettingsDocument(this.stateFile, emptyWorkbenchSettingsDocument());
        }
        return this.stateFile;
      });
    } catch (error) {
      throw new WorkbenchSettingsServiceError(
        error instanceof TypeError || error instanceof SyntaxError
          ? "workbench-settings-invalid"
          : "workbench-settings-io",
      );
    }
  }

  async update(payload: WorkbenchSettingsUpdate): Promise<WorkbenchSettingsUpdateResult> {
    try {
      let updatedPreferences: WorkbenchSettingsPreferences | undefined;
      const result = await this.withLock(async () => {
        const document = await readWorkbenchSettingsDocument(this.stateFile);
        const current = parsePreferences(document.preferences);
        const preferences = applyPatch(current, payload.patch);
        if (JSON.stringify(preferences) === JSON.stringify(current)) {
          return { revision: document.revision };
        }
        const next = nextWorkbenchSettingsDocument(document, { preferences });
        await writeWorkbenchSettingsDocument(this.stateFile, next);
        updatedPreferences = preferences;
        return { revision: next.revision };
      });
      if (updatedPreferences) {
        for (const listener of preferenceListenersByStateFile.get(this.stateFile) ?? []) {
          try {
            listener(updatedPreferences);
          } catch (error) {
            console.error("[workbench-settings] preference listener failed.", error);
          }
        }
      }
      return result;
    } catch (error) {
      throw new WorkbenchSettingsServiceError(
        error instanceof TypeError || error instanceof SyntaxError
          ? "workbench-settings-invalid"
          : "workbench-settings-io",
      );
    }
  }
}

export function subscribeWorkbenchSettingsPreferences(
  stateFile: string,
  listener: WorkbenchSettingsPreferencesListener,
): () => void {
  let listeners = preferenceListenersByStateFile.get(stateFile);
  if (!listeners) {
    listeners = new Set();
    preferenceListenersByStateFile.set(stateFile, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) preferenceListenersByStateFile.delete(stateFile);
  };
}
