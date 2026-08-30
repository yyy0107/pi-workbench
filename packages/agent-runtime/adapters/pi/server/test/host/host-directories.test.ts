import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === "../../src/host/native-workspace-picker" ? `${specifier}.ts` : specifier,
      context,
    );
  },
});
const {
  HostDirectoryError,
  canOpenHostPath,
  createHostDirectory,
  listHostDirectory,
  openHostPath,
  pickHostDirectory,
} = (await import(
  new URL("../../src/host/host-directories.ts", import.meta.url).href
)) as typeof import("../../src/host/host-directories");
moduleHooks.deregister();

type HostDirectoryErrorCode = import("../../src/host/host-directories").HostDirectoryErrorCode;
type HostPathRunner = import("../../src/host/host-directories").HostPathRunner;

async function temporaryDirectory(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-host-directories-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function rejectsHostDirectoryError(
  operation: () => Promise<unknown>,
  code: HostDirectoryErrorCode,
  details: object,
): Promise<void> {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof HostDirectoryError);
    assert.equal(error.name, "HostDirectoryError");
    assert.equal(error.code, code);
    assert.deepEqual(error.details, details);
    assert.ok(error.message.length > 0);
    return true;
  });
}

test("lists only navigable directories, including hidden directories and directory links", async (t) => {
  const root = await temporaryDirectory(t);
  await Promise.all([
    mkdir(path.join(root, ".hidden")),
    mkdir(path.join(root, "alpha")),
    mkdir(path.join(root, "zeta")),
    writeFile(path.join(root, "file.txt"), "not a directory"),
  ]);
  await symlink(path.join(root, "alpha"), path.join(root, "linked"), "dir");
  await symlink(path.join(root, "missing"), path.join(root, "broken"), "dir");

  const listing = await listHostDirectory(path.join(root, "."));
  const canonicalRoot = await realpath(root);

  assert.equal(listing.path, canonicalRoot);
  assert.equal(listing.home, await realpath(homedir()));
  assert.deepEqual(
    listing.entries.map(({ name, hidden }) => ({ name, hidden })),
    [
      { name: ".hidden", hidden: true },
      { name: "alpha", hidden: false },
      { name: "linked", hidden: false },
      { name: "zeta", hidden: false },
    ],
  );
  assert.equal(
    listing.entries.find(({ name }) => name === "linked")?.path,
    path.join(canonicalRoot, "linked"),
  );
  assert.equal(listing.truncated, false);
  assert.equal(listing.crumbs.at(-1)?.name, path.basename(canonicalRoot));
  assert.equal(listing.crumbs.at(-1)?.path, canonicalRoot);
  const rootPath = path.parse(canonicalRoot).root;
  assert.deepEqual(listing.crumbs[0], { name: rootPath, path: rootPath, hidden: false });
});

test("resolves a requested directory link to its canonical path", async (t) => {
  const root = await temporaryDirectory(t);
  const target = path.join(root, "target");
  const link = path.join(root, "alias");
  await mkdir(target);
  await symlink(target, link, "dir");

  const listing = await listHostDirectory(link);
  assert.equal(listing.path, await realpath(target));
  assert.equal(listing.crumbs.at(-1)?.name, "target");
});

test("maps missing paths and files to directory-unreadable", async (t) => {
  const root = await temporaryDirectory(t);
  const missing = path.join(root, "missing");
  const file = path.join(root, "file.txt");
  await writeFile(file, "file");

  await rejectsHostDirectoryError(() => listHostDirectory(missing), "directory-unreadable", {
    path: missing,
  });
  await rejectsHostDirectoryError(() => listHostDirectory(file), "directory-unreadable", {
    path: file,
  });
});

test("stops directory traversal when the request is aborted", async (t) => {
  const root = await temporaryDirectory(t);
  await mkdir(path.join(root, "child"));
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(listHostDirectory(root, controller.signal), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "AbortError");
    return true;
  });
});

test("limits directory results to 500 and reports truncation only above that limit", async (t) => {
  const root = await temporaryDirectory(t);
  await Promise.all(
    Array.from({ length: 500 }, (_, index) =>
      mkdir(path.join(root, `directory-${String(index).padStart(4, "0")}`)),
    ),
  );

  const exact = await listHostDirectory(root);
  assert.equal(exact.entries.length, 500);
  assert.equal(exact.truncated, false);

  await mkdir(path.join(root, "directory-0500"));
  const truncated = await listHostDirectory(root);
  assert.equal(truncated.entries.length, 500);
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.entries[0]?.name, "directory-0000");
  assert.equal(truncated.entries.at(-1)?.name, "directory-0499");
});

