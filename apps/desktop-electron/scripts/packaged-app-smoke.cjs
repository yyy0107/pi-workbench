require("tsx/cjs");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const {
  RUNTIME_HOST_IDENTITY_PATH,
  parseRuntimeHostIdentity,
} = require("@workbench/host-contracts/runtime-host-control");
const { defineRuntimeConnection } = require("@workbench/host-contracts/runtime-connection");

const { stopServerProcess } = require("../src/server-process-lifecycle.cjs");
const { resolveDesktopArtifactLayout } = require("./desktop-artifact-layout.cjs");
const {
  createAuthenticatedWebSocketConstructor,
  probeAuthenticatedRuntimeHttp,
} = require("./staged-api-only-runtime-smoke.cjs");
const {
  DEFAULT_OPERATION_TIMEOUT_MS,
  DEFAULT_READY_TIMEOUT_MS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  TERMINAL_MARKER,
  assertEmptySessionList,
  assertIsolatedHostDescription,
  callRpc,
  createSmokeStateDirectory,
  smokePiWebSocketPair,
  smokeTerminalWebSocket,
  stateEnvironment,
  terminalWebSocketUrl,
  withTimeout,
} = require("./runtime-smoke-support.cjs");

const RESULT_TYPE = "workbench-packaged-app-smoke";
const MAX_PRE_BOOTSTRAP_DIAGNOSTIC_BYTES = 8 * 1024 * 1024;
const MAX_POST_BOOTSTRAP_DIAGNOSTIC_BYTES = 8 * 1024 * 1024;
const MAX_DIAGNOSTIC_LINE_TAIL_BYTES = 64 * 1024;
const MAX_RENDERER_DEBUGGER_LIST_BYTES = 1024 * 1024;
const DEFAULT_CLEANUP_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const TITLE_BAR_PROBE = Object.freeze({ color: "#123456", symbolColor: "#fedcba" });
const PACKAGED_SMOKE_OWNER_FRAME_TYPE = "workbench:packaged-smoke-owner";
const PACKAGED_SMOKE_OWNER_ACK_FRAME_TYPE = "workbench:packaged-smoke-owner-ack";
const PACKAGED_SMOKE_OWNER_FRAME_VERSION = 1;

function defaultTimers() {
  return { clearInterval, clearTimeout, setInterval, setTimeout };
}

function isPathInside(rootDirectory, candidatePath) {
  const relative = path.relative(path.resolve(rootDirectory), path.resolve(candidatePath));
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function assertCanonicalDirectory(directory, label) {
  const resolved = path.resolve(directory);
  const stats = lstatSync(resolved);
  if (!stats.isDirectory() || stats.isSymbolicLink() || realpathSync(resolved) !== resolved) {
    throw new Error(`${label} must be a canonical real directory.`);
  }
  return resolved;
}

function assertCanonicalRegularFile(filePath, label, { executable = false } = {}) {
  const resolved = path.resolve(filePath);
  const stats = lstatSync(resolved);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    realpathSync(resolved) !== resolved ||
    (executable && (stats.mode & 0o111) === 0)
  ) {
    throw new Error(`${label} must be a canonical${executable ? " executable" : ""} regular file.`);
  }
  return resolved;
}

function linuxUnpackedDirectoryName(arch) {
  if (arch === "x64") return "linux-unpacked";
  if (["arm64", "armv7l", "ia32"].includes(arch)) return `linux-${arch}-unpacked`;
  throw new Error(`The packaged-app smoke does not recognize Linux architecture ${arch}.`);
}

/**
 * The Phase 7 packaged-app execution contract is deliberately Linux-native.
 *
 * It relies on Xvfb, /proc start-time identities, and isolated POSIX process
 * groups to prove that the packaged Window, renderer bridge, Runtime,
 * PTY, and every child process clean up safely.  A target that cannot execute
 * under that exact contract must never be passed to this runner: a successful
 * electron-builder invocation is useful artifact evidence, but it is not a
 * substitute for a native packaged-app execution result.
 */
function resolvePackagedAppSmokeContract(
  target,
  { hostArch = process.arch, hostPlatform = process.platform } = {},
) {
  if (
    !target ||
    !["darwin", "linux", "win32"].includes(target.platform) ||
    typeof target.arch !== "string" ||
    target.arch.length === 0
  ) {
    throw new Error("Packaged-app smoke requires a recognized target platform and architecture.");
  }
  if (target.platform === "linux" && hostPlatform === "linux" && target.arch === hostArch) {
    return Object.freeze({
      execution: "required",
      reason: "Linux packaged-app execution contract is native to this host.",
    });
  }
  if (target.platform !== hostPlatform || target.arch !== hostArch) {
    return Object.freeze({
      execution: "not-run",
      reason:
        "cross-target artifact; the Linux packaged-app execution contract cannot safely launch it.",
    });
  }
  return Object.freeze({
    execution: "not-run",
    reason:
      "this host platform has no implemented packaged-app execution and fail-closed cleanup contract.",
  });
}

async function resolveLinuxPackagedApplication(
  outputDirectory,
  { expectedTarget, expectedRendererBuildId, resolveLayout = resolveDesktopArtifactLayout } = {},
) {
  const contract = resolvePackagedAppSmokeContract(expectedTarget);
  if (contract.execution !== "required") {
    throw new Error(`The packaged-app smoke cannot launch this target: ${contract.reason}`);
  }
  const outputRoot = assertCanonicalDirectory(outputDirectory, "Electron output root");
  const appOutDirectory = assertCanonicalDirectory(
    path.join(outputRoot, linuxUnpackedDirectoryName(expectedTarget.arch)),
    "Electron unpacked app root",
  );
  if (!isPathInside(outputRoot, appOutDirectory)) {
    throw new Error("Electron unpacked app root escapes the output root.");
  }
  const resourcesDirectory = assertCanonicalDirectory(
    path.join(appOutDirectory, "resources"),
    "Electron unpacked Resources root",
  );
  const runtimeDirectory = assertCanonicalDirectory(
    path.join(resourcesDirectory, "desktop-runtime"),
    "Packaged desktop Runtime root",
  );
  const layout = await resolveLayout(runtimeDirectory, {
    expectedTarget,
    expectedRendererBuildId,
  });
  const appManifestPath = assertCanonicalRegularFile(
    path.join(resourcesDirectory, "app", "package.json"),
    "Packaged Electron app manifest",
  );
  const appManifest = JSON.parse(readFileSync(appManifestPath, "utf8"));
  if (
    typeof appManifest.name !== "string" ||
    !/^[a-z0-9][a-z0-9._-]*$/u.test(appManifest.name) ||
    appManifest.name === "." ||
    appManifest.name === ".."
  ) {
    throw new Error("Packaged Electron app manifest has an unsafe executable name.");
  }
  const executable = assertCanonicalRegularFile(
    path.join(appOutDirectory, appManifest.name),
    "Packaged Electron executable",
    { executable: true },
  );
  if (!isPathInside(appOutDirectory, executable)) {
    throw new Error("Packaged Electron executable escapes the unpacked app root.");
  }
  return Object.freeze({
    appOutDirectory,
    executable,
    layout,
    resourcesDirectory,
    runtimeDirectory,
  });
}

function createPackagedSmokeEnvironment(environment, stateRoot, display) {
  const inherited = { ...environment };
  for (const name of Object.keys(inherited)) {
    const normalized = name.toUpperCase();
    if (normalized.startsWith("NODE_") || normalized.startsWith("WORKBENCH_")) {
      delete inherited[name];
    }
  }
  delete inherited.ELECTRON_RUN_AS_NODE;
  delete inherited.ELECTRON_NO_ASAR;
  const state = stateEnvironment(stateRoot);
  return {
    ...inherited,
    ...state,
    DISPLAY: display,
    HOME: path.join(stateRoot, "home"),
    PI_CODING_AGENT_DIR: path.join(stateRoot, "agent"),
    PI_WORKBENCH_SETTINGS_FILE: path.join(stateRoot, "workbench-settings.json"),
    SHELL: "/bin/sh",
    XDG_CACHE_HOME: path.join(stateRoot, "xdg-cache"),
    XDG_CONFIG_HOME: path.join(stateRoot, "xdg-config"),
  };
}

