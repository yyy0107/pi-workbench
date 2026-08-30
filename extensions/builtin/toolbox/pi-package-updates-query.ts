import type {
  PiPackageUpdatesValue,
  PiResourceCatalogTarget,
} from "@/workbench/runtime-contributions/pi/protocol/rpc";
import { listAvailablePiPackageUpdates } from "@/workbench/runtime-contributions/pi/client/resources";

const EMPTY_UPDATES: PiPackageUpdatesValue = { updates: [] };
const DEFAULT_MAX_AGE_MS = 30_000;

export type PackageUpdatesLoadState = "idle" | "loading" | "ready" | "failed";

export interface PackageUpdatesSnapshot {
  readonly isRefreshing: boolean;
  readonly loadState: PackageUpdatesLoadState;
  readonly refreshFailed: boolean;
  readonly value: PiPackageUpdatesValue;
}

export const IDLE_PACKAGE_UPDATES_SNAPSHOT: PackageUpdatesSnapshot = {
  isRefreshing: false,
  loadState: "idle",
  refreshFailed: false,
  value: EMPTY_UPDATES,
};

interface PackageUpdatesQueryEntry {
  readonly listeners: Set<() => void>;
  target: PiResourceCatalogTarget;
  snapshot: PackageUpdatesSnapshot;
  hasValue: boolean;
  stale: boolean;
  updatedAt: number;
  inFlight?: Promise<void>;
  revalidateAfterFlight: boolean;
}

interface PackageUpdatesQueryOptions {
  readonly load: (target: PiResourceCatalogTarget) => Promise<PiPackageUpdatesValue>;
  readonly maxAgeMs?: number;
  readonly now?: () => number;
}

export interface PiPackageUpdatesQuery {
  ensure(target: PiResourceCatalogTarget): Promise<void>;
  getSnapshot(target: PiResourceCatalogTarget): PackageUpdatesSnapshot;
  invalidate(target?: PiResourceCatalogTarget): void;
  refresh(target: PiResourceCatalogTarget): Promise<void>;
  subscribe(target: PiResourceCatalogTarget, listener: () => void): () => void;
}

export function piPackageUpdatesTargetKey(target: PiResourceCatalogTarget): string {
  return target.scope === "user" ? "user" : `project:${target.workspaceId}`;
}

export function createPiPackageUpdatesQuery({
  load,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  now = Date.now,
}: PackageUpdatesQueryOptions): PiPackageUpdatesQuery {
  const entries = new Map<string, PackageUpdatesQueryEntry>();

  const getEntry = (target: PiResourceCatalogTarget): PackageUpdatesQueryEntry => {
    const key = piPackageUpdatesTargetKey(target);
    const existing = entries.get(key);
    if (existing) {
      existing.target = target;
      return existing;
    }

    const entry: PackageUpdatesQueryEntry = {
      listeners: new Set(),
      target,
      snapshot: IDLE_PACKAGE_UPDATES_SNAPSHOT,
      hasValue: false,
      stale: true,
      updatedAt: 0,
      revalidateAfterFlight: false,
    };
    entries.set(key, entry);
    return entry;
  };

  const publish = (entry: PackageUpdatesQueryEntry, snapshot: PackageUpdatesSnapshot): void => {
    entry.snapshot = snapshot;
    for (const listener of entry.listeners) listener();
  };

  const request = (entry: PackageUpdatesQueryEntry, force: boolean): Promise<void> => {
    if (entry.inFlight) return entry.inFlight;
    if (!force && entry.hasValue && !entry.stale && now() - entry.updatedAt < maxAgeMs) {
      return Promise.resolve();
    }

    publish(
      entry,
      entry.hasValue
        ? {
            ...entry.snapshot,
            isRefreshing: true,
            loadState: "ready",
            refreshFailed: false,
          }
        : {
            isRefreshing: false,
            loadState: "loading",
            refreshFailed: false,
            value: EMPTY_UPDATES,
          },
    );

    const inFlight = load(entry.target).then(
      (value) => {
        entry.hasValue = true;
        entry.stale = false;
        entry.updatedAt = now();
        publish(entry, {
          isRefreshing: false,
          loadState: "ready",
          refreshFailed: false,
          value,
        });
      },
      () => {
        publish(
          entry,
          entry.hasValue
            ? {
                ...entry.snapshot,
                isRefreshing: false,
                loadState: "ready",
                refreshFailed: true,
              }
            : {
                isRefreshing: false,
                loadState: "failed",
                refreshFailed: false,
                value: EMPTY_UPDATES,
              },
        );
      },
    );
    entry.inFlight = inFlight;
    void inFlight.finally(() => {
      if (entry.inFlight === inFlight) entry.inFlight = undefined;
      if (!entry.revalidateAfterFlight) return;
      entry.revalidateAfterFlight = false;
      if (entry.listeners.size > 0) void request(entry, true);
    });
    return inFlight;
  };

  const invalidateEntry = (entry: PackageUpdatesQueryEntry): void => {
    entry.stale = true;
    if (entry.inFlight) {
      entry.revalidateAfterFlight = true;
      return;
    }
    if (entry.listeners.size > 0) void request(entry, true);
  };

  return {
    ensure(target) {
      return request(getEntry(target), false);
    },
    getSnapshot(target) {
      return getEntry(target).snapshot;
    },
    invalidate(target) {
      if (target) {
        const entry = entries.get(piPackageUpdatesTargetKey(target));
        if (entry) invalidateEntry(entry);
        return;
      }
      for (const entry of entries.values()) invalidateEntry(entry);
    },
    refresh(target) {
      return request(getEntry(target), true);
    },
    subscribe(target, listener) {
      const entry = getEntry(target);
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
  };
}

export const piPackageUpdatesQuery = createPiPackageUpdatesQuery({
  load: (target) => listAvailablePiPackageUpdates({ target }),
});

export function invalidatePiPackageUpdates(target?: PiResourceCatalogTarget): void {
  piPackageUpdatesQuery.invalidate(target);
}
