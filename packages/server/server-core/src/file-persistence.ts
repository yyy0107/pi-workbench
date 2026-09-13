import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import {
  chmod,
  link,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  utimes,
} from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_LOCK_WAIT_TIMEOUT_MS = 10_000;
const DEFAULT_LOCK_STALE_AFTER_MS = 30_000;
const DEFAULT_LOCK_HEARTBEAT_MS = 5_000;
const INITIAL_LOCK_RETRY_MS = 5;
const MAX_LOCK_RETRY_MS = 100;

interface LockOwner {
  host: string;
  pid: number;
  token: string;
}

interface LockDirectoryIdentity {
  dev: number;
  ino: number;
}

interface ObservedLockOwner {
  content: string;
  identity: LockDirectoryIdentity;
  fileName: string;
  owner?: LockOwner;
  mtimeMs: number;
}

export interface CrossProcessFileLockOptions {
  lockDirectory: string;
  waitTimeoutMs?: number;
  staleAfterMs?: number;
  heartbeatIntervalMs?: number;
  parentDirectoryMode?: number;
}

export interface AtomicReplaceFileOptions {
  directoryMode?: number;
  fileMode?: number;
  enforceFileModeAfterReplace?: boolean;
}

export class CrossProcessFileLockTimeoutError extends Error {
  readonly lockDirectory: string;
  readonly waitTimeoutMs: number;

  constructor(lockDirectory: string, waitTimeoutMs: number) {
    super(`Timed out waiting for ${lockDirectory}`);
    this.name = "CrossProcessFileLockTimeoutError";
    this.lockDirectory = lockDirectory;
    this.waitTimeoutMs = waitTimeoutMs;
  }
}

function nodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || Array.isArray(error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function nonNegativeMilliseconds(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number.`);
  }
  return value;
}

function positiveMilliseconds(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number.`);
  }
  return value;
}

function parseJsonLockOwner(value: string): LockOwner | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const { host, pid, token } = parsed as Partial<LockOwner>;
    if (
      typeof host !== "string" ||
      typeof pid !== "number" ||
      !Number.isSafeInteger(pid) ||
      pid <= 0 ||
      typeof token !== "string" ||
      token.length === 0
    ) {
      return undefined;
    }
    return { host, pid, token };
  } catch {
    return undefined;
  }
}

function parseLegacyLockOwner(value: string): LockOwner | undefined {
  const match = /^(.*):([1-9]\d*):([^:]+)$/u.exec(value.trim());
  if (!match) return undefined;
  const pid = Number(match[2]);
  return Number.isSafeInteger(pid) ? { host: match[1]!, pid, token: match[3]! } : undefined;
}

function parseLockOwner(value: string): LockOwner | undefined {
  return parseJsonLockOwner(value) ?? parseLegacyLockOwner(value);
}

function lockDirectoryIdentity(value: Stats): LockDirectoryIdentity {
  return { dev: value.dev, ino: value.ino };
}

function isSameLockDirectory(left: LockDirectoryIdentity, right: LockDirectoryIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isOwnerFileName(value: string): boolean {
  return value === "owner" || /^owner\.[0-9a-f-]+\.json$/u.test(value);
}

async function observeLockOwners(lockDirectory: string): Promise<ObservedLockOwner[]> {
  const entries = await readdir(lockDirectory, { withFileTypes: true });
  return (
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && isOwnerFileName(entry.name))
        .map(async ({ name: fileName }): Promise<ObservedLockOwner | undefined> => {
          const ownerFile = path.join(lockDirectory, fileName);
          try {
            const [content, ownerStat] = await Promise.all([
              readFile(ownerFile, "utf8"),
              stat(ownerFile),
            ]);
            return {
              content,
              identity: lockDirectoryIdentity(ownerStat),
              fileName,
              owner: parseLockOwner(content),
              mtimeMs: ownerStat.mtimeMs,
            };
          } catch (error) {
            if (nodeErrorCode(error) === "ENOENT") return undefined;
            throw error;
          }
        }),
    )
  ).filter((owner): owner is ObservedLockOwner => owner !== undefined);
}

function lockOwnerIsAlive(owner: LockOwner | undefined): boolean | undefined {
  if (!owner || owner.host !== hostname()) return undefined;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return nodeErrorCode(error) === "ESRCH" ? false : true;
  }
}