function parseInspectorEndpoint(rawUrl, kind) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  const port = Number(url.port);
  const pathMatches =
    kind === "main"
      ? /^\/[0-9a-f-]+$/iu.test(url.pathname)
      : kind === "renderer"
        ? /^\/devtools\/browser\/[0-9a-f-]+$/iu.test(url.pathname)
        : kind === "renderer-target" && /^\/devtools\/page\/[0-9a-f-]+$/iu.test(url.pathname);
  if (
    url.protocol !== "ws:" ||
    url.hostname !== "127.0.0.1" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !pathMatches
  ) {
    return undefined;
  }
  return url.href;
}

function createPackagedOutputMonitor(child) {
  const endpoints = { main: undefined, renderer: undefined };
  const waiters = { main: [], renderer: [] };
  const credentials = [];
  let credentialFailure;
  let preBootstrapDiagnostics = Buffer.alloc(0);
  let postBootstrapDiagnostics = Buffer.alloc(0);
  let postBootstrapDiagnosticBytes = 0;
  const credentialTails = new Map();
  let expectedExit = false;
  let lineTail = "";
  let terminalFailure;

  const failWaiters = (error) => {
    terminalFailure ??= error;
    for (const kind of ["main", "renderer"]) {
      for (const waiter of waiters[kind].splice(0)) waiter.reject(terminalFailure);
    }
  };
  const deliver = (kind, value) => {
    if (endpoints[kind]) return;
    endpoints[kind] = value;
    for (const waiter of waiters[kind].splice(0)) waiter.resolve(value);
  };
  const scanLine = (line) => {
    const main = line.match(/Debugger listening on (ws:\/\/[^\s]+)/u)?.[1];
    const renderer = line.match(/DevTools listening on (ws:\/\/[^\s]+)/u)?.[1];
    if (main) {
      const endpoint = parseInspectorEndpoint(main, "main");
      if (endpoint) deliver("main", endpoint);
    }
    if (renderer) {
      const endpoint = parseInspectorEndpoint(renderer, "renderer");
      if (endpoint) deliver("renderer", endpoint);
    }
  };
  const scanCredential = (text, values = credentials) => {
    for (const credential of values) {
      const combined = `${credentialTails.get(credential) ?? ""}${text}`;
      if (combined.includes(credential)) {
        credentialFailure = new Error(
          "Packaged application diagnostics contained the Runtime credential.",
        );
      }
      credentialTails.set(credential, combined.slice(-Math.max(0, credential.length - 1)));
    }
  };
  const onData = (chunk) => {
    const data = Buffer.from(chunk);
    if (credentials.length === 0) {
      if (preBootstrapDiagnostics.length + data.length > MAX_PRE_BOOTSTRAP_DIAGNOSTIC_BYTES) {
        failWaiters(
          new Error("Packaged application emitted excessive diagnostics before Runtime bootstrap."),
        );
        return;
      }
      preBootstrapDiagnostics = Buffer.concat([preBootstrapDiagnostics, data]);
    } else {
      postBootstrapDiagnosticBytes += data.length;
      if (postBootstrapDiagnosticBytes > MAX_POST_BOOTSTRAP_DIAGNOSTIC_BYTES) {
        failWaiters(
          new Error("Packaged application emitted excessive diagnostics after Runtime bootstrap."),
        );
        return;
      }
      postBootstrapDiagnostics = Buffer.concat([postBootstrapDiagnostics, data]);
      scanCredential(data.toString("utf8"));
    }
    const combinedLines = `${lineTail}${data.toString("utf8")}`;
    const lines = combinedLines.split(/\r?\n/u);
    lineTail = lines.pop() ?? "";
    if (Buffer.byteLength(lineTail, "utf8") > MAX_DIAGNOSTIC_LINE_TAIL_BYTES) {
      failWaiters(
        new Error("Packaged application emitted an excessive unterminated diagnostic line."),
      );
      return;
    }
    for (const line of lines) scanLine(line);
  };

  child.stdout?.on?.("data", onData);
  child.stderr?.on?.("data", onData);
  child.once?.("error", () => failWaiters(new Error("Packaged application process failed.")));
  child.once?.("exit", (code, signal) => {
    if (expectedExit) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    failWaiters(new Error(`Packaged application exited before smoke completion (${reason}).`));
  });

  return Object.freeze({
    assertCredentialAbsent() {
      if (terminalFailure) throw terminalFailure;
      if (credentialFailure) throw credentialFailure;
    },
    expectExit() {
      if (terminalFailure) throw terminalFailure;
      expectedExit = true;
    },
    setCredential(value) {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error("Packaged Runtime bootstrap returned an invalid credential.");
      }
      if (credentials.includes(value)) {
        throw new Error("Packaged Runtime reused a prior credential.");
      }
      credentials.push(value);
      credentialTails.set(value, "");
      const retained = Buffer.concat([preBootstrapDiagnostics, postBootstrapDiagnostics]).toString(
        "utf8",
      );
      scanCredential(retained, [value]);
      if (credentialFailure) throw credentialFailure;
    },
    waitFor(kind, timeoutMs, timers) {
      if (!Object.prototype.hasOwnProperty.call(endpoints, kind)) {
        throw new Error(`Unknown packaged inspector endpoint kind ${kind}.`);
      }
      if (endpoints[kind]) return Promise.resolve(endpoints[kind]);
      if (terminalFailure) return Promise.reject(terminalFailure);
      return withTimeout(
        new Promise((resolve, reject) => waiters[kind].push({ reject, resolve })),
        `Packaged ${kind} inspector endpoint`,
        timeoutMs,
        timers,
      );
    },
  });
}

function createCdpClient(webSocketUrl, { WebSocketImpl, timeoutMs, timers }) {
  const socket = new WebSocketImpl(webSocketUrl);
  const pending = new Map();
  let nextId = 1;
  let failure;
  const opened = withTimeout(
    new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", () => reject(new Error("Inspector WebSocket failed to open.")));
    }),
    "Inspector WebSocket open",
    timeoutMs,
    timers,
  );
  const fail = () => {
    failure ??= new Error("Inspector WebSocket closed before the expected response.");
    for (const waiter of pending.values()) waiter.reject(failure);
    pending.clear();
  };
  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      failure = new Error("Inspector WebSocket returned invalid JSON.");
      fail();
      return;
    }
    if (!Number.isSafeInteger(message?.id)) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) {
      const error = new Error(waiter.failureMessage);
      if (Number.isSafeInteger(message.error.code)) error.protocolCode = message.error.code;
      waiter.reject(error);
    } else waiter.resolve(message.result);
  });
  socket.once("error", fail);
  socket.once("close", fail);

  const sendCommand = async ({ failureMessage, method, params, timeoutLabel }) => {
    await opened;
    if (failure) throw failure;
    const id = nextId++;
    const response = withTimeout(
      new Promise((resolve, reject) => pending.set(id, { failureMessage, reject, resolve })),
      timeoutLabel,
      timeoutMs,
      timers,
    );
    socket.send(JSON.stringify({ id, method, params }));
    return response;
  };

  return Object.freeze({
    close() {
      try {
        socket.close();
      } catch {}
    },
    async evaluate(expression, failureMessage = "Inspector command failed.") {
      const result = await sendCommand({
        failureMessage,
        method: "Runtime.evaluate",
        params: { awaitPromise: true, expression, returnByValue: true },
        timeoutLabel: failureMessage,
      });
      if (
        result?.result?.type === "undefined" &&
        !Object.prototype.hasOwnProperty.call(result.result, "value")
      ) {
        return undefined;
      }
      if (result?.exceptionDetails || !result?.result || !("value" in result.result)) {
        throw new Error("Inspector evaluation did not return a by-value result.");
      }
      return result.result.value;
    },
    async runIfWaitingForDebugger() {
      await sendCommand({
        failureMessage: "Packaged main inspector could not resume the application.",
        method: "Runtime.runIfWaitingForDebugger",
        params: {},
        timeoutLabel: "Inspector Runtime.runIfWaitingForDebugger",
      });
    },
  });
}

