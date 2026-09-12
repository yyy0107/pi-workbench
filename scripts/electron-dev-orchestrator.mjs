import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import workbenchPaths from "./workbench-paths.cjs";

const { createWorkbenchPaths } = workbenchPaths;
const CONNECT_EXISTING_ARGUMENT = "--connect-existing";
const PORT_ARGUMENT = "--port";
const DEFAULT_RENDERER_ORIGIN = "http://127.0.0.1:3000";
const DEFAULT_STARTUP_TIMEOUT_MS = 90_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const DEFAULT_FORCE_TIMEOUT_MS = 2_000;
const DESKTOP_RENDERER_MARKER = 'data-workbench-desktop-renderer="1"';

function stableError(message) {
  return new Error(message);
}

export function parseCanonicalDesktopRendererOrigin(value) {
  if (typeof value !== "string" || value !== value.trim()) return undefined;
  try {
    const url = new URL(value);
    const port = Number(url.port);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535 ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.origin !== value
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

/** Select exactly one topology. Electron, not this root process, owns the Runtime child. */
export function parseElectronDevelopmentOptions({
  argv = process.argv.slice(2),
  environment = process.env,
} = {}) {
  const arguments_ = argv[0] === "--" ? argv.slice(1) : argv;
  let connectExisting = false;
  let rendererPort;
  let rendererPortSpecified = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === CONNECT_EXISTING_ARGUMENT && !connectExisting) {
      connectExisting = true;
      continue;
    }
    if (argument === PORT_ARGUMENT && !rendererPortSpecified) {
      rendererPortSpecified = true;
      rendererPort = arguments_[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith(`${PORT_ARGUMENT}=`) && !rendererPortSpecified) {
      rendererPortSpecified = true;
      rendererPort = argument.slice(PORT_ARGUMENT.length + 1);
      continue;
    }
    throw stableError(
      `Usage: electron-dev-orchestrator.mjs [${CONNECT_EXISTING_ARGUMENT}] [${PORT_ARGUMENT} <port>]`,
    );
  }
  if (rendererPortSpecified) {
    const port = Number(rendererPort);
    if (
      !/^\d+$/u.test(rendererPort ?? "") ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535
    ) {
      throw stableError(`${PORT_ARGUMENT} must be an integer from 1 to 65535.`);
    }
    rendererPort = String(port);
  }
  for (const staleName of ["WORKBENCH_WEB_ORIGIN", "WORKBENCH_RUNTIME_ORIGIN"]) {
    if (environment[staleName]?.trim()) {
      throw stableError(
        `${staleName} is obsolete; only WORKBENCH_DESKTOP_RENDERER_ORIGIN is accepted.`,
      );
    }
  }

  const explicitOrigin = environment.WORKBENCH_DESKTOP_RENDERER_ORIGIN?.trim();
  if (connectExisting) {
    if (explicitOrigin && rendererPortSpecified) {
      throw stableError(
        `WORKBENCH_DESKTOP_RENDERER_ORIGIN and ${PORT_ARGUMENT} cannot be used together.`,
      );
    }
    const rendererOrigin = parseCanonicalDesktopRendererOrigin(
      explicitOrigin || (rendererPortSpecified ? `http://127.0.0.1:${rendererPort}` : undefined),
    );
    if (!rendererOrigin) {
      throw stableError(
        `WORKBENCH_DESKTOP_RENDERER_ORIGIN must be a canonical loopback HTTP origin, or ${PORT_ARGUMENT} must select an existing loopback renderer.`,
      );
    }
    return Object.freeze({ mode: "connect-existing", rendererOrigin });
  }
  if (explicitOrigin) {
    throw stableError(
      `WORKBENCH_DESKTOP_RENDERER_ORIGIN requires ${CONNECT_EXISTING_ARGUMENT}; managed mode owns the endpoint.`,
    );
  }
  return Object.freeze({
    mode: "managed",
    rendererOrigin: rendererPortSpecified
      ? `http://127.0.0.1:${rendererPort}`
      : DEFAULT_RENDERER_ORIGIN,
  });
}

function scrubWorkbenchEnvironment(environment) {
  const clean = { ...environment };
  for (const name of Object.keys(clean)) {
    if (name.toUpperCase().startsWith("WORKBENCH_")) delete clean[name];
  }
  return clean;
}

export function createDesktopRendererLaunchConfiguration({
  paths = createWorkbenchPaths(),
  environment = process.env,
  rendererOrigin = DEFAULT_RENDERER_ORIGIN,
  requireFromRenderer = createRequire(path.join(paths.desktopRendererRoot, "package.json")),
} = {}) {
  const origin = parseCanonicalDesktopRendererOrigin(rendererOrigin);
  if (!origin) throw stableError("Invalid managed Desktop renderer origin.");
  const nextCli = requireFromRenderer.resolve("next/dist/bin/next");
  const url = new URL(origin);
  return Object.freeze({
    command: process.execPath,
    args: Object.freeze([nextCli, "dev", "--hostname", url.hostname, "--port", url.port]),
    options: Object.freeze({
      cwd: paths.desktopRendererRoot,
      env: { ...scrubWorkbenchEnvironment(environment), NODE_ENV: "development" },
      detached: process.platform !== "win32",
      stdio: "inherit",
      windowsHide: true,
    }),
  });
}

export function createElectronLaunchConfiguration({
  paths = createWorkbenchPaths(),
  environment = process.env,
  rendererOrigin,
  requireFromElectron = createRequire(path.join(paths.desktopElectronRoot, "package.json")),
} = {}) {
  const origin = parseCanonicalDesktopRendererOrigin(rendererOrigin);
  if (!origin) throw stableError("Invalid Electron Desktop renderer origin.");
  const executable = requireFromElectron("electron");
  if (typeof executable !== "string" || !path.isAbsolute(executable)) {
    throw stableError("Electron development executable could not be resolved from its app.");
  }
  return Object.freeze({
    command: executable,
    args: Object.freeze([paths.desktopElectronRoot]),
    options: Object.freeze({
      cwd: paths.desktopElectronRoot,
      env: {
        ...scrubWorkbenchEnvironment(environment),
        NODE_ENV: "development",
        WORKBENCH_DESKTOP_RENDERER_ORIGIN: origin,
      },
      detached: process.platform !== "win32",
      stdio: "inherit",
      windowsHide: false,
    }),
  });
}

function childExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode, error: false });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.once("error", () => finish({ code: null, signal: null, error: true }));
    child.once("exit", (code, signal) => finish({ code, signal, error: false }));
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

