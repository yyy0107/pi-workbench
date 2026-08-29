"use client";

import { create } from "zustand";

import type {
  WorkflowDocument,
  WorkflowHostPayload,
  WorkflowReadValue,
  WorkflowRunSummary,
  WorkflowSummary,
} from "@/runtime/shared/execution";
import { workflowClient } from "@/runtime/pi/client/workflows/workflow-client";
import { mergeWorkflowRuns } from "./execution-run-merge";

type LoadState = "idle" | "loading" | "ready" | "error";
export type WorkflowWakeLockState = "idle" | "active" | "unsupported" | "error";

interface WorkflowCatalogState {
  items: WorkflowSummary[];
  runs: WorkflowRunSummary[];
  removedRunIds: ReadonlySet<string>;
  loadState: LoadState;
  keepAwake: boolean;
  wakeLockState: WorkflowWakeLockState;
  error?: string;
  refresh(): Promise<void>;
  applyHostPayload(payload: WorkflowHostPayload): void;
  setKeepAwake(keepAwake: boolean): void;
  setWakeLockState(wakeLockState: WorkflowWakeLockState): void;
}

function byUpdatedAt<Value extends { updatedAt: number }>(left: Value, right: Value): number {
  return right.updatedAt - left.updatedAt;
}

export const useWorkflowCatalogStore = create<WorkflowCatalogState>((set) => ({
  items: [],
  runs: [],
  removedRunIds: new Set(),
  loadState: "idle",
  keepAwake: false,
  wakeLockState: "idle",
  async refresh() {
    set({ loadState: "loading", error: undefined });
    try {
      const workflows = await workflowClient.list({});
      set({
        items: workflows.items,
        loadState: "ready",
        error: undefined,
      });

      const runs = await workflowClient.listRuns({ limit: 200 }).then(
        (value) => ({ status: "fulfilled" as const, value }),
        () => ({ status: "rejected" as const }),
      );
      if (runs.status === "fulfilled") {
        set((state) => ({
          // Host deltas may arrive while the refresh RPC is in flight. Merge by durable sequence so
          // that a delayed list response cannot roll a run back to queued/running.
          runs: mergeWorkflowRuns(
            runs.value.items.filter(({ id }) => !state.removedRunIds.has(id)),
            state.runs,
          ),
        }));
      }
    } catch (error) {
      set({
        loadState: "error",
        error: error instanceof Error ? error.message : "workflow-load-failed",
      });
    }
  },
  applyHostPayload(payload) {
    switch (payload.type) {
      case "host/workflow-changed":
        set((state) => ({
          items: [
            payload.workflow,
            ...state.items.filter(({ id }) => id !== payload.workflow.id),
          ].sort(byUpdatedAt),
        }));
        break;
      case "host/workflow-removed":
        set((state) => ({
          items: state.items.filter(({ id }) => id !== payload.workflowId),
          runs: state.runs.filter(({ workflowId }) => workflowId !== payload.workflowId),
        }));
        break;
      case "host/workflow-run-changed":
        set((state) =>
          state.removedRunIds.has(payload.run.id)
            ? state
            : { runs: mergeWorkflowRuns(state.runs, [payload.run]) },
        );
        break;
      case "host/workflow-run-removed":
        set((state) => ({
          runs: state.runs.filter(({ id }) => id !== payload.runId),
          removedRunIds: new Set(state.removedRunIds).add(payload.runId),
        }));
        break;
    }
  },
  setKeepAwake(keepAwake) {
    set({ keepAwake, ...(!keepAwake ? { wakeLockState: "idle" as const } : {}) });
  },
  setWakeLockState(wakeLockState) {
    set({ wakeLockState });
  },
}));

export type WorkflowEditorSelection =
  | { type: "node"; id: string }
  | { type: "edge"; id: string }
  | undefined;

export type WorkflowSaveState = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

interface WorkflowEditorState {
  document?: WorkflowDocument;
  workflowDirectory?: string;
  selection: WorkflowEditorSelection;
  saveState: WorkflowSaveState;
  error?: string;
  editVersion: number;
  load(value: WorkflowReadValue): void;
  reset(): void;
  updateDocument(update: (document: WorkflowDocument) => WorkflowDocument): void;
  setSelection(selection: WorkflowEditorSelection): void;
  beginSave(): number;
  finishSave(document: WorkflowDocument, savedEditVersion: number): void;
  failSave(error: string, conflict?: boolean): void;
}

export const useWorkflowEditorStore = create<WorkflowEditorState>((set, get) => ({
  selection: undefined,
  saveState: "idle",
  editVersion: 0,
  load(value) {
    set({
      document: value.document,
      workflowDirectory: value.workflowDirectory,
      selection: undefined,
      saveState: "idle",
      error: undefined,
      editVersion: 0,
    });
  },
  reset() {
    set({
      document: undefined,
      workflowDirectory: undefined,
      selection: undefined,
      saveState: "idle",
      error: undefined,
      editVersion: 0,
    });
  },
  updateDocument(update) {
    const document = get().document;
    if (!document) return;
    set((state) => ({
      document: update(document),
      editVersion: state.editVersion + 1,
      saveState: "dirty",
      error: undefined,
    }));
  },
  setSelection(selection) {
    set({ selection });
  },
  beginSave() {
    const version = get().editVersion;
    set({ saveState: "saving", error: undefined });
    return version;
  },
  finishSave(saved, savedEditVersion) {
    set((state) => {
      if (!state.document || state.document.id !== saved.id) return state;
      if (state.editVersion === savedEditVersion) {
        return { document: saved, saveState: "saved", error: undefined };
      }
      return {
        document: {
          ...state.document,
          draftRevision: saved.draftRevision,
          publishedRevisionId: saved.publishedRevisionId,
        },
        saveState: "dirty",
        error: undefined,
      };
    });
  },
  failSave(error, conflict = false) {
    set({ saveState: conflict ? "conflict" : "error", error });
  },
}));
