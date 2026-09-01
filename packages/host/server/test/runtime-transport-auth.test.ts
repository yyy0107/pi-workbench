import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";

import {
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
  RuntimeWebSocketCloseCode,
} from "@workbench/host-contracts";
import {
  applyDesktopRuntimeWebSocketUpgradeAuthorization,
  authorizeDesktopRuntimeHttpRequest,
  authorizeDesktopRuntimeWebSocketUpgrade,
  canonicalizeAuthorizedDesktopRuntimeRequest,
  createAuthenticatedNoServerWebSocketServer,
  createRuntimeWebSocketAuthenticationAdmission,
  defineDesktopSidecarRuntimeAuthPolicy,
  type DesktopSidecarRuntimeAuthPolicy,
  type DesktopRuntimeWebSocketUpgradeAuthorization,
  type RuntimeAuthenticationTimers,
} from "../src/runtime-transport-auth";

const RENDERER_ORIGIN = "https://renderer.workbench.test";

function authPolicy(
  instanceId = "runtime-one",
  accessToken = "secret-one",
): DesktopSidecarRuntimeAuthPolicy {
  return defineDesktopSidecarRuntimeAuthPolicy({
    instanceId,
    accessToken,
    allowedOrigins: [RENDERER_ORIGIN, "tauri://localhost"],
    webSocketAuthenticationTimeoutMs: 25,
  });
}

function request(
  headers: Record<string, string>,
  method = "POST",
): Pick<IncomingMessage, "headers" | "method"> {
  return { headers, method };
}

test("defines immutable credential-safe sidecar policies and canonical renderer origins", () => {
  const policy = authPolicy();
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.allowedOrigins), true);
  assert.equal(policy.protocolVersion, RUNTIME_CONNECTION_PROTOCOL_VERSION);
  assert.deepEqual(policy.allowedOrigins, [RENDERER_ORIGIN, "tauri://localhost"]);

  assert.throws(
    () =>
      defineDesktopSidecarRuntimeAuthPolicy({
        instanceId: "runtime",
        accessToken: "do-not-echo\nsecret",
        allowedOrigins: [RENDERER_ORIGIN],
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Invalid desktop-sidecar Runtime authentication policy." &&
      !error.message.includes("do-not-echo"),
  );
  assert.throws(
    () =>
      defineDesktopSidecarRuntimeAuthPolicy({
        instanceId: "runtime",
        accessToken: "secret",
        allowedOrigins: ["null"],
      }),
    /Invalid desktop-sidecar Runtime authentication policy/,
  );
  assert.throws(
    () =>
      defineDesktopSidecarRuntimeAuthPolicy({
        instanceId: "runtime",
        accessToken: "secret",
        allowedOrigins: [RENDERER_ORIGIN],
        webSocketAuthenticationTimeoutMs: 30_001,
      }),
    /Invalid desktop-sidecar Runtime authentication policy/,
  );
});

test("authorizes exact Origin, CORS preflight, and one case-insensitive Bearer credential", () => {
  const policy = authPolicy();
  assert.deepEqual(
    authorizeDesktopRuntimeHttpRequest(
      request({
        origin: RENDERER_ORIGIN,
        authorization: "bEaReR secret-one",
      }),
      policy,
    ),
    { kind: "authorized", origin: RENDERER_ORIGIN },
  );
  assert.deepEqual(
    authorizeDesktopRuntimeHttpRequest(
      request(
        {
          origin: RENDERER_ORIGIN,
          "access-control-request-method": "PATCH",
          "access-control-request-headers": "Content-Type, Authorization",
        },
        "OPTIONS",
      ),
      policy,
    ),
    { kind: "preflight", origin: RENDERER_ORIGIN },
  );
  assert.deepEqual(
    authorizeDesktopRuntimeHttpRequest(
      request({ origin: RENDERER_ORIGIN, authorization: "Bearer secret-one, Bearer second" }),
      policy,
    ),
    { kind: "rejected", status: 401, origin: RENDERER_ORIGIN },
  );
  assert.deepEqual(
    authorizeDesktopRuntimeHttpRequest(
      request({ origin: "https://attacker.test", authorization: "Bearer secret-one" }),
      policy,
    ),
    { kind: "rejected", status: 403 },
  );
  assert.deepEqual(
    authorizeDesktopRuntimeHttpRequest(
      request(
        {
          origin: RENDERER_ORIGIN,
          "access-control-request-method": "CONNECT",
        },
        "OPTIONS",
      ),
      policy,
    ),
    { kind: "rejected", status: 400, origin: RENDERER_ORIGIN },
  );
});

