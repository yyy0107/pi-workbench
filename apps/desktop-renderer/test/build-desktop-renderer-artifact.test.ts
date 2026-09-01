import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseDesktopRendererArtifactManifest } from "@workbench/host-contracts/desktop-renderer-artifact-manifest";

import { buildDesktopRendererArtifact } from "../scripts/build-desktop-renderer-artifact";

test("publishes an exact hashed static artifact and preserves it after a rejected rebuild", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-desktop-renderer-artifact-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const sourceDirectory = path.join(root, "export");
  const outputDirectory = path.join(root, "artifact");
  await mkdir(path.join(sourceDirectory, "_next", "static"), { recursive: true });
  await writeFile(path.join(sourceDirectory, "index.html"), "<main>Workbench</main>", "utf8");
  await writeFile(path.join(sourceDirectory, "_next", "static", "app.js"), "export {};", "utf8");
  await writeFile(path.join(sourceDirectory, "_next", "static", "app.js.map"), "{}", "utf8");

  const manifest = await buildDesktopRendererArtifact({
    sourceDirectory,
    outputDirectory,
    applicationVersion: "1.2.3",
  });
  assert.equal(manifest.applicationVersion, "1.2.3");
  assert.equal(manifest.entrypoint, "index.html");
  assert.equal(manifest.files.length, 2);
  await assert.rejects(
    readFile(path.join(outputDirectory, "_next", "static", "app.js.map"), "utf8"),
    { code: "ENOENT" },
  );
  assert.equal(manifest.buildId.startsWith("sha256-"), true);
  assert.deepEqual(
    parseDesktopRendererArtifactManifest(
      JSON.parse(
        await readFile(path.join(outputDirectory, "artifact-manifest.json"), "utf8"),
      ) as unknown,
    ),
    manifest,
  );

  const publishedManifest = await readFile(
    path.join(outputDirectory, "artifact-manifest.json"),
    "utf8",
  );
  await writeFile(path.join(sourceDirectory, "server.mjs"), "export {};", "utf8");
  await assert.rejects(
    buildDesktopRendererArtifact({
      sourceDirectory,
      outputDirectory,
      applicationVersion: "1.2.3",
    }),
    /Unsafe Desktop renderer artifact file/u,
  );
  assert.equal(
    await readFile(path.join(outputDirectory, "artifact-manifest.json"), "utf8"),
    publishedManifest,
  );
});

test("distinguishes sibling prefixes from dot-dot-prefixed descendants", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-desktop-renderer-boundary-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const sourceDirectory = path.join(root, "export");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(path.join(sourceDirectory, "index.html"), "<main>Workbench</main>", "utf8");

  await buildDesktopRendererArtifact({
    sourceDirectory,
    outputDirectory: path.join(root, "export-other"),
    applicationVersion: "1.2.3",
  });
  await assert.rejects(
    buildDesktopRendererArtifact({
      sourceDirectory,
      outputDirectory: path.join(sourceDirectory, "..artifact"),
      applicationVersion: "1.2.3",
    }),
    /must not overlap/u,
  );
});
