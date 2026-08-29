"use client";

import { useEffect } from "react";

import { isWorkflowHostPayload } from "@/runtime/shared/execution";
import { usePiSessionManager } from "@/runtime/pi/client/runtime/context";

import { useWorkflowCatalogStore } from "./execution-state";

export function WorkflowRuntimeBridge() {
  const manager = usePiSessionManager();
  const keepAwake = useWorkflowCatalogStore((state) => state.keepAwake);

  useEffect(() => {
    const refresh = () => void useWorkflowCatalogStore.getState().refresh();
    if (useWorkflowCatalogStore.getState().loadState === "idle") refresh();
    const unsubscribeHost = manager.subscribeHostEvents((payload) => {
      if (!isWorkflowHostPayload(payload)) return;
      useWorkflowCatalogStore.getState().applyHostPayload(payload);
    });
    const unsubscribeReconnect = manager.subscribeConnectionReady(refresh);
    return () => {
      unsubscribeHost();
      unsubscribeReconnect();
    };
  }, [manager]);

  useEffect(() => {
    const setWakeLockState = useWorkflowCatalogStore.getState().setWakeLockState;
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
      useWorkflowCatalogStore.setState({ keepAwake: false, wakeLockState: "unsupported" });
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
  }, [keepAwake]);

  return null;
}
