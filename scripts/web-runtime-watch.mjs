import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRuntimeSourceWatchArguments } from "./runtime-source-watch.mjs";
import workbenchPaths from "./workbench-paths.cjs";

const { createWorkbenchPaths } = workbenchPaths;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const FORCE_TIMEOUT_MS = 2_000;

export function scrubWebRuntimeWatchEnvironment(environment) {
  const clean = { ...environment };
  for (const name of Object.keys(clean)) {
    if (name.toUpperCase().startsWith("WORKBENCH_")) delete clean[name];
  }
  return clean;
}

/** One tsx watch owner restarts the Web/Runtime orchestrator on the canonical source boundary. */
export function createWebRuntimeWatchLaunchConfiguration({
  paths = createWorkbenchPaths(),
  environment = process.env,
  tsxCli = fileURLToPath(import.meta.resolve("tsx/cli")),
} = {}) {
  return Object.freeze({
    command: process.execPath,
    args: Object.freeze([
      tsxCli,
      "watch",
      ...createRuntimeSourceWatchArguments({ paths }),
      path.join(paths.repositoryRoot, "scripts", "web-runtime-orchestrator.mjs"),
      "--development",
    ]),
    options: Object.freeze({
      cwd: paths.repositoryRoot,
      env: scrubWebRuntimeWatchEnvironment(environment),
      detached: process.platform !== "win32",
      stdio: "inherit",
      windowsHide: false,
    }),
  });
}

function childExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    child.once("error", () => resolve({ code: 1, signal: null }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function bounded(promise, timeoutMs) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timeout = setTimeout(reject, timeoutMs);
      timeout.unref?.();
    }),
  ]).finally(() => clearTimeout(timeout));
}

function forceWatchTree(child) {
  if (process.platform !== "win32" && Number.isInteger(child.pid) && child.pid > 1) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall through to the direct watch process.
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // The child exit waiter remains authoritative.
  }
}

export async function runManagedWebRuntimeWatch({
  paths = createWorkbenchPaths(),
  environment = process.env,
  processControl = process,
  launch = createWebRuntimeWatchLaunchConfiguration({ paths, environment }),
  spawnImpl = spawn,
} = {}) {
  const child = spawnImpl(launch.command, launch.args, launch.options);
  const exited = childExit(child);
  let resolveSignal;
  const signal = new Promise((resolve) => {
    resolveSignal = resolve;
  });
  const onSigint = () => resolveSignal();
  const onSigterm = () => resolveSignal();
  processControl.once("SIGINT", onSigint);
  processControl.once("SIGTERM", onSigterm);
  try {
    const outcome = await Promise.race([
      exited.then((result) => ({ kind: "exit", result })),
      signal.then(() => ({ kind: "signal" })),
    ]);
    if (outcome.kind === "exit") {
      return outcome.result.code === 0 && outcome.result.signal === null ? 0 : 1;
    }
    try {
      child.kill("SIGTERM");
      await bounded(exited, SHUTDOWN_TIMEOUT_MS);
      return 0;
    } catch {
      forceWatchTree(child);
      await bounded(exited, FORCE_TIMEOUT_MS).catch(() => undefined);
      return 1;
    }
  } finally {
    processControl.off("SIGINT", onSigint);
    processControl.off("SIGTERM", onSigterm);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runManagedWebRuntimeWatch();
  } catch {
    console.error("Workbench Web/Runtime source watch failed.");
    process.exitCode = 1;
  }
}