export function forceDevelopmentProcessTree(
  child,
  { platform = process.platform, killProcess = process.kill } = {},
) {
  if (platform !== "win32" && Number.isInteger(child?.pid) && child.pid > 1) {
    try {
      killProcess(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall through when its process group is already gone.
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // The exit waiter remains authoritative.
  }
}

export function startManagedChild({
  launch,
  spawnImpl = spawn,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  forceTimeoutMs = DEFAULT_FORCE_TIMEOUT_MS,
  forceProcessTree = forceDevelopmentProcessTree,
} = {}) {
  const child = spawnImpl(launch.command, launch.args, launch.options);
  const exited = childExit(child);
  let shutdownOperation;
  return Object.freeze({
    exited,
    shutdown() {
      shutdownOperation ??= (async () => {
        if (child.exitCode !== null || child.signalCode !== null) {
          forceProcessTree(child);
          return;
        }
        try {
          child.kill("SIGTERM");
          await bounded(exited, shutdownTimeoutMs, "Development child shutdown");
          forceProcessTree(child);
        } catch {
          forceProcessTree(child);
          await bounded(exited, forceTimeoutMs, "Development child forced cleanup").catch(
            () => undefined,
          );
        }
      })();
      return shutdownOperation;
    },
  });
}

export async function waitForDesktopRenderer(
  rendererOrigin,
  { fetchImpl = fetch, timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS, retryMs = 100 } = {},
) {
  const origin = parseCanonicalDesktopRendererOrigin(rendererOrigin);
  if (!origin) throw stableError("Invalid Desktop renderer readiness origin.");
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const response = await fetchImpl(`${origin}/`, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(Math.min(5_000, timeoutMs)),
      });
      const html = await response.text();
      if (response.ok && html.includes(DESKTOP_RENDERER_MARKER)) return;
    } catch {
      // Next may still be compiling its first route.
    }
    await new Promise((resolve) => setTimeout(resolve, retryMs));
  } while (Date.now() < deadline);
  throw stableError("Desktop renderer readiness timed out.");
}

