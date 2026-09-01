const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { startPackagedWorkbenchRuntime } = require("../src/packaged-runtime-lifecycle.cjs");
const support = require("../scripts/desktop-artifact-support.cjs");

const FIXTURE = path.join(__dirname, "test-fixtures", "packaged-runtime-child.cjs");

test("real detached children complete ready and ordered protocol shutdown without orphans", async (t) => {
  const stateRoot = mkdtempSync(path.join(tmpdir(), "workbench-packaged-lifecycle-"));
  t.after(() => rmSync(stateRoot, { force: true, recursive: true }));
  const stateFile = path.join(stateRoot, "events.ndjson");
  const session = await startPackagedWorkbenchRuntime({
    runtimeDirectory: stateRoot,
    supportPath: path.join(stateRoot, "desktop-artifact-support.cjs"),
    settingsFile: path.join(stateRoot, "settings.json"),
    rendererOrigin: "workbench://app",
    environment: {
      ...process.env,
      PACKAGED_LIFECYCLE_TEST_STATE_FILE: stateFile,
    },
    executable: process.execPath,
    loadSupport: () => support,
    resolveLayout: async () => ({
      renderer: { artifactRoot: stateRoot },
      runtime: { entrypoint: FIXTURE },
    }),
  });
  const pids = [session.runtimeReady.pid];

  await session.stop();
  const events = readFileSync(stateFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(events, [
    { event: "start", type: "runtime" },
    { event: "shutdown", type: "runtime" },
  ]);
  for (const pid of pids) {
    assert.throws(
      () => process.kill(pid, 0),
      (error) => error?.code === "ESRCH",
    );
  }
});
