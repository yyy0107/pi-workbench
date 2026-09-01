"use client";

import { useEffect } from "react";

import {
  usePiExecutionClient,
  usePiExecutionRuntimeClient,
} from "@workbench/agent-runtime-pi-client/execution";
import { isWorkflowHostPayload } from "@workbench/execution-contracts";

import { useWorkflowCatalogStore, useWorkflowCatalogStoreApi } from "./execution-state";

export function WorkflowRuntimeBridge() {
  const manager = usePiExecutionRuntimeClient();
  const { workflow } = usePiExecutionClient();
  const catalogStore = useWorkflowCatalogStoreApi();
  const keepAwake = useWorkflowCatalogStore((state) => state.keepAwake);

  useEffect(() => {
    const refresh = () => void catalogStore.getState().refresh(workflow);
    if (catalogStore.getState().loadState === "idle") refresh();
    const unsubscribeHost = manager.subscribeHostEvents((payload) => {
      if (!isWorkflowHostPayload(payload)) return;
      catalogStore.getState().applyHostPayload(payload);
    });
    const unsubscribeReconnect = manager.subscribeConnectionReady(refresh);
    return () => {
      unsubscribeHost();
      unsubscribeReconnect();
    };
  }, [catalogStore, manager, workflow]);

  useEffect(() => {
    const setWakeLockState = catalogStore.getState().setWakeLockState;
    if (!keepAwake) {
      setWakeLockState("idle");
      return;
    }

    interface WorkflowWakeLockSentinel extends EventTarget {
      readonly released: boolean;
      release(): Promise<void>;
    }

    const wakeLock = (
      navigator as Navigator & {
        wakeLock?: { request(type: "screen"): Promise<WorkflowWakeLockSentinel> };
      }
    ).wakeLock;
    if (!wakeLock) {
      catalogStore.setState({ keepAwake: false, wakeLockState: "unsupported" });
      return;
    }

    let disposed = false;
    let sentinel: WorkflowWakeLockSentinel | undefined;
    const acquire = async () => {
      if (disposed || document.visibilityState !== "visible" || (sentinel && !sentinel.released)) {
        return;
      }
      try {
        const next = await wakeLock.request("screen");
        if (disposed) {
          await next.release();
          return;
        }
        sentinel = next;
        setWakeLockState("active");
        next.addEventListener(
          "release",
          () => {
            if (!disposed) setWakeLockState("idle");
          },
          { once: true },
        );
      } catch {
        if (!disposed) setWakeLockState("error");
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void acquire();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, [catalogStore, keepAwake]);

  return null;
}