function terminationLatch(processControl) {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  const onSigint = () => resolve({ kind: "signal" });
  const onSigterm = () => resolve({ kind: "signal" });
  processControl.once("SIGINT", onSigint);
  processControl.once("SIGTERM", onSigterm);
  processControl.once("SIGHUP", onSigterm);
  return Object.freeze({
    promise,
    dispose() {
      processControl.off("SIGINT", onSigint);
      processControl.off("SIGTERM", onSigterm);
      processControl.off("SIGHUP", onSigterm);
    },
  });
}

export async function runElectronDevelopment({
  options = parseElectronDevelopmentOptions(),
  paths = createWorkbenchPaths(),
  environment = process.env,
  processControl = process,
  rendererLaunch = options.mode === "managed"
    ? createDesktopRendererLaunchConfiguration({
        paths,
        environment,
        rendererOrigin: options.rendererOrigin,
      })
    : undefined,
  electronLaunch = createElectronLaunchConfiguration({
    paths,
    environment,
    rendererOrigin: options.rendererOrigin,
  }),
  startChild = startManagedChild,
  waitForRenderer = waitForDesktopRenderer,
} = {}) {
  if (rendererLaunch) {
    // An existing renderer's marker must not make a failed managed child look ready.
    const url = new URL(options.rendererOrigin);
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", (error) => {
        reject(
          error.code === "EADDRINUSE"
            ? stableError(
                `Desktop renderer endpoint ${url.origin} is already in use. Stop its server, or connect to an existing Desktop renderer with WORKBENCH_DESKTOP_RENDERER_ORIGIN=${url.origin} pnpm electron:dev:connect.`,
              )
            : error,
        );
      });
      probe.listen({ host: url.hostname, port: Number(url.port), exclusive: true }, () => {
        probe.close((error) => (error ? reject(error) : resolve()));
      });
    });
  }
  const termination = terminationLatch(processControl);
  let renderer;
  let electron;
  try {
    if (rendererLaunch) renderer = startChild({ launch: rendererLaunch });
    const startup = await Promise.race([
      waitForRenderer(options.rendererOrigin).then(() => ({ kind: "ready" })),
      renderer?.exited.then(() => ({ kind: "renderer-exit" })) ?? new Promise(() => undefined),
      termination.promise,
    ]);
    if (startup.kind !== "ready") return startup.kind === "signal" ? 0 : 1;

    electron = startChild({ launch: electronLaunch });
    const outcome = await Promise.race([
      electron.exited.then((result) => ({ kind: "electron-exit", result })),
      renderer?.exited.then(() => ({ kind: "renderer-exit" })) ?? new Promise(() => undefined),
      termination.promise,
    ]);
    if (outcome.kind === "electron-exit") {
      return outcome.result.code === 0 && outcome.result.signal === null && !outcome.result.error
        ? 0
        : 1;
    }
    return outcome.kind === "signal" ? 0 : 1;
  } finally {
    termination.dispose();
    await electron?.shutdown().catch(() => undefined);
    await renderer?.shutdown().catch(() => undefined);
  }
}

async function main() {
  try {
    process.exitCode = await runElectronDevelopment();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Electron development failed.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
