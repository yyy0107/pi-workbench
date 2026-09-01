require("tsx/cjs");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomBytes, randomUUID } = require("node:crypto");
const { EventEmitter } = require("node:events");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const {
  RUNTIME_HOST_HEALTH_PATH,
  RUNTIME_HOST_IDENTITY_PATH,
  RuntimeHostControlNdjsonDecoder,
  RuntimeHostShutdownReason,
  createRuntimeHostShutdownFrame,
  createRuntimeHostStartFrame,
  encodeRuntimeHostControlInputFrame,
  parseRuntimeHostControlOutputFrame,
  parseRuntimeHostHealth,
  parseRuntimeHostIdentity,
  parseRuntimeHostReadyFrame,
  parseRuntimeHostShutdownAckFrame,
} = require("@workbench/host-contracts/runtime-host-control");
const { defineRuntimeConnection } = require("@workbench/host-contracts/runtime-connection");
const { createRuntimeWebSocket } = require("@workbench/host-client/runtime-websocket");

const { registerServerProcess, stopServerProcess } = require("../src/server-process-lifecycle.cjs");
const {
  assertExactTarget,
  electronRuntimeTargetFromIdentity,
  readElectronRuntimeIdentity,
} = require("./native-runtime.cjs");
const {
  resolveDesktopRuntimeArtifact,
  resolveStagedDesktopRuntimeArtifact,
} = require("./runtime-artifact-admission.cjs");
const {
  DEFAULT_OPERATION_TIMEOUT_MS,
  DEFAULT_READY_TIMEOUT_MS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  assertEmptySessionList,
  assertIsolatedHostDescription,
  callRpc,
  createTerminalChallenge,
  smokePiWebSocketPair,
  smokeTerminalWebSocket,
  stagedHostEnvironment,
  terminalShellEnvironment,
  terminalWebSocketUrl,
  withTimeout,
} = require("./runtime-smoke-support.cjs");

const RESULT_TYPE = "workbench-staged-api-only-runtime-smoke";
const ERROR_TYPE = "workbench-staged-api-only-runtime-smoke-error";
const DEFAULT_ALLOWED_ORIGIN = "http://renderer.workbench.smoke.invalid";
const DEFAULT_CLEANUP_TIMEOUT_MS = 10_000;

function runtimeArgument(arguments_ = process.argv.slice(2)) {
  if (arguments_.length !== 2 || arguments_[0] !== "--runtime") {
    throw new Error(
      "Usage: staged-api-only-runtime-smoke.cjs --runtime <desktop-runtime-directory>",
    );
  }
  return path.resolve(arguments_[1]);
}

function defaultTimers() {
  return { clearTimeout, setTimeout };
}

function credentialText(value) {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function redactCredential(value, accessToken) {
  const text = credentialText(value);
  return accessToken && text.includes(accessToken)
    ? text.split(accessToken).join("[REDACTED]")
    : text;
}

function assertCredentialAbsent(value, accessToken, label) {
  if (credentialText(value).includes(accessToken)) {
    throw new Error(`${label} contained the Runtime Host credential.`);
  }
}

function safeOperationError(error, accessToken) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Staged API-only Runtime smoke operation failed.";
  return new Error(redactCredential(message, accessToken));
}

function createCredentialStreamMonitor(stream, accessToken, label) {
  let tail = "";
  let failure;
  const retainedLength = Math.max(0, accessToken.length - 1);
  stream?.on?.("data", (chunk) => {
    const combined = `${tail}${credentialText(chunk)}`;
    if (combined.includes(accessToken)) {
      failure = new Error(`${label} contained the Runtime Host credential.`);
    }
    tail = retainedLength === 0 ? "" : combined.slice(-retainedLength);
  });
  stream?.once?.("error", () => {
    failure ??= new Error(`${label} could not be drained.`);
  });
  return {
    assertSafe() {
      if (failure) throw failure;
    },
  };
}

