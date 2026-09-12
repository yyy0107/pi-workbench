import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";

import {
  parseElectronDevelopmentOptions,
  runElectronDevelopment,
  startManagedChild,
  waitForDesktopRenderer,
} from "./electron-dev-orchestrator.mjs";
import { createWebRuntimeWatchLaunchConfiguration } from "./web-runtime-watch.mjs";
import workbenchPaths from "./workbench-paths.cjs";

const { createWorkbenchPaths } = workbenchPaths;

async function listenOnLoopback(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

test("validates one renderer endpoint, waits before Electron launch, and cleans owners in reverse order", async () => {
  await waitForDesktopRenderer("http://127.0.0.1:3000", {
    fetchImpl: async () => ({
      ok: true,
      text: async () => '<body data-workbench-desktop-renderer="1">',
    }),
    timeoutMs: 10,
    retryMs: 0,
  });
  await assert.rejects(
    waitForDesktopRenderer("http://127.0.0.1:3000", {
      fetchImpl: async () => ({ ok: true, text: async () => "<body>wrong app</body>" }),
      timeoutMs: 1,
      retryMs: 0,
    }),
    /readiness timed out/u,
  );
  assert.deepEqual(parseElectronDevelopmentOptions({ argv: [], environment: {} }), {
    mode: "managed",
    rendererOrigin: "http://127.0.0.1:3000",
  });
  assert.deepEqual(
    parseElectronDevelopmentOptions({ argv: ["--port", "43127"], environment: {} }),
    {
      mode: "managed",
      rendererOrigin: "http://127.0.0.1:43127",
    },
  );
  assert.deepEqual(
    parseElectronDevelopmentOptions({ argv: ["--", "--port=43128"], environment: {} }),
    {
      mode: "managed",
      rendererOrigin: "http://127.0.0.1:43128",
    },
  );
  assert.deepEqual(
    parseElectronDevelopmentOptions({
      argv: ["--connect-existing"],
      environment: { WORKBENCH_DESKTOP_RENDERER_ORIGIN: "http://127.0.0.1:43127" },
    }),
    { mode: "connect-existing", rendererOrigin: "http://127.0.0.1:43127" },
  );
  assert.deepEqual(
    parseElectronDevelopmentOptions({
      argv: ["--connect-existing", "--port", "43129"],
      environment: {},
    }),
    { mode: "connect-existing", rendererOrigin: "http://127.0.0.1:43129" },
  );
  for (const argv of [
    ["--port"],
    ["--port", "0"],
    ["--port", "65536"],
    ["--port", "not-a-port"],
    ["--port", "43127", "--port", "43128"],
  ]) {
    assert.throws(
      () => parseElectronDevelopmentOptions({ argv, environment: {} }),
      /Usage:|--port must be/u,
    );
  }
  assert.throws(
    () =>
      parseElectronDevelopmentOptions({
        argv: ["--connect-existing"],
        environment: { WORKBENCH_WEB_ORIGIN: "http://127.0.0.1:3000" },
      }),
    /WORKBENCH_WEB_ORIGIN is obsolete/u,
  );
  assert.throws(
    () =>
      parseElectronDevelopmentOptions({
        argv: ["--connect-existing"],
        environment: { WORKBENCH_DESKTOP_RENDERER_ORIGIN: "http://localhost:3000" },
      }),
    /canonical loopback HTTP origin/u,
  );
  const paths = createWorkbenchPaths({ repositoryRoot: "/arbitrary/workbench" });
  const webWatch = createWebRuntimeWatchLaunchConfiguration({
    paths,
    environment: { WORKBENCH_RUNTIME_ORIGIN: "http://127.0.0.1:49999" },
    tsxCli: "/virtual/tsx-cli.mjs",
  });
  assert.deepEqual(webWatch.args.slice(0, 2), ["/virtual/tsx-cli.mjs", "watch"]);
  assert.deepEqual(webWatch.args.slice(-2), [
    path.join(paths.repositoryRoot, "scripts", "web-runtime-orchestrator.mjs"),
    "--development",
  ]);
  assert.equal(JSON.stringify(webWatch).includes("49999"), false);

  const processControl = new EventEmitter();
  const events = [];
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const never = new Promise(() => undefined);
  const portProbe = createServer();
  const rendererOrigin = await listenOnLoopback(portProbe);
  await new Promise((resolve) => portProbe.close(resolve));
  const running = runElectronDevelopment({
    options: { mode: "managed", rendererOrigin },
    processControl,
    rendererLaunch: { owner: "renderer" },
    electronLaunch: { owner: "electron" },
    startChild({ launch }) {
      events.push(`${launch.owner}:start`);
      return {
        exited: never,
        async shutdown() {
          events.push(`${launch.owner}:shutdown`);
        },
      };
    },
    waitForRenderer() {
      events.push("renderer:probe");
      return ready;
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["renderer:start", "renderer:probe"]);
  resolveReady();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["renderer:start", "renderer:probe", "electron:start"]);

  processControl.emit("SIGHUP");
  assert.equal(await running, 0);
  assert.deepEqual(events, [
    "renderer:start",
    "renderer:probe",
    "electron:start",
    "electron:shutdown",
    "renderer:shutdown",
  ]);
  assert.equal(processControl.listenerCount("SIGHUP"), 0);
});

test("rejects an occupied managed endpoint before launching children, but allows explicit connect", async (t) => {
  const server = createServer((_request, response) => {
    response.end('<body data-workbench-desktop-renderer="1">');
  });
  const rendererOrigin = await listenOnLoopback(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const processControl = new EventEmitter();
  const launches = [];
  const configuration = {
    processControl,
    rendererLaunch: { owner: "renderer" },
    electronLaunch: { owner: "electron" },
    startChild({ launch }) {
      launches.push(launch.owner);
      return {
        exited: Promise.resolve({ code: 0, signal: null, error: false }),
        async shutdown() {},
      };
    },
  };

  await assert.rejects(
    runElectronDevelopment({
      ...configuration,
      options: { mode: "managed", rendererOrigin },
    }),
    /already in use.*pnpm electron:dev:connect/u,
  );
  assert.deepEqual(launches, []);

  assert.equal(
    await runElectronDevelopment({
      ...configuration,
      options: { mode: "connect-existing", rendererOrigin },
      rendererLaunch: undefined,
    }),
    0,
  );
  assert.deepEqual(launches, ["electron"]);
  assert.equal(server.listening, true);
});

test("cleans the owned process tree after a graceful child exit", async () => {
  const signals = [];
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    kill(signal) {
      signals.push(signal);
      this.exitCode = 0;
      this.emit("exit", 0, null);
    },
  });
  const managed = startManagedChild({
    launch: {},
    spawnImpl: () => child,
    forceProcessTree: (owner) => {
      assert.equal(owner, child);
      signals.push("cleanup-tree");
    },
  });
  await managed.shutdown();
  await managed.shutdown();
  assert.deepEqual(signals, ["SIGTERM", "cleanup-tree"]);
});
