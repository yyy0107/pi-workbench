import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureWorkbenchBuiltinResources } from "../src/builtin-resources";
import { WORKBENCH_TOOL_SOURCE_PATHS } from "../src/tool-resources";

test("deploys only product tool snapshots and retires known flat sources without deleting unknown files", async (t) => {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "workbench-product-tools-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const snapshots = path.join(agentDir, "extensions", ".builtin");
  await mkdir(path.join(snapshots, "src"), { recursive: true });
  await writeFile(path.join(snapshots, "src", "bash.ts"), "old shipped bash");
  await writeFile(path.join(snapshots, "src", "custom-user-note.txt"), "keep this file");
  await mkdir(path.join(snapshots, "resources/rpiv-todo"), { recursive: true });
  await mkdir(path.join(snapshots, "src/tools"), { recursive: true });
  await writeFile(path.join(snapshots, "src/tools/bash.ts"), "previous layout");
  await writeFile(path.join(snapshots, "resources/rpiv-todo/LICENSE"), "previous license");
  await writeFile(path.join(snapshots, "resources/rpiv-todo/user-note.txt"), "keep");
  const first = await ensureWorkbenchBuiltinResources(agentDir);
  assert.equal(first.extensions, snapshots);
  for (const relative of WORKBENCH_TOOL_SOURCE_PATHS) await stat(path.join(snapshots, relative));
  assert.match(
    await readFile(path.join(snapshots, "src/bash/index.ts"), "utf8"),
    /createWorkbenchBashToolOverride/,
  );
  assert.match(await readFile(path.join(snapshots, "src/rpiv-todo/LICENSE"), "utf8"), /MIT/);
  await assert.rejects(stat(path.join(snapshots, "resources/rpiv-todo/LICENSE")), {
    code: "ENOENT",
  });
  await assert.rejects(stat(path.join(snapshots, "src/tools/bash.ts")), { code: "ENOENT" });
  assert.equal(
    await readFile(path.join(snapshots, "resources/rpiv-todo/user-note.txt"), "utf8"),
    "keep",
  );
  await assert.rejects(stat(path.join(snapshots, "src", "builtin-resources.ts")), {
    code: "ENOENT",
  });
  await assert.rejects(stat(path.join(snapshots, "lib", "builtin-files.ts")), { code: "ENOENT" });
  await assert.rejects(stat(path.join(snapshots, "src", "bash.ts")), { code: "ENOENT" });
  assert.equal(
    await readFile(path.join(snapshots, "src/custom-user-note.txt"), "utf8"),
    "keep this file",
  );
  const second = await ensureWorkbenchBuiltinResources(agentDir);
  assert.deepEqual(second, first);
  assert.equal(
    await readFile(path.join(snapshots, "src/custom-user-note.txt"), "utf8"),
    "keep this file",
  );
});

test("fresh snapshots colocate Todo attribution and include real extension resources", async (t) => {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "workbench-tools-fresh-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const { extensions } = await ensureWorkbenchBuiltinResources(agentDir);
  assert.deepEqual((await readdir(extensions)).sort(), ["lib", "resources", "src"]);
  assert.deepEqual(await readdir(path.join(extensions, "resources")), ["extensions"]);
  assert.match(
    await readFile(path.join(extensions, "resources/extensions/rpiv-todo/index.ts"), "utf8"),
    /pi\.registerTool/,
  );
  for (const name of ["index.ts", "state.ts", "replay.ts", "README.md", "LICENSE"])
    await stat(path.join(extensions, "src/rpiv-todo", name));
  assert.deepEqual((await readdir(new URL("../resources/", import.meta.url))).sort(), [
    "extensions",
    "prompts",
    "skills",
  ]);
});

test("retiring nested snapshots refuses symlink parents and preserves external files", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-tools-symlink-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = path.join(root, "agent");
  const external = path.join(root, "external");
  const resources = path.join(agentDir, "extensions/.builtin/resources");
  await mkdir(resources, { recursive: true });
  await mkdir(external);
  await writeFile(path.join(external, "LICENSE"), "untouched");
  await symlink(external, path.join(resources, "rpiv-todo"), "dir");
  await assert.rejects(ensureWorkbenchBuiltinResources(agentDir), /symbolic link/);
  assert.equal(await readFile(path.join(external, "LICENSE"), "utf8"), "untouched");
});
