import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceStore } from "./workspace-store";
import { WorkspaceFileError, WorkspaceFileService } from "./workspace-files";

async function fixture(t: test.TestContext) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "workbench-workspace-files-"));
  const workspaceRoot = path.join(temporaryRoot, "project");
  await mkdir(workspaceRoot);
  const store = new WorkspaceStore({ stateFile: path.join(temporaryRoot, "state.json") });
  const { workspace } = await store.create(workspaceRoot);
  const files = new WorkspaceFileService({ workspaceStore: () => store });
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  return { files, temporaryRoot, workspace, workspaceRoot };
}

async function rejectsWorkspaceFileError(
  operation: () => Promise<unknown>,
  code: string,
): Promise<WorkspaceFileError> {
  let received: WorkspaceFileError | undefined;
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof WorkspaceFileError);
    assert.equal(error.code, code);
    received = error;
    return true;
  });
  return received!;
}

test("lists direct workspace children with directories first and blocks escaping links", async (t) => {
  const { files, temporaryRoot, workspace, workspaceRoot } = await fixture(t);
  await Promise.all([
    mkdir(path.join(workspaceRoot, "src10")),
    mkdir(path.join(workspaceRoot, "src2")),
    writeFile(path.join(workspaceRoot, ".env"), "SECRET=no\n"),
    writeFile(path.join(workspaceRoot, "index.ts"), "export {};\n"),
  ]);
  await symlink(path.join(workspaceRoot, "src2"), path.join(workspaceRoot, "linked-src"), "dir");
  await symlink(temporaryRoot, path.join(workspaceRoot, "outside"), "dir");

  const listing = await files.listDirectory({ workspaceId: workspace.workspaceId });

  assert.deepEqual(
    listing.entries.map(({ name, kind, hidden, symbolicLink }) => ({
      name,
      kind,
      hidden,
      symbolicLink,
    })),
    [
      { name: "linked-src", kind: "directory", hidden: false, symbolicLink: true },
      { name: "src2", kind: "directory", hidden: false, symbolicLink: undefined },
      { name: "src10", kind: "directory", hidden: false, symbolicLink: undefined },
      { name: ".env", kind: "file", hidden: true, symbolicLink: undefined },
      { name: "index.ts", kind: "file", hidden: false, symbolicLink: undefined },
    ],
  );
  assert.equal(
    listing.entries.some((entry) => entry.name === "outside"),
    false,
  );
  assert.equal(listing.relativePath, "");
  assert.equal(listing.absolutePath, workspaceRoot);
  assert.equal(listing.truncated, false);
});

test("reads UTF-8 files and writes only from the expected version", async (t) => {
  const { files, workspace, workspaceRoot } = await fixture(t);
  await mkdir(path.join(workspaceRoot, "src"));
  const target = path.join(workspaceRoot, "src", "app.ts");
  await writeFile(target, "export const value = 1;\n");

  const descriptor = await files.describeFile({
    workspaceId: workspace.workspaceId,
    relativePath: "src/app.ts",
  });
  assert.equal(descriptor.mediaType, "text/plain");
  assert.equal(descriptor.encoding, "utf-8");
  assert.match(descriptor.version, /^stat-sha256:/);

  const initial = await files.readFile({
    workspaceId: workspace.workspaceId,
    relativePath: "src/app.ts",
  });
  assert.equal(initial.content, "export const value = 1;\n");
  assert.equal(initial.absolutePath, target);
  assert.match(initial.version, /^sha256:/);

  const saved = await files.writeFile({
    workspaceId: workspace.workspaceId,
    relativePath: "src/app.ts",
    content: "export const value = 2;\n",
    expectedVersion: initial.version,
  });
  assert.equal(saved.content, "export const value = 2;\n");
  assert.notEqual(saved.version, initial.version);
  assert.equal(await readFile(target, "utf8"), saved.content);

  await rejectsWorkspaceFileError(
    () =>
      files.writeFile({
        workspaceId: workspace.workspaceId,
        relativePath: "src/app.ts",
        content: "stale write\n",
        expectedVersion: initial.version,
      }),
    "workspace-file-conflict",
  );
  assert.equal(await readFile(target, "utf8"), saved.content);
});

test("rejects traversal, binary files, oversized files, and unknown workspaces", async (t) => {
  const { files, workspace, workspaceRoot } = await fixture(t);
  await writeFile(path.join(workspaceRoot, "binary.dat"), Buffer.from([0, 1, 2, 3]));
  await writeFile(path.join(workspaceRoot, "large.txt"), "123456");
  const smallFiles = new WorkspaceFileService({
    workspaceStore: () => ({
      list: async () => ({
        items: [workspace],
        archivedSessionIds: [],
        pinnedWorkspaceIds: [],
        pinnedSessionIds: [],
      }),
    }),
    fileSizeLimit: 4,
  });

  const binaryDescriptor = await files.describeFile({
    workspaceId: workspace.workspaceId,
    relativePath: "binary.dat",
  });
  assert.equal(binaryDescriptor.mediaType, "application/octet-stream");
  assert.equal(binaryDescriptor.encoding, null);

  const traversal = await rejectsWorkspaceFileError(
    () =>
      files.readFile({
        workspaceId: workspace.workspaceId,
        relativePath: "../outside.txt",
      }),
    "workspace-path-outside-root",
  );
  assert.deepEqual(traversal.details, {
    workspaceId: workspace.workspaceId,
    relativePath: "../outside.txt",
  });
  await rejectsWorkspaceFileError(
    () =>
      files.readFile({
        workspaceId: workspace.workspaceId,
        relativePath: "binary.dat",
      }),
    "workspace-file-unsupported-encoding",
  );
  await rejectsWorkspaceFileError(
    () =>
      smallFiles.readFile({
        workspaceId: workspace.workspaceId,
        relativePath: "large.txt",
      }),
    "workspace-file-too-large",
  );
  await rejectsWorkspaceFileError(
    () => files.listDirectory({ workspaceId: "missing" }),
    "workspace-not-found",
  );
});
