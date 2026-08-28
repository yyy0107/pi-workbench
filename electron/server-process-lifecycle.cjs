const { spawn } = require("node:child_process");

const WORKBENCH_SHUTDOWN_MESSAGE_TYPE = "workbench:shutdown";
const DEFAULT_GRACEFUL_TIMEOUT_MS = 5_000;
const DEFAULT_FORCE_TIMEOUT_MS = 2_000;

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

function killWindowsProcessTree(pid) {
  return new Promise((resolve, reject) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", reject);
    killer.once("exit", () => resolve());
  });
}

function requestGracefulStop(child, platform, killGroup) {
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

  if (Number.isInteger(child.pid) && child.pid > 0) {
    try {
      killGroup(child.pid, "SIGTERM");
      return true;
    } catch {
      // The child may have exited between the running check and the signal.
    }
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // The exit waiter remains authoritative.
  }
  return true;
}

async function forceStop(child, platform, killGroup, killWindowsTree) {
  const pid = child.pid;
  if (!Number.isInteger(pid) || pid < 1 || pid === process.pid) {
    try {
      child.kill("SIGKILL");
    } catch {
      // Nothing else can be addressed safely without a valid child pid.
    }
    return;
  }

  try {
    if (platform === "win32") await killWindowsTree(pid);
    else killGroup(pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may already have exited.
    }
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
  } = {},
) {
  if (!child || !isChildRunning(child)) return { exited: true, forced: false };
  const exited = waitForExit(child);
  const gracefulRequested = requestGracefulStop(child, platform, killGroup);
  if (!gracefulRequested) {
    await forceStop(child, platform, killGroup, killWindowsTree);
    return {
      exited: await waitUntil(exited, forceTimeoutMs),
      forced: true,
    };
  }
  if (await waitUntil(exited, gracefulTimeoutMs)) return { exited: true, forced: false };

  await forceStop(child, platform, killGroup, killWindowsTree);
  return {
    exited: await waitUntil(exited, forceTimeoutMs),
    forced: true,
  };
}

module.exports = {
  DEFAULT_FORCE_TIMEOUT_MS,
  DEFAULT_GRACEFUL_TIMEOUT_MS,
  WORKBENCH_SHUTDOWN_MESSAGE_TYPE,
  stopServerProcess,
};
