import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";

import { RuntimeConnectedWebMode } from "@workbench/host-contracts/runtime-connected-web-control";

import workbenchPaths from "./workbench-paths.cjs";
import {
  parseWebRuntimeOrchestratorOptions,
  runManagedWebRuntime,
} from "./web-runtime-orchestrator.mjs";
import {
  createWebRuntimeWatchLaunchConfiguration,
  runManagedWebRuntimeWatch,
} from "./web-runtime-watch.mjs";

const { createWorkbenchPaths } = workbenchPaths;
const paths = createWorkbenchPaths({
  repositoryRoot: path.resolve("/arbitrary/workbench-repository"),
});

class FakeProcessControl extends EventEmitter {}

function cleanShutdown(events, owner) {
  return async () => {
    events.push(`${owner}:shutdown`);
    return { forced: false, errors: [] };
  };
}

test("parses one explicit browser mode and optional managed-owner registration", () => {
  assert.deepEqual(
    parseWebRuntimeOrchestratorOptions({
      argv: ["--development", "--managed"],
      environment: { PORT: "43127" },
    }),
    {
      mode: RuntimeConnectedWebMode.development,
      managed: true,
      webOrigin: "http://127.0.0.1:43127",
    },
  );
  assert.deepEqual(
    parseWebRuntimeOrchestratorOptions({ argv: ["--production"], environment: {} }),
    {
      mode: RuntimeConnectedWebMode.production,
      managed: false,
      webOrigin: "http://127.0.0.1:3000",
    },
  );
  for (const argv of [
    [],
    ["--development", "--production"],
    ["--production", "--production"],
    ["--development", "--unknown"],
  ]) {
    assert.throws(() => parseWebRuntimeOrchestratorOptions({ argv, environment: {} }), /Usage:/u);
  }
  assert.throws(
    () =>
      parseWebRuntimeOrchestratorOptions({ argv: ["--production"], environment: { PORT: "0" } }),
    /PORT must be/u,
  );
});

test("owns Web and Runtime separately, configures only the proxy, and stops public admission first", async () => {
  const events = [];
  const processControl = new FakeProcessControl();
  let controlMessage;
  const code = await runManagedWebRuntime({
    mode: RuntimeConnectedWebMode.production,
    managed: true,
    paths,
    environment: { NODE_ENV: "test" },
    processControl,
    webOrigin: "http://127.0.0.1:43127",
    createAccessToken: () => "root-only-secret",
    webLaunch: { command: "web", args: [], options: {} },
    runtimeLaunch: { command: "runtime", args: [], options: {} },
    async reportOwner(owner, pid) {
      events.push(`owner:${owner}:${pid}`);
    },
    startWeb(options) {
      events.push("web:start");
      assert.deepEqual(options.secrets, ["root-only-secret"]);
      return {
        pid: 43_127,
        ready: Promise.resolve({ host: "127.0.0.1", port: 43_127, pid: 43_127 }),
        exited: new Promise(() => undefined),
        async configure(message) {
          events.push("web:configure");
          controlMessage = message;
        },
        shutdown: cleanShutdown(events, "web"),
      };
    },
    async startRuntime(options) {
      events.push("runtime:start");
      assert.equal(options.publicOrigin, "http://127.0.0.1:43127");
      assert.equal(options.accessToken, "root-only-secret");
      return {
        httpOrigin: "http://127.0.0.1:43128",
        instanceId: "runtime-one",
        pid: 43_128,
        shutdown: cleanShutdown(events, "runtime"),
      };
    },
    async verifyTopology({ webOrigin, runtime }) {
      events.push("topology:verify");
      assert.equal(webOrigin, "http://127.0.0.1:43127");
      assert.equal(runtime.instanceId, "runtime-one");
    },
    onReady(origin) {
      events.push(`ready:${origin}`);
      processControl.emit("SIGTERM");
    },
  });

  assert.equal(code, 0);
  assert.deepEqual(events, [
    "web:start",
    "owner:web:43127",
    "runtime:start",
    "owner:runtime:43128",
    "web:configure",
    "topology:verify",
    "ready:http://127.0.0.1:43127",
    "web:shutdown",
    "runtime:shutdown",
  ]);
  assert.equal(controlMessage.mode, RuntimeConnectedWebMode.production);
  assert.equal(controlMessage.publicOrigin, "http://127.0.0.1:43127");
  assert.equal(controlMessage.runtimeConnection.httpOrigin, "http://127.0.0.1:43128");
  assert.equal(controlMessage.runtimeConnection.accessToken, "root-only-secret");
  assert.equal("runtimePid" in controlMessage, false);
});

test("cleans the already-owned Web process when Runtime startup fails without reflecting secrets", async () => {
  const events = [];
  await assert.rejects(
    runManagedWebRuntime({
      mode: RuntimeConnectedWebMode.development,
      paths,
      processControl: new FakeProcessControl(),
      webOrigin: "http://127.0.0.1:43127",
      createAccessToken: () => "must-not-leak",
      webLaunch: { command: "web", args: [], options: {} },
      runtimeLaunch: { command: "runtime", args: [], options: {} },
      startWeb() {
        events.push("web:start");
        return {
          pid: 43_127,
          ready: new Promise(() => undefined),
          exited: new Promise(() => undefined),
          async configure() {},
          shutdown: cleanShutdown(events, "web"),
        };
      },
      async startRuntime() {
        throw new Error("must-not-leak");
      },
    }),
    (error) =>
      error instanceof Error &&
      error.message === "Managed Web/Runtime orchestration failed during Runtime start." &&
      !error.message.includes("must-not-leak"),
  );
  assert.deepEqual(events, ["web:start", "web:shutdown"]);
});

test("creates one token-free tsx watch owner for the Web/Runtime orchestrator", async () => {
  const launch = createWebRuntimeWatchLaunchConfiguration({
    paths,
    environment: {
      PORT: "43127",
      WORKBENCH_RUNTIME_ACCESS_TOKEN: "stale-secret",
      Workbench_Web_Origin: "http://127.0.0.1:49999",
    },
    tsxCli: "/virtual/tsx-cli.mjs",
  });
  assert.equal(launch.command, process.execPath);
  assert.deepEqual(launch.args.slice(0, 2), ["/virtual/tsx-cli.mjs", "watch"]);
  assert.deepEqual(launch.args.slice(-2), [
    path.join(paths.repositoryRoot, "scripts", "web-runtime-orchestrator.mjs"),
    "--development",
  ]);
  assert.equal(launch.options.cwd, paths.repositoryRoot);
  assert.equal(launch.options.stdio, "inherit");
  assert.equal(launch.options.env.PORT, "43127");
  assert.equal(JSON.stringify(launch).includes("stale-secret"), false);
  assert.equal(JSON.stringify(launch).includes("49999"), false);
  assert.equal(typeof runManagedWebRuntimeWatch, "function");
});
