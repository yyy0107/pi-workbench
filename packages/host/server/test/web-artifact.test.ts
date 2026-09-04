import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import {
  WEB_ARTIFACT_KIND,
  WEB_ARTIFACT_MANIFEST_FILENAME,
  WEB_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  WEB_ARTIFACT_PRIMARY_ENTRYPOINT,
} from "@workbench/host-contracts/web-artifact-manifest";
import { RUNTIME_HOST_PROTOCOL_VERSION } from "@workbench/host-contracts/runtime-host-control";
import {
  WEB_HOST_CONTROL_MAX_SHUTDOWN_DEADLINE_MS,
  WEB_HOST_CONTROL_TRANSPORT,
  WEB_HOST_CONTROL_VERSION,
  WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE,
  WEB_HOST_SHUTDOWN_FRAME_TYPE,
} from "@workbench/host-contracts/web-host-control";

import {
  WEB_ARTIFACT_MANIFEST_MAX_BYTES,
  resolveWebArtifact,
} from "@workbench/host-server/web-artifact";

const FIXTURE_RELATIVE_APP_DIR = "standalone/app";
const FIXTURE_REQUIRED_SERVER_FILES = `${FIXTURE_RELATIVE_APP_DIR}/.next/required-server-files.json`;
const FIXTURE_BUILD_ID_PATH = `${FIXTURE_RELATIVE_APP_DIR}/.next/BUILD_ID`;
const FIXTURE_REQUIRED_SERVER_FILES_LINK = `${FIXTURE_RELATIVE_APP_DIR}/.next/required-server-files-link.json`;

interface MutableArtifactFixture {
  readonly artifactRoot: string;
  readonly manifestPath: string;
  readonly parent: string;
  manifest: ReturnType<typeof createManifest>;
}

function writeArtifactFile(
  root: string,
  relativePath: string,
  contents: string | Uint8Array,
  mode = 0o644,
): string {
  const filename = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, contents);
  chmodSync(filename, mode);
  return filename;
}

function record(root: string, relativePath: string) {
  const filename = path.join(root, ...relativePath.split("/"));
  const stats = lstatSync(filename);
  return {
    path: relativePath,
    size: stats.size,
    sha256: createHash("sha256").update(readFileSync(filename)).digest("hex"),
    mode: stats.mode & 0o777,
  };
}

function createManifest(
  files: ReturnType<typeof record>[],
  links: Array<{ path: string; target: string }>,
) {
  return {
    schemaVersion: WEB_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifactKind: WEB_ARTIFACT_KIND,
    buildId: "fixture-build",
    relativeAppDir: FIXTURE_RELATIVE_APP_DIR,
    requiredServerFiles: FIXTURE_REQUIRED_SERVER_FILES,
    entrypoint: WEB_ARTIFACT_PRIMARY_ENTRYPOINT,
    externalPackages: ["next"],
    controlVersion: WEB_HOST_CONTROL_VERSION,
    requiredRuntimeHostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    shutdownContract: {
      transport: WEB_HOST_CONTROL_TRANSPORT,
      requestType: WEB_HOST_SHUTDOWN_FRAME_TYPE,
      acknowledgementType: WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE,
      maximumDeadlineMs: WEB_HOST_CONTROL_MAX_SHUTDOWN_DEADLINE_MS,
    },
    resources: files
      .map((file) => file.path)
      .filter((relativePath) => relativePath !== WEB_ARTIFACT_PRIMARY_ENTRYPOINT),
    files,
    links,
  };
}

function writeManifest(value: MutableArtifactFixture): void {
  writeFileSync(value.manifestPath, `${JSON.stringify(value.manifest, null, 2)}\n`);
}

function fixture(t: TestContext, { withLink = false } = {}): MutableArtifactFixture {
  const parent = mkdtempSync(path.join(os.tmpdir(), "workbench-host-web-artifact-"));
  t.after(() => rmSync(parent, { force: true, recursive: true }));
  const artifactRoot = path.join(parent, "source-web");
  mkdirSync(artifactRoot);
  const filePaths = [
    FIXTURE_BUILD_ID_PATH,
    FIXTURE_REQUIRED_SERVER_FILES,
    WEB_ARTIFACT_PRIMARY_ENTRYPOINT,
  ].sort();
  writeArtifactFile(
    artifactRoot,
    FIXTURE_REQUIRED_SERVER_FILES,
    `${JSON.stringify({ config: { output: "standalone" }, relativeAppDir: FIXTURE_RELATIVE_APP_DIR })}\n`,
  );
  writeArtifactFile(artifactRoot, FIXTURE_BUILD_ID_PATH, "fixture-build");
  writeArtifactFile(artifactRoot, WEB_ARTIFACT_PRIMARY_ENTRYPOINT, "export {};\n", 0o755);
  const links: Array<{ path: string; target: string }> = [];
  if (withLink) {
    const linkPath = FIXTURE_REQUIRED_SERVER_FILES_LINK;
    symlinkSync("required-server-files.json", path.join(artifactRoot, ...linkPath.split("/")));
    links.push({ path: linkPath, target: "required-server-files.json" });
  }
  const files = filePaths.map((relativePath) => record(artifactRoot, relativePath));
  const manifestPath = path.join(artifactRoot, WEB_ARTIFACT_MANIFEST_FILENAME);
  const value: MutableArtifactFixture = {
    artifactRoot,
    manifest: createManifest(files, links),
    manifestPath,
    parent,
  };
  writeManifest(value);
  return value;
}