async function retryUntil(
  operation,
  label,
  { timeoutMs, pollIntervalMs, retryError = () => false, timers },
) {
  let interval;
  const result = new Promise((resolve, reject) => {
    let running = false;
    const attempt = async () => {
      if (running) return;
      running = true;
      try {
        const value = await operation();
        if (value !== undefined) resolve(value);
      } catch (error) {
        if (!retryError(error)) reject(error);
      } finally {
        running = false;
      }
    };
    interval = timers.setInterval(attempt, pollIntervalMs);
    void attempt();
  });
  return withTimeout(result, label, timeoutMs, timers).finally(() => {
    timers.clearInterval(interval);
  });
}

function isRetryableMainInspectorEvaluation(error) {
  return error?.protocolCode === -32000;
}

async function resolveRendererDebuggerTarget(
  browserWebSocketUrl,
  { fetchImpl, timeoutMs, pollIntervalMs, timers },
) {
  const browser = new URL(browserWebSocketUrl);
  const listUrl = new URL("/json/list", `http://${browser.host}`);
  return retryUntil(
    async () => {
      let response;
      let targets;
      const controller = new AbortController();
      try {
        try {
          response = await withTimeout(
            fetchImpl(listUrl, { signal: controller.signal }),
            "Renderer inspector target request",
            timeoutMs,
            timers,
          );
        } catch {
          return undefined;
        }
        const contentLength = Number(response.headers?.get?.("content-length"));
        if (
          Number.isSafeInteger(contentLength) &&
          contentLength > MAX_RENDERER_DEBUGGER_LIST_BYTES
        ) {
          throw new Error("Renderer inspector target list exceeded its size limit.");
        }
        targets = await withTimeout(
          response.json(),
          "Renderer inspector target response",
          timeoutMs,
          timers,
        );
        if (Buffer.byteLength(JSON.stringify(targets), "utf8") > MAX_RENDERER_DEBUGGER_LIST_BYTES) {
          throw new Error("Renderer inspector target list exceeded its size limit.");
        }
      } finally {
        controller.abort();
      }
      if (!response.ok || response.status !== 200) return undefined;
      if (!Array.isArray(targets)) throw new Error("Renderer inspector target list was invalid.");
      const candidates = targets.filter((target) => {
        if (target?.type !== "page" || typeof target.url !== "string") return false;
        try {
          const page = new URL(target.url);
          return page.protocol === "workbench:" && page.hostname === "app";
        } catch {
          return false;
        }
      });
      if (candidates.length === 0) return undefined;
      if (candidates.length !== 1) {
        throw new Error("Packaged application exposed multiple Workbench renderer targets.");
      }
      const target = candidates[0];
      const debuggerUrl = parseInspectorEndpoint(target.webSocketDebuggerUrl, "renderer-target");
      if (!debuggerUrl)
        throw new Error("Workbench renderer inspector endpoint was not loopback-only.");
      const debuggerEndpoint = new URL(debuggerUrl);
      if (debuggerEndpoint.host !== browser.host) {
        throw new Error("Workbench renderer inspector escaped the browser debug endpoint.");
      }
      return Object.freeze({ debuggerUrl, pageUrl: target.url });
    },
    "Workbench renderer inspector target",
    { timeoutMs, pollIntervalMs, timers },
  );
}

const ELECTRON_MAIN_MODULE_EXPRESSION =
  'process.getBuiltinModule("module").createRequire(process.mainModule.filename)("electron")';

const MAIN_WINDOW_PATCH_EXPRESSION = `(() => {
  const electron = ${ELECTRON_MAIN_MODULE_EXPRESSION};
  const windows = electron.BrowserWindow.getAllWindows();
  if (windows.length !== 1 || windows[0].isDestroyed()) return undefined;
  const target = windows[0];
  if (!globalThis.__workbenchPackagedSmokeTitleBar) {
    const calls = [];
    const original = target.setTitleBarOverlay;
    if (typeof original !== "function") throw new Error("missing titlebar method");
    target.setTitleBarOverlay = function (options) {
      calls.push({ color: options?.color, symbolColor: options?.symbolColor });
      return Reflect.apply(original, this, [options]);
    };
    Object.defineProperty(globalThis, "__workbenchPackagedSmokeTitleBar", {
      configurable: false,
      enumerable: false,
      value: { calls, windowId: target.id },
      writable: false,
    });
  }
  return { windowCount: windows.length, windowId: target.id };
})()`;

const MAIN_WINDOW_RELOAD_EXPRESSION = `(() => {
  const electron = ${ELECTRON_MAIN_MODULE_EXPRESSION};
  const windows = electron.BrowserWindow.getAllWindows();
  if (windows.length !== 1 || windows[0].isDestroyed()) return undefined;
  const target = windows[0];
  return new Promise((resolve) => {
    target.webContents.once("did-finish-load", () => {
      resolve({ windowCount: electron.BrowserWindow.getAllWindows().length, windowId: target.id });
    });
    target.webContents.reload();
  });
})()`;

const RENDERER_READY_EXPRESSION = `(() => {
  const bridge = window.workbenchDesktop;
  const shell = document.querySelector('[data-workbench-shell][data-workbench-surface="shell"]');
  const composer = shell?.querySelector('[data-slot="workbench-composer-shell"]');
  if (
    document.readyState !== "complete" ||
    !document.body ||
    !shell ||
    !composer ||
    typeof bridge?.lifecycle?.restartRuntime !== "function" ||
    typeof bridge?.runtime?.bootstrap !== "function" ||
    typeof bridge?.titleBar?.setOverlay !== "function"
  ) return undefined;
  return {
    bridgeFrozen: Object.isFrozen(bridge),
    lifecycleFrozen: Object.isFrozen(bridge.lifecycle),
    runtimeFrozen: Object.isFrozen(bridge.runtime),
    titleBarFrozen: Object.isFrozen(bridge.titleBar),
    documentReadyState: document.readyState,
    origin: location.origin,
    composerMounted: true,
    shellMounted: true,
  };
})()`;

const RUNTIME_BOOTSTRAP_EXPRESSION = "window.workbenchDesktop.runtime.bootstrap()";
const RUNTIME_RESTART_EXPRESSION = "window.workbenchDesktop.lifecycle.restartRuntime()";
const RENDERER_RELOADED_EXPRESSION = RENDERER_READY_EXPRESSION;
const RENDERER_RUNTIME_IDENTITY_EXPRESSION = `(() => {
  const bridge = window.workbenchDesktop;
  return Promise.resolve(bridge.runtime.bootstrap()).then(async (connection) => {
    const response = await fetch(new URL(${JSON.stringify(
      RUNTIME_HOST_IDENTITY_PATH,
    )}, connection.httpOrigin), {
      headers: { Authorization: \`Bearer \${connection.accessToken}\` },
    });
    let document;
    try {
      document = await response.json();
    } catch {
      document = undefined;
    }
    return {
      document,
      observedOrigin: location.origin,
      status: response.status,
    };
  });
})()`;
const TITLE_BAR_DELIVERY_EXPRESSION = `(() => {
  window.workbenchDesktop.titleBar.setOverlay(${JSON.stringify(TITLE_BAR_PROBE)});
  return true;
})()`;
const TITLE_BAR_RESULT_EXPRESSION = "globalThis.__workbenchPackagedSmokeTitleBar?.calls ?? []";
const GRACEFUL_QUIT_EXPRESSION = `(() => {
  const electron = ${ELECTRON_MAIN_MODULE_EXPRESSION};
  setImmediate(() => electron.app.quit());
  return true;
})()`;

