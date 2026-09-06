const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { mkdtempSync, realpathSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const { removeRuntimeArtifactOverrides } = require("../src/runtime-artifact-environment.cjs");

const LOOPBACK_HOST = "127.0.0.1";
const TERMINAL_MARKER = "__workbench_staged_terminal_smoke__";
const TERMINAL_MARKER_TAIL_LENGTH = 512;
const DEFAULT_READY_TIMEOUT_MS = 120_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 12_000;

function createSmokeStateDirectory(prefix) {
  // Match Terminal's fs/promises.realpath, including Windows short names and macOS /var aliases.
  return realpathSync.native(mkdtempSync(prefix));
}

function withTimeout(promise, label, timeoutMs, timers) {
  return new Promise((resolve, reject) => {
    const timeout = timers.setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );
    Promise.resolve(promise).then(
      (value) => {
        timers.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        timers.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function stateEnvironment(stateRoot) {
  return {
    PI_CODING_AGENT_DIR: path.join(stateRoot, "agent"),
    PI_WORKBENCH_CONTEXT_TRACE_DIR: path.join(stateRoot, "context-trace"),
    PI_WORKBENCH_IMAGE_UNDERSTANDING_STATE_FILE: path.join(
      stateRoot,
      "image-understanding-state.json",
    ),
    PI_WORKBENCH_SESSION_INDEX_FILE: path.join(stateRoot, "session-index.json"),
    PI_WORKBENCH_SETTINGS_FILE: path.join(stateRoot, "workbench-settings.json"),
    PI_WORKBENCH_STATE_DIR: path.join(stateRoot, "state"),
    PI_WORKBENCH_WORKSPACE_STATE_FILE: path.join(stateRoot, "workspace-state.json"),
    WORKBENCH_AUTOMATION_DIR: path.join(stateRoot, "automation"),
    XDG_CONFIG_HOME: path.join(stateRoot, "xdg-config"),
  };
}

function terminalShellEnvironment(
  stateRoot,
  { nodeExecutable = process.execPath, writeFile = writeFileSync } = {},
) {
  const emptyShellEnvironment = path.join(stateRoot, "empty-shell-environment");
  const historyFile = path.join(stateRoot, "terminal-history");
  const replHistoryFile = path.join(stateRoot, "node-repl-history");
  writeFile(emptyShellEnvironment, "", "utf8");
  writeFile(replHistoryFile, "", "utf8");
  return {
    BASH_ENV: emptyShellEnvironment,
    ENV: emptyShellEnvironment,
    HISTFILE: historyFile,
    INPUTRC: emptyShellEnvironment,
    NODE_OPTIONS: "",
    NODE_PATH: "",
    NODE_REPL_EXTERNAL_MODULE: "",
    NODE_REPL_HISTORY: replHistoryFile,
    PROMPT_COMMAND: "",
    WORKBENCH_TERMINAL_SHELL: nodeExecutable,
  };
}

function stagedHostEnvironment(environment, stateRoot, terminalEnvironment) {
  const inheritedEnvironment = { ...environment };
  for (const name of Object.keys(inheritedEnvironment)) {
    if (name.startsWith("NODE_")) delete inheritedEnvironment[name];
  }
  // Packaged/relocated smokes must exercise the adjacent staged target. Operator-only source
  // overrides are intentionally not inherited into a desktop child.
  removeRuntimeArtifactOverrides(inheritedEnvironment);
  const result = {
    ...inheritedEnvironment,
    ...stateEnvironment(stateRoot),
    ...terminalEnvironment,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    PORT: "0",
    WORKBENCH_HOST: LOOPBACK_HOST,
  };
  // The staged Host and its hermetic REPL probe must not inherit Node startup/debug/cache knobs.
  // The terminal environment adds back only empty preload/module settings and isolated history.
  return result;
}

function rawText(value) {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString("utf8");
  if (Array.isArray(value) && value.every((item) => Buffer.isBuffer(item))) {
    return Buffer.concat(value).toString("utf8");
  }
  return undefined;
}

function parseFrame(value, label) {
  const text = rawText(value);
  try {
    return JSON.parse(text ?? "");
  } catch {
    throw new Error(`${label} sent an invalid JSON frame.`);
  }
}

async function callRpc(fetchImpl, baseUrl, method, { headers = {}, signal, timeoutMs, timers }) {
  const rpcId = `runtime-smoke-${method}-${randomUUID()}`;
  const response = await withTimeout(
    fetchImpl(new URL(`/api/${method}`, baseUrl), {
      body: JSON.stringify({ type: "client-request", rpcId, method, payload: {} }),
      headers: { ...headers, "Content-Type": "application/json" },
      method: "POST",
      signal,
    }),
    `${method} RPC`,
    timeoutMs,
    timers,
  );
  if (!response?.ok || response.status !== 200) {
    throw new Error(`${method} RPC returned HTTP ${response?.status ?? "unknown"}.`);
  }
  const body = await withTimeout(response.json(), `${method} RPC response body`, timeoutMs, timers);
  if (
    !body ||
    body.type !== "server-response" ||
    body.rpcId !== rpcId ||
    !body.result ||
    body.result.ok !== true
  ) {
    throw new Error(`${method} RPC returned an invalid success envelope.`);
  }
  return body.result.value;
}

function assertIsolatedHostDescription(hostDescription, runtimeDirectory, stateRoot) {
  if (
    hostDescription?.product !== "pi-workbench" ||
    typeof hostDescription.version !== "string" ||
    hostDescription.version.length === 0 ||
    typeof hostDescription.piVersion !== "string" ||
    hostDescription.piVersion.length === 0 ||
    hostDescription.piVersion.length === 0 ||
    hostDescription.cwd !== runtimeDirectory ||
    hostDescription.userPackageDir !== path.join(stateRoot, "agent", "npm") ||
    hostDescription.attachedSessions !== 0 ||
    typeof hostDescription.canOpenPath !== "boolean"
  ) {
    throw new Error("host.describe did not reflect the isolated staged Host state.");
  }
}

function assertEmptySessionList(sessionList) {
  if (
    !sessionList ||
    typeof sessionList !== "object" ||
    Array.isArray(sessionList) ||
    !Array.isArray(sessionList.items) ||
    sessionList.items.length !== 0 ||
    (sessionList.runningSessionIds !== undefined &&
      (!Array.isArray(sessionList.runningSessionIds) || sessionList.runningSessionIds.length !== 0))
  ) {
    throw new Error("session.list did not reflect an empty isolated staged Host state.");
  }
}

async function requestRuntimeHttp(
  requestImpl,
  baseUrl,
  pathname,
  { headers = {}, method = "GET", timeoutMs, timers },
) {
  let outgoing;
  const operation = new Promise((resolve, reject) => {
    outgoing = requestImpl(new URL(pathname, baseUrl), { headers, method }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.once("error", reject);
      response.once("end", () => {
        resolve({
          body: Buffer.concat(chunks).toString("utf8"),
          headers: response.headers,
          status: response.statusCode,
        });
      });
    });
    outgoing.once?.("error", reject);
    outgoing.end();
  });
  try {
    return await withTimeout(operation, `${method} ${pathname}`, timeoutMs, timers);
  } catch (error) {
    outgoing?.destroy?.();
    throw error;
  }
}

function smokePiWebSocketPair(WebSocketImpl, baseUrl, { timeoutMs, timers }) {
  const sockets = [];
  const complete = withTimeout(
    new Promise((resolve, reject) => {
      const state = {
        host: { closed: false, opened: false },
        mux: { closed: false, opened: false },
      };
      const urls = {
        host: new URL("/api/events.host", baseUrl),
        mux: new URL("/api/events.mux", baseUrl),
      };
      for (const url of Object.values(urls)) {
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      }
      const maybeExercisePair = () => {
        if (!state.host.opened || !state.mux.opened) return;
        try {
          sockets[0].close(1000, "staged runtime smoke complete");
          sockets[1].send("{}");
        } catch (error) {
          reject(error);
        }
      };
      const maybeFinish = () => {
        if (state.host.closed && state.mux.closed) resolve();
      };
      for (const channel of ["host", "mux"]) {
        const socket = new WebSocketImpl(urls[channel].href);
        sockets.push(socket);
        socket.once?.("error", reject);
        socket.once?.("open", () => {
          state[channel].opened = true;
          maybeExercisePair();
        });
        socket.once?.("close", (code, reason) => {
          if (!state[channel].opened) {
            reject(new Error(`Pi ${channel} WebSocket closed before opening.`));
            return;
          }
          if (channel === "host" && code !== 1000) {
            reject(new Error(`Pi host WebSocket closed with ${code}, expected 1000.`));
            return;
          }
          if (channel === "mux" && (code !== 1008 || rawText(reason) !== "downlink only")) {
            reject(
              new Error(
                `Pi mux WebSocket did not enforce the downlink-only contract: closed with ${code}/${JSON.stringify(rawText(reason) ?? "")}; expected 1008/"downlink only".`,
              ),
            );
            return;
          }
          state[channel].closed = true;
          maybeFinish();
        });
      }
    }),
    "Pi WebSocket handshakes",
    timeoutMs,
    timers,
  );
  return { complete, sockets: () => sockets };
}

function createTerminalChallenge({ createId = randomUUID, platform = process.platform } = {}) {
  const expected = `${TERMINAL_MARKER}:${createId()}`;
  const encoded = Buffer.from(expected, "utf8").toString("base64");
  const lineEnding = platform === "win32" ? "\r\n" : "\r";
  const input =
    `process.stdout.write(Buffer.from(${JSON.stringify(encoded)},'base64'));process.exit(0)` +
    lineEnding;
  assert.equal(input.includes(expected), false, "Terminal challenge plaintext must not be echoed.");
  return { expected, input };
}

function terminalWebSocketUrl(baseUrl, runtimeDirectory, sessionId) {
  const url = new URL("/api/terminal", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("sessionId", sessionId);
  url.searchParams.set("cwd", runtimeDirectory);
  url.searchParams.set("cols", "80");
  url.searchParams.set("rows", "24");
  return url.href;
}

function smokeTerminalWebSocket(WebSocketImpl, url, { challenge, timeoutMs, timers }) {
  let socket;
  let processHandle;
  const terminalUrl = new URL(url);
  const sessionId = terminalUrl.searchParams.get("sessionId");
  const expectedCwd = terminalUrl.searchParams.get("cwd");
  let outputTail = "";
  let sawMarker = false;
  let sawExit = false;
  let lastSequence = 0;
  const complete = withTimeout(
    new Promise((resolve, reject) => {
      socket = new WebSocketImpl(url);
      socket.once?.("error", reject);
      socket.on("message", (raw) => {
        let frame;
        try {
          frame = parseFrame(raw, "Terminal WebSocket");
        } catch (error) {
          reject(error);
          return;
        }
        if (frame?.type === "process/ready") {
          const process = frame.process;
          if (
            !process ||
            typeof process.processHandle !== "string" ||
            process.processHandle.length === 0 ||
            process.processHandle.length > 1_024 ||
            process.sessionId !== sessionId ||
            process.kind !== "shell" ||
            process.cwd !== expectedCwd ||
            typeof process.process !== "string" ||
            process.process.length === 0 ||
            process.tty !== true ||
            process.processState !== "running" ||
            process.interactionState !== "none" ||
            process.attachmentState !== "attached" ||
            !Number.isSafeInteger(process.pid) ||
            process.pid < 1 ||
            !Number.isSafeInteger(process.startedAt) ||
            process.startedAt < 0 ||
            !Number.isSafeInteger(process.outputBytes) ||
            process.outputBytes < 0 ||
            !Number.isSafeInteger(process.outputBytesCap) ||
            process.outputBytesCap < 1 ||
            typeof process.outputCapReached !== "boolean"
          ) {
            reject(new Error("Terminal WebSocket sent an invalid PTY ready frame."));
            return;
          }
          processHandle = process.processHandle;
          socket.send(
            JSON.stringify({ type: "process/resize", processHandle, cols: 100, rows: 30 }),
          );
          socket.send(
            JSON.stringify({
              type: "process/write-stdin",
              processHandle,
              data: challenge.input,
            }),
          );
          return;
        }
        if (
          frame?.type === "process/output-delta" &&
          frame.delta?.processHandle === processHandle
        ) {
          if (
            !Number.isSafeInteger(frame.delta.sequence) ||
            frame.delta.sequence < 1 ||
            frame.delta.sequence <= lastSequence ||
            frame.delta.stream !== "terminal" ||
            typeof frame.delta.data !== "string" ||
            !Number.isSafeInteger(frame.delta.outputBytes) ||
            frame.delta.outputBytes < 0 ||
            typeof frame.delta.outputCapReached !== "boolean"
          ) {
            reject(new Error("Terminal WebSocket sent an invalid output frame."));
            return;
          }
          lastSequence = frame.delta.sequence;
          outputTail = `${outputTail}${frame.delta.data}`.slice(-TERMINAL_MARKER_TAIL_LENGTH);
          sawMarker ||= outputTail.includes(challenge.expected);
          return;
        }
        if (frame?.type === "process/exited") {
          if (frame.exit?.processHandle !== processHandle) {
            reject(new Error("Terminal WebSocket exited a different process."));
            return;
          }
          if (
            frame.exit.processState !== "exited" ||
            frame.exit.reason !== "exited" ||
            frame.exit.exitCode !== 0 ||
            (frame.exit.signal !== undefined &&
              (!Number.isSafeInteger(frame.exit.signal) || frame.exit.signal < 0)) ||
            !Number.isSafeInteger(frame.exit.outputBytes) ||
            frame.exit.outputBytes < 0 ||
            typeof frame.exit.outputCapReached !== "boolean"
          ) {
            reject(
              new Error(`Terminal process exited unexpectedly: ${JSON.stringify(frame.exit)}.`),
            );
            return;
          }
          sawExit = true;
          return;
        }
        if (frame?.type === "process/error") {
          reject(new Error(`Terminal WebSocket reported ${frame.code ?? "an unknown"} error.`));
        }
      });
      socket.once?.("close", (code) => {
        if (!sawExit || !sawMarker) {
          reject(new Error("Terminal WebSocket closed before marker output and clean exit."));
          return;
        }
        if (code !== 1000) {
          reject(new Error(`Terminal WebSocket closed with ${code}, expected 1000.`));
          return;
        }
        resolve({ processHandle });
      });
    }),
    "Terminal WebSocket",
    timeoutMs,
    timers,
  );
  return { complete, socket: () => socket };
}

module.exports = {
  DEFAULT_OPERATION_TIMEOUT_MS,
  DEFAULT_READY_TIMEOUT_MS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  TERMINAL_MARKER,
  assertEmptySessionList,
  assertIsolatedHostDescription,
  callRpc,
  createSmokeStateDirectory,
  createTerminalChallenge,
  requestRuntimeHttp,
  smokePiWebSocketPair,
  smokeTerminalWebSocket,
  stagedHostEnvironment,
  stateEnvironment,
  terminalShellEnvironment,
  terminalWebSocketUrl,
  withTimeout,
};
