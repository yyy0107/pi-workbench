import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RuntimeConnectedWebMode,
  createRuntimeConnectedWebStartMessage,
} from "@workbench/host-contracts/runtime-connected-web-control";
import {
  createWorkbenchHostShutdownMessage,
  parseWorkbenchHostReadyMessage,
} from "@workbench/host-contracts/host-control";
import {
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
  defineRuntimeConnection,
} from "@workbench/host-contracts/runtime-connection";
import { parseRuntimeHostIdentity } from "@workbench/host-contracts/runtime-host-control";
import {
  createStreamingSecretRedactor,
  forceManagedChildProcessTree,
  startRuntimeSidecar,
} from "@workbench/host-server/runtime-sidecar-child";
import workbenchPaths from "./workbench-paths.cjs";

const { createWorkbenchPaths } = workbenchPaths;

const DEVELOPMENT_ARGUMENT = "--development";
const PRODUCTION_ARGUMENT = "--production";
const MANAGED_ARGUMENT = "--managed";
const DEFAULT_WEB_PORT = 3000;
const OWNER_REGISTRATION_TIMEOUT_MS = 5_000;
const CHILD_STARTUP_TIMEOUT_MS = 90_000;
const CHILD_SHUTDOWN_TIMEOUT_MS = 10_000;
const CHILD_FORCE_TIMEOUT_MS = 2_000;

function stableError(message) {
  return new Error(message);
}

function scrubWorkbenchEnvironment(environment) {
  const clean = { ...environment };
  for (const name of Object.keys(clean)) {
    if (name.toUpperCase().startsWith("WORKBENCH_")) delete clean[name];
  }
  return clean;
}

export function createDevelopmentWebLaunchConfiguration({
  paths = createWorkbenchPaths(),
  environment = process.env,
  mode,
  webOrigin,
  tsxLoader = fileURLToPath(import.meta.resolve("tsx")),
} = {}) {
  const url = new URL(webOrigin);
  return Object.freeze({
    command: process.execPath,
    args: Object.freeze([
      "--import",
      tsxLoader,
      path.join(paths.webSourceRoot, "runtime-connected-web-main.ts"),
    ]),
    options: Object.freeze({
      cwd: paths.webRoot,
      env: {
        ...scrubWorkbenchEnvironment(environment),
        NODE_ENV: mode,
        PORT: url.port,
        WORKBENCH_HOST: "127.0.0.1",
        WORKBENCH_WEB_ROOT: paths.webRoot,
      },
      detached: process.platform !== "win32",
      stdio: Object.freeze(["inherit", "pipe", "pipe", "ipc"]),
      windowsHide: true,
    }),
  });
}

export function createDevelopmentRuntimeLaunchConfiguration({
  paths = createWorkbenchPaths(),
  environment = process.env,
  mode,
  tsxLoader = fileURLToPath(import.meta.resolve("tsx")),
} = {}) {
  return Object.freeze({
    command: process.execPath,
    args: Object.freeze(["--import", tsxLoader, path.join(paths.runtimeAppRoot, "src", "main.ts")]),
    options: Object.freeze({
      cwd: paths.runtimeAppRoot,
      env: {
        ...scrubWorkbenchEnvironment(environment),
        NODE_ENV: mode,
        WORKBENCH_RUNTIME_MANAGED_CHILD: "1",
      },
      detached: process.platform !== "win32",
      windowsHide: true,
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

function bounded(promise, timeoutMs, label) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timeout = setTimeout(() => reject(stableError(`${label} timed out.`)), timeoutMs);
      timeout.unref?.();
    }),
  ]).finally(() => clearTimeout(timeout));
}

export function forceDetachedDevelopmentProcessTree(child) {
  if (process.platform !== "win32" && Number.isInteger(child?.pid) && child.pid > 1) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Use the shared exact-tree fallback below.
    }
  }
  forceManagedChildProcessTree(child);
}

function sendChildMessage(child, message) {
  return new Promise((resolve, reject) => {
    if (!child.connected || typeof child.send !== "function") {
      reject(stableError("Managed child IPC is unavailable."));
      return;
    }
    child.send(message, (error) => (error ? reject(error) : resolve()));
  });
}

