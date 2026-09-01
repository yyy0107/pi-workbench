import type { Server } from "node:http";

import {
  RUNTIME_HOST_HEALTH_PATH,
  RUNTIME_HOST_IDENTITY_PATH,
  RuntimeHostShutdownReason,
  createRuntimeHostHealth,
  createRuntimeHostIdentity,
  parseRuntimeHostIdentity,
  type RuntimeHostIdentity,
  type RuntimeHostShutdownReason as RuntimeHostShutdownReasonValue,
} from "@workbench/host-contracts/runtime-host-control";

import {
  defineDesktopSidecarRuntimeAuthPolicy,
  type DesktopSidecarRuntimeAuthPolicy,
} from "@workbench/host-server/runtime-transport-auth";
import {
  createWorkbenchHttpServer,
  type WorkbenchWebSocketGateway,
} from "@workbench/host-server/workbench-http-server";
import {
  createFetchRequestHandler,
  type RuntimeFetchHandler,
} from "@workbench/host-server/fetch-request-handler";

export const API_ONLY_RUNTIME_HOST = "127.0.0.1" as const;
export const API_ONLY_RUNTIME_PORT = 0 as const;

export const RuntimeHostLifecycleReason = Object.freeze({
  ...RuntimeHostShutdownReason,
  startupFailed: "startup-failed",
  controlError: "control-error",
} as const);

export type RuntimeHostLifecycleReason =
  (typeof RuntimeHostLifecycleReason)[keyof typeof RuntimeHostLifecycleReason];

export interface RuntimeHostLifecycleDisposeContext {
  readonly reason: RuntimeHostLifecycleReason;
  readonly deadlineMs: number;
  /** Aborts when the total shutdown deadline expires. */
  readonly signal: AbortSignal;
}

export interface RuntimeHostLifecycle {
  /** Disposes the injected Runtime graph and all upgraded connections, honoring deadline aborts. */
  dispose(context: RuntimeHostLifecycleDisposeContext): void | Promise<void>;
}

export interface ApiOnlyRuntimeHostStartOptions {
  readonly host: typeof API_ONLY_RUNTIME_HOST;
  readonly port: number;
  readonly pid: number;
  readonly desktopSidecarAuth: DesktopSidecarRuntimeAuthPolicy;
  readonly runtimeApi: RuntimeFetchHandler;
  /** Must apply this same sidecar policy before any business WebSocket allocation. */
  readonly webSocketGateway: WorkbenchWebSocketGateway;
  readonly upgradeRequiredPaths: readonly string[];
  readonly lifecycle: RuntimeHostLifecycle;
  readonly identityProbe?: typeof fetch;
  readonly onRequestError?: (error: unknown) => void;
  readonly onUpgradeRelayMissing?: (request: import("node:http").IncomingMessage) => void;
}

export interface RunningApiOnlyRuntimeHost {
  readonly server: Server;
  readonly host: typeof API_ONLY_RUNTIME_HOST;
  readonly port: number;
  readonly httpOrigin: string;
  readonly identity: RuntimeHostIdentity;
  shutdown(options: {
    readonly reason: RuntimeHostLifecycleReason;
    readonly deadlineMs: number;
  }): Promise<void>;
}

function isPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 65_535;
}

function isProcessId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRuntimeHostLifecycleReason(value: unknown): value is RuntimeHostLifecycleReason {
  return Object.values(RuntimeHostLifecycleReason).includes(value as RuntimeHostLifecycleReason);
}

function jsonResponse(request: Request, value: unknown): Response {
  const body = JSON.stringify(value);
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(Buffer.byteLength(body)),
      "Cache-Control": "no-store",
    },
  });
}

function methodNotAllowed(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" },
  });
}

export function createRuntimeHostFetchHandler(options: {
  readonly identity: RuntimeHostIdentity;
  readonly runtimeApi: RuntimeFetchHandler;
}): RuntimeFetchHandler {
  const identity = parseRuntimeHostIdentity(options.identity);
  if (!identity) throw new Error("Invalid Runtime Host endpoint identity.");
  const health = createRuntimeHostHealth(identity.instanceId);
  return (request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === RUNTIME_HOST_HEALTH_PATH || pathname === RUNTIME_HOST_IDENTITY_PATH) {
      if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed();
      return jsonResponse(request, pathname === RUNTIME_HOST_HEALTH_PATH ? health : identity);
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return options.runtimeApi(request);
    }
    return new Response("Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  };
}

async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, API_ONLY_RUNTIME_HOST, () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string" || address.address !== API_ONLY_RUNTIME_HOST) {
    throw new Error("Runtime Host did not bind the required loopback address.");
  }
  return address.port;
}

async function closeServer(server: Server, deadlineMs: number): Promise<void> {
  if (!server.listening) return;
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server.closeIdleConnections();
  const timeout = setTimeout(() => server.closeAllConnections(), deadlineMs);
  timeout.unref?.();
  try {
    await closed;
  } finally {
    clearTimeout(timeout);
  }
}