function refreshOwnedFile(
  value: MutableArtifactFixture,
  relativePath: string,
  contents?: string,
): void {
  if (contents !== undefined) writeArtifactFile(value.artifactRoot, relativePath, contents);
  value.manifest = {
    ...value.manifest,
    files: value.manifest.files.map((file) =>
      file.path === relativePath ? record(value.artifactRoot, relativePath) : file,
    ),
  };
  writeManifest(value);
}

test("resolves one canonical exhaustive Web artifact envelope", (t) => {
  const value = fixture(t, { withLink: true });
  const resolved = resolveWebArtifact({
    manifestPath: value.manifestPath,
    expectedBuildId: "fixture-build",
  });
  assert.equal(resolved.artifactRoot, value.artifactRoot);
  assert.equal(resolved.manifestPath, value.manifestPath);
  assert.equal(resolved.appRoot, path.join(value.artifactRoot, FIXTURE_RELATIVE_APP_DIR));
  assert.equal(resolved.entrypoint, path.join(value.artifactRoot, WEB_ARTIFACT_PRIMARY_ENTRYPOINT));
  assert.equal(resolved.nextConfig.output, "standalone");
  assert.equal(Object.isFrozen(resolved), true);
});

test("rejects oversized/invalid manifests and stale build identity", (t) => {
  const stale = fixture(t);
  assert.throws(
    () => resolveWebArtifact({ artifactRoot: stale.artifactRoot, expectedBuildId: "new-build" }),
    /build identity changed/u,
  );

  const oversized = fixture(t);
  writeFileSync(oversized.manifestPath, Buffer.alloc(WEB_ARTIFACT_MANIFEST_MAX_BYTES + 1, 0x20));
  assert.throws(
    () => resolveWebArtifact({ artifactRoot: oversized.artifactRoot }),
    /manifest has an invalid size/u,
  );

  const invalid = fixture(t);
  writeFileSync(invalid.manifestPath, "not-json\n");
  assert.throws(
    () => resolveWebArtifact({ artifactRoot: invalid.artifactRoot }),
    /manifest is invalid JSON/u,
  );
});

test("rejects byte, mode, extra-file, and missing-file inventory drift", async (t) => {
  await t.test("bytes/hash", (t) => {
    const value = fixture(t);
    writeArtifactFile(value.artifactRoot, WEB_ARTIFACT_PRIMARY_ENTRYPOINT, "mutated\n", 0o755);
    assert.throws(
      () => resolveWebArtifact({ artifactRoot: value.artifactRoot }),
      /regular-file inventory does not match/u,
    );
  });

  await t.test("mode", (t) => {
    const value = fixture(t);
    chmodSync(path.join(value.artifactRoot, WEB_ARTIFACT_PRIMARY_ENTRYPOINT), 0o700);
    assert.throws(
      () => resolveWebArtifact({ artifactRoot: value.artifactRoot }),
      /regular-file inventory does not match/u,
    );
  });

  await t.test("extra", (t) => {
    const value = fixture(t);
    writeArtifactFile(value.artifactRoot, `${FIXTURE_RELATIVE_APP_DIR}/.next/extra.js`, "extra\n");
    assert.throws(
      () => resolveWebArtifact({ artifactRoot: value.artifactRoot }),
      /regular-file inventory does not match/u,
    );
  });

  await t.test("missing", (t) => {
    const value = fixture(t);
    rmSync(path.join(value.artifactRoot, FIXTURE_BUILD_ID_PATH));
    assert.throws(
      () => resolveWebArtifact({ artifactRoot: value.artifactRoot }),
      /regular-file inventory does not match/u,
    );
  });
});