async function removeOwnedLockDirectory(
  lockDirectory: string,
  ownerFileName: string,
  identity: LockDirectoryIdentity,
): Promise<void> {
  // The owner filename contains this acquisition's unguessable token, so removing that exact
  // entry is safe even if the canonical directory was replaced while acquisition was starting.
  await rm(path.join(lockDirectory, ownerFileName), { force: true });
  let currentIdentity: LockDirectoryIdentity;
  try {
    currentIdentity = lockDirectoryIdentity(await stat(lockDirectory));
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return;
    throw error;
  }
  if (!isSameLockDirectory(identity, currentIdentity)) return;
  try {
    await rmdir(lockDirectory);
  } catch (error) {
    if (["ENOENT", "ENOTEMPTY", "EEXIST"].includes(nodeErrorCode(error) ?? "")) return;
    throw error;
  }
}

async function removeObservedStaleLock(
  lockDirectory: string,
  identity: LockDirectoryIdentity,
  owners: readonly ObservedLockOwner[],
): Promise<boolean> {
  let currentIdentity: LockDirectoryIdentity;
  try {
    currentIdentity = lockDirectoryIdentity(await stat(lockDirectory));
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return true;
    throw error;
  }
  if (!isSameLockDirectory(identity, currentIdentity)) return false;

  const entries = await readdir(lockDirectory);
  const ownerNames = new Set(owners.map(({ fileName }) => fileName));
  if (entries.some((entry) => !ownerNames.has(entry)) || entries.length !== owners.length) {
    return false;
  }
  if (owners.length > 1) return false;

  if (owners.length === 1) {
    const observedOwner = owners[0]!;
    const ownerFile = path.join(lockDirectory, observedOwner.fileName);
    const quarantinedOwner = path.join(lockDirectory, `.stale-owner.${randomUUID()}`);
    try {
      await rename(ownerFile, quarantinedOwner);
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") return false;
      throw error;
    }

    const restoreOwner = async (): Promise<void> => {
      try {
        await link(quarantinedOwner, ownerFile);
      } catch (error) {
        if (nodeErrorCode(error) !== "EEXIST") throw error;
      }
      await rm(quarantinedOwner, { force: true });
    };
    try {
      const [currentDirectoryStat, currentOwnerStat, content] = await Promise.all([
        stat(lockDirectory),
        stat(quarantinedOwner),
        readFile(quarantinedOwner, "utf8"),
      ]);
      if (
        !isSameLockDirectory(identity, lockDirectoryIdentity(currentDirectoryStat)) ||
        !isSameLockDirectory(observedOwner.identity, lockDirectoryIdentity(currentOwnerStat)) ||
        observedOwner.mtimeMs !== currentOwnerStat.mtimeMs ||
        observedOwner.content !== content
      ) {
        await restoreOwner();
        return false;
      }
      await rm(quarantinedOwner, { force: true });
    } catch (error) {
      await restoreOwner();
      if (nodeErrorCode(error) === "ENOENT") return false;
      throw error;
    }
  }
  try {
    await rmdir(lockDirectory);
    return true;
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return true;
    if (["ENOTEMPTY", "EEXIST"].includes(nodeErrorCode(error) ?? "")) return false;
    throw error;
  }
}

