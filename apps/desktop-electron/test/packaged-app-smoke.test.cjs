const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const {
  GRACEFUL_QUIT_EXPRESSION,
  MAIN_WINDOW_PATCH_EXPRESSION,
  MAIN_WINDOW_RELOAD_EXPRESSION,
  RENDERER_READY_EXPRESSION,
  RENDERER_RELOADED_EXPRESSION,
  RENDERER_RUNTIME_IDENTITY_EXPRESSION,
  RUNTIME_RESTART_EXPRESSION,
  assertPackagedProcessGroup,
  assertPackagedProcessTopology,
  acquireLinuxDisplay,
  attachPackagedOwnerRegistry,
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
  resolveLinuxPackagedApplication,
  resolvePackagedAppSmokeContract,
  resolveRendererDebuggerTarget,
  runPackagedAppSmoke,
  validateRendererReady,
  validateRendererRuntimeIdentity,
} = require("../scripts/packaged-app-smoke.cjs");

const TARGET = Object.freeze({
  platform: "linux",
  arch: process.arch,
});

function fixture(t, prefix = "workbench-packaged-app-smoke-test-") {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  return root;
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  return child;
}

test("recognizes only canonical ephemeral loopback inspector endpoints", () => {
  assert.equal(linuxUnpackedDirectoryName("x64"), "linux-unpacked");
  assert.equal(linuxUnpackedDirectoryName("arm64"), "linux-arm64-unpacked");
  assert.throws(() => linuxUnpackedDirectoryName("mips"), /does not recognize/u);

  assert.equal(
    parseInspectorEndpoint("ws://127.0.0.1:43210/01234567-abcd", "main"),
    "ws://127.0.0.1:43210/01234567-abcd",
  );
  assert.equal(
    parseInspectorEndpoint("ws://127.0.0.1:43211/devtools/browser/01234567-abcd", "renderer"),
    "ws://127.0.0.1:43211/devtools/browser/01234567-abcd",
  );
  assert.equal(
    parseInspectorEndpoint("ws://127.0.0.1:43211/devtools/page/01234567-abcd", "renderer-target"),
    "ws://127.0.0.1:43211/devtools/page/01234567-abcd",
  );
  for (const [url, kind] of [
    ["ws://0.0.0.0:43210/01234567", "main"],
    ["ws://127.0.0.1:0/01234567", "main"],
    ["ws://user@127.0.0.1:43210/01234567", "main"],
    ["ws://127.0.0.1:43210/devtools/page/01234567", "renderer"],
    ["wss://127.0.0.1:43210/01234567", "main"],
  ]) {
    assert.equal(parseInspectorEndpoint(url, kind), undefined);
  }
});

test("requires the packaged-app execution contract only for a native Linux target", () => {
  assert.deepEqual(
    resolvePackagedAppSmokeContract(
      { platform: "linux", arch: "x64" },
      {
        hostArch: "x64",
        hostPlatform: "linux",
      },
    ),
    {
      execution: "required",
      reason: "Linux packaged-app execution contract is native to this host.",
    },
  );
  for (const [target, host] of [
    [
      { platform: "win32", arch: "x64" },
      { hostArch: "x64", hostPlatform: "linux" },
    ],
    [
      { platform: "linux", arch: "arm64" },
      { hostArch: "x64", hostPlatform: "linux" },
    ],
    [
      { platform: "darwin", arch: "arm64" },
      { hostArch: "arm64", hostPlatform: "darwin" },
    ],
    [
      { platform: "win32", arch: "x64" },
      { hostArch: "x64", hostPlatform: "win32" },
    ],
  ]) {
    const contract = resolvePackagedAppSmokeContract(target, host);
    assert.equal(contract.execution, "not-run");
    assert.match(contract.reason, /cannot safely launch|no implemented .* cleanup/u);
  }
  assert.throws(
    () => resolvePackagedAppSmokeContract({ platform: "freebsd", arch: "x64" }),
    /recognized target platform and architecture/u,
  );
});

