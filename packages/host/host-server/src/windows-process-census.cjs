const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const DEFAULT_WINDOWS_CENSUS_INTERVAL_MS = 1_000;

function windowsProcessCensusError(message) {
  return new Error(`Windows process census uncertainty: ${message}`);
}

function windowsCensusCommand() {
  // CommandLineToArgvW is Windows' own parser. Matching its argv plus raw CommandLine, executable
  // and CreationDate prevents PID reuse and substring/quoted-argument decoys from being killed.
  return String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WorkbenchCommandLine {
  [DllImport("shell32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern IntPtr CommandLineToArgvW(string commandLine, out int argumentCount);
  [DllImport("kernel32.dll")]
  public static extern IntPtr LocalFree(IntPtr memory);
}
'@
function Convert-WorkbenchCommandLine([string] $commandLine) {
  $argumentCount = 0
  $memory = [WorkbenchCommandLine]::CommandLineToArgvW($commandLine, [ref] $argumentCount)
  if ($memory -eq [IntPtr]::Zero -or $argumentCount -lt 1) { return @() }
  try {
    $arguments = @()
    for ($index = 0; $index -lt $argumentCount; $index += 1) {
      $pointer = [Runtime.InteropServices.Marshal]::ReadIntPtr($memory, $index * [IntPtr]::Size)
      $arguments += [Runtime.InteropServices.Marshal]::PtrToStringUni($pointer)
    }
    # Let PowerShell enumerate each argument into the caller's @(...). Returning the array as one
    # item creates argv = [[...]], which makes every process identity unverifiable after JSON.
    return $arguments
  } finally {
    [void] [WorkbenchCommandLine]::LocalFree($memory)
  }
}
$records = @(
  Get-CimInstance Win32_Process | ForEach-Object {
    if ([string]::IsNullOrWhiteSpace([string] $_.ExecutablePath) -or [string]::IsNullOrWhiteSpace([string] $_.CommandLine)) { return }
    $argv = @(Convert-WorkbenchCommandLine ([string] $_.CommandLine))
    if ($argv.Count -lt 1) { return }
    [pscustomobject]@{
      pid = [int] $_.ProcessId
      parentPid = [int] $_.ParentProcessId
      creationDate = $_.CreationDate.ToUniversalTime().ToString('o')
      executable = [string] $_.ExecutablePath
      commandLine = [string] $_.CommandLine
      argv = @($argv)
    }
  }
)
[Console]::WriteLine((ConvertTo-Json -InputObject $records -Compress -Depth 4))
`;
}

async function readWindowsProcessCensus({ execFileImpl = execFileAsync } = {}) {
  const { stdout } = await execFileImpl(
    "powershell.exe",
    ["-NoProfile", "-Command", windowsCensusCommand()],
    {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    },
  );
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
}

function normalizeWindowsPath(value) {
  return value.replaceAll("/", "\\").toLowerCase();
}

function normalizeWindowsCensus(records) {
  if (!Array.isArray(records)) throw windowsProcessCensusError("process census was not an array");
  const normalized = new Map();
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw windowsProcessCensusError("process census contained an invalid record");
    }
    const { argv, commandLine, creationDate, executable, parentPid, pid } = record;
    if (
      !Number.isInteger(pid) ||
      pid < 2 ||
      !Number.isInteger(parentPid) ||
      parentPid < 0 ||
      typeof creationDate !== "string" ||
      creationDate.length === 0 ||
      typeof executable !== "string" ||
      executable.length === 0 ||
      typeof commandLine !== "string" ||
      commandLine.length === 0 ||
      !Array.isArray(argv) ||
      argv.length === 0 ||
      argv.some((argument) => typeof argument !== "string") ||
      normalized.has(pid)
    ) {
      throw windowsProcessCensusError("process census contained an unverifiable identity");
    }
    normalized.set(
      pid,
      Object.freeze({
        argv: Object.freeze([...argv]),
        commandLine,
        creationDate,
        executable: normalizeWindowsPath(executable),
        parentPid,
        pid,
      }),
    );
  }
  return normalized;
}

function sameWindowsProcessIdentity(left, right) {
  return (
    left.pid === right.pid &&
    left.creationDate === right.creationDate &&
    left.executable === right.executable &&
    left.commandLine === right.commandLine &&
    left.argv.length === right.argv.length &&
    left.argv.every((argument, index) => argument === right.argv[index])
  );
}

function killWindowsProcessTree(pid, { spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const killer = spawnImpl("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    let settled = false;
    killer.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    killer.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else reject(new Error(`taskkill failed (${signal || `exit ${code ?? "unknown"}`}).`));
    });
  });
}

function createWindowsProcessRegistry({
  censusIntervalMs = DEFAULT_WINDOWS_CENSUS_INTERVAL_MS,
  readCensus = readWindowsProcessCensus,
  timers = { clearTimeout, setTimeout },
} = {}) {
  const records = new Map();
  let leaderPid;
  let monitoring;
  let failure;
  let stopped = false;
  let pending = Promise.resolve();

  const fail = (error) => {
    failure ??= error instanceof Error ? error : windowsProcessCensusError("process census failed");
    return failure;
  };
  const addDescendants = (current) => {
    const children = new Map();
    for (const candidate of current.values()) {
      const entries = children.get(candidate.parentPid) ?? [];
      entries.push(candidate);
      children.set(candidate.parentPid, entries);
    }
    const visit = (parentPid, depth) => {
      for (const child of children.get(parentPid) ?? []) {
        const existing = records.get(child.pid);
        if (existing && !sameWindowsProcessIdentity(existing.identity, child)) continue;
        if (!existing) records.set(child.pid, Object.freeze({ depth, identity: child }));
        visit(child.pid, depth + 1);
      }
    };
    // A recorded descendant remains a trusted live branch after its original leader reparented.
    for (const [pid, entry] of records) {
      const currentRecord = current.get(pid);
      if (currentRecord && sameWindowsProcessIdentity(entry.identity, currentRecord)) {
        visit(pid, entry.depth + 1);
      }
    }
  };
  const read = async () => {
    if (failure) throw failure;
    try {
      const current = normalizeWindowsCensus(await readCensus());
      if (!Number.isInteger(leaderPid))
        throw windowsProcessCensusError("leader was never registered");
      const leader = current.get(leaderPid);
      const knownLeader = records.get(leaderPid);
      if (!knownLeader) {
        if (!leader) {
          throw windowsProcessCensusError(
            `leader PID ${leaderPid} was absent from its initial census`,
          );
        }
        records.set(leaderPid, Object.freeze({ depth: 0, identity: leader }));
      } else if (leader && !sameWindowsProcessIdentity(knownLeader.identity, leader)) {
        throw windowsProcessCensusError(`leader PID ${leaderPid} identity changed`);
      }
      addDescendants(current);
      return current;
    } catch (error) {
      throw fail(error);
    }
  };
  // Serialize reads so shutdown gets a fresh census after any in-flight background scan.
  const refresh = () => {
    const next = pending.then(read);
    pending = next.catch(() => undefined);
    return next;
  };
  const dispose = () => {
    stopped = true;
    if (monitoring) timers.clearTimeout(monitoring);
    monitoring = undefined;
  };
  const schedule = () => {
    if (stopped) return;
    // PowerShell startup + CIM enumeration is expensive. Leave an idle gap after each scan,
    // rather than blocking Electron's UI thread or piling up concurrent PowerShell processes.
    // ponytail: snapshots can miss short-lived parent branches; use Windows Job Objects if
    // guaranteed descendant ownership between scans becomes necessary.
    monitoring = timers.setTimeout(async () => {
      monitoring = undefined;
      try {
        await refresh();
        schedule();
      } catch {
        // Shutdown reports the stored uncertainty; do not keep retrying a failed census.
      }
    }, censusIntervalMs);
    monitoring?.unref?.();
  };
  return Object.freeze({
    get failure() {
      return failure;
    },
    get leaderPid() {
      return leaderPid;
    },
    get records() {
      return records;
    },
    async register(pid, child) {
      if (!Number.isInteger(pid) || pid < 2 || pid === process.pid) {
        throw windowsProcessCensusError("leader has an unsafe PID");
      }
      if (leaderPid !== undefined) throw windowsProcessCensusError("leader was registered twice");
      leaderPid = pid;
      child?.once?.("exit", dispose);
      await refresh();
      schedule();
      return this;
    },
    refresh,
    dispose,
  });
}

async function terminateVerifiedWindowsProcessTree(registry, killTree = killWindowsProcessTree) {
  registry.dispose();
  if (registry.failure) throw registry.failure;
  const current = await registry.refresh();
  const verified = [];
  for (const entry of registry.records.values()) {
    const observed = current.get(entry.identity.pid);
    if (!observed) continue;
    if (!sameWindowsProcessIdentity(entry.identity, observed)) {
      throw windowsProcessCensusError(`PID ${entry.identity.pid} identity changed`);
    }
    verified.push(Object.freeze({ ...entry, identity: observed }));
  }
  const leader = verified.find((entry) => entry.identity.pid === registry.leaderPid);
  if (leader) {
    try {
      await killTree(leader.identity.pid);
      return true;
    } catch {
      // A leader can die between census and taskkill. Re-check every retained descendant below.
    }
  }
  for (const entry of verified.sort((left, right) => right.depth - left.depth)) {
    try {
      await killTree(entry.identity.pid);
    } catch {
      const afterFailure = (await registry.refresh()).get(entry.identity.pid);
      if (afterFailure && sameWindowsProcessIdentity(entry.identity, afterFailure)) {
        throw windowsProcessCensusError(
          `taskkill could not terminate verified PID ${entry.identity.pid}`,
        );
      }
    }
  }
  return true;
}

module.exports = {
  DEFAULT_WINDOWS_CENSUS_INTERVAL_MS,
  createWindowsProcessRegistry,
  killWindowsProcessTree,
  readWindowsProcessCensus,
  sameWindowsProcessIdentity,
  terminateVerifiedWindowsProcessTree,
  windowsProcessCensusError,
};