async function acquireCrossProcessFileLock(
  options: CrossProcessFileLockOptions,
): Promise<() => Promise<void>> {
  const waitTimeoutMs = nonNegativeMilliseconds(
    options.waitTimeoutMs ?? DEFAULT_LOCK_WAIT_TIMEOUT_MS,
    "waitTimeoutMs",
  );
  const staleAfterMs = positiveMilliseconds(
    options.staleAfterMs ?? DEFAULT_LOCK_STALE_AFTER_MS,
    "staleAfterMs",
  );
  const heartbeatIntervalMs = positiveMilliseconds(
    options.heartbeatIntervalMs ??
      Math.max(1, Math.min(DEFAULT_LOCK_HEARTBEAT_MS, Math.floor(staleAfterMs / 3))),
    "heartbeatIntervalMs",
  );
  const lockDirectory = options.lockDirectory;
  if (!lockDirectory) throw new TypeError("lockDirectory must be non-empty.");

  await mkdir(path.dirname(lockDirectory), {
    recursive: true,
    ...(options.parentDirectoryMode === undefined ? {} : { mode: options.parentDirectoryMode }),
  });
  const deadline = Date.now() + waitTimeoutMs;
  let retryMs = INITIAL_LOCK_RETRY_MS;

  for (;;) {
    const owner: LockOwner = { host: hostname(), pid: process.pid, token: randomUUID() };
    const ownerFileName = `owner.${owner.token}.json`;
    let acquired = false;
    try {
      await mkdir(lockDirectory);
      acquired = true;
    } catch (error) {
      if (nodeErrorCode(error) !== "EEXIST") throw error;
    }

    if (acquired) {
      let identity: LockDirectoryIdentity | undefined;
      try {
        identity = lockDirectoryIdentity(await stat(lockDirectory));
        const ownerFile = path.join(lockDirectory, ownerFileName);
        const handle = await open(ownerFile, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify(owner), "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        const [currentStat, entries] = await Promise.all([
          stat(lockDirectory),
          readdir(lockDirectory),
        ]);
        if (
          !isSameLockDirectory(identity, lockDirectoryIdentity(currentStat)) ||
          entries.length !== 1 ||
          entries[0] !== ownerFileName
        ) {
          await removeOwnedLockDirectory(lockDirectory, ownerFileName, identity);
          continue;
        }
        const acquiredIdentity = identity;

        const heartbeat = setInterval(() => {
          const now = new Date();
          // Keep the canonical directory fresh for readers using the legacy `owner` protocol,
          // while the token-named file remains the authoritative heartbeat for this owner.
          void Promise.allSettled([utimes(ownerFile, now, now), utimes(lockDirectory, now, now)]);
        }, heartbeatIntervalMs);
        heartbeat.unref?.();
        return async () => {
          clearInterval(heartbeat);
          await removeOwnedLockDirectory(lockDirectory, ownerFileName, acquiredIdentity);
        };
      } catch (error) {
        if (identity) {
          await removeOwnedLockDirectory(lockDirectory, ownerFileName, identity);
        }
        if (nodeErrorCode(error) === "ENOENT") continue;
        throw error;
      }
    }

    try {
      const lockStat = await stat(lockDirectory);
      const identity = lockDirectoryIdentity(lockStat);
      const owners = await observeLockOwners(lockDirectory).catch((error: unknown) => {
        // Windows may temporarily deny reads while another process releases an owner file.
        // An incomplete observation must never authorize stale-lock removal; retry below.
        if (["EPERM", "EACCES", "EBUSY"].includes(nodeErrorCode(error) ?? "")) return undefined;
        throw error;
      });
      if (owners !== undefined) {
        const ownerStates = owners.map(({ owner: currentOwner }) => lockOwnerIsAlive(currentOwner));
        const ownerAlive = ownerStates.includes(true)
          ? true
          : ownerStates.length > 0 && ownerStates.every((state) => state === false)
            ? false
            : undefined;
        const lastHeartbeatMs = Math.max(lockStat.mtimeMs, ...owners.map(({ mtimeMs }) => mtimeMs));
        if (ownerAlive === false || Date.now() - lastHeartbeatMs > staleAfterMs) {
          if (await removeObservedStaleLock(lockDirectory, identity, owners)) continue;
        }
      }
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") continue;
      throw error;
    }

    if (Date.now() >= deadline) {
      throw new CrossProcessFileLockTimeoutError(lockDirectory, waitTimeoutMs);
    }
    await delay(retryMs);
    retryMs = Math.min(retryMs * 2, MAX_LOCK_RETRY_MS);
  }
}

export async function withCrossProcessFileLock<Result>(
  options: CrossProcessFileLockOptions,
  operation: () => Promise<Result>,
): Promise<Result> {
  const release = await acquireCrossProcessFileLock(options);
  try {
    return await operation();
  } finally {
    await release();
  }
}

export async function atomicReplaceFile(
  file: string,
  content: string,
  options: AtomicReplaceFileOptions = {},
): Promise<void> {
  const directory = path.dirname(file);
  const fileMode = options.fileMode ?? 0o600;
  await mkdir(directory, {
    recursive: true,
    ...(options.directoryMode === undefined ? {} : { mode: options.directoryMode }),
  });
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    const handle = await open(temporary, "wx", fileMode);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
    if (options.enforceFileModeAfterReplace) await chmod(file, fileMode);
  } finally {
    await rm(temporary, { force: true });
  }
}