test("discovers split inspector diagnostics and detects a credential across chunks", async () => {
  const child = fakeChild();
  const monitor = createPackagedOutputMonitor(child);
  const main = monitor.waitFor("main", 1_000, { clearTimeout, setTimeout });
  const renderer = monitor.waitFor("renderer", 1_000, { clearTimeout, setTimeout });

  child.stderr.emit("data", "Debugger listening on ws://127.0.0.1:43210/0123-");
  child.stderr.emit(
    "data",
    "4567\nDevTools listening on ws://127.0.0.1:43211/devtools/browser/89ab-cdef\n",
  );
  assert.equal(await main, "ws://127.0.0.1:43210/0123-4567");
  assert.equal(await renderer, "ws://127.0.0.1:43211/devtools/browser/89ab-cdef");

  child.stdout.emit("data", "diagnostic before bootstrap\n");
  monitor.setCredential("secret-runtime-token");
  child.stderr.emit("data", "unsafe secret-runtime-");
  child.stderr.emit("data", "token output");
  assert.throws(
    () => monitor.assertCredentialAbsent(),
    /diagnostics contained the Runtime credential/u,
  );
});

test("accepts only an explicitly expected packaged application exit", async () => {
  const unexpectedChild = fakeChild();
  const unexpectedMonitor = createPackagedOutputMonitor(unexpectedChild);
  const endpoint = unexpectedMonitor.waitFor("main", 1_000, { clearTimeout, setTimeout });
  unexpectedChild.emit("exit", 0, null);
  await assert.rejects(endpoint, /exited before smoke completion \(code 0\)/u);
  assert.throws(
    () => unexpectedMonitor.assertCredentialAbsent(),
    /exited before smoke completion \(code 0\)/u,
  );

  const expectedChild = fakeChild();
  const expectedMonitor = createPackagedOutputMonitor(expectedChild);
  expectedMonitor.setCredential("runtime-secret");
  expectedMonitor.expectExit();
  expectedChild.emit("exit", 0, null);
  assert.doesNotThrow(() => expectedMonitor.assertCredentialAbsent());
});

test("bounds post-bootstrap diagnostics and unterminated diagnostic lines", () => {
  const child = fakeChild();
  const monitor = createPackagedOutputMonitor(child);
  monitor.setCredential("runtime-secret");
  child.stderr.emit("data", "x".repeat(64 * 1024 + 1));
  assert.throws(() => monitor.assertCredentialAbsent(), /excessive unterminated diagnostic line/u);
});

test("retains diagnostics until the second Runtime credential is known", () => {
  const child = fakeChild();
  const monitor = createPackagedOutputMonitor(child);
  monitor.setCredential("first-runtime-secret");
  child.stderr.emit("data", "unsafe second-runtime-secret output\n");
  assert.throws(
    () => monitor.setCredential("second-runtime-secret"),
    /diagnostics contained the Runtime credential/u,
  );
});

test("sanitizes the packaged process environment, always owns Xvfb, and creates a non-echoed POSIX PTY probe", async () => {
  const environment = createPackagedSmokeEnvironment(
    {
      DISPLAY: ":7",
      ELECTRON_RUN_AS_NODE: "1",
      NODE_OPTIONS: "--inspect",
      WORKBENCH_RUNTIME_ACCESS_TOKEN: "stale",
      PATH: "/bin",
    },
    "/isolated/state",
    ":99",
  );
  assert.equal(environment.DISPLAY, ":99");
  assert.equal(environment.HOME, "/isolated/state/home");
  assert.equal(environment.PI_CODING_AGENT_DIR, "/isolated/state/agent");
  assert.equal(environment.PI_WORKBENCH_SETTINGS_FILE, "/isolated/state/workbench-settings.json");
  assert.equal(environment.SHELL, "/bin/sh");
  assert.equal(environment.PATH, "/bin");
  assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(environment.NODE_OPTIONS, undefined);
  assert.equal(environment.WORKBENCH_RUNTIME_ACCESS_TOKEN, undefined);

  const xvfb = fakeChild();
  xvfb.stdio = [undefined, undefined, undefined, new EventEmitter()];
  const spawned = [];
  const displayPromise = acquireLinuxDisplay(
    { DISPLAY: ":77", PATH: "/bin" },
    {
      spawnChild(command, args, options) {
        spawned.push({ args, command, options });
        queueMicrotask(() => xvfb.stdio[3].emit("data", "99\n"));
        return xvfb;
      },
      timeoutMs: 1_000,
      timers: { clearTimeout, setTimeout },
    },
  );
  const display = await displayPromise;
  assert.equal(display.display, ":99");
  assert.equal(display.child, xvfb);
  assert.equal(spawned[0].command, "Xvfb");
  assert.equal(spawned[0].options.env.DISPLAY, undefined);

  const malformedXvfb = fakeChild();
  const malformedSignals = [];
  malformedXvfb.kill = (signal) => {
    malformedSignals.push(signal);
    queueMicrotask(() => {
      malformedXvfb.signalCode = signal;
      malformedXvfb.emit("exit", null, signal);
    });
  };
  await assert.rejects(
    acquireLinuxDisplay(
      { DISPLAY: ":77" },
      {
        spawnChild: () => malformedXvfb,
        timeoutMs: 1_000,
        timers: { clearTimeout, setTimeout },
      },
    ),
    /did not expose its display descriptor/u,
  );
  assert.deepEqual(malformedSignals, ["SIGTERM"]);

  const challenge = createPosixTerminalChallenge({ createId: () => "fixed-id" });
  assert.equal(challenge.expected, "__workbench_staged_terminal_smoke__:fixed-id");
  assert.equal(challenge.input.includes(challenge.expected), false);
  assert.match(challenge.input, /^printf '[\\0-7]+'; exit 0\r$/u);
});

