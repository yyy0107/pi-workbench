import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { normalizeRuntimeArtifactPermissions } from "../scripts/build-runtime-artifact";

test(
  "published runtime files are readable after root installation without following symlinks",
  {
    skip: process.platform === "win32",
  },
  async (t) => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "workbench-runtime-permissions-"));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const artifact = path.join(temporary, "artifact");
    const packageRoot = path.join(artifact, "node_modules", "node-pty");
    await mkdir(packageRoot, { recursive: true });
    const manifest = path.join(packageRoot, "package.json");
    const executable = path.join(packageRoot, "spawn-helper");
    const outside = path.join(temporary, "outside");
    await writeFile(manifest, '{"name":"node-pty"}\n');
    await writeFile(executable, "#!/bin/sh\n");
    await writeFile(outside, "private source\n");
    await chmod(artifact, 0o700);
    await chmod(packageRoot, 0o700);
    await chmod(manifest, 0o600);
    await chmod(executable, 0o700);
    await chmod(outside, 0o600);
    const alias = path.join(artifact, "source-link");
    await symlink(outside, alias);

    await normalizeRuntimeArtifactPermissions(artifact);

    assert.equal((await lstat(artifact)).mode & 0o777, 0o755);
    assert.equal((await lstat(packageRoot)).mode & 0o777, 0o755);
    assert.equal((await lstat(manifest)).mode & 0o777, 0o644);
    assert.equal((await lstat(executable)).mode & 0o777, 0o755);
    assert.equal((await lstat(outside)).mode & 0o777, 0o600);
    assert.equal(await readlink(alias), outside);
    assert.equal(await readFile(manifest, "utf8"), '{"name":"node-pty"}\n');
  },
);
