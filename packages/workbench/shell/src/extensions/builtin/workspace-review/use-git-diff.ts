"use client";

import { useEffect, useRef, useState } from "react";
import { useWorkbenchWorkspaceCapability } from "@workbench/agent-runtime-client/context";
import { WorkbenchAgentCapabilityError } from "@workbench/agent-runtime-client";
import type {
  WorkbenchWorkspaceGitDiff,
  WorkbenchWorkspaceGitDiffRequest,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";

type RepositoryDiff = Extract<WorkbenchWorkspaceGitDiff, { repository: true }>;

/** The owner keys this hook's component by comparison/file so pages cannot cross resources. */
export function useGitDiff(request: WorkbenchWorkspaceGitDiffRequest, enabled = true) {
  const workspace = useWorkbenchWorkspaceCapability();
  const [data, setData] = useState<WorkbenchWorkspaceGitDiff>();
  const [error, setError] = useState<"unavailable" | "failed" | "stale" | "too-large">();
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const previous = useRef<RepositoryDiff | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(undefined);
    if (!enabled || !workspace?.readGitDiff) {
      setError("unavailable");
      setLoading(false);
      return;
    }
    void workspace
      .readGitDiff(
        { ...request, offset, ...(offset ? { patchVersion: previous.current?.patchVersion } : {}) },
        { signal: controller.signal },
      )
      .then((value) => {
        if (!active) return;
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
      controller.abort();
    };
  }, [workspace, request, offset, attempt, enabled]);

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