test("acknowledges exactly two ordered Runtime generations without unsafe PID reuse", async () => {
  const process = (pid, parentPid, processGroupId, startTime) =>
    Object.freeze({
      arguments: Object.freeze([]),
      environment: Object.freeze([]),
      parentPid,
      pid,
      processGroupId,
      startTime,
    });
  const app = process(4100, 1, 4100, "100");
  const firstRuntime = process(4300, 4100, 4300, "102");
  const secondRuntime = process(4400, 4100, 4400, "104");
  let snapshot = [app, firstRuntime];
  const registry = createLinuxPackagedOwnerRegistry(4100, { readProcesses: () => snapshot });
  const child = new EventEmitter();
  const acknowledgements = [];
  const acknowledgedGenerations = [];
  child.send = (frame) => acknowledgements.push(frame);
  attachPackagedOwnerRegistry(child, registry, {
    beforeAcknowledge: async (owner) => acknowledgedGenerations.push(owner.generation),
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  // A removed Web owner fails closed without producing an acknowledgement.
  child.emit("message", {
    owner: "web",
    pid: 4200,
    requestId: 1,
    type: "workbench:packaged-smoke-owner",
    version: 1,
  });
  await settle();
  // The Runtime ack can arrive before the Electron lifecycle sends its control start frame.
  child.emit("message", {
    owner: "runtime",
    pid: 4300,
    requestId: 2,
    type: "workbench:packaged-smoke-owner",
    version: 1,
  });
  await settle();
  assert.throws(() => registry.assertComplete(), /exactly two Runtime generations/u);

  // A replacement cannot be acknowledged while generation one or any member of its PGID lives.
  snapshot = [app, firstRuntime, secondRuntime];
  child.emit("message", {
    owner: "runtime",
    pid: 4400,
    requestId: 3,
    type: "workbench:packaged-smoke-owner",
    version: 1,
  });
  await settle();

  snapshot = [app, secondRuntime];
  child.emit("message", {
    owner: "runtime",
    pid: 4400,
    requestId: 4,
    type: "workbench:packaged-smoke-owner",
    version: 1,
  });
  await settle();
  registry.assertComplete();
  assert.deepEqual(acknowledgedGenerations, [1, 2]);
  assert.deepEqual(acknowledgements, [
    {
      accepted: true,
      owner: "runtime",
      pid: 4300,
      requestId: 2,
      type: "workbench:packaged-smoke-owner-ack",
      version: 1,
    },
    {
      accepted: false,
      owner: "runtime",
      pid: 4400,
      requestId: 3,
      type: "workbench:packaged-smoke-owner-ack",
      version: 1,
    },
    {
      accepted: true,
      owner: "runtime",
      pid: 4400,
      requestId: 4,
      type: "workbench:packaged-smoke-owner-ack",
      version: 1,
    },
  ]);

  // Electron may be gone before cleanup. Re-parented members keep both verified PGIDs reserved.
  snapshot = [
    process(4301, 1, 4300, "first-surviving-descendant"),
    process(4401, 1, 4400, "second-surviving-descendant"),
  ];
  assert.deepEqual(registry.liveOwnerProcessGroups(), [4300, 4400]);
  const survivingSignals = [];
  forceStopLinuxProcessGroups(registry.liveOwnerProcessGroups(), {
    killGroup: (...args) => survivingSignals.push(args),
  });
  assert.deepEqual(survivingSignals, [
    [-4300, "SIGKILL"],
    [-4400, "SIGKILL"],
  ]);

  // Recycled leader PIDs are not preserved members and must not be killed.
  snapshot = [process(4300, 1, 4300, "reused"), process(4400, 1, 4400, "reused")];
  assert.deepEqual(registry.liveOwnerProcessGroups(), []);
  const signals = [];
  forceStopLinuxProcessGroups(registry.liveOwnerProcessGroups(), {
    killGroup: (...args) => signals.push(args),
  });
  assert.deepEqual(signals, []);
});

test("resolves the exact manifest-owned Linux unpacked executable", async (t) => {
  const root = fixture(t);
  const appOut = path.join(root, linuxUnpackedDirectoryName(process.arch));
  const resources = path.join(appOut, "resources");
  const runtimeDirectory = path.join(resources, "desktop-runtime");
  const appDirectory = path.join(resources, "app");
  mkdirSync(runtimeDirectory, { recursive: true });
  mkdirSync(appDirectory, { recursive: true });
  writeFileSync(path.join(appDirectory, "package.json"), '{"name":"workbench-ui"}\n');
  const executable = path.join(appOut, "workbench-ui");
  writeFileSync(executable, "executable");
  chmodSync(executable, 0o755);
  const layout = {
    renderer: { artifactRoot: path.join(runtimeDirectory, "desktop-renderer") },
    runtime: { entrypoint: path.join(runtimeDirectory, "runtime-entry.cjs") },
  };
  const calls = [];
  const resolved = await resolveLinuxPackagedApplication(root, {
    expectedTarget: TARGET,
    expectedRendererBuildId: "renderer-build",
    resolveLayout: async (...arguments_) => {
      calls.push(arguments_);
      return layout;
    },
  });
  assert.equal(resolved.executable, executable);
  assert.equal(resolved.runtimeDirectory, runtimeDirectory);
  assert.equal(resolved.layout, layout);
  assert.deepEqual(calls, [
    [runtimeDirectory, { expectedTarget: TARGET, expectedRendererBuildId: "renderer-build" }],
  ]);
});

test("reads and validates exact Linux process-group ownership without leaking credentials", (t) => {
  const procRoot = fixture(t, "workbench-packaged-proc-test-");
  const groupId = 4100;
  const writeProcess = (pid, parentPid, arguments_, environment) => {
    const directory = path.join(procRoot, String(pid));
    mkdirSync(directory);
    writeFileSync(
      path.join(directory, "stat"),
      `${pid} (process with spaces) S ${parentPid} ${groupId} 0 0 0 0 0 0 0 0 0\n`,
    );
    writeFileSync(path.join(directory, "cmdline"), `${arguments_.join("\0")}\0`);
    writeFileSync(path.join(directory, "environ"), `${environment.join("\0")}\0`);
  };
  writeProcess(groupId, 1, ["/release/workbench-ui"], ["DISPLAY=:99"]);
  writeProcess(4101, groupId, ["/release/workbench-ui", "--type=renderer"], []);
  writeProcess(4102, groupId, ["/release/runtime.cjs"], []);
  mkdirSync(path.join(procRoot, "other"));

  assert.deepEqual(parseLinuxStat(`${groupId} (process with spaces) S 1 ${groupId} 0 0\n`), {
    parentPid: 1,
    pid: groupId,
    processGroupId: groupId,
  });
  const processes = readLinuxProcessGroup(groupId, { procRoot });
  assert.deepEqual(
    processes.map((process) => process.pid),
    [4100, 4101, 4102],
  );
  assert.doesNotThrow(() =>
    assertPackagedProcessGroup(processes, {
      accessToken: "runtime-secret",
      appPid: groupId,
      runtimeEntrypoint: "/release/runtime.cjs",
      runtimePid: 4102,
    }),
  );
  const unsafe = processes.map((process) =>
    process.pid === 4102 ? { ...process, environment: ["TOKEN=runtime-secret"] } : process,
  );
  assert.throws(
    () =>
      assertPackagedProcessGroup(unsafe, {
        accessToken: "runtime-secret",
        appPid: groupId,
        runtimeEntrypoint: "/release/runtime.cjs",
        runtimePid: 4102,
      }),
    /credential escaped into process argv or environment/u,
  );
});

test("captures the detached Runtime child group only through the live Electron topology", () => {
  const process = (pid, parentPid, processGroupId, arguments_ = [], environment = []) => ({
    pid,
    parentPid,
    processGroupId,
    arguments: Object.freeze(arguments_),
    environment: Object.freeze(environment),
  });
  const processes = [
    process(4100, 1, 4100, ["/release/workbench-ui"]),
    process(4101, 4100, 4100, ["chromium-renderer"]),
    process(4300, 4100, 4300, ["/release/runtime.cjs"]),
    process(4301, 4300, 4301, ["runtime-worker"]),
    process(9000, 1, 9000, ["unrelated"], ["TOKEN=runtime-secret"]),
  ];
  const topology = captureLinuxProcessTopology(4100, { readProcesses: () => processes });
  assert.deepEqual(
    topology.processes.map((item) => item.pid),
    [4100, 4101, 4300, 4301],
  );
  assert.deepEqual(topology.processGroupIds, [4100, 4300, 4301]);
  assert.doesNotThrow(() =>
    assertPackagedProcessTopology(topology.processes, {
      accessToken: "runtime-secret",
      appPid: 4100,
      runtimeEntrypoint: "/release/runtime.cjs",
      runtimePid: 4300,
    }),
  );
  const signals = [];
  forceStopLinuxProcessGroups(topology.processGroupIds, {
    killGroup: (...arguments_) => signals.push(arguments_),
  });
  assert.deepEqual(
    signals,
    topology.processGroupIds.map((processGroupId) => [-processGroupId, "SIGKILL"]),
  );
  assert.equal(
    linuxProcessGroupsAreEmpty(topology.processGroupIds, { readProcessGroup: () => [] }),
    true,
  );
});

test("refreshes a late detached PTY-like group and force-cleans only its starttime-anchored members", () => {
  const process = (pid, parentPid, processGroupId, arguments_ = []) => ({
    arguments: Object.freeze(arguments_),
    environment: Object.freeze([]),
    parentPid,
    pid,
    processGroupId,
    startTime: String(pid * 100),
  });
  const initialProcesses = [
    process(4100, 1, 4100, ["/release/workbench-ui"]),
    process(4300, 4100, 4300, ["/release/runtime.cjs"]),
  ];
  const lateProcesses = [...initialProcesses, process(4400, 4300, 4400, ["pty-like-grandchild"])];
  const initial = captureLinuxProcessTopology(4100, { readProcesses: () => initialProcesses });
  const refreshed = captureLinuxProcessTopology(4100, { readProcesses: () => lateProcesses });
  const merged = mergeLinuxProcessTopologies(initial, refreshed);
  assert.deepEqual(merged.processGroupIds, [4100, 4300, 4400]);
  assert.deepEqual(
    liveOwnedLinuxProcessGroups(merged, { readProcesses: () => lateProcesses }),
    [4100, 4300, 4400],
  );

  const remainingGroups = new Set(merged.processGroupIds);
  const signals = [];
  forceStopLinuxProcessGroups(
    liveOwnedLinuxProcessGroups(merged, { readProcesses: () => lateProcesses }),
    {
      killGroup: (negativeProcessGroupId, signal) => {
        signals.push([negativeProcessGroupId, signal]);
        remainingGroups.delete(-negativeProcessGroupId);
      },
    },
  );
  assert.deepEqual(signals, [
    [-4100, "SIGKILL"],
    [-4300, "SIGKILL"],
    [-4400, "SIGKILL"],
  ]);
  assert.equal(
    linuxProcessGroupsAreEmpty(merged.processGroupIds, {
      readProcessGroup: (processGroupId) => (remainingGroups.has(processGroupId) ? [{}] : []),
    }),
    true,
  );
});

test("uses by-value inspector evaluation without exposing expression failures", async () => {
  const commands = [];
  class FakeWebSocket extends EventEmitter {
    constructor(url) {
      super();
      this.url = url;
      setImmediate(() => this.emit("open"));
    }
    close() {
      this.emit("close");
    }
    send(raw) {
      const request = JSON.parse(raw);
      commands.push(request.method);
      if (request.method === "Runtime.runIfWaitingForDebugger") {
        assert.deepEqual(request.params, {});
        setImmediate(() => this.emit("message", JSON.stringify({ id: request.id, result: {} })));
        return;
      }
      assert.equal(request.method, "Runtime.evaluate");
      assert.equal(request.params.returnByValue, true);
      setImmediate(() =>
        this.emit(
          "message",
          JSON.stringify({ id: request.id, result: { result: { value: { ready: true } } } }),
        ),
      );
    }
  }
  const client = createCdpClient("ws://127.0.0.1:43210/abcd", {
    WebSocketImpl: FakeWebSocket,
    timeoutMs: 1_000,
    timers: { clearTimeout, setTimeout },
  });
  await client.runIfWaitingForDebugger();
  assert.deepEqual(await client.evaluate("({ ready: true })"), { ready: true });
  assert.deepEqual(commands, ["Runtime.runIfWaitingForDebugger", "Runtime.evaluate"]);
  client.close();
});

test("identifies the timed-out inspector evaluation stage", async () => {
  class UnresponsiveWebSocket extends EventEmitter {
    constructor() {
      super();
      setImmediate(() => this.emit("open"));
    }
    close() {
      this.emit("close");
    }
    send() {}
  }
  const client = createCdpClient("ws://127.0.0.1:43210/abcd", {
    WebSocketImpl: UnresponsiveWebSocket,
    timeoutMs: 5,
    timers: { clearTimeout, setTimeout },
  });
  await assert.rejects(
    client.evaluate("new Promise(() => {})", "Packaged restart checkpoint failed."),
    /Packaged restart checkpoint failed\. timed out after 5ms/u,
  );
  client.close();
});

test("renderer-context Runtime identity gate requires workbench://app CORS rather than a supplied Origin", () => {
  assert.match(RENDERER_RUNTIME_IDENTITY_EXPRESSION, /window\.workbenchDesktop/u);
  assert.match(RENDERER_RUNTIME_IDENTITY_EXPRESSION, /await fetch/u);
  assert.doesNotMatch(RENDERER_RUNTIME_IDENTITY_EXPRESSION, /headers:\s*\{[^}]*Origin/iu);
  const connection = {
    accessToken: "in-memory-only",
    httpOrigin: "http://127.0.0.1:43102",
    instanceId: "runtime-one",
    kind: "desktop-sidecar",
    protocolVersion: 1,
  };
  const document = {
    product: "workbench-runtime-host",
    hostProtocolVersion: 1,
    instanceId: "runtime-one",
    pid: 7412,
  };
  assert.deepEqual(
    validateRendererRuntimeIdentity(
      {
        document,
        observedOrigin: "workbench://app",
        status: 200,
      },
      connection,
      "workbench://app",
    ),
    document,
  );
  assert.throws(
    () =>
      validateRendererRuntimeIdentity(
        {
          document,
          observedOrigin: "null",
          status: 200,
        },
        connection,
        "workbench://app",
      ),
    /exact-origin CSP\/CORS Runtime request/u,
  );
});

test("renderer readiness requires the hydrated shared Shell and Composer", () => {
  assert.match(RENDERER_READY_EXPRESSION, /data-workbench-shell/u);
  assert.match(RENDERER_READY_EXPRESSION, /data-slot="workbench-composer-shell"/u);
  assert.match(RENDERER_READY_EXPRESSION, /lifecycle\?\.restartRuntime/u);
  assert.match(RUNTIME_RESTART_EXPRESSION, /lifecycle\.restartRuntime/u);
  assert.match(MAIN_WINDOW_RELOAD_EXPRESSION, /webContents\.reload/u);
  assert.match(MAIN_WINDOW_RELOAD_EXPRESSION, /did-finish-load/u);
  assert.equal(RENDERER_RELOADED_EXPRESSION, RENDERER_READY_EXPRESSION);
  const ready = {
    bridgeFrozen: true,
    composerMounted: true,
    documentReadyState: "complete",
    lifecycleFrozen: true,
    origin: "workbench://app",
    runtimeFrozen: true,
    shellMounted: true,
    titleBarFrozen: true,
  };
  assert.doesNotThrow(() => validateRendererReady(ready, "workbench://app"));
  assert.throws(
    () => validateRendererReady({ ...ready, composerMounted: false }, "workbench://app"),
    /frozen trusted desktop bridge at ready/u,
  );
});

test("main-process inspector expressions load Electron without a global require", async () => {
  const overlayCalls = [];
  let quitCalled = false;
  let reloadCalled = false;
  const webContents = new EventEmitter();
  webContents.reload = () => {
    reloadCalled = true;
    setImmediate(() => webContents.emit("did-finish-load"));
  };
  const window = {
    id: 17,
    isDestroyed: () => false,
    setTitleBarOverlay(options) {
      overlayCalls.push(options);
    },
    webContents,
  };
  const electron = {
    app: { quit: () => (quitCalled = true) },
    BrowserWindow: { getAllWindows: () => [window] },
  };
  const context = {
    process: {
      getBuiltinModule(specifier) {
        assert.equal(specifier, "module");
        return {
          createRequire(filename) {
            assert.equal(filename, "/release/electron/main.cjs");
            return (requested) => {
              assert.equal(requested, "electron");
              return electron;
            };
          },
        };
      },
      mainModule: { filename: "/release/electron/main.cjs" },
    },
    setImmediate(callback) {
      callback();
    },
  };

  assert.equal(Object.prototype.hasOwnProperty.call(context, "require"), false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(vm.runInNewContext(MAIN_WINDOW_PATCH_EXPRESSION, context))),
    { windowCount: 1, windowId: 17 },
  );
  window.setTitleBarOverlay({ color: "#123456", symbolColor: "#fedcba" });
  assert.deepEqual(overlayCalls, [{ color: "#123456", symbolColor: "#fedcba" }]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(await vm.runInNewContext(MAIN_WINDOW_RELOAD_EXPRESSION, context))),
    { windowCount: 1, windowId: 17 },
  );
  assert.equal(reloadCalled, true);
  assert.equal(vm.runInNewContext(GRACEFUL_QUIT_EXPRESSION, context), true);
  assert.equal(quitCalled, true);
});

