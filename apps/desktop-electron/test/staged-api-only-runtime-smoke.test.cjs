require("tsx/cjs");

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { PassThrough, Writable } = require("node:stream");
const test = require("node:test");

const {
  createRuntimeHostHealth,
  createRuntimeHostIdentity,
  createRuntimeHostReadyFrame,
  createRuntimeHostShutdownAckFrame,
} = require("@workbench/host-contracts/runtime-host-control");
const {
  createRuntimeWebSocketAuthenticatedFrame,
  parseRuntimeWebSocketAuthenticateFrame,
} = require("@workbench/host-contracts/runtime-connection");

const {
  TERMINAL_MARKER,
  createSmokeStateDirectory,
} = require("../scripts/runtime-smoke-support.cjs");
const {
  DEFAULT_ALLOWED_ORIGIN,
  ERROR_TYPE,
  RESULT_TYPE,
  runStagedApiOnlyRuntimeSmoke,
  runtimeArgument,
} = require("../scripts/staged-api-only-runtime-smoke.cjs");

const ACCESS_TOKEN = "stdin-only-api-runtime-secret";
const INSTANCE_ID = "api-runtime-smoke-instance";
const HOST_PID = 44_001;
const HTTP_ORIGIN = "http://127.0.0.1:43271";
const ELECTRON_IDENTITY = Object.freeze({
  platform: "linux",
  arch: "x64",
  libc: "glibc",
  electronVersion: "43.4.1",
  nodeVersion: "24.18.1",
  nodeModuleAbi: "148",
  napiVersion: "10",
});
const ELECTRON_TARGET = Object.freeze({
  runtimeFlavor: "electron-node",
  platform: "linux",
  arch: "x64",
  targetTriple: "x86_64-unknown-linux-gnu",
  libc: "glibc",
  nodeVersion: "24.18.1",
  nodeModuleAbi: 148,
  napiVersion: 10,
  electronVersion: "43.4.1",
});

class TrackedPassThrough extends PassThrough {
  dataListeners = 0;

  on(event, listener) {
    if (event === "data") this.dataListeners += 1;
    return super.on(event, listener);
  }
}

class FakeControlChild extends EventEmitter {
  exitCode = null;
  pid = HOST_PID;
  signalCode = null;
  stderr = new TrackedPassThrough();
  stdout = new TrackedPassThrough();
  inputFrames = [];

  constructor({ readyInstanceId = INSTANCE_ID, stderrLeak } = {}) {
    super();
    this.readyInstanceId = readyInstanceId;
    this.stderrLeak = stderrLeak;
    let pending = "";
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        pending += String(chunk);
        for (;;) {
          const newline = pending.indexOf("\n");
          if (newline < 0) break;
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          const frame = JSON.parse(line);
          this.inputFrames.push(frame);
          this.#handleFrame(frame);
        }
        callback();
      },
    });
  }

  #handleFrame(frame) {
    if (frame.type === "start") {
      queueMicrotask(() => {
        if (this.stderrLeak) this.stderr.write(this.stderrLeak);
        this.stdout.write(
          `${JSON.stringify(
            createRuntimeHostReadyFrame({
              instanceId: this.readyInstanceId,
              pid: this.pid,
              httpOrigin: HTTP_ORIGIN,
            }),
          )}\n`,
        );
      });
      return;
    }
    if (frame.type === "shutdown") {
      queueMicrotask(() => {
        this.stdout.write(`${JSON.stringify(createRuntimeHostShutdownAckFrame())}\n`, () => {
          this.exit(0, null);
        });
      });
    }
  }

  exit(code, signal) {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
    this.stdout.end();
    this.stderr.end();
    queueMicrotask(() => this.emit("close", code, signal));
  }
}

function response(body, { headers = {}, status = 200 } = {}) {
  return new Response(body, { headers, status });
}

