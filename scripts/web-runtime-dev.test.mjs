import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWebRuntimeDevOptions,
  runProductionBuild,
  runWebRuntimeDev,
} from "./web-runtime-dev.mjs";

test("parses hot mode and an optional development port", () => {
  assert.deepEqual(parseWebRuntimeDevOptions([]), { hot: false });
  assert.deepEqual(parseWebRuntimeDevOptions(["--hot"]), { hot: true });
  assert.deepEqual(parseWebRuntimeDevOptions(["--", "--hot"]), { hot: true });
  assert.deepEqual(parseWebRuntimeDevOptions(["--hot", "--port", "43127"]), {
    hot: true,
    port: 43127,
  });
  assert.deepEqual(parseWebRuntimeDevOptions(["--port=43128"]), {
    hot: false,
    port: 43128,
  });
  for (const argv of [
    ["--unknown"],
    ["--hot", "--hot"],
    ["--port"],
    ["--port", "0"],
    ["--port", "65536"],
    ["--port", "not-a-port"],
    ["--port", "43127", "--port", "43128"],
  ]) {
    assert.throws(() => parseWebRuntimeDevOptions(argv), /Usage:|--port must be/u);
  }
});

test("builds before production, while hot mode starts the existing watcher directly", async () => {
  const events = [];
  const productionEnvironment = { PATH: "/bin", PORT: "3000" };
  const productionCode = await runWebRuntimeDev({
    options: { hot: false, port: 43127 },
    environment: productionEnvironment,
    build() {
      events.push("build");
      return 0;
    },
    async startProduction(options) {
      assert.equal(options.mode, "production");
      assert.deepEqual(options.environment, { PATH: "/bin", PORT: "43127" });
      events.push("production");
      return 0;
    },
  });
  const hotEnvironment = { PATH: "/bin" };
  const hotCode = await runWebRuntimeDev({
    options: { hot: true, port: 43128 },
    environment: hotEnvironment,
    build() {
      events.push("unexpected-build");
      return 0;
    },
    async startHot(options) {
      assert.deepEqual(options.environment, { PATH: "/bin", PORT: "43128" });
      events.push("hot");
      return 0;
    },
  });

  assert.equal(productionCode, 0);
  assert.equal(hotCode, 0);
  assert.deepEqual(events, ["build", "production", "hot"]);
  assert.deepEqual(productionEnvironment, { PATH: "/bin", PORT: "3000" });
  assert.deepEqual(hotEnvironment, { PATH: "/bin" });
});

test("runs the existing root build and does not start production after a failed build", async () => {
  let invocation;
  const buildCode = runProductionBuild({
    paths: { repositoryRoot: "/workbench" },
    environment: { PATH: "/bin" },
    spawnSyncImpl(command, args, options) {
      invocation = { command, args, options };
      return { status: 1, signal: null };
    },
  });
  let started = false;
  const devCode = await runWebRuntimeDev({
    options: { hot: false },
    build: () => buildCode,
    startProduction() {
      started = true;
      return 0;
    },
  });

  assert.equal(invocation.command, "pnpm");
  assert.deepEqual(invocation.args, ["build"]);
  assert.equal(invocation.options.cwd, "/workbench");
  assert.equal(buildCode, 1);
  assert.equal(devCode, 1);
  assert.equal(started, false);
});