function createRuntimeControlChannel(child, accessToken, { timeoutMs, timers }) {
  const decoder = new RuntimeHostControlNdjsonDecoder();
  const queuedFrames = [];
  const frameWaiters = [];
  let failure;
  let stdoutTail = "";
  const retainedLength = Math.max(0, accessToken.length - 1);

  const fail = (error) => {
    if (failure) return;
    failure = safeOperationError(error, accessToken);
    for (const waiter of frameWaiters.splice(0)) waiter.reject(failure);
  };
  const deliver = (frame) => {
    const waiter = frameWaiters.shift();
    if (waiter) waiter.resolve(frame);
    else queuedFrames.push(frame);
  };

  child.stdout?.on?.("data", (chunk) => {
    const combined = `${stdoutTail}${credentialText(chunk)}`;
    if (combined.includes(accessToken)) {
      fail(new Error("Runtime Host control stdout contained the Runtime Host credential."));
      return;
    }
    stdoutTail = retainedLength === 0 ? "" : combined.slice(-retainedLength);
    try {
      for (const record of decoder.push(chunk)) {
        const frame = parseRuntimeHostControlOutputFrame(record);
        if (!frame) {
          fail(new Error("Runtime Host control stdout sent an invalid output frame."));
          return;
        }
        deliver(frame);
      }
    } catch {
      fail(new Error("Runtime Host control stdout sent invalid NDJSON."));
    }
  });
  child.stdout?.once?.("error", () => {
    fail(new Error("Runtime Host control stdout failed."));
  });
  child.stdout?.once?.("end", () => {
    try {
      decoder.finish();
    } catch {
      fail(new Error("Runtime Host control stdout ended with incomplete NDJSON."));
    }
    if (frameWaiters.length > 0) {
      fail(new Error("Runtime Host control stdout ended before the expected frame."));
    }
  });
  child.once?.("error", () => {
    fail(new Error("Staged API-only Runtime Host process failed."));
  });

  return {
    assertDrained() {
      if (failure) throw failure;
      if (queuedFrames.length > 0) {
        throw new Error("Runtime Host control stdout sent an unexpected trailing frame.");
      }
    },
    async send(frame, label, operationTimeoutMs = timeoutMs) {
      if (failure) throw failure;
      const encoded = encodeRuntimeHostControlInputFrame(frame);
      const write = new Promise((resolve, reject) => {
        try {
          if (!child.stdin || child.stdin.destroyed) {
            reject(new Error("Runtime Host control stdin is unavailable."));
            return;
          }
          child.stdin.write(encoded, (error) => {
            if (error) reject(new Error("Runtime Host control stdin write failed."));
            else resolve();
          });
        } catch {
          reject(new Error("Runtime Host control stdin write failed."));
        }
      });
      await withTimeout(write, label, operationTimeoutMs, timers);
      if (failure) throw failure;
    },
    async next(label, operationTimeoutMs = timeoutMs) {
      if (failure) throw failure;
      if (queuedFrames.length > 0) return queuedFrames.shift();
      return withTimeout(
        new Promise((resolve, reject) => frameWaiters.push({ reject, resolve })),
        label,
        operationTimeoutMs,
        timers,
      );
    },
  };
}

function observeProcessClose(child) {
  return new Promise((resolve) => {
    child.once("error", () => resolve({ failed: true }));
    child.once("close", (code, signal) => resolve({ code, failed: false, signal }));
  });
}

function waitForExit(child, { timeoutMs, timers }) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return withTimeout(
    new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }),
    "Staged API-only Runtime Host shutdown",
    timeoutMs,
    timers,
  );
}

async function withAbortTimeout(run, label, timeoutMs, timers) {
  const controller = new AbortController();
  try {
    return await withTimeout(run(controller.signal), label, timeoutMs, timers);
  } finally {
    controller.abort();
  }
}

function responseHeader(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name);
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value.join(", ") : value;
}

async function requestRuntimeJson(fetchImpl, url, init, { label, timeoutMs, timers }) {
  return withAbortTimeout(
    async (signal) => {
      const response = await fetchImpl(url, { ...init, signal });
      const body = await response.text();
      let value;
      try {
        value = JSON.parse(body);
      } catch {
        value = undefined;
      }
      return { headers: response.headers, ok: response.ok, status: response.status, value };
    },
    label,
    timeoutMs,
    timers,
  );
}

async function requestRuntimeText(fetchImpl, url, init, { label, timeoutMs, timers }) {
  return withAbortTimeout(
    async (signal) => {
      const response = await fetchImpl(url, { ...init, signal });
      const body = await response.text();
      return { body, headers: response.headers, status: response.status };
    },
    label,
    timeoutMs,
    timers,
  );
}

function authenticatedHeaders(accessToken, allowedOrigin) {
  return { Authorization: `Bearer ${accessToken}`, Origin: allowedOrigin };
}

