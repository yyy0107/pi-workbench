const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const runScript = path.resolve(__dirname, "_run.sh");

function runBash(source) {
  return execFileSync("bash", ["-c", `source "$1"; ${source}`, "bash", runScript], {
    cwd: path.resolve(__dirname, "../.."),
    encoding: "utf8",
  });
}

test("electron dev reuses a healthy existing Workbench without stopping it", () => {
  const output = runBash(`
    workbench_server_is_healthy() { return 0; }
    release_workbench_electron_dev() { echo unexpected-electron-release; return 1; }
    release_port() { echo unexpected-port-release; return 1; }
    release_workbench_dev_watchers() { echo unexpected-watcher-release; return 1; }
    release_next_dev_lock() { echo unexpected-lock-release; return 1; }
    prepare_electron_dev_server 4311
  `);

  assert.match(output, /Reusing the healthy Workbench development server on port 4311/);
  assert.doesNotMatch(output, /unexpected-/);
});

test("electron dev clears an unhealthy listener and stale development ownership", () => {
  const output = runBash(`
    workbench_server_is_healthy() { return 1; }
    release_workbench_electron_dev() { echo released-electron; }
    listener_pids() { echo 101; }
    release_port() { echo "released-port:$1"; }
    release_workbench_dev_watchers() { echo released-watchers; }
    release_next_dev_lock() { echo released-lock; }
    prepare_electron_dev_server 4312
  `);

  assert.match(output, /occupied by an unhealthy process/);
  assert.match(output, /released-electron/);
  assert.match(output, /released-port:4312/);
  assert.match(output, /released-watchers/);
  assert.match(output, /released-lock/);
  assert.match(output, /startup is clear on port 4312/);
});

test("electron dev clears idle watchers and locks even when the port is already free", () => {
  const output = runBash(`
    workbench_server_is_healthy() { return 1; }
    release_workbench_electron_dev() { echo released-electron; }
    listener_pids() { return 0; }
    release_port() { echo unexpected-port-release; return 1; }
    release_workbench_dev_watchers() { echo released-watchers; }
    release_next_dev_lock() { echo released-lock; }
    prepare_electron_dev_server 4313
  `);

  assert.doesNotMatch(output, /unexpected-port-release/);
  assert.match(output, /released-electron/);
  assert.match(output, /released-watchers/);
  assert.match(output, /released-lock/);
  assert.match(output, /startup is clear on port 4313/);
});

test("electron dev continues when the port is free and no stale processes exist", () => {
  const output = runBash(`
    workbench_server_is_healthy() { return 1; }
    listener_pids() { return 0; }
    workbench_electron_dev_pids() { return 0; }
    workbench_dev_watcher_pids() { return 0; }
    next_dev_lock_pids() { return 0; }
    prepare_electron_dev_server 4314
    echo continued-to-electron
  `);

  assert.match(output, /startup is clear on port 4314/);
  assert.match(output, /continued-to-electron/);
});