function validateRendererReady(value, expectedOrigin) {
  if (
    !value ||
    value.bridgeFrozen !== true ||
    value.lifecycleFrozen !== true ||
    value.runtimeFrozen !== true ||
    value.titleBarFrozen !== true ||
    value.documentReadyState !== "complete" ||
    value.origin !== expectedOrigin ||
    value.composerMounted !== true ||
    value.shellMounted !== true
  ) {
    throw new Error("Packaged renderer did not expose the frozen trusted desktop bridge at ready.");
  }
}

function validateRendererRuntimeIdentity(value, connection, expectedOrigin) {
  const identity = value?.status === 200 ? parseRuntimeHostIdentity(value.document) : undefined;
  if (
    !identity ||
    value.observedOrigin !== expectedOrigin ||
    identity.instanceId !== connection.instanceId ||
    identity.hostProtocolVersion !== connection.protocolVersion
  ) {
    throw new Error(
      `Packaged renderer did not complete an exact-origin CSP/CORS Runtime request (status=${String(value?.status)}, origin=${String(value?.observedOrigin)}, identity=${identity ? "valid" : "invalid"}).`,
    );
  }
  return identity;
}

async function readAuthenticatedRuntimeIdentity(
  fetchImpl,
  connection,
  allowedOrigin,
  { timeoutMs, timers },
) {
  const response = await withTimeout(
    fetchImpl(new URL(RUNTIME_HOST_IDENTITY_PATH, connection.httpOrigin), {
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        Origin: allowedOrigin,
      },
    }),
    "Packaged Runtime identity",
    timeoutMs,
    timers,
  );
  let document;
  try {
    document = await response.json();
  } catch {
    document = undefined;
  }
  const identity = response.status === 200 ? parseRuntimeHostIdentity(document) : undefined;
  if (
    !response.ok ||
    !identity ||
    identity.instanceId !== connection.instanceId ||
    identity.hostProtocolVersion !== connection.protocolVersion ||
    response.headers.get("access-control-allow-origin") !== allowedOrigin
  ) {
    throw new Error("Packaged Runtime identity did not match the trusted preload bootstrap.");
  }
  return identity;
}

function createPosixTerminalChallenge({ createId = randomUUID } = {}) {
  const expected = `${TERMINAL_MARKER}:${createId()}`;
  const octal = [...Buffer.from(expected, "utf8")]
    .map((byte) => `\\${byte.toString(8).padStart(3, "0")}`)
    .join("");
  const input = `printf '${octal}'; exit 0\r`;
  assert.equal(input.includes(expected), false, "Terminal challenge plaintext must not be echoed.");
  return Object.freeze({ expected, input });
}

function parseLinuxStat(text) {
  const commandEnd = text.lastIndexOf(")");
  if (commandEnd < 2) return undefined;
  const pid = Number(text.slice(0, text.indexOf(" ")));
  const fields = text
    .slice(commandEnd + 2)
    .trim()
    .split(/\s+/u);
  const parentPid = Number(fields[1]);
  const processGroupId = Number(fields[2]);
  if (
    ![pid, parentPid, processGroupId].every((value) => Number.isSafeInteger(value) && value > 0)
  ) {
    return undefined;
  }
  const base = { parentPid, pid, processGroupId };
  const startTime = fields[19];
  return typeof startTime === "string" && /^\d+$/u.test(startTime) ? { ...base, startTime } : base;
}

function readNullSeparatedFile(filePath) {
  const value = readFileSync(filePath);
  return value.length === 0 ? [] : value.toString("utf8").split("\0").filter(Boolean);
}

function readLinuxProcesses({ procRoot = "/proc" } = {}) {
  const processes = [];
  for (const entry of readdirSync(procRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
    const processDirectory = path.join(procRoot, entry.name);
    try {
      const stat = parseLinuxStat(readFileSync(path.join(processDirectory, "stat"), "utf8"));
      if (!stat) continue;
      processes.push(
        Object.freeze({
          ...stat,
          arguments: Object.freeze(readNullSeparatedFile(path.join(processDirectory, "cmdline"))),
          environment: Object.freeze(readNullSeparatedFile(path.join(processDirectory, "environ"))),
        }),
      );
    } catch (error) {
      if (!["ENOENT", "EACCES", "EPERM"].includes(error?.code)) throw error;
    }
  }
  return Object.freeze(processes.sort((left, right) => left.pid - right.pid));
}

function readLinuxProcessGroup(processGroupId, options = {}) {
  return Object.freeze(
    readLinuxProcesses(options).filter((process) => process.processGroupId === processGroupId),
  );
}

function findLinuxProcess(processes, pid) {
  return processes.find((process) => process.pid === pid);
}

function assertExactOwnerFrame(frame) {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    throw new Error("Packaged smoke owner frame was invalid.");
  }
  const keys = Object.keys(frame).sort();
  if (
    keys.length !== 5 ||
    keys.some((key, index) => key !== ["owner", "pid", "requestId", "type", "version"][index]) ||
    frame.type !== PACKAGED_SMOKE_OWNER_FRAME_TYPE ||
    frame.version !== PACKAGED_SMOKE_OWNER_FRAME_VERSION ||
    frame.owner !== "runtime" ||
    !Number.isSafeInteger(frame.pid) ||
    frame.pid < 1 ||
    !Number.isSafeInteger(frame.requestId) ||
    frame.requestId < 1
  ) {
    throw new Error("Packaged smoke owner frame was invalid.");
  }
  return frame;
}

/**
 * Records the two ordered Runtime leaders that Electron reports over the
 * token-free parent IPC channel. Every PID is paired with `/proc` start time
 * before it is accepted, so PID reuse can only fail the smoke; it can never
 * cause a signal to be sent to an unrelated process group.
 */
