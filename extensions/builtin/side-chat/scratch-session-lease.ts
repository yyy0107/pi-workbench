import type { PiSideChatClient } from "@/workbench/runtime-contributions/pi/client/side-chat";

interface ScratchLease {
  count: number;
  promoted: boolean;
  releaseTimer?: ReturnType<typeof setTimeout>;
}

const leases = new Map<string, ScratchLease>();

/** Delay release by one task so React development effect replay cannot destroy a live scratch. */
export function retainScratchSession(manager: PiSideChatClient, sessionId: string): () => void {
  const lease = leases.get(sessionId) ?? { count: 0, promoted: false };
  if (lease.releaseTimer) clearTimeout(lease.releaseTimer);
  lease.releaseTimer = undefined;
  lease.count += 1;
  leases.set(sessionId, lease);

  return () => {
    const current = leases.get(sessionId);
    if (!current) return;
    current.count = Math.max(0, current.count - 1);
    if (current.count > 0) return;
    if (current.promoted) {
      leases.delete(sessionId);
      return;
    }
    current.releaseTimer = setTimeout(() => {
      const pending = leases.get(sessionId);
      if (!pending || pending.count > 0 || pending.promoted) return;
      leases.delete(sessionId);
      void manager.releaseScratchSession(sessionId).catch((error: unknown) => {
        console.error("[workbench-side-chat] scratch release failed", error);
      });
    }, 0);
  };
}

export function markScratchSessionPromoted(sessionId: string): void {
  const lease = leases.get(sessionId) ?? { count: 0, promoted: true };
  if (lease.releaseTimer) clearTimeout(lease.releaseTimer);
  lease.releaseTimer = undefined;
  lease.promoted = true;
  leases.set(sessionId, lease);
}