test("creates a trimmed directory name and returns its canonical path", async (t) => {
  const root = await temporaryDirectory(t);
  const result = await createHostDirectory({ path: root, name: "  child  " });

  assert.deepEqual(result, { path: await realpath(path.join(root, "child")) });
});

test("rejects empty, traversal, and separator-containing directory names", async (t) => {
  const root = await temporaryDirectory(t);

  for (const name of ["", "   ", ".", " .. ", "nested/child", "nested\\child"]) {
    await rejectsHostDirectoryError(
      () => createHostDirectory({ path: root, name }),
      "directory-create-failed",
      { path: path.resolve(root) },
    );
  }
});

test("distinguishes unreadable parents, existing entries, and creation failures", async (t) => {
  const root = await temporaryDirectory(t);
  const existing = path.join(root, "existing");
  await writeFile(existing, "existing");

  await rejectsHostDirectoryError(
    () => createHostDirectory({ path: path.join(root, "missing"), name: "child" }),
    "directory-unreadable",
    { path: path.join(root, "missing") },
  );
  await rejectsHostDirectoryError(
    () => createHostDirectory({ path: root, name: "existing" }),
    "directory-exists",
    { path: existing },
  );
  await rejectsHostDirectoryError(
    () => createHostDirectory({ path: root, name: "invalid\0name" }),
    "directory-create-failed",
    { path: path.join(root, "invalid\0name") },
  );
});

test("returns a canonical picked path and maps cancellation to null", async (t) => {
  const root = await temporaryDirectory(t);
  const selected = path.join(root, "selected");
  const alias = path.join(root, "alias");
  await mkdir(selected);
  await symlink(selected, alias, "dir");

  const signal = new AbortController().signal;
  assert.equal(
    await pickHostDirectory(signal, {
      platform: "linux",
      run: async () => ({ stdout: `${alias}\n`, stderr: "" }),
    }),
    await realpath(selected),
  );

  assert.equal(
    await pickHostDirectory(signal, {
      platform: "linux",
      run: async () => {
        throw Object.assign(new Error("cancelled"), { code: 1 });
      },
    }),
    null,
  );
});

test("maps an unavailable native picker and preserves other picker failures", async () => {
  const signal = new AbortController().signal;
  await rejectsHostDirectoryError(
    () =>
      pickHostDirectory(signal, {
        platform: "linux",
        run: async () => {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        },
      }),
    "directory-picker-unavailable",
    { capability: "directory-picker" },
  );

  const expected = Object.assign(new Error("picker failed"), { code: 2 });
  await assert.rejects(
    pickHostDirectory(signal, {
      platform: "linux",
      run: async () => {
        throw expected;
      },
    }),
    (error) => error === expected,
  );
});

test("reports host path opening support by platform", () => {
  assert.equal(canOpenHostPath("darwin"), true);
  assert.equal(canOpenHostPath("win32"), true);
  assert.equal(canOpenHostPath({ platform: "linux", env: {}, osRelease: "6.8.0" }), false);
  assert.equal(
    canOpenHostPath({ platform: "linux", env: { DISPLAY: ":0" }, osRelease: "6.8.0" }),
    true,
  );
  assert.equal(
    canOpenHostPath({ platform: "linux", env: {}, osRelease: "5.15.0-microsoft-WSL2" }),
    true,
  );
  assert.equal(canOpenHostPath("freebsd"), false);
});

test("opens canonical host paths with safe platform-specific execFile arguments", async (t) => {
  const root = await temporaryDirectory(t);
  const target = path.join(root, 'literal;$(touch injected)"path');
  await writeFile(target, "target");
  const canonicalTarget = await realpath(target);
  const expectedCommands: readonly [NodeJS.Platform, string][] = [
    ["darwin", "open"],
    ["win32", "explorer.exe"],
    ["linux", "xdg-open"],
  ];

  for (const [platform, expectedCommand] of expectedCommands) {
    const calls: { command: string; args: readonly string[] }[] = [];
    const run: HostPathRunner = async (command, args) => {
      calls.push({ command, args });
    };

    assert.deepEqual(await openHostPath(target, { platform, run }), { opened: true });
    assert.deepEqual(calls, [{ command: expectedCommand, args: [canonicalTarget] }]);
  }
});

test("does not invoke a runner on unsupported platforms and preserves runner errors", async (t) => {
  const root = await temporaryDirectory(t);
  let invoked = false;
  await assert.rejects(
    openHostPath(root, {
      platform: "freebsd",
      run: async () => {
        invoked = true;
      },
    }),
    /unsupported/,
  );
  assert.equal(invoked, false);

  const expected = new Error("open failed");
  await assert.rejects(
    openHostPath(root, {
      platform: "linux",
      run: async () => {
        throw expected;
      },
    }),
    (error) => error === expected,
  );
});