function createFakeRuntimeFetch({
  calls,
  runtimeDirectory,
  stateRoot,
  rejectAuthorized = false,
  allowedOrigin = DEFAULT_ALLOWED_ORIGIN,
}) {
  return async (input, init = {}) => {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    const authorization = headers.get("authorization");
    const origin = headers.get("origin");
    calls.push({
      authorization,
      body: init.body,
      method: init.method ?? "GET",
      origin,
      signal: init.signal,
      url: url.href,
    });

    if (origin === "https://malicious.invalid") {
      return response("Forbidden", { status: 403 });
    }
    if (authorization !== `Bearer ${ACCESS_TOKEN}` || rejectAuthorized) {
      return response("Unauthorized", {
        status: 401,
        headers: {
          ...(origin === allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
          "WWW-Authenticate": "Bearer",
        },
      });
    }
    const cors = { "Access-Control-Allow-Origin": allowedOrigin };
    if (url.pathname === "/api/health") {
      return Response.json(createRuntimeHostHealth(INSTANCE_ID), { headers: cors });
    }
    if (url.pathname === "/api/identity") {
      return Response.json(createRuntimeHostIdentity({ instanceId: INSTANCE_ID, pid: HOST_PID }), {
        headers: cors,
      });
    }

    const request = JSON.parse(init.body);
    const value =
      request.method === "host.describe"
        ? {
            product: "pi-workbench",
            version: "1.0.0",
            piVersion: "0.84.2",
            cwd: runtimeDirectory,
            userPackageDir: path.join(stateRoot, "agent", "npm"),
            attachedSessions: 0,
            canOpenPath: true,
          }
        : { items: [], runningSessionIds: [] };
    return Response.json(
      {
        type: "server-response",
        rpcId: request.rpcId,
        result: { ok: true, value },
      },
      { headers: cors },
    );
  };
}

function createFakeNativeWebSocket(context, { failAcknowledgementPath } = {}) {
  return class FakeNativeWebSocket {
    onclose = null;
    onerror = null;
    onmessage = null;
    onopen = null;
    readyState = 0;

    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.sent = [];
      this.acknowledged = false;
      this.closed = false;
      this.pathname = new URL(url).pathname;
      context.sockets.push(this);
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.({ type: "open" });
      });
    }

    send(data) {
      this.sent.push(data);
      const frame = JSON.parse(String(data));
      if (!this.acknowledged) {
        const authentication = parseRuntimeWebSocketAuthenticateFrame(frame);
        assert.ok(authentication, "the first WebSocket frame must be authenticate");
        assert.equal(authentication.instanceId, INSTANCE_ID);
        assert.equal(authentication.accessToken, ACCESS_TOKEN);
        context.timeline.push(`${this.pathname}:authenticate`);
        queueMicrotask(() => {
          this.acknowledged = true;
          context.timeline.push(`${this.pathname}:ack`);
          this.onmessage?.({
            data: JSON.stringify(
              createRuntimeWebSocketAuthenticatedFrame(
                this.pathname === failAcknowledgementPath ? "wrong-instance" : INSTANCE_ID,
              ),
            ),
          });
          if (this.pathname === "/api/terminal" && this.pathname !== failAcknowledgementPath) {
            queueMicrotask(() => this.#sendTerminalReady());
          }
        });
        return;
      }

      context.timeline.push(`${this.pathname}:business:${frame.type ?? "json"}`);
      if (this.pathname === "/api/events.mux") {
        this.#closeFromServer(1008, "downlink only");
        return;
      }
      if (this.pathname === "/api/terminal" && frame.type === "process/write-stdin") {
        this.#answerTerminalChallenge(frame);
      }
    }

    close(code = 1000, reason = "") {
      this.#closeFromServer(code, reason);
    }

    #sendTerminalReady() {
      const terminalUrl = new URL(this.url);
      this.onmessage?.({
        data: JSON.stringify({
          type: "process/ready",
          process: {
            kind: "shell",
            cwd: terminalUrl.searchParams.get("cwd"),
            process: "/virtual/node",
            pid: 32_001,
            processHandle: terminalUrl.searchParams.get("sessionId"),
            processState: "running",
            sessionId: terminalUrl.searchParams.get("sessionId"),
            tty: true,
            interactionState: "none",
            attachmentState: "attached",
            startedAt: 1,
            outputBytes: 0,
            outputBytesCap: 1_048_576,
            outputCapReached: false,
          },
        }),
      });
    }

    #answerTerminalChallenge(frame) {
      const encodedMatch = frame.data.match(/Buffer\.from\(("(?:[^"\\]|\\.)*"),'base64'\)/u);
      assert.ok(encodedMatch, "terminal input must carry the non-echo challenge");
      const expected = Buffer.from(JSON.parse(encodedMatch[1]), "base64").toString("utf8");
      assert.equal(frame.data.includes(expected), false);
      const midpoint = Math.floor(expected.length / 2);
      queueMicrotask(() => {
        for (const [index, data] of [
          expected.slice(0, midpoint),
          expected.slice(midpoint),
        ].entries()) {
          this.onmessage?.({
            data: JSON.stringify({
              type: "process/output-delta",
              delta: {
                data,
                outputBytes: index === 0 ? midpoint : expected.length,
                outputCapReached: false,
                processHandle: frame.processHandle,
                sequence: index + 1,
                stream: "terminal",
              },
            }),
          });
        }
        this.onmessage?.({
          data: JSON.stringify({
            type: "process/exited",
            exit: {
              exitCode: 0,
              outputBytes: expected.length,
              outputCapReached: false,
              processHandle: frame.processHandle,
              processState: "exited",
              reason: "exited",
            },
          }),
        });
        this.#closeFromServer(1000, "");
      });
    }

    #closeFromServer(code, reason) {
      if (this.closed) return;
      this.closed = true;
      this.readyState = 3;
      queueMicrotask(() => this.onclose?.({ code, reason }));
    }
  };
}