test("redacts inspector command failures and closes pending CDP work", async () => {
  class FakeWebSocket extends EventEmitter {
    constructor() {
      super();
      setImmediate(() => this.emit("open"));
    }
    close() {
      this.emit("close");
    }
    send(raw) {
      const request = JSON.parse(raw);
      setImmediate(() =>
        this.emit(
          "message",
          JSON.stringify({
            id: request.id,
            error: {
              code: -32000,
              message: "desktop-runtime-secret must never be reported",
            },
          }),
        ),
      );
    }
  }
  const client = createCdpClient("ws://127.0.0.1:43210/abcd", {
    WebSocketImpl: FakeWebSocket,
    timeoutMs: 1_000,
    timers: { clearTimeout, setTimeout },
  });
  await assert.rejects(client.evaluate("throw new Error('unexpected')"), (error) => {
    assert.equal(error.message, "Inspector command failed.");
    assert.equal(error.protocolCode, -32000);
    assert.equal(error.message.includes("desktop-runtime-secret"), false);
    return true;
  });
  client.close();
});

test("treats an exact undefined CDP remote result as a retryable value", async () => {
  class FakeWebSocket extends EventEmitter {
    constructor() {
      super();
      setImmediate(() => this.emit("open"));
    }
    close() {
      this.emit("close");
    }
    send(raw) {
      const request = JSON.parse(raw);
      setImmediate(() =>
        this.emit(
          "message",
          JSON.stringify({ id: request.id, result: { result: { type: "undefined" } } }),
        ),
      );
    }
  }
  const client = createCdpClient("ws://127.0.0.1:43210/abcd", {
    WebSocketImpl: FakeWebSocket,
    timeoutMs: 1_000,
    timers: { clearTimeout, setTimeout },
  });
  assert.equal(await client.evaluate("undefined"), undefined);
  client.close();
});

