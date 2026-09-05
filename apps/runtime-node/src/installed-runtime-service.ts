import { WebSocketServer } from "ws";

import { STREAM_PATHS } from "@workbench/agent-runtime-pi-protocol/stream";
import { createNoServerWebSocketGateway } from "@workbench/agent-runtime-pi-server/websocket";
import {
  createAuthenticatedNoServerWebSocketServer,
  createRuntimeWebSocketAuthenticationAdmission,
  type DesktopSidecarRuntimeAuthPolicy,
} from "@workbench/host-server/runtime-transport-auth";
import type { WorkbenchWebSocketGateway } from "@workbench/host-server/workbench-http-server";
import {
  configuredApiTrustedHosts,
  inspectApiRequestTrust,
} from "@workbench/server-core/request-trust";
import {
  SET_DEFAULT_TERMINAL_SHELL_METHOD,
  TERMINAL_WEBSOCKET_PATH,
} from "@workbench/terminal-contracts";
import {
  createTerminalGateway,
  type TerminalSessionManagerLike,
} from "@workbench/terminal-server/gateway";
import { TerminalSessionManager } from "@workbench/terminal-server/shell-sessions";

import { getInstalledPiServer } from "./composition/installed-pi-server";
import { createTerminalShellRpcHandler } from "./terminal-shell-rpc";

const MAX_RUNTIME_WEBSOCKET_PAYLOAD_BYTES = 128 * 1024;

export const INSTALLED_RUNTIME_WEBSOCKET_PATHS = Object.freeze([
  STREAM_PATHS.mux,
  STREAM_PATHS.host,
  TERMINAL_WEBSOCKET_PATH,
]);

export interface InstalledRuntimeServiceOptions {
  readonly desktopSidecarAuth?: DesktopSidecarRuntimeAuthPolicy;
  readonly onUnexpectedError?: (scope: "pi-websocket" | "terminal", error: unknown) => void;
}

export interface InstalledRuntimeService {
  readonly handleHttpRequest: (request: Request) => Promise<Response>;
  readonly webSocketGateway: WorkbenchWebSocketGateway;
  readonly webSocketServers: readonly WebSocketServer[];
  readonly upgradeRequiredPaths: readonly string[];
  dispose(signal?: AbortSignal): Promise<void>;
}

export interface InstalledRuntimeDisposalOwners {
  readonly disposePi: () => Promise<void>;
  readonly disposeTerminals: readonly (() => void)[];
}

/** Preserves Pi quiescence before Terminal teardown while still aggregating every cleanup error. */
export function createInstalledRuntimeDisposer({
  disposePi,
  disposeTerminals,
}: InstalledRuntimeDisposalOwners): (signal?: AbortSignal) => Promise<void> {
  let disposeOperation: Promise<void> | undefined;
  let settled = false;
  let terminalsDisposed = false;
  const errors: unknown[] = [];
  const abortListenerCleanups = new Set<() => void>();
  const disposeTerminalOwners = () => {
    if (terminalsDisposed) return;
    terminalsDisposed = true;
    for (const disposeTerminal of disposeTerminals) {
      try {
        disposeTerminal();
      } catch (error) {
        errors.push(error);
      }
    }
  };
  const observeAbort = (signal: AbortSignal | undefined) => {
    if (!signal || settled || terminalsDisposed) return;
    if (signal.aborted) {
      disposeTerminalOwners();
      return;
    }
    const forceDisposeTerminals = () => disposeTerminalOwners();
    signal.addEventListener("abort", forceDisposeTerminals, { once: true });
    abortListenerCleanups.add(() => signal.removeEventListener("abort", forceDisposeTerminals));
  };
  return (signal) => {
    if (disposeOperation) {
      observeAbort(signal);
      return disposeOperation;
    }
    let resolveDispose!: () => void;
    let rejectDispose!: (error: unknown) => void;
    const operation = new Promise<void>((resolve, reject) => {
      resolveDispose = resolve;
      rejectDispose = reject;
    });
    disposeOperation = operation;
    observeAbort(signal);
    void (async () => {
      try {
        await disposePi();
      } catch (error) {
        errors.push(error);
      }
      disposeTerminalOwners();
      settled = true;
      for (const cleanup of abortListenerCleanups) cleanup();
      abortListenerCleanups.clear();
      if (errors.length > 0) {
        throw new AggregateError(errors, "Installed Runtime service shutdown failed.");
      }
    })().then(resolveDispose, rejectDispose);
    return operation;
  };
}