function fixture({
  child = new FakeControlChild(),
  childWorkingDirectory,
  failAcknowledgementPath,
  rejectAuthorized = false,
  allowedOrigin = DEFAULT_ALLOWED_ORIGIN,
} = {}) {
  const stateRoot = path.join("/temporary", "staged-api-only-runtime-smoke");
  const runtimeDirectory = path.join("/real", "staged", "runtime-node", "electron-target");
  const runtimeArtifact = Object.freeze({
    artifactRoot: runtimeDirectory,
    entrypoint: path.join(runtimeDirectory, "server.mjs"),
    manifestPath: path.join(runtimeDirectory, "artifact-manifest.json"),
    manifest: Object.freeze({ target: ELECTRON_TARGET }),
  });
  const fetchCalls = [];
  const webSockets = { sockets: [], timeline: [] };
  const removed = [];
  const admissionCalls = [];
  const spawned = [];
  const stopped = [];
  return {
    child,
    admissionCalls,
    fetchCalls,
    removed,
    runtimeDirectory,
    spawned,
    stateRoot,
    stopped,
    webSockets,
    options: {
      WebSocketImpl: createFakeNativeWebSocket(webSockets, { failAcknowledgementPath }),
      createAccessToken: () => ACCESS_TOKEN,
      createId: (() => {
        let sequence = 0;
        return () => `deterministic-${++sequence}`;
      })(),
      electronExecutable: "/virtual/electron",
      environment: {
        CODEX_HOME: "/preserved/codex-home",
        HOME: "/preserved/home",
        NODE_OPTIONS: "--require /must-not-load.cjs",
        WORKBENCH_RUNTIME_ARTIFACT_MANIFEST: "/malicious/outside/artifact-manifest.json",
        WORKBENCH_RUNTIME_ARTIFACT_TARGET_JSON: '{"runtimeFlavor":"node"}',
      },
      fetchImpl: createFakeRuntimeFetch({
        allowedOrigin,
        calls: fetchCalls,
        rejectAuthorized,
        runtimeDirectory: childWorkingDirectory ?? stateRoot,
        stateRoot,
      }),
      mkdtemp: () => stateRoot,
      nodeExecutable: "/build-orchestrator/node",
      remove: (...arguments_) => removed.push(arguments_),
      resolveArtifact: async (options) => {
        admissionCalls.push(options);
        return runtimeArtifact;
      },
      runtimeDirectory,
      runtimeArtifact,
      childWorkingDirectory,
      target: ELECTRON_TARGET,
      readIdentity: () => ELECTRON_IDENTITY,
      spawnChild: (...arguments_) => {
        spawned.push(arguments_);
        return child;
      },
      stopProcess: async (target) => {
        stopped.push(target);
        child.exit(1, null);
        return { exited: true, forced: true };
      },
      temporaryDirectory: "/temporary",
      writeFile: () => undefined,
      readyTimeoutMs: 200,
      operationTimeoutMs: 200,
      shutdownTimeoutMs: 200,
      cleanupTimeoutMs: 200,
      allowedOrigin,
    },
  };
}