function createLinuxPackagedOwnerRegistry(appPid, { readProcesses = readLinuxProcesses } = {}) {
  if (!Number.isSafeInteger(appPid) || appPid < 1) {
    throw new Error("Packaged Electron leader PID was invalid.");
  }
  const initial = findLinuxProcess(readProcesses(), appPid);
  if (!initial || typeof initial.startTime !== "string" || initial.processGroupId !== appPid) {
    throw new Error("Packaged Electron leader could not be start-time anchored in /proc.");
  }
  const app = Object.freeze({
    pid: initial.pid,
    processGroupId: initial.processGroupId,
    startTime: initial.startTime,
  });
  const owners = [];

  const exactLive = (record, processes = readProcesses()) => {
    const current = findLinuxProcess(processes, record.pid);
    return Boolean(
      current &&
      current.startTime === record.startTime &&
      current.processGroupId === record.processGroupId,
    );
  };
  const preservedGroupIsLive = (record, processes) => {
    const currentLeader = findLinuxProcess(processes, record.pid);
    if (exactLive(record, processes)) return true;
    // Once a detached leader's PID is recycled, its old PGID must never be
    // signalled.  If it is absent, however, a different current member proves
    // the original PGID is still reserved by a surviving re-parented child.
    return (
      !currentLeader &&
      processes.some(
        (process) => process.pid !== record.pid && process.processGroupId === record.processGroupId,
      )
    );
  };

  return Object.freeze({
    accept(frame) {
      const accepted = assertExactOwnerFrame(frame);
      if (owners.length >= 2) {
        throw new Error("Packaged smoke reported more than two Runtime generations.");
      }
      const snapshot = readProcesses();
      if (!exactLive(app, snapshot)) {
        throw new Error("Packaged Electron leader identity changed before owner registration.");
      }
      const previous = owners.at(-1);
      if (previous) {
        if (accepted.requestId <= previous.requestId) {
          throw new Error("Packaged Runtime owner reports were not ordered.");
        }
        if (owners.some((owner) => preservedGroupIsLive(owner, snapshot))) {
          throw new Error("Previous packaged Runtime generation was still live.");
        }
      }
      const child = findLinuxProcess(snapshot, accepted.pid);
      if (
        !child ||
        child.parentPid !== app.pid ||
        typeof child.startTime !== "string" ||
        child.processGroupId !== child.pid
      ) {
        throw new Error("Packaged smoke owner could not be start-time anchored below Electron.");
      }
      const owner = Object.freeze({
        generation: owners.length + 1,
        owner: accepted.owner,
        pid: child.pid,
        processGroupId: child.processGroupId,
        requestId: accepted.requestId,
        startTime: child.startTime,
      });
      owners.push(owner);
      return owner;
    },
    assertComplete() {
      if (owners.length !== 2) {
        throw new Error("Packaged Electron did not register exactly two Runtime generations.");
      }
    },
    app,
    isAppLive() {
      return exactLive(app);
    },
    liveOwnerProcessGroups() {
      const snapshot = readProcesses();
      const records = [app, ...owners];
      return Object.freeze(
        [
          ...new Set(
            records
              .filter((record) => preservedGroupIsLive(record, snapshot))
              .map((record) => record.processGroupId),
          ),
        ].sort((left, right) => left - right),
      );
    },
    owners() {
      return Object.freeze([...owners]);
    },
  });
}

function attachPackagedOwnerRegistry(child, registry, { beforeAcknowledge } = {}) {
  if (typeof child?.on !== "function" || typeof child?.send !== "function") return;
  child.on("message", (frame) => {
    void (async () => {
      let accepted = false;
      let requestId;
      let owner;
      let pid;
      if (frame && typeof frame === "object" && !Array.isArray(frame)) {
        requestId = frame.requestId;
        owner = frame.owner;
        pid = frame.pid;
      }
      try {
        const record = registry.accept(frame);
        await beforeAcknowledge?.(record);
        accepted = true;
      } catch {
        // The child receives only a boolean acknowledgement; process topology and
        // path details stay in the release-smoke parent diagnostics.
      }
      if (
        !(
          Number.isSafeInteger(requestId) &&
          owner === "runtime" &&
          Number.isSafeInteger(pid) &&
          pid > 0
        )
      )
        return;
      try {
        child.send({
          accepted,
          owner,
          pid,
          requestId,
          type: PACKAGED_SMOKE_OWNER_ACK_FRAME_TYPE,
          version: PACKAGED_SMOKE_OWNER_FRAME_VERSION,
        });
      } catch {
        // The Electron process will time out its awaited report and fail closed.
      }
    })();
  });
}

function captureLinuxProcessTopology(appPid, { readProcesses = readLinuxProcesses } = {}) {
  const snapshot = readProcesses();
  const byParentPid = new Map();
  for (const process of snapshot) {
    const children = byParentPid.get(process.parentPid) ?? [];
    children.push(process);
    byParentPid.set(process.parentPid, children);
  }
  const owned = [];
  const pending = [appPid];
  const visited = new Set();
  const byPid = new Map(snapshot.map((process) => [process.pid, process]));
  while (pending.length > 0) {
    const pid = pending.pop();
    if (visited.has(pid)) continue;
    visited.add(pid);
    const process = byPid.get(pid);
    if (!process) continue;
    owned.push(process);
    for (const child of byParentPid.get(pid) ?? []) pending.push(child.pid);
  }
  if (!owned.some((process) => process.pid === appPid)) {
    throw new Error("Packaged Electron process was absent from the Linux process snapshot.");
  }
  return Object.freeze({
    appPid,
    processGroupIds: Object.freeze(
      [...new Set(owned.map((process) => process.processGroupId))].sort((a, b) => a - b),
    ),
    processes: Object.freeze(owned.sort((left, right) => left.pid - right.pid)),
  });
}

function mergeLinuxProcessTopologies(...topologies) {
  const processes = new Map();
  const processGroupIds = new Set();
  let appPid;
  for (const topology of topologies) {
    if (!topology) continue;
    appPid ??= topology.appPid;
    if (topology.appPid !== appPid) {
      throw new Error("Cannot merge Linux process topologies for different Electron leaders.");
    }
    for (const process of topology.processes) {
      processes.set(`${process.pid}:${process.startTime ?? "unknown"}`, process);
    }
    for (const processGroupId of topology.processGroupIds) processGroupIds.add(processGroupId);
  }
  if (!Number.isSafeInteger(appPid) || appPid < 1) {
    throw new Error("Cannot merge an empty Linux process topology.");
  }
  return Object.freeze({
    appPid,
    processGroupIds: Object.freeze([...processGroupIds].sort((left, right) => left - right)),
    processes: Object.freeze([...processes.values()].sort((left, right) => left.pid - right.pid)),
  });
}

function assertPackagedProcessTopology(
  processes,
  { appPid, accessToken, runtimeEntrypoint, runtimePid },
) {
  if (!processes.some((process) => process.pid === appPid)) {
    throw new Error("Packaged Electron process was absent from its owned process topology.");
  }
  const runtime = processes.find(
    (process) => process.pid === runtimePid && process.arguments.includes(runtimeEntrypoint),
  );
  if (!runtime) {
    throw new Error("Packaged Runtime Host was absent from the owned Electron process topology.");
  }
  for (const process of processes) {
    if (
      process.arguments.some((value) => value.includes(accessToken)) ||
      process.environment.some((value) => value.includes(accessToken))
    ) {
      throw new Error("Packaged Runtime credential escaped into process argv or environment.");
    }
  }
}

function assertPackagedProcessGroup(processes, options) {
  return assertPackagedProcessTopology(processes, options);
}

function linuxProcessGroupsAreEmpty(
  processGroupIds,
  { readProcessGroup = readLinuxProcessGroup } = {},
) {
  return processGroupIds.every((processGroupId) => readProcessGroup(processGroupId).length === 0);
}

function liveOwnedLinuxProcessGroups(topology, { readProcesses = readLinuxProcesses } = {}) {
  const currentByPid = new Map(readProcesses().map((process) => [process.pid, process]));
  const liveGroups = new Set();
  for (const captured of topology.processes) {
    const current = currentByPid.get(captured.pid);
    if (
      typeof captured.startTime === "string" &&
      current?.startTime === captured.startTime &&
      current.processGroupId === captured.processGroupId
    ) {
      liveGroups.add(captured.processGroupId);
    }
  }
  return Object.freeze([...liveGroups].sort((left, right) => left - right));
}

function forceStopLinuxProcessGroups(processGroupIds, { killGroup = process.kill } = {}) {
  for (const processGroupId of processGroupIds) {
    try {
      killGroup(-processGroupId, "SIGKILL");
    } catch {
      // A group can race its normal shutdown; the subsequent exact snapshot is authoritative.
    }
  }
}

function isChildRunning(child) {
  return child && child.exitCode === null && child.signalCode == null;
}

function waitForChildExit(child, label, timeoutMs, timers) {
  if (!isChildRunning(child)) {
    return Promise.resolve({ code: child?.exitCode, signal: child?.signalCode });
  }
  return withTimeout(
    new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }),
    label,
    timeoutMs,
    timers,
  );
}

