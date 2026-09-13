import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_ARTIFACT_KIND,
  RUNTIME_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  assertRuntimeArtifactManifest,
  assertRuntimeArtifactNativeInventory,
  parseRuntimeArtifactManifest,
  parseRuntimeArtifactNativeInventory,
  runtimeArtifactTargetKey,
} from "../src/runtime-artifact-manifest";
import {
  RUNTIME_HOST_CONTROL_VERSION,
  RUNTIME_HOST_PROTOCOL_VERSION,
} from "../src/runtime-host-control";

function manifest() {
  return {
    schemaVersion: RUNTIME_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifactKind: RUNTIME_ARTIFACT_KIND,
    runtimeMode: "api-only",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
    hostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    target: {
      runtimeFlavor: "electron-node",
      platform: "linux",
      arch: "x64",
      targetTriple: "x86_64-unknown-linux-gnu",
      libc: "glibc",
      nodeVersion: "24.11.1",
      nodeModuleAbi: 137,
      napiVersion: 10,
      electronVersion: "43.4.1",
    },
    entrypoint: "server.mjs",
    externalPackages: ["@earendil-works/pi-coding-agent", "node-pty"],
    dynamicPackages: ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"],
    resources: [],
    modelReadableResources: [],
    nativePackages: ["node-pty"],
    nativeInventory: {
      path: "native-runtime-inventory.json",
      size: 123,
      sha256: "a".repeat(64),
    },
    links: [
      {
        path: "node_modules/node-pty",
        target: ".pnpm/node-pty@1.1.0/node_modules/node-pty",
      },
    ],
    upgradeRequiredPaths: ["/api/events.mux", "/api/events.host", "/api/terminal"],
  } as const;
}

test("strictly parses and freezes a Runtime artifact build envelope", () => {
  const parsed = assertRuntimeArtifactManifest(manifest());
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.target), true);
  assert.equal(Object.isFrozen(parsed.nativeInventory), true);
  assert.equal(Object.isFrozen(parsed.links), true);
  assert.equal(Object.isFrozen(parsed.links[0]), true);
  assert.equal(Object.isFrozen(parsed.externalPackages), true);
  assert.equal(Object.isFrozen(parsed.upgradeRequiredPaths), true);
  assert.equal("accessToken" in parsed, false);
  assert.equal("httpOrigin" in parsed, false);
  assert.equal("instanceId" in parsed, false);
});

test("rejects unknown/live fields, escaping paths, incoherent targets and repeated arrays", () => {
  for (const invalid of [
    { ...manifest(), accessToken: "secret" },
    { ...manifest(), runtimeMode: "combined" },
    { ...manifest(), controlVersion: 999 },
    { ...manifest(), entrypoint: "../server.mjs" },
    { ...manifest(), resources: ["/absolute"] },
    { ...manifest(), nativeInventory: { ...manifest().nativeInventory, sha256: "invalid" } },
    { ...manifest(), links: [{ path: "node_modules/pkg", target: "/absolute" }] },
    { ...manifest(), links: [{ path: "node_modules/pkg", target: "C:/external/store/pkg" }] },
    { ...manifest(), links: [{ path: "node_modules/pkg", target: "\\\\server\\share\\pkg" }] },
    { ...manifest(), links: [{ path: "node_modules/pkg", target: "../../../escape" }] },
    { ...manifest(), upgradeRequiredPaths: ["/api/events.mux", "/api/events.mux"] },
    { ...manifest(), target: { ...manifest().target, targetTriple: "aarch64-unknown-linux-gnu" } },
    { ...manifest(), target: { ...manifest().target, runtimeFlavor: "node" } },
  ]) {
    assert.equal(parseRuntimeArtifactManifest(invalid), undefined);
  }
});

test("accepts 4096 complete support resources, including JavaScript, and rejects 4097", () => {
  const resources = Array.from({ length: 4_096 }, (_, index) =>
    index === 0 ? "node_modules/pi/examples/doom.js" : `resources/item-${index}.json`,
  );
  assert.ok(parseRuntimeArtifactManifest({ ...manifest(), resources }));
  assert.equal(
    parseRuntimeArtifactManifest({
      ...manifest(),
      resources: [...resources, "resources/overflow.json"],
    }),
    undefined,
  );
});

