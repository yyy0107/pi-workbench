import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import {
  RUNTIME_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  RUNTIME_NODE_ARTIFACT_DYNAMIC_PACKAGES,
  RUNTIME_NODE_ARTIFACT_EXTERNAL_PACKAGES,
  RUNTIME_NODE_ARTIFACT_NATIVE_PACKAGES,
  runtimeArtifactTargetKey as contractRuntimeArtifactTargetKey,
  type RuntimeArtifactManifest,
  type RuntimeArtifactTarget,
} from "@workbench/host-contracts/runtime-artifact-manifest";
import {
  RUNTIME_HOST_CONTROL_VERSION,
  RUNTIME_HOST_PROTOCOL_VERSION,
} from "@workbench/host-contracts/runtime-host-control";

import {
  RUNTIME_ARTIFACT_MANIFEST_MAX_BYTES,
  createRuntimeArtifactAdmissionPolicy,
  resolveRuntimeArtifact,
  runtimeArtifactTargetKey,
  type RuntimeProcessIdentity,
} from "@workbench/host-server/runtime-artifact";

const NODE_TARGET: RuntimeArtifactTarget = Object.freeze({
  runtimeFlavor: "node",
  platform: "linux",
  arch: "x64",
  targetTriple: "x86_64-unknown-linux-gnu",
  libc: "glibc",
  nodeVersion: "24.16.0",
  nodeModuleAbi: 137,
  napiVersion: 10,
});

const NODE_IDENTITY: RuntimeProcessIdentity = Object.freeze({
  runtimeFlavor: "node",
  platform: "linux",
  arch: "x64",
  libc: "glibc",
  nodeVersion: "24.16.0",
  nodeModuleAbi: 137,
  napiVersion: 10,
});

const EXPECTED_UPGRADE_PATHS = Object.freeze([
  "/api/events.mux",
  "/api/events.host",
  "/api/terminal",
]);

const MODEL_READABLE_RESOURCES = Object.freeze(
  [
    "README.md",
    "docs/guide.md",
    "examples/sdk/model-readable.test.ts",
    "examples/sdk/model-readable.ts",
  ].map((relativePath) =>
    path.posix.join("node_modules", "@earendil-works/pi-coding-agent", relativePath),
  ),
);

const ADMISSION_POLICY = createRuntimeArtifactAdmissionPolicy({
  expectedUpgradePaths: EXPECTED_UPGRADE_PATHS,
  expectedNativeRuntimeFiles: () => [
    {
      packageName: "node-pty",
      relativePath: "build/Release/pty.node",
      executable: false,
    },
    {
      packageName: "tree-sitter",
      relativePath: "prebuilds/linux-x64/tree-sitter.node",
      executable: false,
    },
    {
      packageName: "tree-sitter-bash",
      relativePath: "prebuilds/linux-x64/tree-sitter-bash.node",
      executable: false,
    },
  ],
  collectModelReadableResources: () => ({
    resources: MODEL_READABLE_RESOURCES,
    resolvedExamplesRoot: "node_modules/@earendil-works/pi-coding-agent/examples",
  }),
  assertModelReadableResourceClassification: ({
    resources,
    modelReadableResources,
    expectedModelReadableResources,
    resolvedExamplesRoot,
  }) => {
    assert.deepEqual(modelReadableResources, expectedModelReadableResources);
    assert.ok(modelReadableResources.every((resource) => resources.includes(resource)));
    for (const resource of resources) {
      if (
        (/(?:\.(?:test|spec)|_(?:test|spec))\.[^/]+$/iu.test(resource) ||
          /\.(?:[cm]?ts|tsx)$/iu.test(resource)) &&
        !modelReadableResources.includes(resource)
      ) {
        throw new Error(`Runtime artifact TS/test resource is not model-readable: ${resource}.`);
      }
    }
    assert.equal(resolvedExamplesRoot, "node_modules/@earendil-works/pi-coding-agent/examples");
  },
});

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

interface RuntimeArtifactFixture {
  readonly root: string;
  readonly manifestPath: string;
  readManifest(): Promise<Record<string, unknown>>;
  writeManifest(manifest: Record<string, unknown>): Promise<void>;
}

