import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncStaticAssets } from "../../scripts/sync-static-assets.mjs";

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
