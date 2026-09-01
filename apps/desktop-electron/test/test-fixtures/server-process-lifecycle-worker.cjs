const { fork } = require("node:child_process");
const { appendFileSync } = require("node:fs");

const [mode, stateFile] = process.argv.slice(2);

function record(event) {
  appendFileSync(stateFile, `${JSON.stringify({ event, pid: process.pid, at: Date.now() })}\n`);
}

function stayAlive() {
  setInterval(() => undefined, 1_000);
}

if (mode === "grandchild") {
  record("grandchild-ready");
  if (process.env.WORKBENCH_LIFECYCLE_STUBBORN === "1") {
    process.on("SIGTERM", () => record("grandchild-ignored-sigterm"));
  } else {
    process.once("SIGTERM", () => {
      record("grandchild-unexpected-sigterm");
      process.exit(1);
    });
    process.once("message", (message) => {
      if (message?.type !== "cooperative-stop") return;
      record("grandchild-ipc-stop");
      process.exit(0);
    });
  }
  stayAlive();
  return;
}

if (mode !== "supervisor") {
  throw new Error(`Unsupported lifecycle fixture mode: ${mode}`);
}

const stubborn = process.env.WORKBENCH_LIFECYCLE_STUBBORN === "1";
const grandchild = fork(__filename, ["grandchild", stateFile], {
  detached: false,
  env: process.env,
  silent: true,
});

record("supervisor-ready");
if (typeof process.send === "function") {
  process.send({ type: "ready", leaderPid: process.pid, grandchildPid: grandchild.pid });
}

if (stubborn) {
  process.on("SIGTERM", () => record("supervisor-ignored-sigterm"));
} else {
  process.once("SIGTERM", () => {
    record("supervisor-sigterm");
    grandchild.once("exit", () => {
      record("supervisor-exit");
      process.exit(0);
    });
    grandchild.send({ type: "cooperative-stop" });
  });
}

stayAlive();
