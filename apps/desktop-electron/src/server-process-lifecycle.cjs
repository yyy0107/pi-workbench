const {
  createWindowsProcessRegistry,
  killWindowsProcessTree,
  readWindowsProcessCensus,
  terminateVerifiedWindowsProcessTree,
} = require("@workbench/host-server/windows-process-census");

const WORKBENCH_SHUTDOWN_MESSAGE_TYPE = "workbench:shutdown";
// Give a managed child a bounded cooperative window before escalating its isolated process tree.
const DEFAULT_GRACEFUL_TIMEOUT_MS = 10_000;
const DEFAULT_FORCE_TIMEOUT_MS = 2_000;

// A ChildProcess proves the identity of its leader only while that leader is alive. The shared
// Host-server census retains an exact, in-memory lineage for Windows cleanup; it is never written
// to argv, environment, or a file because process metadata must not become a credential channel.
const windowsRegistrations = new WeakMap();

function lifecycleError(message) {
  return new Error(`Windows server-process cleanup uncertainty: ${message}`);
}

function isChildRunning(child) {
  return child.exitCode === null && child.signalCode == null;
}

function waitForExit(child) {
  if (!isChildRunning(child)) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

function waitUntil(promise, timeoutMs) {
  let timeout;
  return Promise.race([
    promise.then(() => true),
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function signalProcessGroup(pid, signal) {
  process.kill(-pid, signal);
}

function registerServerProcess(
  child,
  { platform = process.platform, windowsRegistry = createWindowsProcessRegistry() } = {},
) {
  if (platform !== "win32" || !child) return undefined;
  if (windowsRegistrations.has(child)) return windowsRegistrations.get(child);
  windowsRegistry.register(child.pid, child);
  windowsRegistrations.set(child, windowsRegistry);
  return windowsRegistry;
}

function registeredWindowsProcessRegistry(child, options) {
  const existing = windowsRegistrations.get(child);
  if (existing) return existing;
  if (!isChildRunning(child)) {
    throw lifecycleError("crashed leader had no registered Windows process census");
  }
  return registerServerProcess(child, options);
}

function requestGracefulStop(child, platform) {
  if (platform === "win32" && child.connected && typeof child.send === "function") {
    try {
      child.send({ type: WORKBENCH_SHUTDOWN_MESSAGE_TYPE }, () => undefined);
      return true;
    } catch {
      return false;
    }
  }

  // Windows cannot deliver a catchable SIGTERM. Without IPC, terminate the
  // complete wrapper/server tree instead of killing only its parent process.
  if (platform === "win32") return false;

  // Runtime inherits the supervisor's isolated process group. Signal only the supervisor so it
  // can stop admission and complete its NDJSON Runtime shutdown before any descendant receives a
  // termination signal. Group addressing is reserved for the forced deadline below.
  try {
    return child.kill("SIGTERM") !== false;
  } catch {
    // The exit waiter remains authoritative.
  }
  return false;
}

async function forceStop(child, platform, killGroup, killWindowsTree, windowsOptions) {
  const pid = child.pid;
  if (!Number.isInteger(pid) || pid < 1 || pid === process.pid) {
    try {
      child.kill("SIGKILL");
    } catch {
      // Nothing else can be addressed safely without a valid child pid.
    }
    return false;
  }

  if (platform === "win32") {
    try {
      const registry = registeredWindowsProcessRegistry(child, windowsOptions);
      return await terminateVerifiedWindowsProcessTree(registry, killWindowsTree);
    } catch {
      // A Windows tree must never fall back to a bare PID after its exact census is uncertain.
      return false;
    }
  }

  try {
    killGroup(pid, "SIGKILL");
    return true;
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may already have exited.
    }
    return false;
  }
}

async function stopServerProcess(
  child,
  {
    platform = process.platform,
    gracefulTimeoutMs = DEFAULT_GRACEFUL_TIMEOUT_MS,
    forceTimeoutMs = DEFAULT_FORCE_TIMEOUT_MS,
    killGroup = signalProcessGroup,
    killWindowsTree = killWindowsProcessTree,
    windowsRegistry,
  } = {},
) {
  if (!child) return { exited: true, forced: false };
  const windowsOptions = { platform, windowsRegistry };
  if (!isChildRunning(child)) {
    // A crashed leader may leave descendants in its previously isolated PGID/tree. On Windows,
    // only a previously captured exact census can address reparented descendants safely.
    const cleaned = await forceStop(child, platform, killGroup, killWindowsTree, windowsOptions);
    return { exited: platform === "win32" ? cleaned : true, forced: true };
  }
  if (platform === "win32") {
    try {
      registerServerProcess(child, windowsOptions);
    } catch {
      return { exited: false, forced: true };
    }
  }
  const exited = waitForExit(child);
  const gracefulRequested = requestGracefulStop(child, platform);
  if (!gracefulRequested) {
    const cleaned = await forceStop(child, platform, killGroup, killWindowsTree, windowsOptions);
    return {
      exited: cleaned && (await waitUntil(exited, forceTimeoutMs)),
      forced: true,
    };
  }
  if (await waitUntil(exited, gracefulTimeoutMs)) {
    // A cooperative Windows leader can still leave a reparented child if it exits during its own
    // final cleanup. The same exact census is cheap to inspect here and refuses an unproven tree.
    if (platform === "win32") {
      const cleaned = await forceStop(child, platform, killGroup, killWindowsTree, windowsOptions);
      return { exited: cleaned, forced: false };
    }
    return { exited: true, forced: false };
  }

  const cleaned = await forceStop(child, platform, killGroup, killWindowsTree, windowsOptions);
  return {
    exited: cleaned && (await waitUntil(exited, forceTimeoutMs)),
    forced: true,
  };
}

module.exports = {
  DEFAULT_FORCE_TIMEOUT_MS,
  DEFAULT_GRACEFUL_TIMEOUT_MS,
  WORKBENCH_SHUTDOWN_MESSAGE_TYPE,
  createWindowsProcessRegistry,
  killWindowsProcessTree,
  readWindowsProcessCensus,
  registerServerProcess,
  stopServerProcess,
};
