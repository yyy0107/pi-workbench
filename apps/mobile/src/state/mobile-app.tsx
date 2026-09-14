import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Platform } from "react-native";
import type { DirectEndpointV1 } from "@workbench/remote-control-contracts/protocol";
import type { DirectConnectionProfile } from "@workbench/remote-control-client/profiles";

import {
  createMobileDirectPairingController,
  type MobileDirectPairingPending,
} from "../features/direct-pairing.ts";
import { createMobileConversationFeature } from "../features/conversation.ts";
import {
  createMobileMachinesFeature,
  markRemoteMachineOnline,
  type MobileMachineCatalogSnapshot,
} from "../features/machines.ts";
import {
  createMobileSessionCatalogFeature,
  type MobileSessionCatalogSnapshot,
} from "../features/session-catalog.ts";
import { createMobileAppStatePlatform } from "../platform/app-state.ts";
import { createMobileNetworkPlatform } from "../platform/network.ts";
import { createMobileSecureStore } from "../platform/secure-store.ts";
import { openMobileDatabase } from "../platform/sqlite.ts";
import { createMobileConnectionProfileStore } from "./connection-profile-store.ts";
import { createMobileConversationStore } from "./conversation-store.ts";
import { createMobileDirectPairingWebSocketTransport } from "./direct-pairing-transport.ts";
import { reconcileMobileInstallation } from "./installation.ts";
import { createMobileProjectionStore } from "./projection-store.ts";
import { createMobileRemoteTransport } from "./remote-transport.ts";
import { createMobileSessionStore } from "./session-store.ts";

type MobileAppStatus = "booting" | "ready" | "error";
type MobilePairingStatus = "idle" | "claiming" | "waiting" | "complete" | "error";

interface MobilePairingViewState {
  readonly status: MobilePairingStatus;
  readonly safetyCode?: string;
  readonly machineId?: string;
  readonly errorCode?: string;
}

interface MobileAppContextValue {
  readonly status: MobileAppStatus;
  readonly pairing: MobilePairingViewState;
  readonly machines: MobileMachineCatalogSnapshot & { readonly loading: boolean };
  refreshMachines(): Promise<void>;
  loadSessions(machineId: string): Promise<MobileSessionCatalogSnapshot>;
  createSession(input: {
    readonly machineId: string;
    readonly title?: string;
    readonly workspaceId?: string;
  }): Promise<string>;
  renameSession(input: {
    readonly machineId: string;
    readonly sessionId: string;
    readonly title: string;
    readonly expectedEntityRevision: string;
  }): Promise<void>;
  setSessionPinned(input: {
    readonly machineId: string;
    readonly sessionId: string;
    readonly pinned: boolean;
    readonly expectedEntityRevision: string;
  }): Promise<void>;
  archiveSession(input: {
    readonly machineId: string;
    readonly sessionId: string;
    readonly expectedEntityRevision: string;
  }): Promise<void>;
  openConversation(input: {
    readonly machineId: string;
    readonly sessionId: string;
    readonly runState?: import("@workbench/remote-control-contracts/protocol").RemoteRunStateV1;
  }): ReturnType<ReturnType<typeof createMobileConversationFeature>["open"]>;
  pairQr(rawCode: string): Promise<string>;
  pairManual(input: {
    readonly host: string;
    readonly port: number;
    readonly manualCode: string;
  }): Promise<string>;
  cancelPairing(): void;
  resetPairing(): void;
  getConnectionProfile(machineId: string): Promise<DirectConnectionProfile | undefined>;
  reorderConnectionEndpoints(machineId: string, endpointIds: readonly string[]): Promise<void>;
  testConnectionEndpoint(machineId: string, endpoint: DirectEndpointV1): Promise<void>;
  saveConnectionEndpoint(input: {
    readonly machineId: string;
    readonly endpointId?: string;
    readonly endpoint: DirectEndpointV1;
  }): Promise<void>;
  removeConnectionEndpoint(machineId: string, endpointId: string): Promise<void>;
  removeMachine(machineId: string): Promise<void>;
}

const MobileAppContext = createContext<MobileAppContextValue | null>(null);

function errorCode(error: unknown): string {
  return error instanceof Error && /^[a-z_]+$/u.test(error.message)
    ? error.message
    : "unexpected_error";
}

type MobileDatabase = Awaited<ReturnType<typeof openMobileDatabase>>;
type MobileSecureStore = ReturnType<typeof createMobileSecureStore>;
type MobileProfileStore = ReturnType<typeof createMobileConnectionProfileStore>;
type MobilePairingController = ReturnType<typeof createMobileDirectPairingController>;
type MobileMachinesFeature = ReturnType<typeof createMobileMachinesFeature>;
type MobileSessionCatalogFeature = ReturnType<typeof createMobileSessionCatalogFeature>;
type MobileConversationFeature = ReturnType<typeof createMobileConversationFeature>;
type MobileRemoteTransport = ReturnType<typeof createMobileRemoteTransport>;

