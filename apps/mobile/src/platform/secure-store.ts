import type * as ExpoSecureStore from "expo-secure-store";

const MACHINE_PREFIX = "workbench.remote.machine.v1.";
const MACHINE_INDEX_KEY = "workbench.remote.machine-index.v1";
type SecureStoreModule = Pick<
  typeof ExpoSecureStore,
  | "WHEN_UNLOCKED_THIS_DEVICE_ONLY"
  | "deleteItemAsync"
  | "getItemAsync"
  | "isAvailableAsync"
  | "setItemAsync"
>;

export interface MobileSecureItemIndexPort {
  list(): Promise<readonly string[]>;
  add(key: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

function machineKey(machineId: string): string {
  const bytes = new TextEncoder().encode(machineId);
  if (bytes.byteLength < 1 || bytes.byteLength > 128) throw new Error("machine_id_invalid");
  return `${MACHINE_PREFIX}${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function parseJson<T>(value: string | null): T | undefined {
  if (value === null) return undefined;
  if (new TextEncoder().encode(value).byteLength > 64 * 1024)
    throw new Error("secure_item_invalid");
  try {
    const decoded = JSON.parse(value) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error();
    return decoded as T;
  } catch {
    throw new Error("secure_item_invalid");
  }
}

function parseMachineIndex(value: string | null): readonly string[] {
  if (value === null) return [];
  if (new TextEncoder().encode(value).byteLength > 64 * 1024) {
    throw new Error("secure_item_invalid");
  }
  try {
    const decoded = JSON.parse(value) as unknown;
    if (
      !Array.isArray(decoded) ||
      decoded.length > 2_000 ||
      decoded.some((key) => typeof key !== "string" || !key.startsWith(MACHINE_PREFIX))
    ) {
      throw new Error();
    }
    return [...new Set(decoded)].sort();
  } catch {
    throw new Error("secure_item_invalid");
  }
}

export function createMobileSecureStore(options: {
  readonly index: MobileSecureItemIndexPort;
  readonly loadModule?: () => Promise<SecureStoreModule>;
}) {
  const loadModule =
    options.loadModule ?? (() => import("expo-secure-store") as Promise<SecureStoreModule>);
  const module = async () => {
    const value = await loadModule();
    if (!(await value.isAvailableAsync())) throw new Error("secure_store_unavailable");
    return value;
  };
  const keyOptions = (secureStore: SecureStoreModule) => ({
    keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    keychainService: "com.piworkbench.remote.credentials",
  });
  let machineIndexOperation = Promise.resolve();
  const updateMachineIndex = async (update: (keys: Set<string>) => void): Promise<void> => {
    const operation = machineIndexOperation.then(async () => {
      const secureStore = await module();
      const keys = new Set(
        parseMachineIndex(
          await secureStore.getItemAsync(MACHINE_INDEX_KEY, keyOptions(secureStore)),
        ),
      );
      update(keys);
      await secureStore.setItemAsync(
        MACHINE_INDEX_KEY,
        JSON.stringify([...keys].sort()),
        keyOptions(secureStore),
      );
    });
    machineIndexOperation = operation.catch(() => undefined);
    await operation;
  };
  const save = async (key: string, value: object): Promise<void> => {
    const encoded = JSON.stringify(value);
    if (new TextEncoder().encode(encoded).byteLength > 64 * 1024) {
      throw new Error("secure_item_too_large");
    }
    const secureStore = await module();
    // Keep a recovery index in the same non-backed-up secure storage. SQLite can be
    // deleted independently during reinstall, while iOS Keychain entries may survive.
    // Indexing before the secret write can only leave a harmless missing-item entry.
    if (key.startsWith(MACHINE_PREFIX)) {
      await updateMachineIndex((keys) => void keys.add(key));
    }
    await secureStore.setItemAsync(key, encoded, keyOptions(secureStore));
    await options.index.add(key);
  };
  const load = async <T>(key: string): Promise<T | undefined> => {
    const secureStore = await module();
    return parseJson<T>(await secureStore.getItemAsync(key, keyOptions(secureStore)));
  };
  const remove = async (key: string): Promise<void> => {
    const secureStore = await module();
    await secureStore.deleteItemAsync(key, keyOptions(secureStore));
    if (key.startsWith(MACHINE_PREFIX)) {
      await updateMachineIndex((keys) => void keys.delete(key));
    }
    await options.index.remove(key);
  };
  return {
    loadMachineKeys: <T extends object>(machineId: string) => load<T>(machineKey(machineId)),
    saveMachineKeys: (machineId: string, value: object) => save(machineKey(machineId), value),
    async clearMachine(machineId: string): Promise<void> {
      await remove(machineKey(machineId));
    },
    async clearAll(): Promise<void> {
      const secureStore = await module();
      await machineIndexOperation;
      const persistedMachineKeys = parseMachineIndex(
        await secureStore.getItemAsync(MACHINE_INDEX_KEY, keyOptions(secureStore)),
      );
      const keys = new Set([...persistedMachineKeys, ...(await options.index.list())]);
      for (const key of keys) await secureStore.deleteItemAsync(key, keyOptions(secureStore));
      await secureStore.deleteItemAsync(MACHINE_INDEX_KEY, keyOptions(secureStore));
      await options.index.clear();
    },
  };
}