test("rejects raw symlink drift, broken links, and links escaping the root", async (t) => {
  await t.test("raw target", (t) => {
    const value = fixture(t, { withLink: true });
    const linkPath = path.join(value.artifactRoot, FIXTURE_REQUIRED_SERVER_FILES_LINK);
    rmSync(linkPath);
    symlinkSync("./required-server-files.json", linkPath);
    assert.throws(
      () => resolveWebArtifact({ artifactRoot: value.artifactRoot }),
      /symlink inventory does not match/u,
    );
  });

  await t.test("broken", (t) => {
    const value = fixture(t, { withLink: true });
    const linkPath = path.join(value.artifactRoot, FIXTURE_REQUIRED_SERVER_FILES_LINK);
    rmSync(linkPath);
    symlinkSync("missing.json", linkPath);
    assert.throws(
      () => resolveWebArtifact({ artifactRoot: value.artifactRoot }),
      /symlink is broken/u,
    );
  });

  await t.test("escape", (t) => {
    const value = fixture(t, { withLink: true });
    const outside = writeArtifactFile(value.parent, "outside.json", "{}\n");
    const linkPath = path.join(value.artifactRoot, FIXTURE_REQUIRED_SERVER_FILES_LINK);
    rmSync(linkPath);
    symlinkSync(outside, linkPath);
    assert.throws(
      () => resolveWebArtifact({ artifactRoot: value.artifactRoot }),
      /Invalid Web artifact manifest|symlink escapes/u,
    );
  });
});

test("binds manifest identity to BUILD_ID bytes and standalone Next metadata", async (t) => {
  await t.test("BUILD_ID", (t) => {
    const value = fixture(t);
    refreshOwnedFile(value, FIXTURE_BUILD_ID_PATH, "different-build");
    assert.throws(
      () => resolveWebArtifact({ artifactRoot: value.artifactRoot }),
      /BUILD_ID does not match/u,
    );
  });

  await t.test("relativeAppDir/output", (t) => {
    const value = fixture(t);
    refreshOwnedFile(
      value,
      FIXTURE_REQUIRED_SERVER_FILES,
      `${JSON.stringify({ config: { output: "export" }, relativeAppDir: "foreign-app" })}\n`,
    );
    assert.throws(
      () => resolveWebArtifact({ artifactRoot: value.artifactRoot }),
      /metadata does not match/u,
    );
  });

  await t.test("Windows relativeAppDir", (t) => {
    const value = fixture(t);
    refreshOwnedFile(
      value,
      FIXTURE_REQUIRED_SERVER_FILES,
      `${JSON.stringify({ config: { output: "standalone" }, relativeAppDir: String.raw`standalone\app` })}\n`,
    );
    assert.equal(
      resolveWebArtifact({ artifactRoot: value.artifactRoot }).manifest.relativeAppDir,
      FIXTURE_RELATIVE_APP_DIR,
    );
  });

  await t.test("invalid required JSON", (t) => {
    const value = fixture(t);
    refreshOwnedFile(value, FIXTURE_REQUIRED_SERVER_FILES, "not-json\n");
    assert.throws(
      () => resolveWebArtifact({ artifactRoot: value.artifactRoot }),
      /required-server-files manifest is invalid JSON/u,
    );
  });
});

test("rejects non-canonical roots and a manifest symlink", async (t) => {
  await t.test("relative root", (t) => {
    const value = fixture(t);
    assert.throws(
      () =>
        resolveWebArtifact({
          artifactRoot: path.relative(process.cwd(), value.artifactRoot),
        }),
      /absolute canonical path without aliases/u,
    );
  });

  await t.test("lexical root alias", (t) => {
    const value = fixture(t);
    const lexicalAlias = `${value.parent}${path.sep}unused${path.sep}..${path.sep}source-web`;
    assert.throws(
      () => resolveWebArtifact({ artifactRoot: lexicalAlias }),
      /absolute canonical path without aliases/u,
    );
  });

  await t.test("root alias", (t) => {
    const value = fixture(t);
    const alias = path.join(value.parent, "web-alias");
    symlinkSync(value.artifactRoot, alias);
    assert.throws(
      () => resolveWebArtifact({ artifactRoot: alias }),
      /root must be a regular directory|root must be canonical/u,
    );
  });

  await t.test("manifest link", (t) => {
    const value = fixture(t);
    const copy = path.join(value.parent, "manifest-copy.json");
    writeFileSync(copy, readFileSync(value.manifestPath));
    rmSync(value.manifestPath);
    symlinkSync(copy, value.manifestPath);
    assert.throws(
      () => resolveWebArtifact({ artifactRoot: value.artifactRoot }),
      /manifest must be a regular file/u,
    );
  });
});