async function disposeRuntimeHost(options: {
  readonly server: Server;
  readonly lifecycle: RuntimeHostLifecycle;
  readonly reason: RuntimeHostLifecycleReason;
  readonly deadlineMs: number;
}): Promise<void> {
  // Begin close synchronously before lifecycle disposal can allocate more work. Upgraded sockets
  // remain lifecycle-owned, while the shared deadline bounds both operations together.
  const closePromise = closeServer(options.server, options.deadlineMs);
  const controller = new AbortController();
  const deadlineError = new Error("Runtime Host shutdown deadline expired.");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(deadlineError);
      controller.abort(deadlineError);
    }, options.deadlineMs);
  });
  const completion = Promise.allSettled([
    Promise.resolve().then(() =>
      options.lifecycle.dispose({
        reason: options.reason,
        deadlineMs: options.deadlineMs,
        signal: controller.signal,
      }),
    ),
    closePromise,
  ]);

  let results: Awaited<typeof completion>;
  try {
    results = await Promise.race([completion, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (results.some((result) => result.status === "rejected")) {
    throw new Error("Runtime Host shutdown failed.");
  }
}

function defineInjectedPolicy(
  policy: DesktopSidecarRuntimeAuthPolicy,
): DesktopSidecarRuntimeAuthPolicy {
  if (policy.kind !== "desktop-sidecar") {
    throw new Error("API-only Runtime Host requires desktop-sidecar authentication.");
  }
  return defineDesktopSidecarRuntimeAuthPolicy({
    instanceId: policy.instanceId,
    accessToken: policy.accessToken,
    allowedOrigins: policy.allowedOrigins,
    webSocketAuthenticationTimeoutMs: policy.webSocketAuthenticationTimeoutMs,
  });
}

async function verifyIdentity(
  fetchImplementation: typeof fetch,
  httpOrigin: string,
  accessToken: string,
  expected: RuntimeHostIdentity,
): Promise<void> {
  let verified = false;
  try {
    const response = await fetchImplementation(`${httpOrigin}${RUNTIME_HOST_IDENTITY_PATH}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5_000),
    });
    const value: unknown = await response.json();
    const identity = response.ok ? parseRuntimeHostIdentity(value) : undefined;
    verified =
      identity?.instanceId === expected.instanceId &&
      identity.pid === expected.pid &&
      identity.hostProtocolVersion === expected.hostProtocolVersion;
  } catch {
    // The caller receives only the stable failure below; transport diagnostics may contain secrets.
  }
  if (!verified) throw new Error("Runtime Host identity probe failed.");
}

/** Starts one authenticated, API-only loopback listener around injected Runtime capabilities. */
export async function startApiOnlyRuntimeHost(
  options: ApiOnlyRuntimeHostStartOptions,
): Promise<RunningApiOnlyRuntimeHost> {
  if (
    options.host !== API_ONLY_RUNTIME_HOST ||
    !isPort(options.port) ||
    !isProcessId(options.pid)
  ) {
    throw new Error("Invalid API-only Runtime Host listen options.");
  }
  const authPolicy = defineInjectedPolicy(options.desktopSidecarAuth);
  const identity = createRuntimeHostIdentity({
    instanceId: authPolicy.instanceId,
    pid: options.pid,
  });
  const runtimeFetchHandler = createRuntimeHostFetchHandler({
    identity,
    runtimeApi: options.runtimeApi,
  });
  let httpOrigin: string | undefined;
  const requestHandler = createFetchRequestHandler({
    fetchHandler: runtimeFetchHandler,
    origin: () => {
      if (!httpOrigin) throw new Error("Runtime Host listener is not ready.");
      return httpOrigin;
    },
  });
  const server = createWorkbenchHttpServer({
    desktopSidecarAuth: authPolicy,
    requestHandler,
    webSocketGateway: options.webSocketGateway,
    upgradeRequiredPaths: options.upgradeRequiredPaths,
    ...(options.onRequestError === undefined ? {} : { onRequestError: options.onRequestError }),
    ...(options.onUpgradeRelayMissing === undefined
      ? {}
      : { onUpgradeRelayMissing: options.onUpgradeRelayMissing }),
  });

  let disposePromise: Promise<void> | undefined;
  const shutdown = ({
    reason,
    deadlineMs,
  }: {
    readonly reason: RuntimeHostLifecycleReason;
    readonly deadlineMs: number;
  }): Promise<void> => {
    if (
      !isRuntimeHostLifecycleReason(reason) ||
      !Number.isSafeInteger(deadlineMs) ||
      deadlineMs <= 0 ||
      deadlineMs > 60_000
    ) {
      return Promise.reject(new Error("Invalid Runtime Host shutdown request."));
    }
    disposePromise ??= disposeRuntimeHost({
      server,
      lifecycle: options.lifecycle,
      reason,
      deadlineMs,
    });
    return disposePromise;
  };

  try {
    const boundPort = await listen(server, options.port);
    httpOrigin = `http://${API_ONLY_RUNTIME_HOST}:${boundPort}`;
    await verifyIdentity(
      options.identityProbe ?? fetch,
      httpOrigin,
      authPolicy.accessToken,
      identity,
    );
    return Object.freeze({
      server,
      host: API_ONLY_RUNTIME_HOST,
      port: boundPort,
      httpOrigin,
      identity,
      shutdown,
    });
  } catch {
    await shutdown({ reason: RuntimeHostLifecycleReason.startupFailed, deadlineMs: 5_000 }).catch(
      () => undefined,
    );
    throw new Error("API-only Runtime Host startup failed.");
  }
}

export function runtimeHostLifecycleReason(
  reason: RuntimeHostShutdownReasonValue,
): RuntimeHostLifecycleReason {
  return reason;
}