/**
 * Installs the single Pi/Terminal service graph used by either the combined launcher or the
 * API-only Runtime Host. This application composition intentionally has no Next dependency.
 */
export function createInstalledRuntimeService(
  options: InstalledRuntimeServiceOptions = {},
): InstalledRuntimeService {
  const reportUnexpectedError =
    options.onUnexpectedError ??
    ((scope: "pi-websocket" | "terminal", error: unknown) => {
      console.error(`[workbench] ${scope} failed.`, error);
    });
  const webSocketAuthenticationAdmission = options.desktopSidecarAuth
    ? createRuntimeWebSocketAuthenticationAdmission()
    : undefined;

  const piWebSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_RUNTIME_WEBSOCKET_PAYLOAD_BYTES,
  });
  const piWebSocketGateway = createNoServerWebSocketGateway({
    webSocketServer: createAuthenticatedNoServerWebSocketServer({
      webSocketServer: piWebSocketServer,
      ...(options.desktopSidecarAuth === undefined
        ? {}
        : { authPolicy: options.desktopSidecarAuth }),
      ...(webSocketAuthenticationAdmission === undefined
        ? {}
        : { authenticationAdmission: webSocketAuthenticationAdmission }),
      onUnexpectedError: (error) => reportUnexpectedError("pi-websocket", error),
    }),
  });

  const terminalWebSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_RUNTIME_WEBSOCKET_PAYLOAD_BYTES,
  });
  const installedPi = getInstalledPiServer();
  const terminalSessions = new TerminalSessionManager({
    getShell: installedPi.terminalShell.getShell,
  });
  const toolTerminalSessions = installedPi.toolTerminalSessions;
  const setDefaultShell = options.desktopSidecarAuth
    ? createTerminalShellRpcHandler(installedPi.terminalShell.setShell)
    : undefined;
  const gatewayTerminalSessions: TerminalSessionManagerLike = {
    attach: (attachOptions) =>
      attachOptions.toolCallId
        ? toolTerminalSessions.attach({
            sessionId: attachOptions.sessionId,
            toolCallId: attachOptions.toolCallId,
            ...(attachOptions.cols === undefined ? {} : { cols: attachOptions.cols }),
            ...(attachOptions.rows === undefined ? {} : { rows: attachOptions.rows }),
          })
        : terminalSessions.attach(attachOptions),
  };
  const terminalGateway = createTerminalGateway({
    webSocketServer: createAuthenticatedNoServerWebSocketServer({
      webSocketServer: terminalWebSocketServer,
      ...(options.desktopSidecarAuth === undefined
        ? {}
        : { authPolicy: options.desktopSidecarAuth }),
      ...(webSocketAuthenticationAdmission === undefined
        ? {}
        : { authenticationAdmission: webSocketAuthenticationAdmission }),
      onUnexpectedError: (error) => reportUnexpectedError("terminal", error),
    }),
    sessions: gatewayTerminalSessions,
    trustedHosts: configuredApiTrustedHosts(),
    inspectTrust: inspectApiRequestTrust,
    onUnexpectedError: (error) => reportUnexpectedError("terminal", error),
  });
  const handlePiUpgrade = piWebSocketGateway.handleUpgrade.bind(piWebSocketGateway);
  const webSocketGateway: WorkbenchWebSocketGateway = {
    handleUpgrade(request, socket, head) {
      return (
        terminalGateway.handleUpgrade(request, socket, head) ||
        handlePiUpgrade(request, socket, head)
      );
    },
  };

  const dispose = createInstalledRuntimeDisposer({
    disposePi: () => installedPi.dispose(),
    disposeTerminals: [() => terminalSessions.dispose(), () => toolTerminalSessions.dispose()],
  });
  return Object.freeze({
    handleHttpRequest: (request: Request) =>
      setDefaultShell &&
      new URL(request.url).pathname === `/api/${SET_DEFAULT_TERMINAL_SHELL_METHOD}`
        ? setDefaultShell(request)
        : installedPi.handleHttpRequest(request),
    webSocketGateway,
    webSocketServers: Object.freeze([piWebSocketServer, terminalWebSocketServer]),
    upgradeRequiredPaths: INSTALLED_RUNTIME_WEBSOCKET_PATHS,
    dispose,
  });
}
