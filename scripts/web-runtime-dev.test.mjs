import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWebRuntimeDevOptions,
  runProductionBuild,
  runWebRuntimeDev,
} from "./web-runtime-dev.mjs";

test("defaults to production and accepts only the explicit hot flag", () => {
  assert.deepEqual(parseWebRuntimeDevOptions([]), { hot: false });
  assert.deepEqual(parseWebRuntimeDevOptions(["--hot"]), { hot: true });
  for (const argv of [["--unknown"], ["--hot", "--hot"]]) {
    assert.throws(() => parseWebRuntimeDevOptions(argv), /Usage:/u);
  }
});

test("builds before production, while hot mode starts the existing watcher directly", async () => {
  const events = [];
  const productionCode = await runWebRuntimeDev({
    options: { hot: false },
    build() {
      events.push("build");
      return 0;
    },
    async startProduction() {
      events.push("production");
      return 0;
    },
  });
  const hotCode = await runWebRuntimeDev({
    options: { hot: true },
    build() {
      events.push("unexpected-build");
      return 0;
    },
    async startHot() {
      events.push("hot");
      return 0;
    },
  });

  assert.equal(productionCode, 0);
  assert.equal(hotCode, 0);
  assert.deepEqual(events, ["build", "production", "hot"]);
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
