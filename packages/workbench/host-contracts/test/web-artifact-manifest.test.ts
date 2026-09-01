import assert from "node:assert/strict";
import test from "node:test";

import {
  WEB_ARTIFACT_EXTERNAL_PACKAGES,
  WEB_ARTIFACT_KIND,
  WEB_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  WEB_ARTIFACT_PRIMARY_ENTRYPOINT,
  assertWebArtifactManifest,
  parseWebArtifactManifest,
  webArtifactBuildIdPath,
} from "../src/web-artifact-manifest";
import { RUNTIME_HOST_PROTOCOL_VERSION } from "../src/runtime-host-control";
import {
  WEB_HOST_CONTROL_MAX_SHUTDOWN_DEADLINE_MS,
  WEB_HOST_CONTROL_TRANSPORT,
  WEB_HOST_CONTROL_VERSION,
  WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE,
  WEB_HOST_SHUTDOWN_FRAME_TYPE,
} from "../src/web-host-control";

const REQUIRED_SERVER_FILES = "apps/web/.next/required-server-files.json";
const NEXT_BUILD_ID = webArtifactBuildIdPath("apps/web");
const LEGACY_NEXT_SERVER = "apps/web/server.js";

function file(path: string) {
  return { path, size: 1, sha256: "a".repeat(64), mode: 0o644 };
}

function manifest() {
  const files = [
    file("apps/web/.next/BUILD_ID"),
    file(REQUIRED_SERVER_FILES),
    file("node_modules/next/package.json"),
    file(WEB_ARTIFACT_PRIMARY_ENTRYPOINT),
  ];
  return {
    schemaVersion: WEB_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifactKind: WEB_ARTIFACT_KIND,
    buildId: "build-123",
    relativeAppDir: "apps/web",
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
    resources: files
      .map((entry) => entry.path)
      .filter((entry) => entry !== WEB_ARTIFACT_PRIMARY_ENTRYPOINT),
    files,
    links: [
      {
        path: "node_modules/next",
        target: ".pnpm/next@fixture/node_modules/next",
      },
    ],
  };
}

function sortedFiles(files: readonly ReturnType<typeof file>[]) {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
}

function resourcesFor(files: readonly ReturnType<typeof file>[]) {
  return sortedFiles(files)
    .map((entry) => entry.path)
    .filter((entry) => entry !== WEB_ARTIFACT_PRIMARY_ENTRYPOINT);
}

test("strictly parses and freezes the Web artifact envelope", () => {
  const parsed = assertWebArtifactManifest(manifest());
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(Object.isFrozen(parsed.shutdownContract), true);
  assert.equal(Object.isFrozen(parsed.resources), true);
  assert.equal(Object.isFrozen(parsed.files), true);
  assert.equal(Object.isFrozen(parsed.files[0]), true);
  assert.equal(Object.isFrozen(parsed.links), true);
  assert.equal(Object.isFrozen(parsed.links[0]), true);
  assert.equal(
    parsed.files.some((entry) => entry.path === "artifact-manifest.json"),
    false,
  );
});

test("requires the metadata-derived required-server-files resource as a regular file", () => {
  const withoutRequiredFile = manifest();
  withoutRequiredFile.files = withoutRequiredFile.files.filter(
    (entry) => entry.path !== REQUIRED_SERVER_FILES,
  );
  withoutRequiredFile.resources = resourcesFor(withoutRequiredFile.files);
  assert.equal(parseWebArtifactManifest(withoutRequiredFile), undefined);

  const requiredAsLink = manifest();
  requiredAsLink.files = requiredAsLink.files.filter(
    (entry) => entry.path !== REQUIRED_SERVER_FILES,
  );
  requiredAsLink.resources = resourcesFor(requiredAsLink.files);
  requiredAsLink.links = [
    ...requiredAsLink.links,
    {
      path: REQUIRED_SERVER_FILES,
      target: "required-server-files.json",
    },
  ].sort((left, right) => left.path.localeCompare(right.path));
  assert.equal(parseWebArtifactManifest(requiredAsLink), undefined);
});

test("requires the measured Next BUILD_ID resource as a regular file", () => {
  const withoutBuildId = manifest();
  withoutBuildId.files = withoutBuildId.files.filter((entry) => entry.path !== NEXT_BUILD_ID);
  withoutBuildId.resources = resourcesFor(withoutBuildId.files);
  assert.equal(parseWebArtifactManifest(withoutBuildId), undefined);

  const buildIdAsLink = manifest();
  buildIdAsLink.files = buildIdAsLink.files.filter((entry) => entry.path !== NEXT_BUILD_ID);
  buildIdAsLink.resources = resourcesFor(buildIdAsLink.files);
  buildIdAsLink.links = [
    ...buildIdAsLink.links,
    {
      path: NEXT_BUILD_ID,
      target: "BUILD_ID.actual",
    },
  ].sort((left, right) => left.path.localeCompare(right.path));
  assert.equal(parseWebArtifactManifest(buildIdAsLink), undefined);
});

test("rejects the removed legacy Next server entry in files and links", () => {
  const legacyFile = manifest();
  legacyFile.files = sortedFiles([...legacyFile.files, file(LEGACY_NEXT_SERVER)]);
  legacyFile.resources = resourcesFor(legacyFile.files);
  assert.equal(parseWebArtifactManifest(legacyFile), undefined);

  const legacyLink = manifest();
  legacyLink.links = [
    ...legacyLink.links,
    {
      path: LEGACY_NEXT_SERVER,
      target: "server-target.mjs",
    },
  ].sort((left, right) => left.path.localeCompare(right.path));
  assert.equal(parseWebArtifactManifest(legacyLink), undefined);
});

test("rejects tampered closure, paths, controls, and manifest inventory", () => {
  for (const invalid of [
    { ...manifest(), unexpected: true },
    { ...manifest(), schemaVersion: 1 },
    { ...manifest(), compatibilitySupervisor: { entrypoint: "server.mjs" } },
    { ...manifest(), buildId: "../build" },
    { ...manifest(), relativeAppDir: "../apps/web" },
    { ...manifest(), externalPackages: [] },
    { ...manifest(), externalPackages: ["next", "ws"] },
    { ...manifest(), entrypoint: "server.mjs" },
    { ...manifest(), controlVersion: 2 },
    { ...manifest(), resources: ["apps/web/.next/BUILD_ID"] },
    {
      ...manifest(),
      files: sortedFiles([...manifest().files, file("artifact-manifest.json")]),
    },
    {
      ...manifest(),
      links: [{ path: "node_modules/next", target: "../../../outside" }],
    },
    {
      ...manifest(),
      files: manifest().files.map((entry) =>
        entry.path === WEB_ARTIFACT_PRIMARY_ENTRYPOINT ? { ...entry, mode: 0o1000 } : entry,
      ),
    },
  ]) {
    assert.equal(parseWebArtifactManifest(invalid), undefined);
  }
});