function firstLine(stream, label, timeoutMs, timers) {
  return withTimeout(
    new Promise((resolve, reject) => {
      let buffer = "";
      const onData = (chunk) => {
        buffer += String(chunk);
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        cleanup();
        resolve(buffer.slice(0, newline).trim());
      };
      const onError = () => {
        cleanup();
        reject(new Error(`${label} stream failed.`));
      };
      const onEnd = () => {
        cleanup();
        reject(new Error(`${label} ended before returning a value.`));
      };
      const cleanup = () => {
        stream.off("data", onData);
        stream.off("error", onError);
        stream.off("end", onEnd);
      };
      stream.on("data", onData);
      stream.once("error", onError);
      stream.once("end", onEnd);
    }),
    label,
    timeoutMs,
    timers,
  );
}

async function acquireLinuxDisplay(environment, { spawnChild = spawn, timeoutMs, timers }) {
  // A release gate must never attach to a developer's X session.  Inherited
  // DISPLAY is intentionally ignored; the owned Xvfb instance is itself part
  // of the cleanup contract.
  const xvfbEnvironment = { ...environment };
  delete xvfbEnvironment.DISPLAY;
  const child = spawnChild(
    "Xvfb",
    ["-displayfd", "3", "-screen", "0", "1440x960x24", "-nolisten", "tcp"],
    { env: xvfbEnvironment, stdio: ["ignore", "ignore", "pipe", "pipe"] },
  );
  try {
    if (!child?.stdio?.[3]) throw new Error("Xvfb did not expose its display descriptor.");
    const displayNumber = await firstLine(
      child.stdio[3],
      "Xvfb display allocation",
      timeoutMs,
      timers,
    );
    if (!/^\d+$/u.test(displayNumber)) {
      throw new Error("Xvfb returned an invalid display number.");
    }
    return Object.freeze({ child, display: `:${displayNumber}` });
  } catch (error) {
    await stopDisplay({ child }, { timeoutMs, timers });
    throw error;
  }
}

async function stopDisplay(display, { timeoutMs, timers }) {
  if (!display?.child) return;
  const child = display.child;
  if (!isChildRunning(child)) return;
  const exit = waitForChildExit(child, "Xvfb shutdown", timeoutMs, timers);
  child.kill("SIGTERM");
  try {
    await exit;
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {}
    await waitForChildExit(child, "Xvfb forced shutdown", timeoutMs, timers);
  }
}

async function originsAreClosed(origins, fetchImpl) {
  for (const origin of origins) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 250);
    try {
      await fetchImpl(origin, { signal: controller.signal });
      return false;
    } catch {
      // An exited packaged child must refuse the old loopback endpoint.
    } finally {
      clearTimeout(timeout);
    }
  }
  return true;
}

function safeError(error, accessTokens) {
  let message = error instanceof Error ? error.message : "Packaged application smoke failed.";
  for (const accessToken of accessTokens) {
    if (message.includes(accessToken)) message = message.split(accessToken).join("[REDACTED]");
  }
  return new Error(message);
}