async function artifactFixture(t: TestContext): Promise<RuntimeArtifactFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-runtime-resolver-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const packageNames = [
    ...new Set([
      ...RUNTIME_NODE_ARTIFACT_EXTERNAL_PACKAGES,
      ...RUNTIME_NODE_ARTIFACT_DYNAMIC_PACKAGES,
    ]),
  ];
  const resources: string[] = [];
  for (const packageName of packageNames) {
    const packageRoot = path.join(root, "node_modules", ...packageName.split("/"));
    const entrypoint = packageName === "tree-sitter-bash" ? "bindings/node/index.js" : "index.js";
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: packageName,
        type: "module",
        ...(packageName === "tree-sitter-bash"
          ? { main: "bindings/node" }
          : { exports: { ".": { import: "./index.js" } } }),
      })}\n`,
    );
    const entrypointPath = path.join(packageRoot, ...entrypoint.split("/"));
    await mkdir(path.dirname(entrypointPath), { recursive: true });
    await writeFile(entrypointPath, "export {};\n");
    resources.push(
      path.posix.join("node_modules", packageName, "package.json"),
      path.posix.join("node_modules", packageName, entrypoint),
    );
    if (packageName === "@earendil-works/pi-coding-agent") {
      for (const artifactPath of MODEL_READABLE_RESOURCES) {
        const relativePath = artifactPath.split("/").slice(3).join("/");
        const destination = path.join(packageRoot, ...relativePath.split("/"));
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, "fixture\n");
        resources.push(artifactPath);
      }
    }
  }

  const nativePayloads = [
    ["node_modules/node-pty/build/Release/pty.node", Buffer.from("node-pty-native\n")],
    [
      "node_modules/tree-sitter/prebuilds/linux-x64/tree-sitter.node",
      Buffer.from("tree-sitter-native\n"),
    ],
    [
      "node_modules/tree-sitter-bash/prebuilds/linux-x64/tree-sitter-bash.node",
      Buffer.from("tree-sitter-bash-native\n"),
    ],
  ] as const;
  for (const [relativePath, bytes] of nativePayloads) {
    const absolute = path.join(root, ...relativePath.split("/"));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
    await chmod(absolute, 0o644);
  }
  const inventoryBytes = Buffer.from(
    `${JSON.stringify({
      schemaVersion: 1,
      target: NODE_TARGET,
      files: nativePayloads
        .map(([relativePath, bytes]) => ({
          path: relativePath,
          size: bytes.byteLength,
          sha256: sha256(bytes),
          mode: 0o644,
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    })}\n`,
  );
  await writeFile(path.join(root, "server.mjs"), "export {};\n");
  await writeFile(path.join(root, "native-runtime-inventory.json"), inventoryBytes);
  const manifestPath = path.join(root, "artifact-manifest.json");
  const manifest: RuntimeArtifactManifest = {
    schemaVersion: RUNTIME_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifactKind: "workbench-runtime-node",
    runtimeMode: "api-only",
    controlVersion: RUNTIME_HOST_CONTROL_VERSION,
    hostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    target: NODE_TARGET,
    entrypoint: "server.mjs",
    externalPackages: RUNTIME_NODE_ARTIFACT_EXTERNAL_PACKAGES,
    dynamicPackages: RUNTIME_NODE_ARTIFACT_DYNAMIC_PACKAGES,
    resources: resources.sort(),
    modelReadableResources: MODEL_READABLE_RESOURCES,
    nativePackages: RUNTIME_NODE_ARTIFACT_NATIVE_PACKAGES,
    nativeInventory: {
      path: "native-runtime-inventory.json",
      size: inventoryBytes.byteLength,
      sha256: sha256(inventoryBytes),
    },
    links: [],
    upgradeRequiredPaths: EXPECTED_UPGRADE_PATHS,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  return {
    root,
    manifestPath,
    readManifest: async () =>
      JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>,
    writeManifest: async (value) => writeFile(manifestPath, `${JSON.stringify(value)}\n`),
  };
}

test("resolves and freezes a complete Runtime artifact against an explicit target", async (t) => {
  const fixture = await artifactFixture(t);
  const resolved = await resolveRuntimeArtifact({
    manifestPath: fixture.manifestPath,
    expectedTarget: NODE_TARGET,
    policy: ADMISSION_POLICY,
  });
  assert.deepEqual(resolved, {
    artifactRoot: fixture.root,
    manifestPath: fixture.manifestPath,
    entrypoint: path.join(fixture.root, "server.mjs"),
    manifest: resolved.manifest,
  });
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(
    runtimeArtifactTargetKey(NODE_TARGET),
    contractRuntimeArtifactTargetKey(NODE_TARGET),
  );
});

test("requires a canonical regular bounded manifest and canonical artifact root", async (t) => {
  const relativeManifest = await artifactFixture(t);
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: path.relative(process.cwd(), relativeManifest.manifestPath),
      expectedTarget: NODE_TARGET,
      policy: ADMISSION_POLICY,
    }),
    /absolute canonical path without aliases/u,
  );

  const lexicalAlias = await artifactFixture(t);
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: `${lexicalAlias.root}${path.sep}unused${path.sep}..${path.sep}artifact-manifest.json`,
      expectedTarget: NODE_TARGET,
      policy: ADMISSION_POLICY,
    }),
    /absolute canonical path without aliases/u,
  );

  const oversized = await artifactFixture(t);
  await truncate(oversized.manifestPath, RUNTIME_ARTIFACT_MANIFEST_MAX_BYTES + 1);
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: oversized.manifestPath,
      expectedTarget: NODE_TARGET,
      policy: ADMISSION_POLICY,
    }),
    /manifest has an invalid size/u,
  );

  const linkedManifest = await artifactFixture(t);
  const manifestTarget = path.join(linkedManifest.root, "manifest-target.json");
  await rename(linkedManifest.manifestPath, manifestTarget);
  await symlink("manifest-target.json", linkedManifest.manifestPath);
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: linkedManifest.manifestPath,
      expectedTarget: NODE_TARGET,
      policy: ADMISSION_POLICY,
    }),
    /manifest must be a regular file/u,
  );

  const aliasedRoot = await artifactFixture(t);
  const aliasParent = await mkdtemp(path.join(tmpdir(), "workbench-runtime-root-alias-"));
  t.after(() => rm(aliasParent, { force: true, recursive: true }));
  const alias = path.join(aliasParent, "artifact-alias");
  await symlink(aliasedRoot.root, alias, "dir");
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: path.join(alias, "artifact-manifest.json"),
      expectedTarget: NODE_TARGET,
      policy: ADMISSION_POLICY,
    }),
    /root must be a regular directory/u,
  );
});

test("requires an explicit frozen policy and exactly one optional target authority", async (t) => {
  const fixture = await artifactFixture(t);
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: fixture.manifestPath,
      expectedTarget: NODE_TARGET,
      policy: undefined as never,
    }),
    /admission policy must be frozen/u,
  );
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: fixture.manifestPath,
      expectedTarget: NODE_TARGET,
      policy: {
        ...ADMISSION_POLICY,
        expectedUpgradePaths: [...EXPECTED_UPGRADE_PATHS],
      },
    }),
    /policy must be frozen/u,
  );
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: fixture.manifestPath,
      expectedTarget: NODE_TARGET,
      processIdentity: NODE_IDENTITY,
      policy: ADMISSION_POLICY,
    }),
    /one target authority/u,
  );
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: fixture.manifestPath,
      expectedTarget: { ...NODE_TARGET, nodeModuleAbi: 999 },
      policy: ADMISSION_POLICY,
    }),
    /does not match the expected target/u,
  );
});

test("enforces target identity, Upgrade paths, and package contracts before spawn", async (t) => {
  const identityFixture = await artifactFixture(t);
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: identityFixture.manifestPath,
      processIdentity: { ...NODE_IDENTITY, nodeModuleAbi: 999 },
      policy: ADMISSION_POLICY,
    }),
    /Node module ABI/u,
  );

  const upgradeFixture = await artifactFixture(t);
  const upgradeManifest = await upgradeFixture.readManifest();
  upgradeManifest.upgradeRequiredPaths = ["/api/events.host"];
  await upgradeFixture.writeManifest(upgradeManifest);
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: upgradeFixture.manifestPath,
      expectedTarget: NODE_TARGET,
      policy: ADMISSION_POLICY,
    }),
    /Upgrade path contract/u,
  );

  const packageFixture = await artifactFixture(t);
  const packageManifest = await packageFixture.readManifest();
  packageManifest.externalPackages = ["ws"];
  await packageFixture.writeManifest(packageManifest);
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: packageFixture.manifestPath,
      expectedTarget: NODE_TARGET,
      policy: ADMISSION_POLICY,
    }),
    /external package set/u,
  );
});

test("binds native inventory bytes, modes, and the complete native payload", async (t) => {
  const inventoryFixture = await artifactFixture(t);
  await writeFile(path.join(inventoryFixture.root, "native-runtime-inventory.json"), "mutated\n");
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: inventoryFixture.manifestPath,
      expectedTarget: NODE_TARGET,
      policy: ADMISSION_POLICY,
    }),
    /inventory does not match/u,
  );

  const modeFixture = await artifactFixture(t);
  await chmod(path.join(modeFixture.root, "node_modules/node-pty/build/Release/pty.node"), 0o600);
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: modeFixture.manifestPath,
      expectedTarget: NODE_TARGET,
      policy: ADMISSION_POLICY,
    }),
    /native file .* does not match/u,
  );

  const extraFixture = await artifactFixture(t);
  await writeFile(path.join(extraFixture.root, "unexpected.node"), "native\n");
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: extraFixture.manifestPath,
      expectedTarget: NODE_TARGET,
      policy: ADMISSION_POLICY,
    }),
    /native payload does not match/u,
  );
});

test("binds complete resources and delegates exact model-readable classification", async (t) => {
  const resourcesFixture = await artifactFixture(t);
  await writeFile(path.join(resourcesFixture.root, "unlisted-resource.json"), "{}\n");
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: resourcesFixture.manifestPath,
      expectedTarget: NODE_TARGET,
      policy: ADMISSION_POLICY,
    }),
    /resource manifest does not describe the complete payload/u,
  );

  const modelFixture = await artifactFixture(t);
  const modelManifest = await modelFixture.readManifest();
  modelManifest.modelReadableResources = MODEL_READABLE_RESOURCES.slice(1);
  await modelFixture.writeManifest(modelManifest);
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: modelFixture.manifestPath,
      expectedTarget: NODE_TARGET,
      policy: ADMISSION_POLICY,
    }),
    /Expected values to be strictly deep-equal/u,
  );
});

test("binds every symlink raw target and rejects broken links", async (t) => {
  const fixture = await artifactFixture(t);
  await mkdir(path.join(fixture.root, "support-target"));
  await symlink("support-target", path.join(fixture.root, "support-link"));
  const manifest = await fixture.readManifest();
  manifest.links = [{ path: "support-link", target: "support-target" }];
  await fixture.writeManifest(manifest);
  await resolveRuntimeArtifact({
    manifestPath: fixture.manifestPath,
    expectedTarget: NODE_TARGET,
    policy: ADMISSION_POLICY,
  });

  manifest.links = [{ path: "support-link", target: "./support-target" }];
  await fixture.writeManifest(manifest);
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: fixture.manifestPath,
      expectedTarget: NODE_TARGET,
      policy: ADMISSION_POLICY,
    }),
    /link manifest does not describe/u,
  );

  await rm(path.join(fixture.root, "support-link"));
  await symlink("missing-target", path.join(fixture.root, "support-link"));
  manifest.links = [{ path: "support-link", target: "missing-target" }];
  await fixture.writeManifest(manifest);
  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: fixture.manifestPath,
      expectedTarget: NODE_TARGET,
      policy: ADMISSION_POLICY,
    }),
  );
});

test("classifies TS/test-shaped symlink paths even though resources contain only files", async (t) => {
  const fixture = await artifactFixture(t);
  await symlink("server.mjs", path.join(fixture.root, "unexpected.test.ts"));
  const manifest = await fixture.readManifest();
  manifest.links = [{ path: "unexpected.test.ts", target: "server.mjs" }];
  await fixture.writeManifest(manifest);

  await assert.rejects(
    resolveRuntimeArtifact({
      manifestPath: fixture.manifestPath,
      expectedTarget: NODE_TARGET,
      policy: ADMISSION_POLICY,
    }),
    /TS\/test resource is not model-readable: unexpected\.test\.ts/u,
  );
});

test(
  "rejects filesystem entries outside the regular-file/directory/symlink model",
  { skip: process.platform === "win32" },
  async (t) => {
    const fixture = await artifactFixture(t);
    const socketPath = path.join(fixture.root, "unsupported.sock");
    const server = createServer();
    server.listen(socketPath);
    await once(server, "listening");
    try {
      await assert.rejects(
        resolveRuntimeArtifact({
          manifestPath: fixture.manifestPath,
          expectedTarget: NODE_TARGET,
          policy: ADMISSION_POLICY,
        }),
        /unsupported entry unsupported\.sock/u,
      );
    } finally {
      server.close();
      await once(server, "close");
    }
  },
);

test("critical artifact files must be lexical regular files, never internal symlinks", async (t) => {
  const cases = [
    {
      label: "Runtime entrypoint",
      relativePath: "server.mjs",
      targetName: "server-target.mjs",
      error: /Runtime entrypoint must be a regular file and not a symbolic link/u,
    },
    {
      label: "native inventory",
      relativePath: "native-runtime-inventory.json",
      targetName: "native-inventory-target.json",
      error: /Runtime native inventory must be a regular file and not a symbolic link/u,
    },
    {
      label: "package manifest",
      relativePath: "node_modules/ws/package.json",
      targetName: "package-target.json",
      error: /Runtime artifact package manifest ws must be a regular file/u,
    },
    {
      label: "package entrypoint",
      relativePath: "node_modules/ws/index.js",
      targetName: "entry-target.js",
      error: /Runtime artifact package ws has no confined entrypoint/u,
    },
  ] as const;

  for (const scenario of cases) {
    await t.test(scenario.label, async (t) => {
      const fixture = await artifactFixture(t);
      const lexicalPath = path.join(fixture.root, ...scenario.relativePath.split("/"));
      const targetPath = path.join(path.dirname(lexicalPath), scenario.targetName);
      await rename(lexicalPath, targetPath);
      await symlink(scenario.targetName, lexicalPath);
      await assert.rejects(
        resolveRuntimeArtifact({
          manifestPath: fixture.manifestPath,
          expectedTarget: NODE_TARGET,
          policy: ADMISSION_POLICY,
        }),
        scenario.error,
      );
    });
  }
});