export function MobileAppProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [status, setStatus] = useState<MobileAppStatus>("booting");
  const [pairing, setPairing] = useState<MobilePairingViewState>({ status: "idle" });
  const [machines, setMachines] = useState<
    MobileMachineCatalogSnapshot & { readonly loading: boolean }
  >({ items: Object.freeze([]), stale: false, loading: false });
  const machinesSnapshot = useRef(machines);
  const database = useRef<MobileDatabase | undefined>(undefined);
  const secureStore = useRef<MobileSecureStore | undefined>(undefined);
  const profileStore = useRef<MobileProfileStore | undefined>(undefined);
  const pairingController = useRef<MobilePairingController | undefined>(undefined);
  const pairingPending = useRef<MobileDirectPairingPending | undefined>(undefined);
  const machinesFeature = useRef<MobileMachinesFeature | undefined>(undefined);
  const sessionCatalogFeature = useRef<MobileSessionCatalogFeature | undefined>(undefined);
  const conversationFeature = useRef<MobileConversationFeature | undefined>(undefined);
  const remoteTransport = useRef<MobileRemoteTransport | undefined>(undefined);
  const pairingAbort = useRef<AbortController | undefined>(undefined);
  const remotePort = useRef({
    read: (machineId: string) => {
      if (!remoteTransport.current) throw new Error("machine_offline");
      return remoteTransport.current.read(machineId);
    },
    submit: (input: Parameters<MobileRemoteTransport["submit"]>[0]) => {
      if (!remoteTransport.current) throw new Error("machine_offline");
      return remoteTransport.current.submit(input);
    },
    readHistory: (input: Parameters<MobileRemoteTransport["readHistory"]>[0]) => {
      if (!remoteTransport.current) throw new Error("machine_offline");
      return remoteTransport.current.readHistory(input);
    },
    recoverOperations: (input: Parameters<MobileRemoteTransport["recoverOperations"]>[0]) => {
      if (!remoteTransport.current) throw new Error("machine_offline");
      return remoteTransport.current.recoverOperations(input);
    },
    subscribe: (machineId: string, listener: Parameters<MobileRemoteTransport["subscribe"]>[1]) => {
      if (!remoteTransport.current) return () => {};
      return remoteTransport.current.subscribe(machineId, listener);
    },
  });

  useEffect(() => {
    machinesSnapshot.current = machines;
  }, [machines]);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const nextDatabase = await openMobileDatabase({});
        const nextSecureStore = createMobileSecureStore({ index: nextDatabase.secureItemIndex });
        await reconcileMobileInstallation({
          sentinel: nextDatabase.sentinel,
          credentials: nextSecureStore,
          projection: nextDatabase.projection,
          platform: Platform.OS === "android" ? "android" : "ios",
        });
        const nextProfiles = createMobileConnectionProfileStore({
          persistence: nextDatabase.directProfiles,
          secureStore: nextSecureStore,
          projection: nextDatabase.projection,
        });
        const nextPairing = createMobileDirectPairingController({
          transport: createMobileDirectPairingWebSocketTransport(),
          secureStore: nextSecureStore,
          profileStore: nextProfiles,
        });
        const nextMachines = createMobileMachinesFeature({ profiles: nextProfiles });
        const nextProjection = createMobileProjectionStore({
          persistence: nextDatabase.projectionSync,
        });
        const nextRemote = createMobileRemoteTransport({
          secureStore: nextSecureStore,
          profileStore: nextProfiles,
          projection: nextProjection,
          lifecycle: createMobileAppStatePlatform(),
          network: createMobileNetworkPlatform(),
        });
        await nextRemote.start();
        const nextSessionStore = createMobileSessionStore({
          persistence: nextDatabase.sessions,
          clock: { now: () => new Date() },
        });
        const nextSessionCatalog = createMobileSessionCatalogFeature({
          cache: {
            loadSessions: async (machineId) => (await nextSessionStore.load(machineId)).items,
            replaceSessions: (machineId, items) =>
              nextSessionStore.replaceCatalog(machineId, items),
          },
          remote: remotePort.current,
        });
        const nextConversation = createMobileConversationFeature({
          store: createMobileConversationStore({
            cache: nextDatabase.conversation,
            clock: { now: () => new Date() },
          }),
          sessionStore: nextSessionStore,
          remote: remotePort.current,
        });
        const initialMachines = await nextMachines.load();
        if (disposed) {
          nextRemote.stop();
          await nextDatabase.close();
          return;
        }
        database.current = nextDatabase;
        secureStore.current = nextSecureStore;
        profileStore.current = nextProfiles;
        pairingController.current = nextPairing;
        machinesFeature.current = nextMachines;
        sessionCatalogFeature.current = nextSessionCatalog;
        conversationFeature.current = nextConversation;
        remoteTransport.current = nextRemote;
        setMachines({ ...initialMachines, loading: false });
        setStatus("ready");
      } catch {
        if (!disposed) setStatus("error");
      }
    })();
    return () => {
      disposed = true;
      pairingAbort.current?.abort();
      pairingPending.current?.cancel();
      remoteTransport.current?.stop();
      void database.current?.close();
    };
  }, []);

  const refreshMachines = useCallback(async () => {
    if (!machinesFeature.current) return;
    setMachines((current) => ({ ...current, loading: true }));
    const snapshot = await machinesFeature.current.load();
    setMachines({ ...snapshot, loading: false });
  }, []);

  const markMachineOnline = useCallback((machineId: string) => {
    const lastSeenAt = new Date().toISOString();
    setMachines((current) => markRemoteMachineOnline(current, machineId, lastSeenAt));
  }, []);

  const protocolReady = useCallback((machineId: string) => {
    const machine = machinesSnapshot.current.items.find((item) => item.machineId === machineId);
    return Boolean(machine && machine.protocolRange.min <= 1 && machine.protocolRange.max >= 1);
  }, []);

  const loadSessions = useCallback(
    async (machineId: string): Promise<MobileSessionCatalogSnapshot> => {
      if (!sessionCatalogFeature.current) throw new Error("session_catalog_unavailable");
      const snapshot = await sessionCatalogFeature.current.load({
        machineId,
        machineReady: protocolReady(machineId),
      });
      if (!snapshot.stale && machinesFeature.current) {
        const refreshedMachines = await machinesFeature.current.load();
        setMachines({ ...refreshedMachines, loading: false });
      } else if (!snapshot.stale) {
        markMachineOnline(machineId);
      }
      return snapshot;
    },
    [markMachineOnline, protocolReady],
  );

  const openConversation = useCallback(
    (input: {
      readonly machineId: string;
      readonly sessionId: string;
      readonly runState?: import("@workbench/remote-control-contracts/protocol").RemoteRunStateV1;
    }) => {
      if (!conversationFeature.current) throw new Error("session_control_unavailable");
      return conversationFeature.current.open({
        ...input,
        machineReady: protocolReady(input.machineId),
      });
    },
    [protocolReady],
  );

  const createSession = useCallback(
    async (input: {
      readonly machineId: string;
      readonly title?: string;
      readonly workspaceId?: string;
    }) => {
      if (!sessionCatalogFeature.current) throw new Error("session_control_unavailable");
      return sessionCatalogFeature.current.create(input);
    },
    [],
  );
  const renameSession = useCallback(
    async (input: Parameters<MobileSessionCatalogFeature["rename"]>[0]) => {
      if (!sessionCatalogFeature.current) throw new Error("session_control_unavailable");
      await sessionCatalogFeature.current.rename(input);
    },
    [],
  );
  const setSessionPinned = useCallback(
    async (input: Parameters<MobileSessionCatalogFeature["setPinned"]>[0]) => {
      if (!sessionCatalogFeature.current) throw new Error("session_control_unavailable");
      await sessionCatalogFeature.current.setPinned(input);
    },
    [],
  );
  const archiveSession = useCallback(
    async (input: Parameters<MobileSessionCatalogFeature["archive"]>[0]) => {
      if (!sessionCatalogFeature.current) throw new Error("session_control_unavailable");
      await sessionCatalogFeature.current.archive(input);
    },
    [],
  );

  const finishPairing = useCallback(
    async (pending: MobileDirectPairingPending) => {
      pairingPending.current = pending;
      setPairing({ status: "waiting", safetyCode: pending.safetyCode });
      const profile = await pending.complete(pairingAbort.current?.signal);
      setPairing({
        status: "complete",
        safetyCode: pending.safetyCode,
        machineId: profile.machineId,
      });
      await refreshMachines();
      return profile.machineId;
    },
    [refreshMachines],
  );

  const runPairing = useCallback(
    async (begin: (signal: AbortSignal) => Promise<MobileDirectPairingPending>) => {
      if (!pairingController.current) throw new Error("session_control_unavailable");
      pairingAbort.current?.abort();
      pairingPending.current?.cancel();
      const controller = new AbortController();
      pairingAbort.current = controller;
      setPairing({ status: "claiming" });
      try {
        return await finishPairing(await begin(controller.signal));
      } catch (error) {
        const code = errorCode(error);
        setPairing(
          code === "pairing_cancelled" ? { status: "idle" } : { status: "error", errorCode: code },
        );
        throw error;
      } finally {
        if (pairingAbort.current === controller) pairingAbort.current = undefined;
        pairingPending.current = undefined;
      }
    },
    [finishPairing],
  );

  const pairQr = useCallback(
    (rawCode: string) =>
      runPairing((signal) =>
        pairingController.current!.beginQr({
          rawCode,
          displayName: Platform.OS === "ios" ? "iPhone" : "Android phone",
          platform: Platform.OS === "ios" ? "ios" : "android",
          signal,
        }),
      ),
    [runPairing],
  );
  const pairManual = useCallback(
    (input: { readonly host: string; readonly port: number; readonly manualCode: string }) =>
      runPairing((signal) =>
        pairingController.current!.beginManual({
          ...input,
          displayName: Platform.OS === "ios" ? "iPhone" : "Android phone",
          platform: Platform.OS === "ios" ? "ios" : "android",
          signal,
        }),
      ),
    [runPairing],
  );

  const cancelPairing = useCallback(() => {
    pairingAbort.current?.abort();
    pairingPending.current?.cancel();
  }, []);
  const resetPairing = useCallback(() => {
    cancelPairing();
    setPairing({ status: "idle" });
  }, [cancelPairing]);
  const getConnectionProfile = useCallback(async (machineId: string) => {
    return profileStore.current?.get(machineId);
  }, []);
  const reorderConnectionEndpoints = useCallback(
    async (machineId: string, endpointIds: readonly string[]) => {
      if (!profileStore.current) throw new Error("session_control_unavailable");
      await profileStore.current.reorder(machineId, endpointIds);
      await refreshMachines();
    },
    [refreshMachines],
  );
  const testConnectionEndpoint = useCallback(
    async (machineId: string, endpoint: DirectEndpointV1) => {
      if (!remoteTransport.current) throw new Error("session_control_unavailable");
      await remoteTransport.current.probeEndpoint(machineId, endpoint);
    },
    [],
  );
  const saveConnectionEndpoint = useCallback(
    async (input: {
      readonly machineId: string;
      readonly endpointId?: string;
      readonly endpoint: DirectEndpointV1;
    }) => {
      if (!profileStore.current || !remoteTransport.current) {
        throw new Error("session_control_unavailable");
      }
      await profileStore.current.saveEndpoint({
        ...input,
        verify: (endpoint) => remoteTransport.current!.probeEndpoint(input.machineId, endpoint),
      });
      remoteTransport.current.disconnectMachine(input.machineId);
      await refreshMachines();
    },
    [refreshMachines],
  );
  const removeConnectionEndpoint = useCallback(
    async (machineId: string, endpointId: string) => {
      if (!profileStore.current || !remoteTransport.current) {
        throw new Error("session_control_unavailable");
      }
      remoteTransport.current.disconnectMachine(machineId);
      await profileStore.current.removeEndpoint(machineId, endpointId);
      await refreshMachines();
    },
    [refreshMachines],
  );
  const removeMachine = useCallback(
    async (machineId: string) => {
      if (!profileStore.current) return;
      remoteTransport.current?.disconnectMachine(machineId);
      await profileStore.current.remove(machineId);
      await refreshMachines();
    },
    [refreshMachines],
  );

  const value = useMemo<MobileAppContextValue>(
    () => ({
      status,
      pairing,
      machines,
      refreshMachines,
      loadSessions,
      createSession,
      renameSession,
      setSessionPinned,
      archiveSession,
      openConversation,
      pairQr,
      pairManual,
      cancelPairing,
      resetPairing,
      getConnectionProfile,
      reorderConnectionEndpoints,
      testConnectionEndpoint,
      saveConnectionEndpoint,
      removeConnectionEndpoint,
      removeMachine,
    }),
    [
      archiveSession,
      cancelPairing,
      createSession,
      getConnectionProfile,
      loadSessions,
      machines,
      openConversation,
      pairManual,
      pairQr,
      pairing,
      refreshMachines,
      reorderConnectionEndpoints,
      testConnectionEndpoint,
      saveConnectionEndpoint,
      removeConnectionEndpoint,
      removeMachine,
      renameSession,
      resetPairing,
      setSessionPinned,
      status,
    ],
  );

  return <MobileAppContext.Provider value={value}>{children}</MobileAppContext.Provider>;
}

export function useMobileApp(): MobileAppContextValue {
  const value = useContext(MobileAppContext);
  if (!value) throw new Error("useMobileApp must be used within MobileAppProvider");
  return value;
}