test("selects exactly one workbench://app renderer target from the loopback inspector", async () => {
  const requested = [];
  const target = await resolveRendererDebuggerTarget("ws://127.0.0.1:43211/devtools/browser/abcd", {
    fetchImpl: async (url) => {
      requested.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            type: "page",
            url: "workbench://app/",
            webSocketDebuggerUrl: "ws://127.0.0.1:43211/devtools/page/ef01",
          },
        ],
      };
    },
    timeoutMs: 1_000,
    pollIntervalMs: 10,
    timers: { clearInterval, clearTimeout, setInterval, setTimeout },
  });
  assert.deepEqual(target, {
    debuggerUrl: "ws://127.0.0.1:43211/devtools/page/ef01",
    pageUrl: "workbench://app/",
  });
  assert.deepEqual(requested, ["http://127.0.0.1:43211/json/list"]);
});

test("bounds the renderer debugger target list before accepting a page endpoint", async () => {
  await assert.rejects(
    resolveRendererDebuggerTarget("ws://127.0.0.1:43211/devtools/browser/abcd", {
      fetchImpl: async () => ({
        headers: { get: () => String(1024 * 1024 + 1) },
        json: async () => assert.fail("oversized target list must not be decoded"),
        ok: true,
        status: 200,
      }),
      timeoutMs: 1_000,
      pollIntervalMs: 10,
      timers: { clearInterval, clearTimeout, setInterval, setTimeout },
    }),
    /target list exceeded its size limit/u,
  );
});

