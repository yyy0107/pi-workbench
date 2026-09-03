import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";

import {
  parseElectronDevelopmentOptions,
  runElectronDevelopment,
  waitForDesktopRenderer,
} from "./electron-dev-orchestrator.mjs";
import { createWebRuntimeWatchLaunchConfiguration } from "./web-runtime-watch.mjs";
import workbenchPaths from "./workbench-paths.cjs";

const { createWorkbenchPaths } = workbenchPaths;

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
    parseElectronDevelopmentOptions({
      argv: ["--connect-existing"],
      environment: { WORKBENCH_DESKTOP_RENDERER_ORIGIN: "http://127.0.0.1:43127" },
    }),
    { mode: "connect-existing", rendererOrigin: "http://127.0.0.1:43127" },
  );
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
  const running = runElectronDevelopment({
    options: { mode: "managed", rendererOrigin: "http://127.0.0.1:3000" },
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

  processControl.emit("SIGTERM");
  assert.equal(await running, 0);
  assert.deepEqual(events, [
    "renderer:start",
    "renderer:probe",
    "electron:start",
    "electron:shutdown",
    "renderer:shutdown",
  ]);
});
