import { createRemoteRecoveryCoordinator } from "@workbench/remote-control-client/recovery";

import type { MobileAppState } from "../platform/app-state.ts";
import type { MobileNetworkState } from "../platform/network.ts";

export type MobileRemoteConnectionStatus =
  | "offline"
  | "reconnecting"
  | "resyncing"
  | "ready"
  | "incompatible"
  | "stale"
  | "outcome-checking";

export interface MobileRemoteLifecyclePort {
  current(): MobileAppState;
  subscribe(listener: (state: MobileAppState) => void): () => void;
}

export interface MobileRemoteNetworkPort {
  current(): Promise<MobileNetworkState>;
  subscribe(listener: (state: MobileNetworkState) => void): () => void;
}

export interface MobileRemoteTransportPort {
  connect(input: { readonly reason: "start" | "foreground" | "network" | "retry" }): Promise<void>;
  suspend(reason: "background" | "network-offline" | "stopped"): void;
}

interface TimerPort {
  set(callback: () => void, milliseconds: number): unknown;
  clear(handle: unknown): void;
}

const defaultTimer: TimerPort = {
  set: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createMobileRemoteClient(options: {
  readonly lifecycle: MobileRemoteLifecyclePort;
  readonly network: MobileRemoteNetworkPort;
  readonly transport: MobileRemoteTransportPort;
  readonly random?: () => number;
  readonly timer?: TimerPort;
}) {
  const timer = options.timer ?? defaultTimer;
  const recovery = createRemoteRecoveryCoordinator({ random: options.random ?? Math.random });
  const listeners = new Set<(status: MobileRemoteConnectionStatus) => void>();
  let status: MobileRemoteConnectionStatus = "offline";
  let appState = options.lifecycle.current();
  let network: MobileNetworkState = { connected: false, reachable: false };
  let reconnectAttempt = 0;
  let reconnectTimer: unknown;
  let recoveryInFlight: Promise<void> | undefined;
  let stopped = true;
  let unsubscribeLifecycle: (() => void) | undefined;
  let unsubscribeNetwork: (() => void) | undefined;

  const transition = (next: MobileRemoteConnectionStatus): void => {
    if (status === next) return;
    status = next;
    for (const listener of listeners) listener(next);
  };

  const clearReconnect = (): void => {
    if (reconnectTimer === undefined) return;
    timer.clear(reconnectTimer);
    reconnectTimer = undefined;
  };

  const canConnect = () => !stopped && appState === "active" && network.reachable;

  const schedule = (): void => {
    if (!canConnect() || reconnectTimer !== undefined || recoveryInFlight) return;
    const delay = recovery.nextDelay(reconnectAttempt++);
    if (status !== "outcome-checking") transition("reconnecting");
    reconnectTimer = timer.set(() => {
      reconnectTimer = undefined;
      void recover("retry");
    }, delay);
  };

  const recover = async (
    reason: Parameters<MobileRemoteTransportPort["connect"]>[0]["reason"],
  ): Promise<void> => {
    if (!canConnect()) return;
    clearReconnect();
    if (recoveryInFlight) return recoveryInFlight;
    transition(status === "outcome-checking" ? "outcome-checking" : "resyncing");
    recoveryInFlight = options.transport.connect({ reason });
    try {
      await recoveryInFlight;
      reconnectAttempt = 0;
    } catch {
      transition("stale");
      schedule();
    } finally {
      recoveryInFlight = undefined;
    }
  };

  const suspend = (reason: "background" | "network-offline" | "stopped") => {
    clearReconnect();
    options.transport.suspend(reason);
    transition(reason === "network-offline" ? "offline" : "stale");
  };

  const onAppState = (next: MobileAppState): void => {
    if (appState === next) return;
    appState = next;
    if (next !== "active") {
      recovery.suspend();
      suspend("background");
      return;
    }
    recovery.foreground();
    void recover("foreground");
  };

  const onNetwork = (next: MobileNetworkState): void => {
    const becameReachable = !network.reachable && next.reachable;
    network = next;
    if (!next.reachable) {
      suspend("network-offline");
      return;
    }
    if (becameReachable) {
      recovery.networkChanged();
      void recover("network");
    }
  };

  return {
    snapshot: () => Object.freeze({ status, active: appState === "active", network }),
    subscribe(listener: (next: MobileRemoteConnectionStatus) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start(): Promise<void> {
      if (!stopped) return;
      stopped = false;
      network = await options.network.current();
      unsubscribeLifecycle = options.lifecycle.subscribe(onAppState);
      unsubscribeNetwork = options.network.subscribe(onNetwork);
      if (canConnect()) await recover("start");
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      unsubscribeLifecycle?.();
      unsubscribeNetwork?.();
      unsubscribeLifecycle = undefined;
      unsubscribeNetwork = undefined;
      suspend("stopped");
    },
    markReady(): void {
      reconnectAttempt = 0;
      clearReconnect();
      transition("ready");
    },
    markDisconnected(options: { readonly unresolvedOutcome?: boolean } = {}): void {
      transition(options.unresolvedOutcome ? "outcome-checking" : "reconnecting");
      schedule();
    },
    markIncompatible(): void {
      clearReconnect();
      transition("incompatible");
    },
  };
}