test("fails closed before resolving or launching a target outside the Linux execution contract", async () => {
  let resolved = false;
  await assert.rejects(
    runPackagedAppSmoke({
      outputDirectory: "/release",
      target: { platform: "win32", arch: process.arch },
      resolveApplication: async () => {
        resolved = true;
      },
    }),
    /cannot safely launch/u,
  );
  assert.equal(resolved, false);
});

test("retains isolated state without a live owned-topology capture when inspector readiness fails", async (t) => {
  const root = fixture(t);
  const stateRoot = path.join(root, "isolated-state");
  const child = fakeChild();
  child.pid = 7821;
  const stopped = [];
  const displays = [];

  await assert.rejects(
    runPackagedAppSmoke({
      outputDirectory: root,
      target: TARGET,
      expectedRendererBuildId: "renderer-build",
      mkdtemp: () => stateRoot,
      resolveApplication: async () => ({
        appOutDirectory: root,
        executable: path.join(root, "workbench-ui"),
        layout: { renderer: {}, runtime: {} },
        runtimeDirectory: root,
      }),
      acquireDisplay: async () => ({ display: ":99" }),
      createOwnerRegistry: () => ({
        isAppLive: () => true,
        liveOwnerProcessGroups: () => [],
        owners: () => [],
      }),
      spawnChild: () => child,
      readyTimeoutMs: 1,
      stopProcess: async (receivedChild, options) => {
        stopped.push({ options, receivedChild });
        receivedChild.exitCode = null;
        receivedChild.signalCode = "SIGKILL";
        return { exited: true, forced: true };
      },
      killProcessGroup: () => assert.fail("an uncaptured PID/PGID must never be killed"),
      readProcessGroup: () => [],
      stopDisplayImpl: async (display) => displays.push(display),
    }),
    (error) => {
      assert.match(error.message, /no start-time-anchored owners/u);
      assert.ok(
        error.errors?.some((nested) => /main inspector endpoint timed out/u.test(nested.message)),
      );
      return true;
    },
  );
  assert.deepEqual(stopped, [{ options: { platform: "linux" }, receivedChild: child }]);
  assert.deepEqual(displays, [{ display: ":99" }]);
  assert.equal(existsSync(stateRoot), true);
});
