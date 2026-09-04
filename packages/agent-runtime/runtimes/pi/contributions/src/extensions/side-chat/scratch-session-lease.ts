import type { PiSideChatClient } from "@workbench/agent-runtime-pi-client/side-chat";

interface ScratchLease {
  count: number;
  promoted: boolean;
  releaseTimer?: ReturnType<typeof setTimeout>;
}

/** Leases are scoped to an installation's client identity, not a globally reused session id. */
const leasesByManager = new WeakMap<PiSideChatClient, Map<string, ScratchLease>>();

function leasesFor(manager: PiSideChatClient): Map<string, ScratchLease> {
  let leases = leasesByManager.get(manager);
  if (!leases) {
    leases = new Map();
    leasesByManager.set(manager, leases);
  }
  return leases;
}

/** Delay release by one task so React development effect replay cannot destroy a live scratch. */
export function retainScratchSession(manager: PiSideChatClient, sessionId: string): () => void {
  const leases = leasesFor(manager);
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

export function markScratchSessionPromoted(manager: PiSideChatClient, sessionId: string): void {
  const leases = leasesFor(manager);
  const lease = leases.get(sessionId) ?? { count: 0, promoted: true };
  if (lease.releaseTimer) clearTimeout(lease.releaseTimer);
  lease.releaseTimer = undefined;
  lease.promoted = true;
  leases.set(sessionId, lease);
}