test("keeps separate sidecar credentials isolated and scrubs authorized request headers", () => {
  const first = authPolicy("runtime-one", "secret-one");
  const second = authPolicy("runtime-two", "secret-two");
  const firstRequest = request({
    origin: RENDERER_ORIGIN,
    authorization: "Bearer secret-one",
  });
  assert.equal(authorizeDesktopRuntimeHttpRequest(firstRequest, first).kind, "authorized");
  assert.deepEqual(authorizeDesktopRuntimeHttpRequest(firstRequest, second), {
    kind: "rejected",
    status: 401,
    origin: RENDERER_ORIGIN,
  });

  const incoming = {
    headers: {
      host: "127.0.0.1:43127",
      origin: RENDERER_ORIGIN,
      authorization: "Bearer secret-one",
      "sec-fetch-site": "cross-site",
    },
    rawHeaders: [
      "Host",
      "127.0.0.1:43127",
      "Origin",
      RENDERER_ORIGIN,
      "Authorization",
      "Bearer secret-one",
      "Sec-Fetch-Site",
      "cross-site",
    ],
  } as unknown as IncomingMessage;
  canonicalizeAuthorizedDesktopRuntimeRequest(incoming);
  assert.equal(incoming.headers.authorization, undefined);
  assert.equal(incoming.headers.origin, "http://127.0.0.1:43127");
  assert.equal(incoming.headers["sec-fetch-site"], "same-origin");
  assert.equal(JSON.stringify(incoming.rawHeaders).includes("secret-one"), false);
  assert.equal(JSON.stringify(incoming.rawHeaders).includes(RENDERER_ORIGIN), false);
});

type SocketEvent = "message" | "close" | "error";
type SocketListener = (...arguments_: unknown[]) => void;

class FakeAuthenticationSocket {
  readonly readyState = 1;
  readonly bufferedAmount = 0;
  readonly sent: string[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  private readonly onceListeners = new Map<SocketEvent, Set<SocketListener>>();
  private readonly persistentListeners = new Map<SocketEvent, Set<SocketListener>>();
  private readonly sendCallbacks: Array<(error?: Error) => void> = [];

  once(event: SocketEvent, listener: SocketListener): void {
    const listeners = this.onceListeners.get(event) ?? new Set();
    listeners.add(listener);
    this.onceListeners.set(event, listeners);
  }

  on(event: SocketEvent, listener: SocketListener): void {
    const listeners = this.persistentListeners.get(event) ?? new Set();
    listeners.add(listener);
    this.persistentListeners.set(event, listeners);
  }

  off(event: SocketEvent, listener: SocketListener): void {
    this.onceListeners.get(event)?.delete(listener);
    this.persistentListeners.get(event)?.delete(listener);
  }

  send(data: string, callback?: (error?: Error) => void): void {
    this.sent.push(data);
    if (callback) this.sendCallbacks.push(callback);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }

  emit(event: SocketEvent, ...arguments_: unknown[]): void {
    const listeners = [
      ...(this.onceListeners.get(event) ?? []),
      ...(this.persistentListeners.get(event) ?? []),
    ];
    this.onceListeners.get(event)?.clear();
    for (const listener of listeners) listener(...arguments_);
  }

  completeNextSend(error?: Error): void {
    const callback = this.sendCallbacks.shift();
    assert.ok(callback, "expected a pending send callback");
    callback(error);
  }
}

interface TimerTask {
  readonly callback: () => void;
  readonly delayMs: number;
  cleared: boolean;
}

class FakeTimers implements RuntimeAuthenticationTimers {
  readonly tasks: TimerTask[] = [];

  setTimeout(callback: () => void, delayMs: number): TimerTask {
    const task = { callback, delayMs, cleared: false };
    this.tasks.push(task);
    return task;
  }

  clearTimeout(timer: unknown): void {
    (timer as TimerTask).cleared = true;
  }

