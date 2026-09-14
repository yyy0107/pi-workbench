import { parseRemoteCursor } from "@workbench/remote-control-contracts/codecs";
import type { RemoteCursor } from "@workbench/remote-control-contracts/protocol";

import { fullJitterBackoffDelay } from "../lib/backoff.ts";

const IDENTIFIER = /^[\x21-\x7e]{1,128}$/u;

export function createRemoteRecoveryCoordinator(options: { readonly random: () => number }) {
  let active = true;
  return {
    nextDelay(attempt: number): number {
      return Math.max(
        1_000,
        fullJitterBackoffDelay(attempt, options.random, { baseMs: 1_000, capMs: 30_000 }),
      );
    },
    resume(cursor: RemoteCursor | undefined, unresolvedOperationIds: readonly string[]) {
      if (
        (cursor && !parseRemoteCursor(cursor)) ||
        unresolvedOperationIds.length > 100 ||
        unresolvedOperationIds.some((value) => !IDENTIFIER.test(value))
      ) {
        throw new Error("recovery_resume_invalid");
      }
      return Object.freeze({
        ...(cursor ? { cursor } : {}),
        unresolvedOperationIds: Object.freeze([...new Set(unresolvedOperationIds)]),
      });
    },
    suspend() {
      active = false;
      return Object.freeze({ closeSocket: true as const, reconnect: false as const });
    },
    foreground() {
      active = true;
      return Object.freeze({ reconnect: true as const, immediate: true as const });
    },
    networkChanged() {
      return active
        ? Object.freeze({ reconnect: true as const, immediate: true as const })
        : Object.freeze({ reconnect: false as const });
    },
  };
}
