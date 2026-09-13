import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  rmdir,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { registerHooks } from "node:module";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "node:fs/promises" && context.parentURL?.endsWith("/file-persistence.ts")) {
      return nextResolve(new URL("./file-persistence.test-fs.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { atomicReplaceFile, CrossProcessFileLockTimeoutError, withCrossProcessFileLock } =
  (await import(
    new URL("../src/file-persistence.ts", import.meta.url).href
  )) as typeof import("../src/file-persistence");
moduleHooks.deregister();

async function fixture(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-file-persistence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("serializes lock contenders and removes ownership after release", async (t) => {
  const directory = await fixture(t);
  const lockDirectory = path.join(directory, "settings.lock");
  const events: string[] = [];
  let enteredFirst!: () => void;
  const firstEntered = new Promise<void>((resolve) => {
    enteredFirst = resolve;
  });
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const options = {
    lockDirectory,
    waitTimeoutMs: 500,
    staleAfterMs: 500,
    heartbeatIntervalMs: 20,
  };

  const first = withCrossProcessFileLock(options, async () => {
    events.push("first:start");
    enteredFirst();
    await firstGate;
    events.push("first:end");
  });
  await firstEntered;
  const second = withCrossProcessFileLock(options, async () => {
    events.push("second:start");
    events.push("second:end");
  });

  await delay(25);
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
  await assert.rejects(stat(lockDirectory), { code: "ENOENT" });
});

test("retries owner read conflicts and keeps unreadable locks intact until timeout", async (t) => {
  for (const code of ["EPERM", "EACCES", "EBUSY"]) {
    const directory = await fixture(t);
    const lockDirectory = path.join(directory, "settings.lock");
    const ownerFile = path.join(lockDirectory, "owner");
    await mkdir(lockDirectory);
    const content = JSON.stringify({ host: hostname(), pid: process.pid, token: "held-by-test" });
    await writeFile(ownerFile, content);
    const old = new Date(Date.now() - 5_000);
    await utimes(ownerFile, old, old);
    await utimes(lockDirectory, old, old);
    const readHook = Symbol.for("workbench.file-persistence.test.read-hook");
    let attempts = 0;
    let releaseOnRetry = false;
    let readErrorCode = code;
    Reflect.set(globalThis, readHook, async (target: string | URL) => {
      if (target.toString() !== ownerFile) return;
      attempts++;
      if (releaseOnRetry && attempts === 2) {
        await rm(ownerFile);
        await rmdir(lockDirectory);
        return;
      }
      throw Object.assign(new Error("owner read conflict"), { code: readErrorCode });
    });
    t.after(() => {
      Reflect.deleteProperty(globalThis, readHook);
    });
    await assert.rejects(
      withCrossProcessFileLock({ lockDirectory, waitTimeoutMs: 30, staleAfterMs: 1 }, async () =>
        assert.fail("must not acquire an unreadable lock"),
      ),
      CrossProcessFileLockTimeoutError,
    );
    assert.ok(attempts > 1);
    assert.equal(await readFile(ownerFile, "utf8"), content);
    readErrorCode = "EIO";
    await assert.rejects(
      withCrossProcessFileLock({ lockDirectory }, async () => assert.fail("must not acquire")),
      { code: "EIO" },
    );
    readErrorCode = code;
    attempts = 0;
    releaseOnRetry = true;
    assert.equal(
      await withCrossProcessFileLock({ lockDirectory, waitTimeoutMs: 500 }, async () => "acquired"),
      "acquired",
    );
    assert.equal(attempts, 2);
    Reflect.deleteProperty(globalThis, readHook);
  }
});

test("release cannot remove a successor created after owner validation", async (t) => {
  const directory = await fixture(t);
  const lockDirectory = path.join(directory, "settings.lock");
  const removeHook = Symbol.for("workbench.file-persistence.test.remove-hook");
  let releaseRemovalStarted!: () => void;
  const releaseAtRemoval = new Promise<void>((resolve) => {
    releaseRemovalStarted = resolve;
  });
  let continueRelease!: () => void;
  const releaseRemovalGate = new Promise<void>((resolve) => {
    continueRelease = resolve;
  });
  let interceptedRelease = false;
  Reflect.set(
    globalThis,
    removeHook,
    async (target: string | URL, options: { recursive?: boolean } | undefined) => {
      const targetPath = target.toString();
      const isCurrentRelease =
        path.dirname(targetPath) === lockDirectory &&
        /^owner\.[0-9a-f-]+\.json$/u.test(path.basename(targetPath));
      const isLegacyRelease = targetPath === lockDirectory && options?.recursive === true;
      if (interceptedRelease || (!isCurrentRelease && !isLegacyRelease)) return;
      interceptedRelease = true;
      releaseRemovalStarted();
      await releaseRemovalGate;
    },
  );
  t.after(() => {
    Reflect.deleteProperty(globalThis, removeHook);
  });

  let enteredFirst!: () => void;
  const firstEntered = new Promise<void>((resolve) => {
    enteredFirst = resolve;
  });
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let enteredSecond!: () => void;
  const secondEntered = new Promise<void>((resolve) => {
    enteredSecond = resolve;
  });
  let releaseSecond!: () => void;
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });

  const first = withCrossProcessFileLock(
    {
      lockDirectory,
      waitTimeoutMs: 500,
      staleAfterMs: 20,
      heartbeatIntervalMs: 1_000,
    },
    async () => {
      enteredFirst();
      await firstGate;
    },
  );
  await firstEntered;
  await delay(40);

  releaseFirst();
  await releaseAtRemoval;

  const second = withCrossProcessFileLock(
    {
      lockDirectory,
      waitTimeoutMs: 500,
      staleAfterMs: 100,
      heartbeatIntervalMs: 5,
    },
    async () => {
      enteredSecond();
      await secondGate;
    },
  );
  await secondEntered;

  continueRelease();
  await first;
  const successorOwners = await readdir(lockDirectory);
  assert.equal(successorOwners.length, 1);
  assert.match(successorOwners[0]!, /^owner\.[0-9a-f-]+\.json$/u);

  releaseSecond();
  await second;
  await assert.rejects(stat(lockDirectory), { code: "ENOENT" });
});

test("heartbeats the canonical directory for legacy lock contenders", async (t) => {
  const directory = await fixture(t);
  const lockDirectory = path.join(directory, "settings.lock");

  await withCrossProcessFileLock(
    {
      lockDirectory,
      waitTimeoutMs: 500,
      staleAfterMs: 100,
      heartbeatIntervalMs: 5,
    },
    async () => {
      const old = new Date(Date.now() - 5_000);
      await utimes(lockDirectory, old, old);
      const staleMtimeMs = (await stat(lockDirectory)).mtimeMs;
      await delay(25);
      assert.ok((await stat(lockDirectory)).mtimeMs > staleMtimeMs);
    },
  );
});

test("times out without deleting a live owner's lock", async (t) => {
  const directory = await fixture(t);
  const lockDirectory = path.join(directory, "settings.lock");
  const ownerFile = path.join(lockDirectory, "owner");
  const owner = { host: hostname(), pid: process.pid, token: "held-by-test" };
  await mkdir(lockDirectory);
  await writeFile(ownerFile, JSON.stringify(owner));

  await assert.rejects(
    withCrossProcessFileLock(
      { lockDirectory, waitTimeoutMs: 20, staleAfterMs: 2_000 },
      async () => undefined,
    ),
    (error: unknown) => {
      assert.ok(error instanceof CrossProcessFileLockTimeoutError);
      assert.equal(error.lockDirectory, lockDirectory);
      assert.equal(error.waitTimeoutMs, 20);
      return true;
    },
  );
  assert.deepEqual(JSON.parse(await readFile(ownerFile, "utf8")), owner);
});

test("recovers a stale legacy lock and cleans stale and active directories", async (t) => {
  const directory = await fixture(t);
  const lockDirectory = path.join(directory, "settings.lock");
  await mkdir(lockDirectory);
  const old = new Date(Date.now() - 5_000);
  await utimes(lockDirectory, old, old);

  assert.equal(
    await withCrossProcessFileLock(
      {
        lockDirectory,
        waitTimeoutMs: 200,
        staleAfterMs: 10,
        heartbeatIntervalMs: 5,
      },
      async () => "recovered",
    ),
    "recovered",
  );
  assert.deepEqual(await readdir(directory), []);
});

test("releases a lock when the protected operation fails", async (t) => {
  const directory = await fixture(t);
  const lockDirectory = path.join(directory, "settings.lock");
  const failure = new Error("operation failed");

  await assert.rejects(
    withCrossProcessFileLock({ lockDirectory }, async () => {
      throw failure;
    }),
    (error: unknown) => error === failure,
  );
  await assert.rejects(stat(lockDirectory), { code: "ENOENT" });
});

test("atomically replaces mode-0600 content and removes temporary files", async (t) => {
  const directory = await fixture(t);
  const parent = path.join(directory, "nested");
  const file = path.join(parent, "settings.json");

  await atomicReplaceFile(file, "first\n", {
    directoryMode: 0o700,
    fileMode: 0o600,
    enforceFileModeAfterReplace: true,
  });
  await atomicReplaceFile(file, "second\n", {
    directoryMode: 0o700,
    fileMode: 0o600,
    enforceFileModeAfterReplace: true,
  });

  assert.equal(await readFile(file, "utf8"), "second\n");
  // Windows does not expose POSIX owner/group permission bits through stat.
  if (process.platform !== "win32") {
    assert.equal((await stat(parent)).mode & 0o777, 0o700);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
  assert.deepEqual(await readdir(parent), ["settings.json"]);
});

test("cleans the temporary file when replacement fails", async (t) => {
  const directory = await fixture(t);
  const target = path.join(directory, "occupied");
  await mkdir(target);

  await assert.rejects(atomicReplaceFile(target, "cannot replace a directory"));
  assert.deepEqual(await readdir(directory), ["occupied"]);
});