async function probeAuthenticatedRuntimeHttp(
  fetchImpl,
  ready,
  accessToken,
  allowedOrigin,
  { timeoutMs, timers },
) {
  const headers = authenticatedHeaders(accessToken, allowedOrigin);
  const health = await requestRuntimeJson(
    fetchImpl,
    new URL(RUNTIME_HOST_HEALTH_PATH, ready.httpOrigin),
    { headers },
    { label: "Runtime Host health", timeoutMs, timers },
  );
  const parsedHealth = health.status === 200 ? parseRuntimeHostHealth(health.value) : undefined;
  if (
    !health.ok ||
    !parsedHealth ||
    parsedHealth.instanceId !== ready.instanceId ||
    parsedHealth.hostProtocolVersion !== ready.hostProtocolVersion ||
    responseHeader(health.headers, "access-control-allow-origin") !== allowedOrigin
  ) {
    throw new Error(
      "Runtime Host health endpoint did not return its exact authenticated identity.",
    );
  }

  const identity = await requestRuntimeJson(
    fetchImpl,
    new URL(RUNTIME_HOST_IDENTITY_PATH, ready.httpOrigin),
    { headers },
    { label: "Runtime Host identity", timeoutMs, timers },
  );
  const parsedIdentity =
    identity.status === 200 ? parseRuntimeHostIdentity(identity.value) : undefined;
  if (
    !identity.ok ||
    !parsedIdentity ||
    parsedIdentity.instanceId !== ready.instanceId ||
    parsedIdentity.pid !== ready.pid ||
    parsedIdentity.hostProtocolVersion !== ready.hostProtocolVersion ||
    responseHeader(identity.headers, "access-control-allow-origin") !== allowedOrigin
  ) {
    throw new Error(
      "Runtime Host identity endpoint did not return its exact authenticated identity.",
    );
  }

  const missingBearer = await requestRuntimeText(
    fetchImpl,
    new URL(RUNTIME_HOST_HEALTH_PATH, ready.httpOrigin),
    { headers: { Origin: allowedOrigin } },
    { label: "Runtime Host missing bearer rejection", timeoutMs, timers },
  );
  if (
    missingBearer.status !== 401 ||
    missingBearer.body !== "Unauthorized" ||
    responseHeader(missingBearer.headers, "www-authenticate") !== "Bearer" ||
    responseHeader(missingBearer.headers, "access-control-allow-origin") !== allowedOrigin
  ) {
    throw new Error("Runtime Host did not reject an allowed Origin without a bearer credential.");
  }

  const maliciousOrigin = await requestRuntimeText(
    fetchImpl,
    new URL(RUNTIME_HOST_IDENTITY_PATH, ready.httpOrigin),
    {
      headers: authenticatedHeaders(accessToken, "https://malicious.invalid"),
    },
    { label: "Runtime Host malicious Origin rejection", timeoutMs, timers },
  );
  if (
    maliciousOrigin.status !== 403 ||
    maliciousOrigin.body !== "Forbidden" ||
    responseHeader(maliciousOrigin.headers, "access-control-allow-origin") !== null
  ) {
    throw new Error("Runtime Host did not reject a malicious Origin.");
  }
}

function createAuthenticatedWebSocketConstructor({
  WebSocketImpl,
  accessToken,
  allowedOrigin,
  connection,
  timeoutMs,
  timers,
}) {
  return function StagedAuthenticatedWebSocket(url) {
    assertCredentialAbsent(url, accessToken, "Runtime WebSocket URL");
    const requested = new URL(url);
    const runtimePath = `${requested.pathname}${requested.search}`;
    const events = new EventEmitter();
    const socket = createRuntimeWebSocket(connection, runtimePath, {
      authenticationTimeoutMs: timeoutMs,
      timers,
      webSocketFactory: (resolvedUrl) => {
        assertCredentialAbsent(resolvedUrl, accessToken, "Runtime WebSocket URL");
        return new WebSocketImpl(resolvedUrl, { origin: allowedOrigin });
      },
    });
    socket.onopen = (event) => events.emit("open", event);
    socket.onmessage = (event) => events.emit("message", event.data);
    socket.onerror = (event) => {
      const code = event && typeof event === "object" ? event.code : undefined;
      events.emit(
        "error",
        new Error(
          `Runtime WebSocket authentication or transport failed${code ? ` (${code})` : ""}.`,
        ),
      );
    };
    socket.onclose = (event) => events.emit("close", event?.code, event?.reason);
    events.send = (data) => socket.send(data);
    events.close = (code, reason) => socket.close(code, reason);
    return events;
  };
}

