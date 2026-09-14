import { PiConnectionController } from "@workbench/pi-rpc-client/connections";
import { createRuntimeWebSocketFactory } from "@workbench/runtime-transport-client/runtime-websocket";
import type {
  RemoteCommandV1,
  RemoteRunStateV1,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";

import type { createDesktopRemoteFrameProcessor } from "./frame-processor.ts";

type FrameProcessor = ReturnType<typeof createDesktopRemoteFrameProcessor>;
type RuntimeConnection = Parameters<typeof createRuntimeWebSocketFactory>[0];
type RuntimeWebSocketOptions = NonNullable<Parameters<typeof createRuntimeWebSocketFactory>[1]>;
type RuntimeWebSocketFactory = NonNullable<RuntimeWebSocketOptions["webSocketFactory"]>;

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

export function createDesktopRemoteRuntimeMonitor(options: {
  readonly machineId: string;
  readonly runtimeConnection: RuntimeConnection;
  readonly webSocketFactory: RuntimeWebSocketFactory;
  readonly frameProcessor: Pick<
    FrameProcessor,
    "publishConversationEntries" | "publishRunState" | "refreshCatalog"
  >;
  readonly readSessionCatalog: () => Promise<readonly RemoteSessionSummaryV1[]>;
  readonly timers?: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
}) {
  const timers = options.timers ?? {
    setTimeout: (callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle: unknown) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const runStates = new Map<string, RemoteRunStateV1>();
  const interactions = new Map<string, boolean>();
  const subscribed = new Set<string>();
  let refreshTimer: unknown;
  let stopped = false;

  let controller: PiConnectionController;

  const subscribeSession = (sessionId: string) => {
    if (subscribed.has(sessionId) || stopped) return;
    subscribed.add(sessionId);
    void controller
      .ensureSessionEvents(sessionId, (event) => {
        if (event.type === "subscribed") return;
        void options.frameProcessor.publishConversationEntries(sessionId, [event]);
        scheduleRefresh();
      })
      .catch(() => {
        subscribed.delete(sessionId);
      });
  };

  const installCatalog = (sessions: readonly RemoteSessionSummaryV1[]) => {
    const retained = new Set(sessions.map(({ sessionId }) => sessionId));
    for (const session of sessions) {
      if (!runStates.has(session.sessionId)) runStates.set(session.sessionId, session.runState);
      subscribeSession(session.sessionId);
    }
    for (const sessionId of subscribed) {
      if (!retained.has(sessionId)) {
        controller.deleteSession(sessionId);
        subscribed.delete(sessionId);
        runStates.delete(sessionId);
        interactions.delete(sessionId);
      }
    }
  };

  const refresh = async () => {
    const sessions = await options.frameProcessor.refreshCatalog();
    installCatalog(sessions);
  };

  const scheduleRefresh = () => {
    if (stopped || refreshTimer !== undefined) return;
    refreshTimer = timers.setTimeout(() => {
      refreshTimer = undefined;
      void refresh().catch(() => undefined);
    }, 50);
  };

  const onHostFrame = (payload: unknown) => {
    const value = record(payload);
    const sessionId = typeof value?.sessionId === "string" ? value.sessionId : undefined;
    if (value?.type === "host/session-status" && sessionId && typeof value.running === "boolean") {
      const previous = runStates.get(sessionId) ?? "idle";
      const state: RemoteRunStateV1 = value.running
        ? "running"
        : previous === "stopping"
          ? "stopped"
          : previous === "running"
            ? "completed"
            : "idle";
      runStates.set(sessionId, state);
      void options.frameProcessor.publishRunState(sessionId, state);
      scheduleRefresh();
      return;
    }
    if (
      value?.type === "host/session-interaction-status" &&
      sessionId &&
      typeof value.waitingForUserInput === "boolean"
    ) {
      interactions.set(sessionId, value.waitingForUserInput);
      if (value.waitingForUserInput) {
        runStates.set(sessionId, "waiting-for-input");
        void options.frameProcessor.publishRunState(sessionId, "waiting-for-input");
      }
      scheduleRefresh();
      return;
    }
    if (value?.type === "host/agent-error" && sessionId) {
      runStates.set(sessionId, "failed");
      void options.frameProcessor.publishRunState(sessionId, "failed");
      scheduleRefresh();
      return;
    }
    if (typeof value?.type === "string" && value.type.startsWith("host/")) {
      scheduleRefresh();
    }
  };

  controller = new PiConnectionController({
    webSocketFactory: createRuntimeWebSocketFactory(options.runtimeConnection, {
      webSocketFactory: options.webSocketFactory,
    }),
    onHostFrame,
  });

  return {
    noteOperationAccepted(command: RemoteCommandV1): void {
      if (command.type !== "session.stop") return;
      runStates.set(command.sessionId, "stopping");
      void options.frameProcessor.publishRunState(command.sessionId, "stopping");
    },
    async start(): Promise<void> {
      if (stopped) return;
      const sessions = await options.readSessionCatalog();
      installCatalog(sessions);
      controller.replaceRunningBaseline(
        sessions.filter(({ runState }) => runState === "running").map(({ sessionId }) => sessionId),
      );
      controller.startRunningEvents(() => scheduleRefresh());
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      if (refreshTimer !== undefined) timers.clearTimeout(refreshTimer);
      refreshTimer = undefined;
      controller.dispose();
      subscribed.clear();
      runStates.clear();
      interactions.clear();
    },
  };
}
