"use client";

import { useEffect, useRef, useState } from "react";
import { useWorkbenchWorkspaceCapability } from "@workbench/agent-runtime-client/context";
import { WorkbenchAgentCapabilityError } from "@workbench/agent-runtime-client";
import type { WorkbenchWorkspaceCapability } from "@workbench/agent-runtime-client/capabilities";
import type {
  WorkbenchWorkspaceGitDiff,
  WorkbenchWorkspaceGitDiffRequest,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";

type RepositoryDiff = Extract<WorkbenchWorkspaceGitDiff, { repository: true }>;
type ReadGitDiff = WorkbenchWorkspaceCapability["readGitDiff"];
type InFlightDiff = {
  controller: AbortController;
  consumers: number;
  promise: ReturnType<ReadGitDiff>;
};
type CachedDiff = {
  expiresAt: number;
  value: WorkbenchWorkspaceGitDiff;
};

const DIFF_CACHE_TTL_MS = 2_000;
const MAX_COMPLETED_DIFFS = 12;
const inFlightDiffs = new WeakMap<WorkbenchWorkspaceCapability, Map<string, InFlightDiff>>();
const completedDiffs = new WeakMap<WorkbenchWorkspaceCapability, Map<string, CachedDiff>>();

function requestKey(request: WorkbenchWorkspaceGitDiffRequest, cacheKey?: string): string {
  return JSON.stringify([
    cacheKey ?? null,
    Object.entries(request).sort(([left], [right]) => left.localeCompare(right)),
  ]);
}

function getCachedDiff(
  workspace: WorkbenchWorkspaceCapability,
  key: string,
): WorkbenchWorkspaceGitDiff | undefined {
  const value = completedDiffs.get(workspace)?.get(key);
  if (!value) return undefined;
  if (value.expiresAt <= Date.now()) {
    completedDiffs.get(workspace)?.delete(key);
    return undefined;
  }
  return value.value;
}

function cacheDiff(
  workspace: WorkbenchWorkspaceCapability,
  key: string,
  value: WorkbenchWorkspaceGitDiff,
): void {
  let cache = completedDiffs.get(workspace);
  if (!cache) {
    cache = new Map();
    completedDiffs.set(workspace, cache);
  }
  cache.set(key, { expiresAt: Date.now() + DIFF_CACHE_TTL_MS, value });
  while (cache.size > MAX_COMPLETED_DIFFS) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function acquireDiff(
  workspace: WorkbenchWorkspaceCapability,
  request: WorkbenchWorkspaceGitDiffRequest,
  cacheKey?: string,
) {
  const key = requestKey(request, cacheKey);
  let requests = inFlightDiffs.get(workspace);
  if (!requests) {
    requests = new Map();
    inFlightDiffs.set(workspace, requests);
  }
  let entry = requests.get(key);
  if (!entry) {
    const controller = new AbortController();
    const promise = workspace.readGitDiff(request, { signal: controller.signal });
    entry = { controller, consumers: 0, promise };
    requests.set(key, entry);
    void promise.then(
      () => {
        if (requests?.get(key) === entry) requests.delete(key);
      },
      () => {
        if (requests?.get(key) === entry) requests.delete(key);
      },
    );
  }
  entry.consumers += 1;
  let released = false;
  return {
    promise: entry.promise,
    release: () => {
      if (released) return;
      released = true;
      entry!.consumers -= 1;
      if (entry!.consumers <= 0 && requests?.get(key) === entry) {
        requests.delete(key);
        entry!.controller.abort();
      }
    },
  };
}

/** The owner keys this hook's component by comparison/file so pages cannot cross resources. */
export function useGitDiff(
  request: WorkbenchWorkspaceGitDiffRequest,
  enabled = true,
  cacheKey?: string,
) {
  const workspace = useWorkbenchWorkspaceCapability();
  const [data, setData] = useState<WorkbenchWorkspaceGitDiff>();
  const [error, setError] = useState<"unavailable" | "failed" | "stale" | "too-large">();
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const previous = useRef<RepositoryDiff | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    if (!enabled || !workspace?.readGitDiff) {
      setError("unavailable");
      setLoading(false);
      return;
    }
    const readRequest = {
      ...request,
      offset,
      ...(offset ? { patchVersion: previous.current?.patchVersion } : {}),
    };
    const key = cacheKey === undefined ? undefined : requestKey(readRequest, cacheKey);
    const apply = (value: WorkbenchWorkspaceGitDiff) => {
      const old = previous.current;
      const next =
        value.repository && offset && old
          ? {
              ...value,
              files: [...old.files, ...value.files],
              ...(value.patch === undefined ? {} : { patch: (old.patch ?? "") + value.patch }),
            }
          : value;
      previous.current = next.repository ? next : undefined;
      setData(next);
    };
    const cached = key === undefined ? undefined : getCachedDiff(workspace, key);
    if (cached) {
      apply(cached);
      setLoading(false);
      return;
    }
    const shared = acquireDiff(workspace, readRequest, cacheKey);
    void shared.promise
      .then((value) => {
        if (!active) return;
        if (key !== undefined) cacheDiff(workspace, key, value);
        apply(value);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setError(
          error instanceof WorkbenchAgentCapabilityError && error.details?.reason === "too-large"
            ? "too-large"
            : error instanceof WorkbenchAgentCapabilityError && error.code === "unavailable"
              ? "unavailable"
              : error instanceof WorkbenchAgentCapabilityError && error.code === "conflict"
                ? "stale"
                : "failed",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      shared.release();
    };
  }, [workspace, request, offset, attempt, enabled, cacheKey]);

  return {
    data,
    error,
    loading,
    retry: () => setAttempt((value) => value + 1),
    loadMore: () => {
      if (!loading && data?.repository && data.nextOffset !== undefined) setOffset(data.nextOffset);
    },
  };
}
