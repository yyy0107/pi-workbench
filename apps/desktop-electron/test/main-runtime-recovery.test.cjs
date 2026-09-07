const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

test("desktop keeps the window on Runtime failure and retries through the trusted restart IPC", async () => {
  const records = [];
  const handlers = new Map();
  let startOptions;
  let startFailure = false;
  let startError = new Error("startup failed");
  let startGate;
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}),
    quit: () => records.push("quit"),
  });
  const oldSession = {
    drainForRestart: async () => records.push("drain"),
    stop: async () => records.push("stop"),
    runtimeConnection: { instanceId: "old" },
  };
  const nextSession = {
    ...oldSession,
    runtimeConnection: { instanceId: "new" },
  };
  const window = {
    isDestroyed: () => false,
    destroy: () => records.push("destroy"),
    webContents: { mainFrame: { url: "workbench://app/" } },
  };
  const context = vm.createContext({
    process,
    URL,
    console: { error: () => {} },
    oldSession,
    window,
    require(id) {
      if (id === "electron")
        return {
          app,
          nativeTheme: new EventEmitter(),
          protocol: {
            registerSchemesAsPrivileged() {},
            handle: () => records.push("protocol"),
            unhandle() {},
          },
          ipcMain: { on() {}, handle: (channel, handler) => handlers.set(channel, handler) },
        };
      if (id === "./desktop-services.cjs")
        return {
          readDesktopSettings: () => ({ preferences: { hardwareAcceleration: true } }),
          createDesktopServices: () => ({
            environment: {},
            showRuntimeError: () => records.push("error"),
            synchronizeTerminalShell: async () => records.push("synchronize"),
          }),
        };
      if (id === "./packaged-runtime-lifecycle.cjs")
        return {
          startPackagedWorkbenchRuntime: async (options) => {
            startOptions = options;
            records.push("start");
            await startGate;
            if (startFailure) throw startError;
            return nextSession;
          },
        };
      if (id === "./desktop-renderer-protocol.cjs")
        return { createDesktopRendererProtocolHandler: () => () => {} };
      return id.startsWith("./") ? require(path.join(__dirname, "../src", id)) : require(id);
    },
  });
  vm.runInContext(
    readFileSync(path.join(__dirname, "../src/main.cjs"), "utf8") +
      `\nruntimeConfiguration = {}; currentWorkbenchUrl = "workbench://app/";
       mainWindow = window; packagedRuntimeSession = oldSession;
       rendererRuntimeConnection = oldSession.runtimeConnection; runtimeReady = true;`,
    context,
  );
  await vm.runInContext("startWorkbenchRuntime()", context);
  startOptions.onUnexpectedExit(new Error("sidecar crashed"));
  assert.equal(vm.runInContext("runtimeReady", context), false);
  assert.equal(vm.runInContext("rendererRuntimeConnection", context), undefined);
  assert.equal(vm.runInContext("mainWindow", context), window);
  const restart = handlers.get("workbench:runtime-restart");
  assert.throws(() => restart({ sender: {} }), /unavailable/u);
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  records.length = 0;
  startFailure = true;
  await assert.rejects(restart(event), /startup failed/u);
  assert.deepEqual(records, ["drain", "start", "error"]);
  assert.equal(vm.runInContext("packagedRuntimeSession", context), undefined);
  records.length = 0;
  startFailure = false;
  const retry = restart(event);
  assert.equal(restart(event), retry);
  await retry;
  assert.deepEqual(records, ["start", "protocol", "synchronize"]);
  assert.equal(vm.runInContext("runtimeReady", context), true);
  assert.equal(vm.runInContext("rendererRuntimeConnection.instanceId", context), "new");
  vm.runInContext("isQuitting = true", context);
  assert.throws(() => restart(event), /unavailable/u);
  records.length = 0;
  startOptions.onUnexpectedExit(new Error("quitting"));
  assert.deepEqual(records, []);

  vm.runInContext("isQuitting = false; packagedRuntimeSession = undefined", context);
  let allowCleanup = false;
  startError = Object.assign(new Error("startup cleanup failed"), {
    code: "WORKBENCH_RUNTIME_CLEANUP_FAILED",
    async cleanup() {
      records.push("cleanup");
      if (!allowCleanup) throw new Error("process tree did not exit");
    },
  });
  startFailure = true;
  await assert.rejects(restart(event), /startup cleanup failed/u);
  records.length = 0;
  startFailure = false;
  await assert.rejects(restart(event), /process tree did not exit/u);
  assert.deepEqual(records, ["cleanup", "error"]);
  records.length = 0;
  allowCleanup = true;
  await restart(event);
  assert.deepEqual(records, ["cleanup", "start", "protocol", "synchronize"]);

  vm.runInContext(
    "packagedRuntimeSession = undefined; rendererRuntimeConnection = undefined",
    context,
  );
  const gate = Promise.withResolvers();
  startGate = gate.promise;
  records.length = 0;
  const pending = restart(event);
  await new Promise(setImmediate);
  vm.runInContext("isQuitting = true", context);
  gate.resolve();
  await pending;
  assert.deepEqual(records, ["start", "stop"]);
  assert.equal(vm.runInContext("runtimeReady", context), false);
});
