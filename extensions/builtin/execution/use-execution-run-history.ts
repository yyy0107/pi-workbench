"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { workflowClient } from "@/workbench/runtime-contributions/pi/client/execution";
import type { WorkflowRunSummary } from "@workbench/execution-contracts";

import { reconcileWorkflowRunBaseline } from "./execution-run-baseline";
import { mergeWorkflowRuns } from "./execution-run-merge";
import { useWorkflowCatalogStore } from "./execution-state";

export type WorkflowRunHistoryLoadState = "loading" | "ready" | "error";

function runVersion(run: WorkflowRunSummary): string {
  return `${run.lastSeq}:${run.updatedAt}`;
}

export function useWorkflowRunHistory(workflowId: string | undefined): {
  runs: WorkflowRunSummary[];
  loadState: WorkflowRunHistoryLoadState;
  refresh(): Promise<void>;
} {
  const catalogRuns = useWorkflowCatalogStore((state) => state.runs);
  const removedRunIds = useWorkflowCatalogStore((state) => state.removedRunIds);
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([]);
  const [loadState, setLoadState] = useState<WorkflowRunHistoryLoadState>(
    workflowId ? "loading" : "ready",
  );
  const requestIdRef = useRef(0);
  const catalogVersionsRef = useRef(new Map<string, string>());
  const scopedCatalogRuns = useMemo(
    () => (workflowId ? catalogRuns.filter((run) => run.workflowId === workflowId) : []),
    [catalogRuns, workflowId],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!workflowId) return;
    const requestId = ++requestIdRef.current;
    const knownLiveRunIds = new Set(
      useWorkflowCatalogStore
        .getState()
        .runs.filter((run) => run.workflowId === workflowId)
        .map(({ id }) => id),
    );
    setLoadState("loading");
    try {
      const { items } = await workflowClient.listRuns({ workflowId, limit: 200 });
      if (requestId !== requestIdRef.current) return;
      const state = useWorkflowCatalogStore.getState();
      const live = state.runs.filter((run) => run.workflowId === workflowId);
      for (const run of live) catalogVersionsRef.current.set(run.id, runVersion(run));
      setRuns(
        reconcileWorkflowRunBaseline({
          baseline: items,
          live,
          knownLiveRunIds,
          removedRunIds: state.removedRunIds,
        }),
      );
      setLoadState("ready");
    } catch {
      if (requestId === requestIdRef.current) setLoadState("error");
    }
  }, [workflowId]);

  useEffect(() => {
    requestIdRef.current += 1;
    catalogVersionsRef.current.clear();
    setRuns([]);
    setLoadState(workflowId ? "loading" : "ready");
  }, [workflowId]);

  useEffect(() => {
    if (!workflowId) return;
    const changed = scopedCatalogRuns.filter((run) => {
      const version = runVersion(run);
      if (catalogVersionsRef.current.get(run.id) === version) return false;
      catalogVersionsRef.current.set(run.id, version);
      return true;
    });
    setRuns((current) =>
      mergeWorkflowRuns(
        current.filter(({ id }) => !removedRunIds.has(id)),
        changed.filter(({ id }) => !removedRunIds.has(id)),
      ),
    );
  }, [removedRunIds, scopedCatalogRuns, workflowId]);

  useEffect(() => {
    if (!workflowId) return;
    void refresh();
    return () => {
      requestIdRef.current += 1;
    };
  }, [refresh, workflowId]);

  const orderedRuns = useMemo(
    () => [...runs].sort((left, right) => right.createdAt - left.createdAt),
    [runs],
  );

  return { runs: orderedRuns, loadState, refresh };
}
