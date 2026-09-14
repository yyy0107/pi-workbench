import type { createMobileConversationStore } from "../state/conversation-store.ts";
import type { createMobileSessionStore } from "../state/session-store.ts";
import {
  createMobileRemoteSession,
  type MobileRemoteSessionSnapshot,
  type MobileRemoteSessionPort,
} from "../state/remote-session.ts";
import type { MobileRemoteConnectionStatus } from "../state/remote-client.ts";

export function mobileConversationConnectionStatus(
  snapshot: MobileRemoteSessionSnapshot | undefined,
): MobileRemoteConnectionStatus {
  if (!snapshot) return "resyncing";
  if (snapshot.operations.some(({ status }) => status === "outcome-unknown")) {
    return "outcome-checking";
  }
  if (snapshot.errorCode === "protocol_version_mismatch") return "incompatible";
  if (snapshot.ready && !snapshot.stale) return "ready";
  if (snapshot.errorCode === "machine_offline" || snapshot.errorCode === "network_error") {
    return "offline";
  }
  return snapshot.stale ? "stale" : "reconnecting";
}

export function createMobileConversationFeature(options: {
  readonly store: ReturnType<typeof createMobileConversationStore>;
  readonly remote?: MobileRemoteSessionPort;
  readonly sessionStore?: ReturnType<typeof createMobileSessionStore>;
  readonly clock?: { now(): Date };
  readonly createOperationId?: () => string;
}) {
  return {
    open(input: {
      readonly machineId: string;
      readonly sessionId: string;
      readonly machineReady: boolean;
      readonly runState?: import("@workbench/remote-control-contracts/protocol").RemoteRunStateV1;
    }) {
      const session = createMobileRemoteSession({
        machineId: input.machineId,
        sessionId: input.sessionId,
        ...(input.runState === undefined ? {} : { initialRunState: input.runState }),
        store: options.store,
        ...(options.sessionStore === undefined ? {} : { sessionStore: options.sessionStore }),
        ...(options.remote === undefined ? {} : { remote: options.remote }),
        clock: options.clock ?? { now: () => new Date() },
        createOperationId: options.createOperationId ?? (() => globalThis.crypto.randomUUID()),
      });
      return {
        session,
        initialize: () => session.initialize(input.machineReady),
      };
    },
  };
}
