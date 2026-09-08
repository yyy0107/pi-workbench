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
import { BROWSER_WEBSOCKET_PATH } from "@workbench/browser-contracts";

import { getInstalledPiServer } from "./composition/installed-pi-server";
import { createTerminalShellRpcHandler } from "./terminal-shell-rpc";
import { createBrowserGateway, MAX_BROWSER_CLIENT_MESSAGE_BYTES } from "./browser-gateway";

const MAX_RUNTIME_WEBSOCKET_PAYLOAD_BYTES = 128 * 1024;

export const INSTALLED_RUNTIME_WEBSOCKET_PATHS = Object.freeze([
  STREAM_PATHS.mux,
  STREAM_PATHS.host,
  TERMINAL_WEBSOCKET_PATH,
  BROWSER_WEBSOCKET_PATH,
]);

export interface InstalledRuntimeServiceOptions {
  readonly desktopSidecarAuth?: DesktopSidecarRuntimeAuthPolicy;
  readonly onUnexpectedError?: (
    scope: "pi-websocket" | "terminal" | "browser",
    error: unknown,
  ) => void;
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
  readonly disposeResources: readonly (() => void)[];
}

/** Preserves Pi quiescence before resource teardown while aggregating every cleanup error. */
export function createInstalledRuntimeDisposer({
  disposePi,
  disposeResources,
}: InstalledRuntimeDisposalOwners): (signal?: AbortSignal) => Promise<void> {
  let disposeOperation: Promise<void> | undefined;
  let settled = false;
  let resourcesDisposed = false;
  const errors: unknown[] = [];
  const abortListenerCleanups = new Set<() => void>();
  const disposeResourceOwners = () => {
    if (resourcesDisposed) return;
    resourcesDisposed = true;
    for (const disposeResource of disposeResources) {
      try {
        disposeResource();
      } catch (error) {
        errors.push(error);
      }
    }
  };
  const observeAbort = (signal: AbortSignal | undefined) => {
    if (!signal || settled || resourcesDisposed) return;
    if (signal.aborted) {
      disposeResourceOwners();
      return;
    }
    const forceDisposeResources = () => disposeResourceOwners();
    signal.addEventListener("abort", forceDisposeResources, { once: true });
    abortListenerCleanups.add(() => signal.removeEventListener("abort", forceDisposeResources));
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
      disposeResourceOwners();
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
 * Installs the shared Pi, Terminal and Browser graph used by either the combined launcher or the
 * API-only Runtime Host. This application composition intentionally has no Next dependency.
 */
export function createInstalledRuntimeService(
  options: InstalledRuntimeServiceOptions = {},
): InstalledRuntimeService {
  const reportUnexpectedError =
    options.onUnexpectedError ??
    ((scope: "pi-websocket" | "terminal" | "browser", error: unknown) => {
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
  const browserManager = installedPi.browser;
  const browserWebSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_BROWSER_CLIENT_MESSAGE_BYTES,
  });
  const browserGateway = createBrowserGateway({
    webSocketServer: createAuthenticatedNoServerWebSocketServer({
      webSocketServer: browserWebSocketServer,
      ...(options.desktopSidecarAuth === undefined
        ? {}
        : { authPolicy: options.desktopSidecarAuth }),
      ...(webSocketAuthenticationAdmission === undefined
        ? {}
        : { authenticationAdmission: webSocketAuthenticationAdmission }),
      onUnexpectedError: (error) => reportUnexpectedError("browser", error),
    }),
    manager: browserManager,
    trustedHosts: configuredApiTrustedHosts(),
    onUnexpectedError: (error) => reportUnexpectedError("browser", error),
  });
  const handlePiUpgrade = piWebSocketGateway.handleUpgrade.bind(piWebSocketGateway);
  const webSocketGateway: WorkbenchWebSocketGateway = {
    handleUpgrade(request, socket, head) {
      return (
        browserGateway.handleUpgrade(request, socket, head) ||
        terminalGateway.handleUpgrade(request, socket, head) ||
        handlePiUpgrade(request, socket, head)
      );
    },
  };

  const dispose = createInstalledRuntimeDisposer({
    disposePi: () => installedPi.dispose(),
    disposeResources: [
      () => terminalSessions.dispose(),
      () => toolTerminalSessions.dispose(),
      () => browserManager.dispose(),
    ],
  });
  return Object.freeze({
    handleHttpRequest: (request: Request) =>
      setDefaultShell &&
      new URL(request.url).pathname === `/api/${SET_DEFAULT_TERMINAL_SHELL_METHOD}`
        ? setDefaultShell(request)
        : installedPi.handleHttpRequest(request),
    webSocketGateway,
    webSocketServers: Object.freeze([
      piWebSocketServer,
      terminalWebSocketServer,
      browserWebSocketServer,
    ]),
    upgradeRequiredPaths: INSTALLED_RUNTIME_WEBSOCKET_PATHS,
    dispose,
  });
}