test("smoke state uses a canonical directory when the temporary parent is a symlink", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "workbench-smoke-state-test-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const target = path.join(root, "target");
  const alias = path.join(root, "alias");
  mkdirSync(target);
  symlinkSync(target, alias, "junction");

  const stateRoot = createSmokeStateDirectory(path.join(alias, "state-"));

  assert.equal(path.dirname(stateRoot), realpathSync(target));
  assert.equal(stateRoot, realpathSync(stateRoot));
});

test("requires an explicit staged runtime CLI argument", () => {
  assert.throws(() => runtimeArgument([]), /Usage: staged-api-only-runtime-smoke/u);
  assert.equal(runtimeArgument(["--runtime", "desktop-runtime"]), path.resolve("desktop-runtime"));
});

test("prints a structured JSON error when CLI arguments are invalid", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "..", "scripts", "staged-api-only-runtime-smoke.cjs")],
    {
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  const error = JSON.parse(result.stderr);
  assert.equal(error.type, ERROR_TYPE);
  assert.match(error.message, /Usage: staged-api-only-runtime-smoke/u);
});

test("smokes the staged API-only Host through control, auth, RPC, WebSockets, PTY, and shutdown", async () => {
  const setup = fixture();
  const readyCheckpoints = [];
  setup.options.onReady = async (checkpoint) => {
    readyCheckpoints.push(checkpoint);
    assert.deepEqual(setup.fetchCalls, []);
  };
  const report = await runStagedApiOnlyRuntimeSmoke(setup.options);

  assert.equal(report.type, RESULT_TYPE);
  assert.deepEqual(report.control, [
    "start:stdin",
    "ready",
    "shutdown:stdin",
    "shutdown-ack",
    "exit:0",
  ]);
  assert.deepEqual(report.http, [
    "health:200",
    "identity:200",
    "missing-bearer:401",
    "malicious-origin:403",
  ]);
  assert.deepEqual(report.rpc, ["host.describe", "session.list"]);
  assert.equal(JSON.stringify(report).includes(ACCESS_TOKEN), false);
  assert.equal(readyCheckpoints.length, 1);
  assert.equal(readyCheckpoints[0].ready.httpOrigin, HTTP_ORIGIN);
  assert.equal(readyCheckpoints[0].runtimeArtifact, setup.options.runtimeArtifact);
  assert.deepEqual(setup.admissionCalls, [
    {
      artifactRoot: setup.runtimeDirectory,
      expectedTarget: ELECTRON_TARGET,
    },
  ]);

  assert.deepEqual(
    setup.child.inputFrames.map((frame) => frame.type),
    ["start", "shutdown"],
  );
  assert.equal(setup.child.inputFrames[0].accessToken, ACCESS_TOKEN);
  assert.deepEqual(setup.child.inputFrames[0].allowedOrigins, [DEFAULT_ALLOWED_ORIGIN]);
  assert.equal(setup.child.inputFrames[1].accessToken, undefined);
  assert.ok(setup.child.stderr.dataListeners > 0, "stderr must be drained");
  assert.ok(setup.child.stdout.dataListeners > 0, "stdout must be consumed as control NDJSON");

  const [executable, arguments_, spawnOptions] = setup.spawned[0];
  assert.equal(executable, "/virtual/electron");
  assert.deepEqual(arguments_, [path.join(setup.runtimeDirectory, "server.mjs")]);
  assert.deepEqual(spawnOptions.stdio, ["pipe", "pipe", "pipe"]);
  assert.equal(spawnOptions.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(spawnOptions.env.HOME, "/preserved/home");
  assert.equal(spawnOptions.env.CODEX_HOME, "/preserved/codex-home");
  assert.equal(spawnOptions.env.NODE_OPTIONS, "");
  assert.equal(spawnOptions.env.WORKBENCH_RUNTIME_ARTIFACT_MANIFEST, undefined);
  assert.equal(spawnOptions.env.WORKBENCH_RUNTIME_ARTIFACT_TARGET_JSON, undefined);
  assert.equal(spawnOptions.cwd, setup.stateRoot);
  assert.equal(JSON.stringify(arguments_).includes(ACCESS_TOKEN), false);
  assert.equal(JSON.stringify(spawnOptions.env).includes(ACCESS_TOKEN), false);

  assert.deepEqual(
    setup.fetchCalls.map((call) => call.url),
    [
      `${HTTP_ORIGIN}/api/health`,
      `${HTTP_ORIGIN}/api/identity`,
      `${HTTP_ORIGIN}/api/health`,
      `${HTTP_ORIGIN}/api/identity`,
      `${HTTP_ORIGIN}/api/host.describe`,
      `${HTTP_ORIGIN}/api/session.list`,
    ],
  );
  assert.equal(
    setup.fetchCalls.every((call) => !call.url.includes(ACCESS_TOKEN)),
    true,
  );
  assert.equal(setup.fetchCalls[0].origin, DEFAULT_ALLOWED_ORIGIN);
  assert.equal(setup.fetchCalls[0].authorization, `Bearer ${ACCESS_TOKEN}`);
  assert.equal(setup.fetchCalls[2].authorization, null);
  assert.equal(setup.fetchCalls[3].origin, "https://malicious.invalid");
  assert.equal(
    setup.fetchCalls.every((call) => call.signal instanceof AbortSignal),
    true,
  );

  assert.equal(setup.webSockets.sockets.length, 3);
  for (const socket of setup.webSockets.sockets) {
    assert.equal(socket.options.origin, DEFAULT_ALLOWED_ORIGIN);
    assert.equal(socket.url.includes(ACCESS_TOKEN), false);
    const authentication = parseRuntimeWebSocketAuthenticateFrame(JSON.parse(socket.sent[0]));
    assert.ok(authentication);
    assert.equal(authentication.accessToken, ACCESS_TOKEN);
  }
  for (const pathname of ["/api/events.host", "/api/events.mux", "/api/terminal"]) {
    const acknowledgement = setup.webSockets.timeline.indexOf(`${pathname}:ack`);
    const business = setup.webSockets.timeline.findIndex((entry) =>
      entry.startsWith(`${pathname}:business:`),
    );
    if (business >= 0) assert.ok(acknowledgement >= 0 && acknowledgement < business);
  }
  const terminal = setup.webSockets.sockets.find((socket) => socket.pathname === "/api/terminal");
  assert.ok(terminal);
  assert.equal(
    terminal.sent.slice(1).some((frame) => String(frame).includes(TERMINAL_MARKER)),
    false,
  );
  assert.deepEqual(setup.removed, [[setup.stateRoot, { force: true, recursive: true }]]);
  assert.deepEqual(setup.stopped, []);
});

test("uses the release cwd without giving it ownership of isolated smoke state", async () => {
  const childWorkingDirectory = path.join("/real", "staged", "desktop-runtime");
  const setup = fixture({ childWorkingDirectory });

  await runStagedApiOnlyRuntimeSmoke(setup.options);

  assert.equal(setup.spawned[0][2].cwd, childWorkingDirectory);
  assert.deepEqual(setup.removed, [[setup.stateRoot, { force: true, recursive: true }]]);
});

test("rejects an external descriptor outside the staged Runtime selection root", async () => {
  const setup = fixture();
  const admittedArtifact = setup.options.runtimeArtifact;
  setup.options.runtimeArtifact = Object.freeze({
    artifactRoot: "/source/runtime/electron-target",
    entrypoint: "/source/runtime/electron-target/server.mjs",
    manifestPath: "/source/runtime/electron-target/artifact-manifest.json",
    manifest: Object.freeze({ target: ELECTRON_TARGET }),
  });
  setup.options.resolveArtifact = async (options) => {
    setup.admissionCalls.push(options);
    return admittedArtifact;
  };
  await assert.rejects(
    runStagedApiOnlyRuntimeSmoke(setup.options),
    /outside the admitted selection root/u,
  );
  assert.deepEqual(setup.admissionCalls, [
    { artifactRoot: setup.runtimeDirectory, expectedTarget: ELECTRON_TARGET },
  ]);
  assert.deepEqual(setup.spawned, []);
  assert.deepEqual(setup.removed, []);
});

test("propagates a custom allowed origin through Runtime control, HTTP, and WebSockets", async () => {
  const allowedOrigin = "http://127.0.0.1:44127";
  const setup = fixture({ allowedOrigin });

  await runStagedApiOnlyRuntimeSmoke(setup.options);

  assert.deepEqual(setup.child.inputFrames[0].allowedOrigins, [allowedOrigin]);
  assert.equal(setup.fetchCalls[0].origin, allowedOrigin);
  assert.equal(setup.fetchCalls[2].origin, allowedOrigin);
  for (const socket of setup.webSockets.sockets) {
    assert.equal(socket.options.origin, allowedOrigin);
  }
});

test("rejects and redacts credentials leaked by child control or diagnostics", async () => {
  for (const child of [
    new FakeControlChild({ readyInstanceId: ACCESS_TOKEN }),
    new FakeControlChild({ stderrLeak: ACCESS_TOKEN }),
  ]) {
    const setup = fixture({ child });
    let failure;
    try {
      await runStagedApiOnlyRuntimeSmoke(setup.options);
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof Error);
    assert.match(failure.message, /credential/u);
    assert.equal(failure.message.includes(ACCESS_TOKEN), false);
    assert.deepEqual(setup.stopped, [setup.child]);
    assert.deepEqual(setup.removed, [[setup.stateRoot, { force: true, recursive: true }]]);
  }
});

test("fails closed when authenticated HTTP admission is missing and cleans only its temp root", async () => {
  const setup = fixture({ rejectAuthorized: true });
  await assert.rejects(
    runStagedApiOnlyRuntimeSmoke(setup.options),
    /health endpoint did not return its exact authenticated identity/u,
  );
  assert.deepEqual(setup.stopped, [setup.child]);
  assert.deepEqual(setup.removed, [[setup.stateRoot, { force: true, recursive: true }]]);
});

test("removes its isolated root when credential creation fails before spawn", async () => {
  const setup = fixture();
  setup.options.createAccessToken = () => {
    throw new Error("credential generation failed");
  };
  await assert.rejects(
    runStagedApiOnlyRuntimeSmoke(setup.options),
    /credential generation failed/u,
  );
  assert.deepEqual(setup.spawned, []);
  assert.deepEqual(setup.removed, [[setup.stateRoot, { force: true, recursive: true }]]);
});

test("fails before WebSocket business traffic when the authentication acknowledgement is invalid", async () => {
  const setup = fixture({ failAcknowledgementPath: "/api/events.host" });
  await assert.rejects(runStagedApiOnlyRuntimeSmoke(setup.options), /authentication/u);
  const hostBusiness = setup.webSockets.timeline.filter((entry) =>
    entry.startsWith("/api/events.host:business:"),
  );
  assert.deepEqual(hostBusiness, []);
  assert.deepEqual(setup.stopped, [setup.child]);
  assert.deepEqual(setup.removed, [[setup.stateRoot, { force: true, recursive: true }]]);
});

test("retains and reports only its isolated root when a failed Host survives cleanup", async () => {
  const setup = fixture({ rejectAuthorized: true });
  setup.options.stopProcess = async (target) => {
    setup.stopped.push(target);
    return { exited: false, forced: true };
  };
  await assert.rejects(
    runStagedApiOnlyRuntimeSmoke(setup.options),
    new RegExp(`could not be stopped.*${setup.stateRoot}`, "u"),
  );
  assert.deepEqual(setup.stopped, [setup.child]);
  assert.deepEqual(setup.removed, []);
});