test("requires model-readable resources to be a sorted exact resource subset", () => {
  const resources = [
    "node_modules/pi-coding-agent/README.md",
    "node_modules/pi-coding-agent/docs/configuration.md",
    "node_modules/pi-coding-agent/examples/basic.ts",
  ];
  assert.ok(
    parseRuntimeArtifactManifest({
      ...manifest(),
      resources,
      modelReadableResources: [...resources],
    }),
  );

  for (const modelReadableResources of [
    [resources[1], resources[0]],
    [resources[0], resources[0]],
    [resources[0], "node_modules/pi-coding-agent/docs/missing.md"],
  ]) {
    assert.equal(
      parseRuntimeArtifactManifest({ ...manifest(), resources, modelReadableResources }),
      undefined,
    );
  }
});

test("accepts 4096 sorted artifact links and rejects 4097", () => {
  const links = Array.from({ length: 4_096 }, (_, index) => ({
    path: `links/item-${String(index).padStart(4, "0")}`,
    target: "../targets/shared",
  }));
  assert.ok(parseRuntimeArtifactManifest({ ...manifest(), links }));
  assert.equal(
    parseRuntimeArtifactManifest({
      ...manifest(),
      links: [...links, { path: "links/overflow", target: "../targets/shared" }].sort(
        (left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
      ),
    }),
    undefined,
  );
});

test("accepts a non-Electron Node target without Electron-only fields", () => {
  const nodeManifest = manifest();
  const { electronVersion: _electronVersion, ...nodeTarget } = nodeManifest.target;
  assert.ok(
    parseRuntimeArtifactManifest({
      ...nodeManifest,
      target: { ...nodeTarget, runtimeFlavor: "node" },
    }),
  );
});

test("derives the ABI-safe target directory key from the strict target contract", () => {
  assert.equal(
    runtimeArtifactTargetKey(manifest().target),
    "electron-node-linux-x64-glibc-abi137-electron43.4.1",
  );
  const nodeManifest = manifest();
  const { electronVersion: _electronVersion, ...nodeTarget } = nodeManifest.target;
  assert.equal(
    runtimeArtifactTargetKey({ ...nodeTarget, runtimeFlavor: "node" }),
    "node-linux-x64-glibc-abi137",
  );
  assert.throws(
    () => runtimeArtifactTargetKey({ ...manifest().target, nodeModuleAbi: 0 }),
    /Invalid Runtime artifact target key/u,
  );
});

test("strictly parses the measured native inventory and rejects ambiguous file sets", () => {
  const value = {
    schemaVersion: 1,
    target: manifest().target,
    files: [
      {
        path: "node_modules/node-pty/build/Release/pty.node",
        size: 123,
        sha256: "b".repeat(64),
        mode: 0o755,
      },
      {
        path: "node_modules/tree-sitter/prebuilds/linux-x64/tree-sitter.node",
        size: 456,
        sha256: "c".repeat(64),
        mode: 0o644,
      },
    ],
  };
  const parsed = assertRuntimeArtifactNativeInventory(value);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.files), true);
  assert.equal(Object.isFrozen(parsed.files[0]), true);

  for (const invalid of [
    { ...value, files: [...value.files].reverse() },
    { ...value, files: [value.files[0], value.files[0]] },
    { ...value, files: [{ ...value.files[0], path: "../pty.node" }] },
    { ...value, files: [{ ...value.files[0], path: "node_modules/node-pty/index.js" }] },
    { ...value, files: [{ ...value.files[0], unexpected: true }] },
    { ...value, files: [{ ...value.files[0], mode: 0o1000 }] },
    { ...value, target: { ...value.target, targetTriple: "aarch64-unknown-linux-gnu" } },
  ]) {
    assert.equal(parseRuntimeArtifactNativeInventory(invalid), undefined);
  }
});
