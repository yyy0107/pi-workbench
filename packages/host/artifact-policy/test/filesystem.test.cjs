const assert = require("node:assert/strict");
const { mkdtemp, mkdir, realpath, rename, rm, symlink } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  isInside,
  canonicalPathSpelling,
  directoryIdentity,
  optionalDirectoryIdentity,
  sameDirectoryIdentity,
} = require("../src/filesystem.cjs");

test("containment uses path segments and rejects parent escapes and Windows cross-volume paths", () => {
  for (const [api, root] of [
    [path.posix, "/build"],
    [path.win32, "C:\\build"],
  ]) {
    assert.equal(isInside(root, root, api), true);
    assert.equal(isInside(root, api.join(root, "child"), api), true);
    assert.equal(isInside(root, api.join(root, "..cache"), api), true);
    assert.equal(isInside(root, api.join(root, "..", "outside"), api), false);
    assert.equal(isInside(root, `${root}-other`, api), false);
    assert.equal(canonicalPathSpelling(root, "root", api), root);
    assert.throws(
      () => canonicalPathSpelling(`${root}${api.sep}..${api.sep}alias`, "root", api),
      /canonical path/,
    );
  }
  assert.equal(isInside("C:\\build", "D:\\build\\child", path.win32), false);
});

test("directory identity detects replacement, aliases, dangling links, and missing directories", async (context) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "artifact-identity-")));
  context.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "output");
  await mkdir(directory);
  const original = await directoryIdentity(directory, "output");
  assert.equal(sameDirectoryIdentity(original, await directoryIdentity(directory, "output")), true);
  await rename(directory, path.join(root, "old"));
  await mkdir(directory);
  assert.equal(
    sameDirectoryIdentity(original, await directoryIdentity(directory, "output")),
    false,
  );
  for (const [name, target] of [
    ["alias", directory],
    ["dangling", path.join(root, "missing")],
    ["outside", path.dirname(root)],
  ]) {
    const link = path.join(root, name);
    await symlink(target, link, "junction");
    await assert.rejects(directoryIdentity(link, name), /symbolic link/);
    await assert.rejects(optionalDirectoryIdentity(link, name), /symbolic link/);
  }
  assert.equal(await optionalDirectoryIdentity(path.join(root, "missing"), "missing"), undefined);
});