  runNext(): void {
    const task = this.tasks.find((candidate) => !candidate.cleared);
    assert.ok(task, "expected a pending timer");
    task.cleared = true;
    task.callback();
  }
}

function authenticateFrame(
  policy: DesktopSidecarRuntimeAuthPolicy,
  overrides: Partial<{ protocolVersion: number; instanceId: string; accessToken: string }> = {},
): string {
  return JSON.stringify({
    type: "authenticate",
    protocolVersion: overrides.protocolVersion ?? policy.protocolVersion,
    instanceId: overrides.instanceId ?? policy.instanceId,
    accessToken: overrides.accessToken ?? policy.accessToken,
  });
}

function decoratedSocket(
  policy: DesktopSidecarRuntimeAuthPolicy,
  options: {
    timers?: FakeTimers;
    onAccepted?: () => void;
    authenticationAdmission?: ReturnType<typeof createRuntimeWebSocketAuthenticationAdmission>;
  } = {},
) {
  const socket = new FakeAuthenticationSocket();
  const underlying = {
    handleUpgrade(
      requestValue: { url: string },
      _networkSocket: object,
      _head: Uint8Array,
      callback: (webSocket: FakeAuthenticationSocket, request: { url: string }) => void,
    ) {
      callback(socket, requestValue);
    },
  };
  const server = createAuthenticatedNoServerWebSocketServer({
    webSocketServer: underlying,
    authPolicy: policy,
    ...(options.authenticationAdmission
      ? { authenticationAdmission: options.authenticationAdmission }
      : {}),
    ...(options.timers ? { timers: options.timers } : {}),
  });
  let accepted = 0;
  server.handleUpgrade({ url: "/api/events.mux" }, {}, new Uint8Array(), () => {
    accepted += 1;
    options.onAccepted?.();
  });
  return { accepted: () => accepted, server, socket, underlying };
}

test("same-origin no-server WebSockets retain the original server without auth framing", () => {
  const underlying = {
    handleUpgrade() {},
  } as unknown as Parameters<
    typeof createAuthenticatedNoServerWebSocketServer
  >[0]["webSocketServer"];
  const decorated = createAuthenticatedNoServerWebSocketServer({ webSocketServer: underlying });
  assert.equal(decorated, underlying);
});

test("sidecar WebSockets acknowledge authentication before invoking the business callback", () => {
  const policy = authPolicy();
  const { accepted, socket } = decoratedSocket(policy);
  assert.equal(accepted(), 0);

  socket.emit("message", Buffer.from(authenticateFrame(policy)), false);
  assert.equal(accepted(), 0, "the gateway must wait until the acknowledgement is flushed");
  assert.equal(socket.sent.length, 1);
  const acknowledgement = JSON.parse(socket.sent[0]!) as Record<string, unknown>;
  assert.deepEqual(acknowledgement, {
    type: "authenticated",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    instanceId: policy.instanceId,
  });
  assert.equal(socket.sent[0]!.includes(policy.accessToken), false);

  socket.completeNextSend();
  assert.equal(accepted(), 1);
});

test("an equivalent cloned listener policy bypasses the legacy frame once without an acknowledgement", () => {
  const listenerPolicy = authPolicy();
  const gatewayPolicy = defineDesktopSidecarRuntimeAuthPolicy({
    instanceId: listenerPolicy.instanceId,
    accessToken: listenerPolicy.accessToken,
    allowedOrigins: listenerPolicy.allowedOrigins,
    webSocketAuthenticationTimeoutMs: listenerPolicy.webSocketAuthenticationTimeoutMs,
  });
  assert.notEqual(listenerPolicy, gatewayPolicy, "the regression requires distinct policy objects");
  const incoming = {
    method: "GET",
    url: "/api/events.mux",
    headers: {
      host: "127.0.0.1:43127",
      origin: RENDERER_ORIGIN,
      authorization: "Bearer secret-one",
      "sec-fetch-site": "same-origin",
    },
    rawHeaders: [
      "Host",
      "127.0.0.1:43127",
      "Origin",
      RENDERER_ORIGIN,
      "Authorization",
      "Bearer secret-one",
      "Sec-Fetch-Site",
      "same-origin",
    ],
  } as unknown as IncomingMessage;
  const admission = authorizeDesktopRuntimeWebSocketUpgrade(incoming, listenerPolicy);
  assert.equal(admission.kind, "preauthorized");
  if (admission.kind !== "preauthorized") throw new Error("expected preauthorization");
  assert.equal(
    applyDesktopRuntimeWebSocketUpgradeAuthorization(incoming, admission.authorization),
    true,
  );
  canonicalizeAuthorizedDesktopRuntimeRequest(incoming);

  const socket = new FakeAuthenticationSocket();
  const server = createAuthenticatedNoServerWebSocketServer({
    authPolicy: gatewayPolicy,
    webSocketServer: {
      handleUpgrade(
        requestValue: IncomingMessage,
        _networkSocket: object,
        _head: Uint8Array,
        callback: (webSocket: FakeAuthenticationSocket, request: IncomingMessage) => void,
      ) {
        callback(socket, requestValue);
      },
    },
  });
  let accepted = 0;
  server.handleUpgrade(incoming, {}, new Uint8Array(), () => {
    accepted += 1;
  });
  assert.equal(accepted, 1);
  assert.deepEqual(socket.sent, []);
  assert.deepEqual(socket.closes, []);
  assert.equal(JSON.stringify(incoming.rawHeaders).includes("secret-one"), false);
});

test("Upgrade capabilities are request-bound, one-use, and cannot be forged", () => {
  const policy = authPolicy();
  const first = {
    method: "GET",
    headers: { origin: RENDERER_ORIGIN, authorization: "Bearer secret-one" },
  } as unknown as IncomingMessage;
  const second = {
    method: "GET",
    headers: { origin: RENDERER_ORIGIN, authorization: "Bearer secret-one" },
  } as unknown as IncomingMessage;
  const admission = authorizeDesktopRuntimeWebSocketUpgrade(first, policy);
  assert.equal(admission.kind, "preauthorized");
  if (admission.kind !== "preauthorized") throw new Error("expected preauthorization");
  assert.equal(
    applyDesktopRuntimeWebSocketUpgradeAuthorization(second, admission.authorization),
    false,
  );
  assert.equal(
    applyDesktopRuntimeWebSocketUpgradeAuthorization(first, admission.authorization),
    false,
  );
  assert.equal(
    applyDesktopRuntimeWebSocketUpgradeAuthorization(
      first,
      {} as DesktopRuntimeWebSocketUpgradeAuthorization,
    ),
    false,
  );

  const reusable = authorizeDesktopRuntimeWebSocketUpgrade(first, policy);
  assert.equal(reusable.kind, "preauthorized");
  if (reusable.kind !== "preauthorized") throw new Error("expected preauthorization");
  assert.equal(
    applyDesktopRuntimeWebSocketUpgradeAuthorization(first, reusable.authorization),
    true,
  );
  assert.equal(
    applyDesktopRuntimeWebSocketUpgradeAuthorization(first, reusable.authorization),
    false,
  );
});

test("a preauthorized Upgrade cannot bypass a websocket server using another policy or be retried", () => {
  const policy = authPolicy();
  const foreignPolicy = authPolicy("runtime-two", "secret-two");
  const incoming = {
    method: "GET",
    url: "/api/events.mux",
    headers: {
      host: "127.0.0.1:43127",
      origin: RENDERER_ORIGIN,
      authorization: "Bearer secret-one",
    },
    rawHeaders: [
      "Host",
      "127.0.0.1:43127",
      "Origin",
      RENDERER_ORIGIN,
      "Authorization",
      "Bearer secret-one",
    ],
  } as unknown as IncomingMessage;
  const admission = authorizeDesktopRuntimeWebSocketUpgrade(incoming, policy);
  assert.equal(admission.kind, "preauthorized");
  if (admission.kind !== "preauthorized") throw new Error("expected preauthorization");
  assert.equal(
    applyDesktopRuntimeWebSocketUpgradeAuthorization(incoming, admission.authorization),
    true,
  );
  canonicalizeAuthorizedDesktopRuntimeRequest(incoming);

  const socket = new FakeAuthenticationSocket();
  const foreign = createAuthenticatedNoServerWebSocketServer({
    authPolicy: foreignPolicy,
    webSocketServer: {
      handleUpgrade(
        requestValue: IncomingMessage,
        _networkSocket: object,
        _head: Uint8Array,
        callback: (webSocket: FakeAuthenticationSocket, request: IncomingMessage) => void,
      ) {
        callback(socket, requestValue);
      },
    },
  });
  let accepted = 0;
  foreign.handleUpgrade(incoming, {}, new Uint8Array(), () => {
    accepted += 1;
  });
  assert.equal(accepted, 0);
  assert.deepEqual(socket.sent, []);
  socket.emit("close");

  const correct = createAuthenticatedNoServerWebSocketServer({
    authPolicy: policy,
    webSocketServer: {
      handleUpgrade(
        requestValue: IncomingMessage,
        _networkSocket: object,
        _head: Uint8Array,
        callback: (webSocket: FakeAuthenticationSocket, request: IncomingMessage) => void,
      ) {
        callback(new FakeAuthenticationSocket(), requestValue);
      },
    },
  });
  let retried = 0;
  correct.handleUpgrade(incoming, {}, new Uint8Array(), () => {
    retried += 1;
  });
  assert.equal(retried, 0, "a mismatched consume attempt must exhaust the request authorization");
});

test("preauthorized Upgrades require the complete canonical policy to match", () => {
  const listenerPolicy = authPolicy();
  const mismatches = [
    defineDesktopSidecarRuntimeAuthPolicy({
      instanceId: listenerPolicy.instanceId,
      accessToken: listenerPolicy.accessToken,
      allowedOrigins: listenerPolicy.allowedOrigins,
      webSocketAuthenticationTimeoutMs: listenerPolicy.webSocketAuthenticationTimeoutMs + 1,
    }),
    defineDesktopSidecarRuntimeAuthPolicy({
      instanceId: listenerPolicy.instanceId,
      accessToken: listenerPolicy.accessToken,
      allowedOrigins: [...listenerPolicy.allowedOrigins].reverse(),
      webSocketAuthenticationTimeoutMs: listenerPolicy.webSocketAuthenticationTimeoutMs,
    }),
  ] as const;

  for (const gatewayPolicy of mismatches) {
    const incoming = {
      method: "GET",
      headers: {
        origin: RENDERER_ORIGIN,
        authorization: `Bearer ${listenerPolicy.accessToken}`,
      },
    } as unknown as IncomingMessage;
    const admission = authorizeDesktopRuntimeWebSocketUpgrade(incoming, listenerPolicy);
    assert.equal(admission.kind, "preauthorized");
    if (admission.kind !== "preauthorized") throw new Error("expected preauthorization");
    assert.equal(
      applyDesktopRuntimeWebSocketUpgradeAuthorization(incoming, admission.authorization),
      true,
    );

    const socket = new FakeAuthenticationSocket();
    const server = createAuthenticatedNoServerWebSocketServer({
      authPolicy: gatewayPolicy,
      webSocketServer: {
        handleUpgrade(
          requestValue: IncomingMessage,
          _networkSocket: object,
          _head: Uint8Array,
          callback: (webSocket: FakeAuthenticationSocket, request: IncomingMessage) => void,
        ) {
          callback(socket, requestValue);
        },
      },
    });
    let accepted = 0;
    server.handleUpgrade(incoming, {}, new Uint8Array(), () => {
      accepted += 1;
    });
    assert.equal(accepted, 0);
    assert.deepEqual(socket.sent, []);
    socket.emit("close");
  }
});

test("invalid HTTP Upgrade Bearers fail closed while missing Bearers retain direct desktop auth", () => {
  const policy = authPolicy();
  assert.deepEqual(
    authorizeDesktopRuntimeWebSocketUpgrade(
      {
        method: "GET",
        headers: { origin: RENDERER_ORIGIN, authorization: "Bearer wrong-secret" },
      } as Pick<IncomingMessage, "method" | "headers">,
      policy,
    ),
    { kind: "rejected" },
  );
  assert.deepEqual(
    authorizeDesktopRuntimeWebSocketUpgrade(
      { method: "GET", headers: { origin: RENDERER_ORIGIN } } as Pick<
        IncomingMessage,
        "method" | "headers"
      >,
      policy,
    ),
    { kind: "legacy" },
  );
});

test("never delegates when the transport closes or acknowledgement send fails", () => {
  const policy = authPolicy();
  const closed = decoratedSocket(policy);
  closed.socket.emit("message", Buffer.from(authenticateFrame(policy)), false);
  closed.socket.emit("close");
  closed.socket.completeNextSend();
  assert.equal(closed.accepted(), 0);

  const failedSend = decoratedSocket(policy);
  failedSend.socket.emit("message", Buffer.from(authenticateFrame(policy)), false);
  failedSend.socket.completeNextSend(new Error("simulated send failure"));
  assert.equal(failedSend.accepted(), 0);
  assert.equal(failedSend.socket.closes[0]?.code, RuntimeWebSocketCloseCode.authenticationFailed);
  assert.equal(JSON.stringify(failedSend.socket.closes).includes(policy.accessToken), false);
});

test("sidecar WebSockets reject invalid, mismatched, and cross-instance first frames", () => {
  const policy = authPolicy();
  const scenarios = [
    { frame: "not-json", code: RuntimeWebSocketCloseCode.invalidAuthenticationFrame },
    {
      frame: authenticateFrame(policy, { protocolVersion: policy.protocolVersion + 1 }),
      code: RuntimeWebSocketCloseCode.protocolVersionMismatch,
    },
    {
      frame: authenticateFrame(policy, { instanceId: "runtime-two" }),
      code: RuntimeWebSocketCloseCode.authenticationFailed,
    },
    {
      frame: authenticateFrame(policy, { accessToken: "secret-two" }),
      code: RuntimeWebSocketCloseCode.authenticationFailed,
    },
  ] as const;

  for (const scenario of scenarios) {
    const { accepted, socket } = decoratedSocket(policy);
    socket.emit("message", Buffer.from(scenario.frame), false);
    assert.equal(accepted(), 0);
    assert.equal(socket.closes[0]?.code, scenario.code);
    assert.equal(JSON.stringify(socket.closes).includes(policy.accessToken), false);
    assert.equal(
      socket.sent.every((frame) => !frame.includes(policy.accessToken)),
      true,
    );
  }
});

test("sidecar WebSocket authentication timeout closes without invoking the gateway", () => {
  const timers = new FakeTimers();
  const policy = authPolicy();
  const { accepted, socket } = decoratedSocket(policy, { timers });
  assert.equal(timers.tasks[0]?.delayMs, policy.webSocketAuthenticationTimeoutMs);
  timers.runNext();
  assert.equal(accepted(), 0);
  assert.equal(socket.closes[0]?.code, RuntimeWebSocketCloseCode.authenticationTimeout);
  assert.equal(
    JSON.stringify({ sent: socket.sent, closes: socket.closes }).includes("secret-one"),
    false,
  );
});

test("shares an explicit pending-authentication admission limit across gateways", () => {
  const policy = authPolicy();
  const authenticationAdmission = createRuntimeWebSocketAuthenticationAdmission(1);
  const first = decoratedSocket(policy, { authenticationAdmission });
  const second = decoratedSocket(policy, { authenticationAdmission });

  assert.equal(first.socket.closes.length, 0);
  assert.deepEqual(second.socket.closes, [
    { code: 1013, reason: "Runtime WebSocket authentication capacity reached." },
  ]);
  assert.equal(first.accepted(), 0);
  assert.equal(second.accepted(), 0);

  first.socket.emit("close");
  const afterRelease = decoratedSocket(policy, { authenticationAdmission });
  assert.equal(afterRelease.socket.closes.length, 0);
  assert.equal(afterRelease.accepted(), 0);
});

test("authenticates against the real ws no-server callback and emits ack before delegation", async () => {
  const policy = authPolicy();
  const rawServer = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const authenticatedServer = createAuthenticatedNoServerWebSocketServer({
    authPolicy: policy,
    webSocketServer: rawServer,
  });
  let accepted = 0;
  let resolveAccepted: (() => void) | undefined;
  const acceptedPromise = new Promise<void>((resolve) => {
    resolveAccepted = resolve;
  });
  const httpServer = createServer();
  httpServer.on("upgrade", (requestValue, socket, head) => {
    authenticatedServer.handleUpgrade(requestValue, socket, head, () => {
      accepted += 1;
      resolveAccepted?.();
    });
  });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const { port } = httpServer.address() as AddressInfo;
  const client = new WebSocket(`ws://127.0.0.1:${port}/api/events.mux`);

  try {
    await once(client, "open");
    assert.equal(accepted, 0);
    assert.equal(rawServer.clients.size, 1, "pending auth sockets remain visible to shutdown");
    client.send(authenticateFrame(policy));
    const [rawAcknowledgement] = await once(client, "message");
    await acceptedPromise;
    assert.equal(accepted, 1);
    const acknowledgement = JSON.parse(rawAcknowledgement.toString()) as Record<string, unknown>;
    assert.equal(acknowledgement.type, "authenticated");
    assert.equal(acknowledgement.instanceId, policy.instanceId);
    assert.equal(rawAcknowledgement.toString().includes(policy.accessToken), false);
  } finally {
    client.close();
    if (client.readyState !== WebSocket.CLOSED) await once(client, "close");
    await new Promise<void>((resolve) => rawServer.close(() => resolve()));
    await new Promise<void>((resolve, reject) =>
      httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
