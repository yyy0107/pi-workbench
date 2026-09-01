import {
  toWorkbenchSettingsJsonObject,
  type WorkbenchSettingsPort,
} from "@workbench/agent-runtime-contracts/settings";
import type { RightWorkspacePersistencePort } from "../right-workspace";
import { LEGACY_RIGHT_WORKSPACE_STORAGE_KEY } from "../legacy-pi-compat";

export const RIGHT_WORKSPACE_LEGACY_STORAGE_KEY = LEGACY_RIGHT_WORKSPACE_STORAGE_KEY;

export interface RightWorkspaceLegacyStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

export interface RightWorkspacePersistenceOptions {
  readonly settings: WorkbenchSettingsPort;
  readonly legacyStorage: RightWorkspaceLegacyStorage;
}

function parseSerializedObject(serialized: string): object {
  const value: unknown = JSON.parse(serialized);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("RightWorkspace persistence must contain a JSON object.");
  }
  return value;
}

/**
 * Bridges the Shell-owned opaque payload to product settings and the one legacy browser key.
 * Reading never migrates; the first successful normalized settings write owns legacy cleanup.
 */
export function createRightWorkspacePersistence({
  settings,
  legacyStorage,
}: RightWorkspacePersistenceOptions): RightWorkspacePersistencePort {
  const loadSettings = settings.load.bind(settings);
  const updateSettings = settings.update.bind(settings);
  let legacyPayloadRead = false;

  const readLegacy = (): string | null => {
    const serialized = legacyStorage.getItem(RIGHT_WORKSPACE_LEGACY_STORAGE_KEY);
    if (serialized !== null) legacyPayloadRead = true;
    return serialized;
  };

  return Object.freeze({
    async read(): Promise<string | null> {
      // A load rejection must propagate: legacy data cannot prove that the authoritative field is
      // absent, so treating it as a fallback could overwrite unknown remote state.
      const preferences = await loadSettings();
      if (preferences.rightWorkspace !== undefined) {
        try {
          // Settings remains authoritative, but remember a leftover legacy value so a fresh
          // provider installation can retry cleanup after an earlier removeItem failure.
          readLegacy();
        } catch {
          // A definitive settings value must not be hidden by unavailable browser storage.
        }
        return JSON.stringify(preferences.rightWorkspace);
      }
      try {
        return readLegacy();
      } catch {
        // The authoritative settings read succeeded and confirmed the field is absent.
        return null;
      }
    },

    async write(serialized: string): Promise<void> {
      const value = parseSerializedObject(serialized);
      await updateSettings({
        rightWorkspace: toWorkbenchSettingsJsonObject(value),
      });
      if (!legacyPayloadRead) return;
      try {
        legacyStorage.removeItem(RIGHT_WORKSPACE_LEGACY_STORAGE_KEY);
        legacyPayloadRead = false;
      } catch {
        // Settings now wins on the next read; retain the marker so a later write may retry cleanup.
      }
    },
  });
}