export function startDevelopmentWebChild({
  launch,
  expectedOrigin,
  secrets = [],
  spawnImpl = spawn,
  onUnexpectedExit = () => undefined,
  onStdout = (text) => process.stdout.write(text),
  onStderr = (text) => process.stderr.write(text),
  startupTimeoutMs = CHILD_STARTUP_TIMEOUT_MS,
} = {}) {
  const child = spawnImpl(launch.command, launch.args, launch.options);
  const expected = new URL(expectedOrigin);
  for (const [stream, sink] of [
    [child.stdout, onStdout],
    [child.stderr, onStderr],
  ]) {
    if (!stream) continue;
    const redactor = createStreamingSecretRedactor(secrets, sink);
    stream.on("data", (chunk) => redactor.write(chunk));
    stream.once("close", () => redactor.end());
  }
  const exited = childExit(child);
  let configured = false;
  let shutdownRequested = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const timeout = setTimeout(
    () => rejectReady(stableError("Development Web startup timed out.")),
    startupTimeoutMs,
  );
  timeout.unref?.();
  child.on("message", (value) => {
    const message = parseWorkbenchHostReadyMessage(value);
    if (
      !configured ||
      !message ||
      message.host !== expected.hostname ||
      message.port !== Number(expected.port) ||
      message.pid !== child.pid
    ) {
      rejectReady(stableError("Development Web ready message is invalid."));
      return;
    }
    clearTimeout(timeout);
    resolveReady(message);
  });
  void exited.then(() => {
    clearTimeout(timeout);
    rejectReady(stableError("Development Web exited before ready."));
    if (!shutdownRequested) onUnexpectedExit();
  });
  let shutdownOperation;
  return Object.freeze({
    pid: child.pid,
    ready,
    exited,
    async configure(message) {
      if (configured) throw stableError("Development Web was configured more than once.");
      configured = true;
      await sendChildMessage(child, message);
    },
    shutdown() {
      shutdownRequested = true;
      shutdownOperation ??= (async () => {
        try {
          await bounded(
            Promise.all([sendChildMessage(child, createWorkbenchHostShutdownMessage()), exited]),
            CHILD_SHUTDOWN_TIMEOUT_MS,
            "Development Web shutdown",
          );
          return { forced: false, errors: [] };
        } catch (error) {
          forceDetachedDevelopmentProcessTree(child);
          await bounded(exited, CHILD_FORCE_TIMEOUT_MS, "Development Web forced cleanup").catch(
            () => undefined,
          );
          return { forced: true, errors: [error] };
        }
      })();
      return shutdownOperation;
    },
  });
}

