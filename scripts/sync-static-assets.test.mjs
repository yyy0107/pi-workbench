import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  syncStaticAssets,
  syncFileViewerAssets,
  syncMaterialIconTheme,
} from "./sync-static-assets.mjs";

test("static asset sync skips completed output and repairs missing output", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-static-assets-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source", "asset.txt");
  const targetRoot = path.join(root, "public", "assets");
  const target = path.join(targetRoot, "nested", "asset.txt");
  const entries = [{ source, target: "nested/asset.txt" }];
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, "first");

  assert.equal(await syncStaticAssets({ entries, fingerprint: "v1", targetRoot }), true);
  assert.equal(await readFile(target, "utf8"), "first");

  const oldTime = new Date(1_000_000);
  await utimes(target, oldTime, oldTime);
  assert.equal(await syncStaticAssets({ entries, fingerprint: "v1", targetRoot }), false);
  assert.equal((await stat(target)).mtimeMs, oldTime.getTime());

  await rm(target);
  assert.equal(await syncStaticAssets({ entries, fingerprint: "v1", targetRoot }), true);
  assert.equal(await readFile(target, "utf8"), "first");
});

test("a failed copy never leaves a completed fingerprint", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-static-failure-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const targetRoot = path.join(root, "output");
  await mkdir(targetRoot);
  await writeFile(path.join(targetRoot, ".workbench-assets"), "old");
  await assert.rejects(
    syncStaticAssets({
      targetRoot,
      fingerprint: "new",
      entries: [{ source: path.join(root, "missing"), target: "asset" }],
    }),
  );
  await assert.rejects(readFile(path.join(targetRoot, ".workbench-assets")), { code: "ENOENT" });
});

test("both app roots use identical package-owned resource lists and fingerprints", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-app-assets-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const assets = ["docx", "hangul", "iwork", "pdf", "ppt", "pptx", "wordperfect", "xlsx"];
  for (const asset of ["icons", ...assets.map((name) => `viewer/vendor/${name}`)]) {
    await mkdir(path.join(root, "package", asset), { recursive: true });
    await writeFile(path.join(root, "package", asset, "asset.txt"), asset);
  }
  await mkdir(path.join(root, "package", "dist"));
  await writeFile(path.join(root, "package", "dist", "material-icons.json"), "{}");
  const require = (name) => ({ name, version: "1" });
  require.resolve = () => path.join(root, "package", "package.json");
  for (const sync of [syncFileViewerAssets, syncMaterialIconTheme]) {
    for (const app of ["web", "desktop"]) {
      const options = { publicRoot: path.join(root, app, "public"), require };
      assert.equal(await sync(options), true);
      assert.equal(await sync(options), false);
    }
  }
  for (const output of ["file-viewer", "vendor/material-icon-theme"]) {
    const markers = await Promise.all(
      ["web", "desktop"].map((app) =>
        readFile(path.join(root, app, "public", output, ".workbench-assets"), "utf8"),
      ),
    );
    assert.equal(markers[0], markers[1]);
  }
  assert.throws(() => syncFileViewerAssets({ publicRoot: root, require }), /Refusing to replace/);
});