async function runPackagedAppSmoke({
  outputDirectory,
  target,
  expectedRendererBuildId,
  environment = process.env,
  WebSocketImpl = require("ws"),
  fetchImpl = fetch,
  spawnChild = spawn,
  resolveApplication = resolveLinuxPackagedApplication,
  acquireDisplay = acquireLinuxDisplay,
  stopDisplayImpl = stopDisplay,
  stopProcess = stopServerProcess,
  killProcessGroup,
  createOwnerRegistry = createLinuxPackagedOwnerRegistry,
  readProcesses = readLinuxProcesses,
  readProcessGroup = readLinuxProcessGroup,
  mkdtemp = createSmokeStateDirectory,
  remove = rmSync,
  temporaryDirectory = tmpdir(),
  timers = defaultTimers(),
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  cleanupTimeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  createId = randomUUID,
} = {}) {
  const contract = resolvePackagedAppSmokeContract(target);
  if (contract.execution !== "required") {
    throw new Error(`The packaged-app smoke cannot launch this target: ${contract.reason}`);
  }
  const application = await resolveApplication(outputDirectory, {
    expectedTarget: target,
    expectedRendererBuildId,
  });
  const startedAt = Date.now();
  const accessTokens = [];
  const runtimeOrigins = [];
  let stateRoot;
  let appChild;
  let display;
  let mainClient;
  let rendererClient;
  let outputMonitor;
  let operationFailure;
  let cleanupFailure;
  let successful = false;
  let piSockets = [];
  let terminalSockets = [];
  const terminalResults = [];
  let ownedTopology;
  let ownerRegistry;
  let topologyExpectation;

  const refreshOwnedTopology = () => {
    if (!appChild || !topologyExpectation) return undefined;
    const refreshed = captureLinuxProcessTopology(appChild.pid, { readProcesses });
    ownedTopology = mergeLinuxProcessTopologies(ownedTopology, refreshed);
    assertPackagedProcessTopology(refreshed.processes, topologyExpectation);
    return ownedTopology;
  };

  try {
    stateRoot = mkdtemp(path.join(temporaryDirectory, "workbench-packaged-app-smoke-"));
    mkdirSync(path.join(stateRoot, "home"), { recursive: true });
    display = await acquireDisplay(environment, {
      spawnChild,
      timeoutMs: operationTimeoutMs,
      timers,
    });
    const childEnvironment = createPackagedSmokeEnvironment(
      environment,
      stateRoot,
      display.display,
    );
    const arguments_ = [
      "--inspect-brk=127.0.0.1:0",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${path.join(stateRoot, "electron-user-data")}`,
    ];
    if (typeof process.geteuid === "function" && process.geteuid() === 0) {
      arguments_.push("--no-sandbox");
    }
    appChild = spawnChild(application.executable, arguments_, {
      cwd: application.appOutDirectory,
      detached: true,
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    if (!appChild || !Number.isSafeInteger(appChild.pid) || appChild.pid < 1) {
      throw new Error("Packaged application process did not start.");
    }
    ownerRegistry = createOwnerRegistry(appChild.pid, { readProcesses });
    attachPackagedOwnerRegistry(appChild, ownerRegistry, {
      async beforeAcknowledge(owner) {
        if (owner.generation !== 2) return;
        const previousOrigin = runtimeOrigins[0];
        if (!previousOrigin || !(await originsAreClosed([previousOrigin], fetchImpl))) {
          throw new Error("Previous packaged Runtime port was still open.");
        }
      },
    });
    outputMonitor = createPackagedOutputMonitor(appChild);
    const mainEndpoint = await outputMonitor.waitFor("main", readyTimeoutMs, timers);
    mainClient = createCdpClient(mainEndpoint, {
      WebSocketImpl,
      timeoutMs: operationTimeoutMs,
      timers,
    });
    await mainClient.runIfWaitingForDebugger();
    const browserEndpoint = await outputMonitor.waitFor("renderer", readyTimeoutMs, timers);
    const mainWindow = await retryUntil(
      () =>
        mainClient.evaluate(
          MAIN_WINDOW_PATCH_EXPRESSION,
          "Packaged main window inspector evaluation failed.",
        ),
      "Packaged BrowserWindow ready",
      {
        timeoutMs: readyTimeoutMs,
        pollIntervalMs,
        retryError: isRetryableMainInspectorEvaluation,
        timers,
      },
    );
    if (mainWindow.windowCount !== 1 || !Number.isSafeInteger(mainWindow.windowId)) {
      throw new Error("Packaged application did not create exactly one BrowserWindow.");
    }
    let rendererTarget = await resolveRendererDebuggerTarget(browserEndpoint, {
      fetchImpl,
      timeoutMs: readyTimeoutMs,
      pollIntervalMs,
      timers,
    });
    rendererClient = createCdpClient(rendererTarget.debuggerUrl, {
      WebSocketImpl,
      timeoutMs: operationTimeoutMs,
      timers,
    });
    const rendererPage = new URL(rendererTarget.pageUrl);
    const rendererOrigin = `${rendererPage.protocol}//${rendererPage.host}`;
    const rendererReady = await retryUntil(
      () =>
        rendererClient.evaluate(
          RENDERER_READY_EXPRESSION,
          "Packaged renderer readiness inspector evaluation failed.",
        ),
      "Packaged renderer ready",
      { timeoutMs: readyTimeoutMs, pollIntervalMs, timers },
    );
    validateRendererReady(rendererReady, rendererOrigin);
    const probeRuntimeGeneration = async (connection, client) => {
      if (connection.kind !== "desktop-sidecar" || connection.httpOrigin === rendererOrigin) {
        throw new Error("Packaged preload did not return a distinct desktop Runtime sidecar.");
      }
      const accessToken = connection.accessToken;
      accessTokens.push(accessToken);
      runtimeOrigins.push(connection.httpOrigin);
      outputMonitor.setCredential(accessToken);

      // This request executes in Chromium, without a caller-supplied Origin header. It proves the
      // registered custom scheme has a non-opaque workbench://app origin, CSP permits only the
      // admitted Runtime endpoint, and Runtime accepts that exact origin rather than `null`.
      const rendererIdentity = validateRendererRuntimeIdentity(
        await client.evaluate(
          RENDERER_RUNTIME_IDENTITY_EXPRESSION,
          "Packaged renderer exact-origin Runtime fetch failed.",
        ),
        connection,
        rendererOrigin,
      );
      const identity = await readAuthenticatedRuntimeIdentity(
        fetchImpl,
        connection,
        rendererOrigin,
        { timeoutMs: operationTimeoutMs, timers },
      );
      if (identity.pid !== rendererIdentity.pid) {
        throw new Error("Packaged renderer and release-smoke Runtime identities differed.");
      }
      const ready = Object.freeze({
        hostProtocolVersion: identity.hostProtocolVersion,
        httpOrigin: connection.httpOrigin,
        instanceId: identity.instanceId,
        pid: identity.pid,
      });
      topologyExpectation = Object.freeze({
        accessToken,
        appPid: appChild.pid,
        runtimeEntrypoint: application.layout.runtime.entrypoint,
        runtimePid: identity.pid,
      });
      // Runtime deliberately creates a detached process group. Capture its exact live ancestry
      // while Electron is still its parent so cleanup never guesses by PID.
      refreshOwnedTopology();
      await probeAuthenticatedRuntimeHttp(fetchImpl, ready, accessToken, rendererOrigin, {
        timeoutMs: operationTimeoutMs,
        timers,
      });
      const headers = { Authorization: `Bearer ${accessToken}`, Origin: rendererOrigin };
      const hostDescription = await callRpc(fetchImpl, connection.httpOrigin, "host.describe", {
        headers,
        timeoutMs: operationTimeoutMs,
        timers,
      });
      assertIsolatedHostDescription(hostDescription, application.runtimeDirectory, stateRoot);
      const sessionList = await callRpc(fetchImpl, connection.httpOrigin, "session.list", {
        headers,
        timeoutMs: operationTimeoutMs,
        timers,
      });
      assertEmptySessionList(sessionList);

      const AuthenticatedWebSocket = createAuthenticatedWebSocketConstructor({
        WebSocketImpl,
        accessToken,
        allowedOrigin: rendererOrigin,
        connection,
        timeoutMs: operationTimeoutMs,
        timers,
      });
      const pi = smokePiWebSocketPair(AuthenticatedWebSocket, connection.httpOrigin, {
        timeoutMs: operationTimeoutMs,
        timers,
      });
      piSockets.push(...pi.sockets());
      await pi.complete;
      const terminal = smokeTerminalWebSocket(
        AuthenticatedWebSocket,
        terminalWebSocketUrl(connection.httpOrigin, stateRoot, `packaged-smoke-${createId()}`),
        {
          challenge: createPosixTerminalChallenge({ createId }),
          timeoutMs: operationTimeoutMs,
          timers,
        },
      );
      terminalSockets.push(terminal.socket());
      terminalResults.push(await terminal.complete);
      return Object.freeze({ connection, identity });
    };

    const firstConnection = defineRuntimeConnection(
      await rendererClient.evaluate(
        RUNTIME_BOOTSTRAP_EXPRESSION,
        "Packaged first Runtime bootstrap inspector evaluation failed.",
      ),
    );
    const firstGeneration = await probeRuntimeGeneration(firstConnection, rendererClient);
    if (ownerRegistry.owners().length !== 1) {
      throw new Error("Packaged Electron did not register its first Runtime generation.");
    }

    await rendererClient.evaluate(
      RUNTIME_RESTART_EXPRESSION,
      "Packaged Runtime restart lifecycle invocation failed.",
    );
    ownerRegistry.assertComplete();
    const owners = ownerRegistry.owners();
    if (
      owners[0].generation !== 1 ||
      owners[1].generation !== 2 ||
      (owners[0].pid === owners[1].pid && owners[0].startTime === owners[1].startTime)
    ) {
      throw new Error("Packaged Runtime generation replacement was not cleanly ordered.");
    }

    const reloadedWindow = await mainClient.evaluate(
      MAIN_WINDOW_RELOAD_EXPRESSION,
      "Packaged main window reload failed.",
    );
    if (reloadedWindow.windowCount !== 1 || reloadedWindow.windowId !== mainWindow.windowId) {
      throw new Error("Packaged Runtime restart replaced its BrowserWindow during reload.");
    }
    rendererClient.close();
    rendererClient = undefined;
    rendererTarget = await resolveRendererDebuggerTarget(browserEndpoint, {
      fetchImpl,
      timeoutMs: readyTimeoutMs,
      pollIntervalMs,
      timers,
    });
    rendererClient = createCdpClient(rendererTarget.debuggerUrl, {
      WebSocketImpl,
      timeoutMs: operationTimeoutMs,
      timers,
    });
    const reloadedRendererReady = await retryUntil(
      () =>
        rendererClient.evaluate(
          RENDERER_RELOADED_EXPRESSION,
          "Reloaded packaged renderer readiness inspector evaluation failed.",
        ),
      "Reloaded packaged renderer ready",
      { timeoutMs: readyTimeoutMs, pollIntervalMs, timers },
    );
    validateRendererReady(reloadedRendererReady, rendererOrigin);
    const secondConnection = defineRuntimeConnection(
      await rendererClient.evaluate(
        RUNTIME_BOOTSTRAP_EXPRESSION,
        "Packaged second Runtime bootstrap inspector evaluation failed.",
      ),
    );
    if (secondConnection.instanceId === firstGeneration.identity.instanceId) {
      throw new Error("Packaged Runtime restart reused its prior instance identity.");
    }
    const secondGeneration = await probeRuntimeGeneration(secondConnection, rendererClient);

    await rendererClient.evaluate(
      TITLE_BAR_DELIVERY_EXPRESSION,
      "Packaged titlebar bridge inspector evaluation failed.",
    );
    const titleBarCalls = await retryUntil(
      async () => {
        const calls = await mainClient.evaluate(
          TITLE_BAR_RESULT_EXPRESSION,
          "Packaged titlebar result inspector evaluation failed.",
        );
        return calls.some(
          (call) =>
            call?.color === TITLE_BAR_PROBE.color &&
            call?.symbolColor === TITLE_BAR_PROBE.symbolColor,
        )
          ? calls
          : undefined;
      },
      "Packaged titlebar bridge delivery",
      {
        timeoutMs: operationTimeoutMs,
        pollIntervalMs,
        retryError: isRetryableMainInspectorEvaluation,
        timers,
      },
    );

    // PTY and Chromium work may add detached descendants after initial Runtime readiness.
    // Refresh immediately before quit, preserving every earlier owned group for cleanup.
    refreshOwnedTopology();
    outputMonitor.assertCredentialAbsent();

    rendererClient.close();
    rendererClient = undefined;
    outputMonitor.expectExit();
    const appExit = waitForChildExit(
      appChild,
      "Packaged application graceful exit",
      shutdownTimeoutMs,
      timers,
    );
    await retryUntil(
      () =>
        mainClient.evaluate(
          GRACEFUL_QUIT_EXPRESSION,
          "Packaged graceful quit inspector evaluation failed.",
        ),
      "Packaged graceful quit inspector evaluation",
      {
        timeoutMs: operationTimeoutMs,
        pollIntervalMs,
        retryError: isRetryableMainInspectorEvaluation,
        timers,
      },
    );
    mainClient.close();
    mainClient = undefined;
    const exit = await appExit;
    if (exit.code !== 0 || exit.signal !== null) {
      throw new Error("Packaged application did not exit cleanly.");
    }
    await retryUntil(
      async () => {
        const groupsAreEmpty = linuxProcessGroupsAreEmpty(ownedTopology.processGroupIds, {
          readProcessGroup,
        });
        const closed = await originsAreClosed(runtimeOrigins, fetchImpl);
        return groupsAreEmpty && closed ? true : undefined;
      },
      "Packaged child process and port cleanup",
      { timeoutMs: cleanupTimeoutMs, pollIntervalMs, timers },
    );
    outputMonitor.assertCredentialAbsent();

    const report = Object.freeze({
      type: RESULT_TYPE,
      durationMs: Date.now() - startedAt,
      window: { composerMounted: true, count: 1, rendererReady: true, shellMounted: true },
      bootstrap: {
        generations: 2,
        kind: secondGeneration.connection.kind,
        protocolVersion: secondGeneration.connection.protocolVersion,
      },
      http: ["identity:200", "health:200", "missing-bearer:401", "malicious-origin:403"],
      rpc: ["host.describe", "session.list"],
      restart: ["runtime:drained", "window:retained", "renderer:reloaded"],
      webSocket: [
        "events.host:authenticated:1000",
        "events.mux:authenticated:1008",
        "terminal:authenticated:1000",
      ],
      terminal: { processHandles: terminalResults.map((result) => result.processHandle) },
      titleBar: { deliveries: titleBarCalls.length },
      exit: ["app:0", "runtime:closed", "process-group:empty"],
    });
    if (accessTokens.some((accessToken) => JSON.stringify(report).includes(accessToken))) {
      throw new Error("Packaged application smoke report contained the Runtime credential.");
    }
    successful = true;
    return report;
  } catch (error) {
    operationFailure = safeError(error, accessTokens);
  } finally {
    for (const socket of piSockets) {
      try {
        socket?.close?.();
      } catch {}
    }
    for (const socket of terminalSockets) {
      try {
        socket?.close?.();
      } catch {}
    }
    rendererClient?.close?.();
    mainClient?.close?.();
    if (!successful && appChild) {
      if (isChildRunning(appChild) && topologyExpectation) {
        try {
          refreshOwnedTopology();
        } catch {
          cleanupFailure ??= new Error(
            `Packaged application owned topology could not be refreshed; isolated smoke state was retained at ${stateRoot}.`,
          );
        }
      }
      // An exited Electron ChildProcess is never handed to the generic POSIX
      // tree killer: detached descendants may already have been re-parented.
      // Only a live leader whose `/proc` start-time still matches can anchor it.
      if (isChildRunning(appChild) && ownerRegistry?.isAppLive()) {
        try {
          await withTimeout(
            stopProcess(appChild, { platform: "linux" }),
            "Packaged application forced cleanup",
            cleanupTimeoutMs,
            timers,
          );
        } catch {
          cleanupFailure = new Error(
            `Packaged application cleanup failed; isolated smoke state was retained at ${stateRoot}.`,
          );
        }
      }
      const liveGroups = new Set(ownerRegistry?.liveOwnerProcessGroups?.() ?? []);
      for (const processGroupId of liveOwnedLinuxProcessGroups(ownedTopology ?? { processes: [] }, {
        readProcesses,
      })) {
        liveGroups.add(processGroupId);
      }
      const survivingGroups = [...liveGroups].filter(
        (processGroupId) => readProcessGroup(processGroupId).length > 0,
      );
      forceStopLinuxProcessGroups(survivingGroups, { killGroup: killProcessGroup });
      const capturedGroups = new Set([
        ...(ownerRegistry?.app ? [ownerRegistry.app.processGroupId] : []),
        ...(ownerRegistry?.owners?.().map((owner) => owner.processGroupId) ?? []),
        ...(ownedTopology?.processGroupIds ?? []),
      ]);
      if (
        capturedGroups.size === 0 ||
        !linuxProcessGroupsAreEmpty([...capturedGroups], { readProcessGroup })
      ) {
        cleanupFailure ??= new Error(
          `Packaged application had no start-time-anchored owners or its owned process groups could not be stopped; isolated smoke state was retained at ${stateRoot}.`,
        );
      }
    }
    try {
      outputMonitor?.assertCredentialAbsent();
    } catch (error) {
      operationFailure ??= safeError(error, accessTokens);
    }
    try {
      await stopDisplayImpl(display, { timeoutMs: cleanupTimeoutMs, timers });
    } catch {
      cleanupFailure ??= new Error(
        `Packaged smoke display cleanup failed; isolated smoke state was retained at ${stateRoot}.`,
      );
    }
    if (!cleanupFailure && stateRoot) {
      try {
        remove(stateRoot, { force: true, recursive: true });
      } catch {
        cleanupFailure = new Error(
          `Failed to remove isolated packaged smoke state at ${stateRoot}.`,
        );
      }
    }
  }
  if (operationFailure && cleanupFailure) {
    throw new AggregateError(
      [operationFailure, cleanupFailure],
      `Packaged application smoke failed; ${cleanupFailure.message}`,
    );
  }
  if (operationFailure) throw operationFailure;
  if (cleanupFailure) throw cleanupFailure;
  throw new Error("Packaged application smoke did not produce a result.");
}

module.exports = {
  DEFAULT_CLEANUP_TIMEOUT_MS,
  GRACEFUL_QUIT_EXPRESSION,
  MAIN_WINDOW_PATCH_EXPRESSION,
  MAIN_WINDOW_RELOAD_EXPRESSION,
  RENDERER_READY_EXPRESSION,
  RENDERER_RELOADED_EXPRESSION,
  RENDERER_RUNTIME_IDENTITY_EXPRESSION,
  RUNTIME_RESTART_EXPRESSION,
  RESULT_TYPE,
  TITLE_BAR_PROBE,
  acquireLinuxDisplay,
  attachPackagedOwnerRegistry,
  assertPackagedProcessGroup,
  assertPackagedProcessTopology,
  captureLinuxProcessTopology,
  createCdpClient,
  createLinuxPackagedOwnerRegistry,
  createPackagedOutputMonitor,
  createPackagedSmokeEnvironment,
  createPosixTerminalChallenge,
  forceStopLinuxProcessGroups,
  linuxProcessGroupsAreEmpty,
  linuxUnpackedDirectoryName,
  liveOwnedLinuxProcessGroups,
  mergeLinuxProcessTopologies,
  parseInspectorEndpoint,
  parseLinuxStat,
  readLinuxProcessGroup,
  readLinuxProcesses,
  resolveLinuxPackagedApplication,
  resolvePackagedAppSmokeContract,
  resolveRendererDebuggerTarget,
  runPackagedAppSmoke,
  validateRendererReady,
  validateRendererRuntimeIdentity,
};