function endControlInput(child) {
  try {
    child.stdin?.end?.();
  } catch {
    // The acknowledged shutdown and process exit remain authoritative.
  }
}

async function runStagedApiOnlyRuntimeSmoke({
  runtimeDirectory,
  runtimeArtifact,
  target,
  environment = process.env,
  electronExecutable = require("electron"),
  nodeExecutable = process.execPath,
  fetchImpl = fetch,
  WebSocketImpl = require("ws"),
  spawnChild = spawn,
  createAccessToken = () => randomBytes(32).toString("base64url"),
  createId = randomUUID,
  mkdtemp = mkdtempSync,
  platform = process.platform,
  remove = rmSync,
  stopProcess = stopServerProcess,
  temporaryDirectory = tmpdir(),
  timers = defaultTimers(),
  writeFile = writeFileSync,
  allowedOrigin = DEFAULT_ALLOWED_ORIGIN,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  cleanupTimeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
  childWorkingDirectory,
  onReady = async () => undefined,
  readIdentity = readElectronRuntimeIdentity,
  resolveArtifact = resolveDesktopRuntimeArtifact,
} = {}) {
  if (typeof runtimeDirectory !== "string" || runtimeDirectory.length === 0) {
    throw new Error("A staged Runtime artifact directory is required.");
  }
  // Electron's embedded Node version and modules ABI are authoritative. Validate the manifest and
  // complete relocated tree before creating state or spawning the API-only Host.
  const measuredTarget = electronRuntimeTargetFromIdentity(
    readIdentity({ electronExecutable, environment }),
  );
  const expectedTarget = target ?? measuredTarget;
  assertExactTarget(measuredTarget, expectedTarget);
  const artifact = await resolveStagedDesktopRuntimeArtifact({
    runtimeDirectory,
    runtimeArtifact,
    expectedTarget,
    resolveArtifact,
  });
  assertExactTarget(artifact.manifest.target, expectedTarget);
  const stateRoot = mkdtemp(path.join(temporaryDirectory, "workbench-staged-api-runtime-smoke-"));
  const startedAt = Date.now();
  let accessToken;
  let child;
  let report;
  let operationFailure;
  let successful = false;
  let cleanupFailure;
  let piSockets = [];
  let terminalSocket;
  let stderrMonitor;
  let control;
  let processClose;

  try {
    accessToken = createAccessToken();
    const startFrame = createRuntimeHostStartFrame({
      accessToken,
      allowedOrigins: [allowedOrigin],
    });
    const shellEnvironment = terminalShellEnvironment(stateRoot, { nodeExecutable, writeFile });
    const childEnvironment = stagedHostEnvironment(environment, stateRoot, shellEnvironment);
    childEnvironment.WORKBENCH_RUNTIME_MANAGED_CHILD = "1";
    const childArguments = [artifact.entrypoint];
    assertCredentialAbsent(childArguments, accessToken, "Runtime Host argv");
    assertCredentialAbsent(childEnvironment, accessToken, "Runtime Host environment");

    child = spawnChild(electronExecutable, childArguments, {
      // Unit/conformance calls default to an unrelated cwd. Packaging passes the staged
      // desktop-runtime root to additionally prove the exact release working directory.
      cwd: childWorkingDirectory ?? stateRoot,
      env: childEnvironment,
      stdio: ["pipe", "pipe", "pipe"],
      detached: platform !== "win32",
      windowsHide: true,
    });
    registerServerProcess(child, { platform });
    if (!child) throw new Error("Staged API-only Runtime Host process did not start.");
    processClose = observeProcessClose(child);
    if (!child.stdin || !child.stdout || !child.stderr) {
      throw new Error("Staged API-only Runtime Host requires piped stdin, stdout, and stderr.");
    }
    stderrMonitor = createCredentialStreamMonitor(child.stderr, accessToken, "Runtime Host stderr");
    control = createRuntimeControlChannel(child, accessToken, {
      timeoutMs: readyTimeoutMs,
      timers,
    });
    await control.send(startFrame, "Runtime Host start control frame");
    const readyOutput = await control.next("Runtime Host ready control frame");
    stderrMonitor.assertSafe();
    const ready = parseRuntimeHostReadyFrame(readyOutput);
    if (!ready || ready.pid !== child.pid || ready.instanceId === accessToken) {
      throw new Error("Runtime Host did not emit the exact expected ready frame.");
    }
    assertCredentialAbsent(ready, accessToken, "Runtime Host ready frame");
    assertCredentialAbsent(ready.httpOrigin, accessToken, "Runtime Host URL");

    await withTimeout(
      Promise.resolve().then(() =>
        onReady(
          Object.freeze({
            ready,
            runtimeArtifact: artifact,
          }),
        ),
      ),
      "Runtime Host ready checkpoint",
      operationTimeoutMs,
      timers,
    );

    await probeAuthenticatedRuntimeHttp(fetchImpl, ready, accessToken, allowedOrigin, {
      timeoutMs: operationTimeoutMs,
      timers,
    });
    stderrMonitor.assertSafe();

    const rpcHeaders = authenticatedHeaders(accessToken, allowedOrigin);
    const hostDescription = await withAbortTimeout(
      (signal) =>
        callRpc(fetchImpl, ready.httpOrigin, "host.describe", {
          headers: rpcHeaders,
          signal,
          timeoutMs: operationTimeoutMs,
          timers,
        }),
      "host.describe authenticated RPC",
      operationTimeoutMs,
      timers,
    );
    assertIsolatedHostDescription(hostDescription, childWorkingDirectory ?? stateRoot, stateRoot);
    const sessionList = await withAbortTimeout(
      (signal) =>
        callRpc(fetchImpl, ready.httpOrigin, "session.list", {
          headers: rpcHeaders,
          signal,
          timeoutMs: operationTimeoutMs,
          timers,
        }),
      "session.list authenticated RPC",
      operationTimeoutMs,
      timers,
    );
    assertEmptySessionList(sessionList);
    stderrMonitor.assertSafe();

    const connection = defineRuntimeConnection({
      kind: "desktop-sidecar",
      protocolVersion: ready.hostProtocolVersion,
      httpOrigin: ready.httpOrigin,
      instanceId: ready.instanceId,
      accessToken,
    });
    const AuthenticatedWebSocket = createAuthenticatedWebSocketConstructor({
      WebSocketImpl,
      accessToken,
      allowedOrigin,
      connection,
      timeoutMs: operationTimeoutMs,
      timers,
    });
    const pi = smokePiWebSocketPair(AuthenticatedWebSocket, ready.httpOrigin, {
      timeoutMs: operationTimeoutMs,
      timers,
    });
    piSockets = pi.sockets();
    await pi.complete;
    stderrMonitor.assertSafe();

    const sessionId = `stage-api-smoke-${createId()}`;
    const challenge = createTerminalChallenge({ createId, platform });
    const terminalUrl = terminalWebSocketUrl(ready.httpOrigin, stateRoot, sessionId);
    assertCredentialAbsent(terminalUrl, accessToken, "Terminal WebSocket URL");
    const terminal = smokeTerminalWebSocket(AuthenticatedWebSocket, terminalUrl, {
      challenge,
      timeoutMs: operationTimeoutMs,
      timers,
    });
    terminalSocket = terminal.socket();
    const terminalResult = await terminal.complete;
    stderrMonitor.assertSafe();

    const exitPromise = waitForExit(child, { timeoutMs: shutdownTimeoutMs, timers });
    await control.send(
      createRuntimeHostShutdownFrame({
        reason: RuntimeHostShutdownReason.requested,
        deadlineMs: shutdownTimeoutMs,
      }),
      "Runtime Host shutdown control frame",
      shutdownTimeoutMs,
    );
    const shutdownOutput = await control.next(
      "Runtime Host shutdown acknowledgement",
      shutdownTimeoutMs,
    );
    if (!parseRuntimeHostShutdownAckFrame(shutdownOutput)) {
      throw new Error("Runtime Host did not emit the exact shutdown acknowledgement.");
    }
    assertCredentialAbsent(shutdownOutput, accessToken, "Runtime Host shutdown acknowledgement");
    endControlInput(child);
    const exit = await exitPromise;
    assert.equal(exit.signal, null, "Runtime Host shutdown must not be signal-terminated.");
    assert.equal(exit.code, 0, "Runtime Host shutdown must exit 0.");
    const closed = await withTimeout(
      processClose,
      "Staged API-only Runtime Host stdio close",
      shutdownTimeoutMs,
      timers,
    );
    if (closed.failed || closed.signal !== null || closed.code !== 0) {
      throw new Error("Runtime Host stdio did not close after its clean exit.");
    }
    control.assertDrained();
    stderrMonitor.assertSafe();

    report = {
      type: RESULT_TYPE,
      durationMs: Date.now() - startedAt,
      control: ["start:stdin", "ready", "shutdown:stdin", "shutdown-ack", "exit:0"],
      http: ["health:200", "identity:200", "missing-bearer:401", "malicious-origin:403"],
      ready: {
        hostProtocolVersion: ready.hostProtocolVersion,
        httpOrigin: ready.httpOrigin,
        pid: ready.pid,
      },
      runtimeArtifact: {
        manifest: path.basename(artifact.manifestPath),
        target: artifact.manifest.target,
      },
      rpc: ["host.describe", "session.list"],
      terminal: { processHandle: terminalResult.processHandle },
      webSocket: [
        "events.host:authenticated:1000",
        "events.mux:authenticated:1008",
        "terminal:authenticated:1000",
      ],
    };
    assertCredentialAbsent(report, accessToken, "Runtime Host smoke result");
    successful = true;
  } catch (error) {
    try {
      control?.assertDrained();
      stderrMonitor?.assertSafe();
      operationFailure = safeOperationError(error, accessToken);
    } catch (diagnosticError) {
      operationFailure = safeOperationError(diagnosticError, accessToken);
    }
  }

  for (const socket of piSockets) {
    try {
      socket?.close?.();
    } catch {}
  }
  try {
    terminalSocket?.close?.();
  } catch {}
  if (!successful && child) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        const stopped = await withTimeout(
          stopProcess(child, { platform }),
          "Staged API-only Runtime Host forced cleanup",
          cleanupTimeoutMs,
          timers,
        );
        if (stopped?.exited !== true || (child.exitCode === null && child.signalCode === null)) {
          cleanupFailure = new Error(
            `Staged API-only Runtime Host could not be stopped; isolated smoke state was retained at ${redactCredential(stateRoot, accessToken)}.`,
          );
        }
      } catch {
        cleanupFailure = new Error(
          `Staged API-only Runtime Host stop failed; isolated smoke state was retained at ${redactCredential(stateRoot, accessToken)}.`,
        );
      }
    }
    if (!cleanupFailure && processClose) {
      try {
        const closed = await withTimeout(
          processClose,
          "Staged API-only Runtime Host cleanup stdio close",
          cleanupTimeoutMs,
          timers,
        );
        if (closed.failed) {
          cleanupFailure = new Error(
            `Staged API-only Runtime Host stdio failed to close; isolated smoke state was retained at ${redactCredential(stateRoot, accessToken)}.`,
          );
        }
      } catch {
        cleanupFailure = new Error(
          `Staged API-only Runtime Host stdio did not close; isolated smoke state was retained at ${redactCredential(stateRoot, accessToken)}.`,
        );
      }
    }
  }
  try {
    control?.assertDrained();
    stderrMonitor?.assertSafe();
  } catch (diagnosticError) {
    operationFailure = safeOperationError(diagnosticError, accessToken);
  }
  if (!cleanupFailure) {
    try {
      remove(stateRoot, { force: true, recursive: true });
    } catch {
      cleanupFailure = new Error(
        `Failed to remove isolated API-only Runtime smoke state at ${redactCredential(stateRoot, accessToken)}.`,
      );
    }
  }
  if (operationFailure && cleanupFailure) {
    throw new AggregateError(
      [operationFailure, cleanupFailure],
      `Staged API-only Runtime smoke failed; ${cleanupFailure.message}`,
    );
  }
  if (operationFailure) throw operationFailure;
  if (cleanupFailure) throw cleanupFailure;
  return report;
}

if (require.main === module) {
  void Promise.resolve()
    .then(() => runStagedApiOnlyRuntimeSmoke({ runtimeDirectory: runtimeArgument() }))
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({
          type: ERROR_TYPE,
          message: error instanceof Error ? error.message : "Staged API-only Runtime smoke failed.",
        })}\n`,
      );
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_ALLOWED_ORIGIN,
  DEFAULT_CLEANUP_TIMEOUT_MS,
  ERROR_TYPE,
  RESULT_TYPE,
  createAuthenticatedWebSocketConstructor,
  probeAuthenticatedRuntimeHttp,
  runStagedApiOnlyRuntimeSmoke,
  runtimeArgument,
};
