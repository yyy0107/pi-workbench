import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT,
  DESKTOP_RENDERER_ARTIFACT_KIND,
  DESKTOP_RENDERER_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  DESKTOP_RENDERER_ARTIFACT_STATIC_ROOT,
  assertDesktopRendererArtifactManifest,
  parseDesktopRendererArtifactManifest,
} from "../src/desktop-renderer-artifact-manifest";
import { RUNTIME_HOST_PROTOCOL_VERSION } from "../src/runtime-host-control";

function file(path: string, mode = 0o644) {
  return { path, size: 1, sha256: "a".repeat(64), mode };
}

function manifest() {
  const files = [file("_next/static/app.js"), file(DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT)];
  return {
    schemaVersion: DESKTOP_RENDERER_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifactKind: DESKTOP_RENDERER_ARTIFACT_KIND,
    applicationVersion: "0.1.0",
    buildId: "sha256-" + "b".repeat(64),
    entrypoint: DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT,
    staticRoot: DESKTOP_RENDERER_ARTIFACT_STATIC_ROOT,
    requiredRuntimeHostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    resources: ["_next/static/app.js"],
    files,
    links: [],
  };
}

test("strictly parses and freezes the static Desktop renderer envelope", () => {
  const parsed = assertDesktopRendererArtifactManifest(manifest());
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.resources), true);
  assert.equal(Object.isFrozen(parsed.files), true);
  assert.equal(Object.isFrozen(parsed.files[0]), true);
  assert.equal(Object.isFrozen(parsed.links), true);
  assert.equal(parsed.entrypoint, "index.html");
  assert.equal(parsed.staticRoot, ".");
});

test("requires an exact complete regular-file inventory", () => {
  const missingEntrypoint = manifest();
  missingEntrypoint.files = [file("_next/static/app.js")];
  assert.equal(parseDesktopRendererArtifactManifest(missingEntrypoint), undefined);

  const incompleteResources = manifest();
  incompleteResources.resources = [];
  assert.equal(parseDesktopRendererArtifactManifest(incompleteResources), undefined);

  const unsorted = manifest();
  unsorted.files = [...unsorted.files].reverse();
  assert.equal(parseDesktopRendererArtifactManifest(unsorted), undefined);
});

test("rejects links, executable files, server payloads, and unsafe paths", () => {
  for (const invalid of [
    { ...manifest(), links: [{ path: "asset", target: "target" }] },
    { ...manifest(), files: [file("_next/static/app.js", 0o755), file("index.html")] },
    {
      ...manifest(),
      files: [file("index.html"), file("server.mjs")],
      resources: ["server.mjs"],
    },
    {
      ...manifest(),
      files: [file("../index.html")],
      resources: [],
    },
    {
      ...manifest(),
      files: [file("artifact-manifest.json"), file("index.html")],
      resources: ["artifact-manifest.json"],
    },
  ]) {
    assert.equal(parseDesktopRendererArtifactManifest(invalid), undefined);
  }
});

test("does not accept serverful Web artifact semantics", () => {
  assert.equal(
    parseDesktopRendererArtifactManifest({
      ...manifest(),
      artifactKind: "workbench-web",
      entrypoint: "web-server.mjs",
      externalPackages: ["next"],
    }),
    undefined,
  );
});
