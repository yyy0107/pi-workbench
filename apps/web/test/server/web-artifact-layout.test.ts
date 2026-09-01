import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  WEB_ARTIFACT_EXTERNAL_PACKAGES,
  WEB_ARTIFACT_KIND,
  WEB_ARTIFACT_MANIFEST_FILENAME,
  WEB_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  WEB_ARTIFACT_PRIMARY_ENTRYPOINT,
} from "@workbench/host-contracts/web-artifact-manifest";
import {
  WEB_HOST_CONTROL_MAX_SHUTDOWN_DEADLINE_MS,
  WEB_HOST_CONTROL_TRANSPORT,
  WEB_HOST_CONTROL_VERSION,
  WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE,
  WEB_HOST_SHUTDOWN_FRAME_TYPE,
} from "@workbench/host-contracts/web-host-control";
import { RUNTIME_HOST_PROTOCOL_VERSION } from "@workbench/host-contracts/runtime-host-control";

import { loadWebArtifactRuntimeLayout } from "@/server/web-artifact-layout";

const RELATIVE_APP_DIRECTORY = "apps/web";
const REQUIRED_SERVER_FILES = `${RELATIVE_APP_DIRECTORY}/.next/required-server-files.json`;
const BUILD_ID = `${RELATIVE_APP_DIRECTORY}/.next/BUILD_ID`;

async function file(root: string, pathname: string) {
  const filename = path.join(root, ...pathname.split("/"));
  const [stats, bytes] = await Promise.all([lstat(filename), readFile(filename)]);
  return {
    path: pathname,
    size: stats.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mode: stats.mode & 0o777,
  };
}

function manifest(files: Awaited<ReturnType<typeof file>>[]) {
  const resources = files
    .map((item) => item.path)
    .filter((pathname) => pathname !== WEB_ARTIFACT_PRIMARY_ENTRYPOINT);
  return {
    schemaVersion: WEB_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifactKind: WEB_ARTIFACT_KIND,
    buildId: "layout-fixture",
    relativeAppDir: RELATIVE_APP_DIRECTORY,
    requiredServerFiles: REQUIRED_SERVER_FILES,
    entrypoint: WEB_ARTIFACT_PRIMARY_ENTRYPOINT,
    externalPackages: [...WEB_ARTIFACT_EXTERNAL_PACKAGES],
    controlVersion: WEB_HOST_CONTROL_VERSION,
    requiredRuntimeHostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    shutdownContract: {
      transport: WEB_HOST_CONTROL_TRANSPORT,
      requestType: WEB_HOST_SHUTDOWN_FRAME_TYPE,
      acknowledgementType: WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE,
      maximumDeadlineMs: WEB_HOST_CONTROL_MAX_SHUTDOWN_DEADLINE_MS,
    },
    resources,
    files,
    links: [],
  };
}

async function createArtifactFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-web-layout-"));
  await mkdir(path.join(root, RELATIVE_APP_DIRECTORY, ".next"), { recursive: true });
  await writeFile(path.join(root, WEB_ARTIFACT_PRIMARY_ENTRYPOINT), "// primary\n");
  await writeFile(path.join(root, BUILD_ID), "layout-fixture");
  await writeFile(
    path.join(root, REQUIRED_SERVER_FILES),
    JSON.stringify({
      config: { output: "standalone" },
      relativeAppDir: RELATIVE_APP_DIRECTORY,
    }),
  );
  const files = await Promise.all(
    [BUILD_ID, REQUIRED_SERVER_FILES, WEB_ARTIFACT_PRIMARY_ENTRYPOINT]
      .sort()
      .map((pathname) => file(root, pathname)),
  );
  await writeFile(path.join(root, WEB_ARTIFACT_MANIFEST_FILENAME), JSON.stringify(manifest(files)));
  return root;
}

test("loads the fixed sibling manifest and metadata-derived app root from arbitrary cwd", async () => {
  const root = await createArtifactFixture();
  const originalCwd = process.cwd();
  const unrelatedCwd = await mkdtemp(path.join(os.tmpdir(), "workbench-web-cwd-"));
  process.chdir(unrelatedCwd);
  try {
    const layout = await loadWebArtifactRuntimeLayout(root);
    assert.equal(layout.artifactRoot, root);
    assert.equal(layout.webRoot, path.join(root, RELATIVE_APP_DIRECTORY));
    assert.equal(layout.manifest.entrypoint, WEB_ARTIFACT_PRIMARY_ENTRYPOINT);
    assert.equal(layout.manifest.relativeAppDir, RELATIVE_APP_DIRECTORY);
  } finally {
    process.chdir(originalCwd);
  }
});

test("rejects a missing/tampered manifest without probing cwd, argv, or environment", async (t) => {
  await t.test("missing sibling", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "workbench-web-layout-missing-"));
    await assert.rejects(
      loadWebArtifactRuntimeLayout(root),
      (error: unknown) =>
        error instanceof Error && error.message === "Web artifact runtime layout is invalid.",
    );
  });

  await t.test("metadata mismatch", async () => {
    const root = await createArtifactFixture();
    await writeFile(
      path.join(root, REQUIRED_SERVER_FILES),
      JSON.stringify({ relativeAppDir: "different/app" }),
    );
    await assert.rejects(loadWebArtifactRuntimeLayout(root), /runtime layout is invalid/u);
  });

  await t.test("manifest symlink", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "workbench-web-outside-"));
    const outsideManifest = path.join(outside, "manifest.json");
    await writeFile(outsideManifest, "{}\n");
    const symlinkRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-web-layout-link-"));
    await symlink(outsideManifest, path.join(symlinkRoot, WEB_ARTIFACT_MANIFEST_FILENAME));
    await assert.rejects(loadWebArtifactRuntimeLayout(symlinkRoot), /runtime layout is invalid/u);
  });

  await t.test("relative injected root", async () => {
    await assert.rejects(loadWebArtifactRuntimeLayout("."), /runtime layout is invalid/u);
  });
});