async function readIdentity(webOrigin) {
  try {
    const response = await fetch(`${webOrigin}/api/identity`, {
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return undefined;
    return parseRuntimeHostIdentity(await response.json());
  } catch {
    return undefined;
  }
}

export async function verifyManagedDevelopmentTopology({ webOrigin, runtime }) {
  const identity = await readIdentity(webOrigin);
  if (identity?.instanceId !== runtime.instanceId || identity.pid !== runtime.pid) {
    throw stableError("Managed development endpoint topology verification failed.");
  }
}

export function reportManagedDevelopmentOwner(owner, pid, { processControl = process } = {}) {
  if (typeof processControl.send !== "function" || !Number.isInteger(pid) || pid < 2) {
    return Promise.reject(stableError("Managed owner registration IPC is unavailable."));
  }
  return new Promise((resolve, reject) => {
    processControl.send({ type: "workbench:development-owner", version: 1, owner, pid }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

function configuredWebOrigin(environment) {
  const raw = environment.PORT?.trim() || String(DEFAULT_WEB_PORT);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw stableError("PORT must be an integer from 1 to 65535.");
  }
  return `http://127.0.0.1:${port}`;
}

export function parseWebRuntimeOrchestratorOptions({
  argv = process.argv.slice(2),
  environment = process.env,
} = {}) {
  const arguments_ = new Set(argv);
  const allowed = new Set([DEVELOPMENT_ARGUMENT, PRODUCTION_ARGUMENT, MANAGED_ARGUMENT]);
  if (
    arguments_.size !== argv.length ||
    argv.some((argument) => !allowed.has(argument)) ||
    arguments_.has(DEVELOPMENT_ARGUMENT) === arguments_.has(PRODUCTION_ARGUMENT)
  ) {
    throw stableError(
      `Usage: web-runtime-orchestrator.mjs (${DEVELOPMENT_ARGUMENT}|${PRODUCTION_ARGUMENT}) [${MANAGED_ARGUMENT}]`,
    );
  }
  return Object.freeze({
    mode: arguments_.has(DEVELOPMENT_ARGUMENT)
      ? RuntimeConnectedWebMode.development
      : RuntimeConnectedWebMode.production,
    managed: arguments_.has(MANAGED_ARGUMENT),
    webOrigin: configuredWebOrigin(environment),
  });
}

function createTerminationLatch(processControl, onTermination) {
  let resolve;
  let settled = false;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  const finish = (outcome) => {
    if (settled) return;
    settled = true;
    onTermination?.(outcome);
    resolve(outcome);
  };
  const onSigint = () => finish({ kind: "signal", signal: "SIGINT" });
  const onSigterm = () => finish({ kind: "signal", signal: "SIGTERM" });
  processControl.once("SIGINT", onSigint);
  processControl.once("SIGTERM", onSigterm);
  return Object.freeze({
    promise,
    fail(owner) {
      finish({ kind: "failure", owner });
    },
    dispose() {
      processControl.off("SIGINT", onSigint);
      processControl.off("SIGTERM", onSigterm);
    },
  });
}

async function shutdownWebRuntimeTopology({ web, runtime }) {
  const errors = [];
  let forced = false;
  const stop = async (label, owner) => {
    if (!owner) return;
    try {
      const result = await owner.shutdown();
      forced ||= result.forced;
      for (const _error of result.errors) errors.push(stableError(`${label} shutdown failed.`));
    } catch {
      errors.push(stableError(`${label} shutdown failed.`));
    }
  };
  // Stop the public proxy admission before asking the private Runtime owner to terminate.
  await stop("Web", web);
  await stop("Runtime", runtime);
  return Object.freeze({ forced, errors: Object.freeze(errors) });
}

export async function runManagedWebRuntime({
  mode,
  managed = false,
  paths = createWorkbenchPaths(),
  environment = process.env,
  processControl = process,
  webOrigin = configuredWebOrigin(environment),
  createAccessToken = () => randomBytes(32).toString("base64url"),
  startWeb = startDevelopmentWebChild,
  startRuntime = startRuntimeSidecar,
  reportOwner = reportManagedDevelopmentOwner,
  verifyTopology = verifyManagedDevelopmentTopology,
  onReady = (origin) => console.log(`> Workbench ready at ${origin}`),
  webLaunch = createDevelopmentWebLaunchConfiguration({
    paths,
    environment,
    mode,
    webOrigin,
  }),
  runtimeLaunch = createDevelopmentRuntimeLaunchConfiguration({ paths, environment, mode }),
} = {}) {
  if (!Object.values(RuntimeConnectedWebMode).includes(mode)) {
    throw stableError("Invalid managed Web/Runtime mode.");
  }
  const startupController = new AbortController();
  let terminationOutcome;
  const termination = createTerminationLatch(processControl, (outcome) => {
    terminationOutcome = outcome;
    startupController.abort();
  });
  let web;
  let runtime;
  let shutdownOperation;
  let stage = "Web start";
  const registeredOwners = new Set();
  const registerOwner = async (owner, pid) => {
    if (!managed) return;
    if (registeredOwners.has(owner)) {
      throw stableError(`Managed ${owner} owner was registered more than once.`);
    }
    await reportOwner(owner, pid, { timeoutMs: OWNER_REGISTRATION_TIMEOUT_MS });
    registeredOwners.add(owner);
  };
  const shutdown = () => {
    shutdownOperation ??= shutdownWebRuntimeTopology({ web, runtime });
    return shutdownOperation;
  };
  try {
    const accessToken = createAccessToken();
    web = startWeb({
      launch: webLaunch,
      expectedOrigin: webOrigin,
      secrets: [accessToken],
      onUnexpectedExit: () => termination.fail("web"),
    });
    stage = "Web owner registration";
    await registerOwner("web", web.pid);
    stage = "Runtime start";
    runtime = await startRuntime({
      launch: runtimeLaunch,
      accessToken,
      publicOrigin: webOrigin,
      startupSignal: startupController.signal,
      forceProcessTree: forceDetachedDevelopmentProcessTree,
      onUnexpectedExit: () => termination.fail("runtime"),
      onStderr: (text) => process.stderr.write(text),
    });
    stage = "Runtime owner registration";
    await registerOwner("runtime", runtime.pid);
    const runtimeConnection = defineRuntimeConnection({
      kind: "desktop-sidecar",
      protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
      httpOrigin: runtime.httpOrigin,
      instanceId: runtime.instanceId,
      accessToken,
    });
    if (runtimeConnection.kind !== "desktop-sidecar") {
      throw stableError("Managed Runtime connection is invalid.");
    }
    stage = "Web configuration";
    await web.configure(
      createRuntimeConnectedWebStartMessage({ mode, publicOrigin: webOrigin, runtimeConnection }),
    );
    stage = "Web readiness";
    await Promise.race([
      web.ready,
      termination.promise.then(() => {
        throw stableError("Managed Web/Runtime startup was interrupted.");
      }),
    ]);
    stage = "topology verification";
    await Promise.race([
      verifyTopology({ webOrigin, runtime }),
      termination.promise.then(() => {
        throw stableError("Managed Web/Runtime topology verification was interrupted.");
      }),
    ]);
    onReady(webOrigin);
    stage = "Web/Runtime lifetime";
    const outcome = await termination.promise;
    stage = "managed cleanup";
    const cleanup = await shutdown();
    return outcome.kind === "signal" && !cleanup.forced && cleanup.errors.length === 0 ? 0 : 1;
  } catch {
    const cleanup = await shutdown();
    if (terminationOutcome?.kind === "signal" && !cleanup.forced && cleanup.errors.length === 0) {
      return 0;
    }
    throw stableError(`Managed Web/Runtime orchestration failed during ${stage}.`);
  } finally {
    termination.dispose();
  }
}

export async function runWebRuntimeOrchestrator(options = parseWebRuntimeOrchestratorOptions()) {
  return runManagedWebRuntime(options);
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runWebRuntimeOrchestrator();
  } catch {
    console.error("Workbench Web/Runtime orchestration failed.");
    process.exitCode = 1;
  }
}
