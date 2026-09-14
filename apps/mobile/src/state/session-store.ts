import { remoteUtf8ByteLength } from "@workbench/remote-control-contracts/codecs";
import { createRemoteSessionManagementState } from "@workbench/remote-control-client/session-management";
import type {
  RemoteRunStateV1,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";

const IDENTIFIER = /^[\x21-\x7e]{1,128}$/u;
const RUN_STATES = new Set<RemoteRunStateV1>([
  "idle",
  "queued",
  "running",
  "waiting-for-input",
  "stopping",
  "completed",
  "stopped",
  "failed",
]);

export interface MobileStoredSessionLocalState {
  readonly machineId: string;
  readonly sessionId: string;
  readonly draft: string;
  readonly readMarker?: string;
  readonly unread: boolean;
  readonly runState: RemoteRunStateV1;
  readonly updatedAt: string;
}

export interface MobileSessionStorePersistencePort {
  loadCatalog(machineId: string): Promise<readonly RemoteSessionSummaryV1[]>;
  replaceCatalog(machineId: string, items: readonly RemoteSessionSummaryV1[]): Promise<void>;
  loadLocalStates(machineId: string): Promise<readonly MobileStoredSessionLocalState[]>;
  saveLocalState(value: MobileStoredSessionLocalState): Promise<void>;
  clearMachine(machineId: string): Promise<void>;
}

function validLocal(value: MobileStoredSessionLocalState): boolean {
  return (
    IDENTIFIER.test(value.machineId) &&
    IDENTIFIER.test(value.sessionId) &&
    remoteUtf8ByteLength(value.draft) <= 64 * 1024 &&
    (value.readMarker === undefined || IDENTIFIER.test(value.readMarker)) &&
    typeof value.unread === "boolean" &&
    RUN_STATES.has(value.runState) &&
    value.updatedAt.endsWith("Z") &&
    Number.isFinite(Date.parse(value.updatedAt))
  );
}

export function createMobileSessionStore(options: {
  readonly persistence: MobileSessionStorePersistencePort;
  readonly clock: { now(): Date };
}) {
  return {
    async load(machineId: string) {
      if (!IDENTIFIER.test(machineId)) throw new Error("machine_id_invalid");
      const reducer = createRemoteSessionManagementState({ machineId });
      reducer.replaceCatalog(await options.persistence.loadCatalog(machineId));
      const persisted = await options.persistence.loadLocalStates(machineId);
      if (persisted.length > 200 || persisted.some((value) => !validLocal(value))) {
        throw new Error("session_local_state_invalid");
      }
      const storedBySession = new Map(persisted.map((value) => [value.sessionId, value]));
      const reduced = reducer.snapshot();
      const localBySession: Record<
        string,
        {
          draft: string;
          readMarker?: string;
          unread: boolean;
          runState: RemoteRunStateV1;
        }
      > = {};
      for (const session of reduced.items) {
        const stored = storedBySession.get(session.sessionId);
        localBySession[session.sessionId] = Object.freeze({
          draft: stored?.draft ?? "",
          ...(stored?.readMarker === undefined ? {} : { readMarker: stored.readMarker }),
          unread: stored?.unread ?? session.attention !== "none",
          runState: session.runState,
        });
      }
      return Object.freeze({
        items: reduced.items,
        localBySession: Object.freeze(localBySession),
      });
    },
    async replaceCatalog(
      machineId: string,
      values: readonly RemoteSessionSummaryV1[],
    ): Promise<void> {
      const reducer = createRemoteSessionManagementState({ machineId });
      reducer.replaceCatalog(values);
      await options.persistence.replaceCatalog(machineId, reducer.snapshot().items);
    },
    async saveLocalState(value: Omit<MobileStoredSessionLocalState, "updatedAt">): Promise<void> {
      const stored = Object.freeze({ ...value, updatedAt: options.clock.now().toISOString() });
      if (!validLocal(stored)) throw new Error("session_local_state_invalid");
      await options.persistence.saveLocalState(stored);
    },
    clearMachine(machineId: string): Promise<void> {
      if (!IDENTIFIER.test(machineId)) throw new Error("machine_id_invalid");
      return options.persistence.clearMachine(machineId);
    },
  };
}
