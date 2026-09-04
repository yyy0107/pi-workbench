import assert from "node:assert/strict";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import {
  access,
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import type { Metafile } from "esbuild";

const temporaryRoot = realpathSync(os.tmpdir());

import {
  RUNTIME_ARTIFACT_APP_OWNED_EXTERNAL_PACKAGES,
  RUNTIME_ARTIFACT_EXTERNAL_PACKAGES,
  RUNTIME_ARTIFACT_MANIFEST_FILENAME,
  RUNTIME_ARTIFACT_NATIVE_PACKAGES,
  RUNTIME_ARTIFACT_NATIVE_INVENTORY_FILENAME,
  RUNTIME_ARTIFACT_UPGRADE_PATHS,
  TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
  artifactLocalLinkTarget,
  assertArtifactConfinement,
  assertPackageOverlaySourceProvenance,
  assertRuntimeArtifactExternalPackages,
  assertRuntimeModelReadableResourceClassification,
  collectRuntimeModelReadableResources,
  assertRuntimeArtifactInputClosure,
  buildRuntimeArtifact,
  copyRuntimeArtifactClosurePath,
  createCommandRuntimeArtifactTargetAdapter,
  createRuntimeArtifactBuildOptions,
  createRuntimeArtifactManifest,
  createRuntimeArtifactTraceResolver,
  currentNodeArtifactTarget,
  currentNodeRuntimeArtifactAdapter,
  flattenWindowsRuntimeNodeModules,
  outputDirectoryForTarget,
  parseRuntimeArtifactBuildRequest,
  projectTracedPnpmDependencyLinks,
  projectRuntimeAppOwnedExternalTraceAliases,
  publishRuntimeArtifactTransaction,
  pruneRuntimeTree,
  resolveRuntimeAppExternalTraceAuthority,
  runtimeAppOwnedExternalTraceAliases,
  runtimeArtifactMaterializationSnapshot,
  runtimeArtifactTargetKey,
  writeNativeInventory,
} from "../scripts/build-runtime-artifact";

function metafile(
  inputs: readonly string[],
  externalPackages = RUNTIME_ARTIFACT_EXTERNAL_PACKAGES,
): Metafile {
  return {
    inputs: Object.fromEntries(inputs.map((input) => [input, { bytes: 1, imports: [] }])),
    outputs: {
      "server.mjs": {
        bytes: 1,
        exports: [],
        inputs: {},
        imports: externalPackages.map((packageName) => ({
          path: packageName,
          kind: "import-statement",
          external: true,
        })),
      },
    },
  };
}

async function writeNativePackageAliases(artifactRoot: string): Promise<void> {
  for (const packageName of RUNTIME_ARTIFACT_NATIVE_PACKAGES) {
    const owner = path.join(
      artifactRoot,
      "node_modules",
      ".pnpm",
      packageName.replaceAll("/", "+"),
      "node_modules",
      ...packageName.split("/"),
    );
    const alias = path.join(artifactRoot, "node_modules", ...packageName.split("/"));
    await mkdir(owner, { recursive: true });
    await mkdir(path.join(owner, packageName === "node-pty" ? "build" : "prebuilds"), {
      recursive: true,
    });
    await mkdir(path.dirname(alias), { recursive: true });
    await symlink(path.relative(path.dirname(alias), owner), alias, "dir");
  }
}

test("bundles every Workbench package and never externalizes Next", () => {
  const fixtureRoot = path.resolve("artifact-builder-fixture");
  const appRoot = path.join(fixtureRoot, "runtime-app");
  const outputDirectory = path.join(fixtureRoot, "output", "intermediate");
  const buildOptions = createRuntimeArtifactBuildOptions({
    appRoot,
    outputDirectory,
  });
  assert.equal(buildOptions.absWorkingDir, appRoot);
  assert.deepEqual(buildOptions.entryPoints, ["src/main.ts"]);
  assert.equal(buildOptions.outfile, path.join(outputDirectory, "server.mjs"));
  assert.ok(buildOptions.external?.includes("node-pty"));
  assert.equal(
    buildOptions.external?.some((entry) => String(entry).startsWith("@workbench/")),
    false,
  );
  assert.equal(buildOptions.external?.includes("next"), false);
  assert.deepEqual(
    assertRuntimeArtifactExternalPackages(RUNTIME_ARTIFACT_EXTERNAL_PACKAGES),
    [...RUNTIME_ARTIFACT_EXTERNAL_PACKAGES].sort(),
  );
  assert.deepEqual(RUNTIME_ARTIFACT_APP_OWNED_EXTERNAL_PACKAGES, ["ws"]);
  assert.throws(
    () => assertRuntimeArtifactExternalPackages([...RUNTIME_ARTIFACT_EXTERNAL_PACKAGES, "next"]),
    /must not depend on Next/,
  );
  assert.throws(
    () => assertRuntimeArtifactExternalPackages(["@workbench/host-server"]),
    /bundle every Workbench package/,
  );
});

test("binds app-owned artifact externals to a declared, installed, confined Runtime owner", async (t) => {
  const fixtureRoot = await mkdtemp(path.join(temporaryRoot, "workbench-runtime-trace-owner-"));
  t.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const repositoryRoot = path.join(fixtureRoot, "repository");
  const appRoot = path.join(repositoryRoot, "apps", "runtime-node");
  const packageDirectory = path.join(
    repositoryRoot,
    "node_modules",
    ".pnpm",
    "ws@fixture",
    "node_modules",
    "ws",
  );
  const packageAlias = path.join(appRoot, "node_modules", "ws");
  const appManifestPath = path.join(appRoot, "package.json");
  await mkdir(packageDirectory, { recursive: true });
  await mkdir(path.dirname(packageAlias), { recursive: true });
  await writeFile(
    appManifestPath,
    `${JSON.stringify({ name: "@workbench/runtime-node", dependencies: { ws: "fixture" } })}\n`,
    "utf8",
  );
  await writeFile(
    path.join(packageDirectory, "package.json"),
    `${JSON.stringify({ name: "ws" })}\n`,
    "utf8",
  );
  await symlink(path.relative(path.dirname(packageAlias), packageDirectory), packageAlias, "dir");

  const authority = await resolveRuntimeAppExternalTraceAuthority({ appRoot, repositoryRoot });
  assert.equal(authority.issuerPath, await realpath(appManifestPath));
  assert.deepEqual(authority.packageNames, ["ws"]);

  await writeFile(
    appManifestPath,
    `${JSON.stringify({ name: "@workbench/runtime-node", dependencies: {} })}\n`,
    "utf8",
  );
  await assert.rejects(
    () => resolveRuntimeAppExternalTraceAuthority({ appRoot, repositoryRoot }),
    /ws must be a direct production dependency of @workbench\/runtime-node/u,
  );

  await writeFile(
    appManifestPath,
    `${JSON.stringify({ name: "@workbench/runtime-node", dependencies: { ws: "fixture" } })}\n`,
    "utf8",
  );
  await writeFile(
    path.join(packageDirectory, "package.json"),
    `${JSON.stringify({ name: "not-ws" })}\n`,
    "utf8",
  );
  await assert.rejects(
    () => resolveRuntimeAppExternalTraceAuthority({ appRoot, repositoryRoot }),
    /ws resolved to a mismatched package/u,
  );

  await writeFile(
    path.join(packageDirectory, "package.json"),
    `${JSON.stringify({ name: "ws" })}\n`,
    "utf8",
  );
  await rm(packageAlias);
  await mkdir(packageAlias);
  await assert.rejects(
    () => resolveRuntimeAppExternalTraceAuthority({ appRoot, repositoryRoot }),
    /ws must be installed through its public pnpm symlink/u,
  );

  const outsidePackage = path.join(fixtureRoot, "outside-ws");
  await mkdir(outsidePackage);
  await writeFile(
    path.join(outsidePackage, "package.json"),
    `${JSON.stringify({ name: "ws" })}\n`,
    "utf8",
  );
  await rm(packageAlias, { recursive: true });
  await symlink(path.relative(path.dirname(packageAlias), outsidePackage), packageAlias, "dir");
  await assert.rejects(
    () => resolveRuntimeAppExternalTraceAuthority({ appRoot, repositoryRoot }),
    /ws Runtime app installation resolves outside the repository/u,
  );
});

test("reanchors exact Runtime app external package specifiers and subpaths for NFT", async () => {
  const appRoot = path.resolve("apps/runtime-node");
  const repositoryRoot = path.resolve(".");
  const originalParent = path.join(temporaryRoot, "workbench-runtime-trace-parent", "server.mjs");
  const calls: { readonly specifier: string; readonly parent: string }[] = [];
  const resolver = await createRuntimeArtifactTraceResolver({
    appRoot,
    repositoryRoot,
    target: currentNodeArtifactTarget(),
    resolveDependency: async (specifier, parent) => {
      calls.push({ specifier, parent });
      return path.join(repositoryRoot, "resolved", encodeURIComponent(specifier));
    },
  });

  await resolver("ws", originalParent, {}, false);
  await resolver("ws/lib/websocket.js", originalParent, {}, true);
  await resolver("unrelated-package", originalParent, {}, false);

  const runtimeAppIssuer = await realpath(path.join(appRoot, "package.json"));
  assert.deepEqual(calls, [
    { specifier: "ws", parent: runtimeAppIssuer },
    { specifier: "ws/lib/websocket.js", parent: runtimeAppIssuer },
    { specifier: "unrelated-package", parent: originalParent },
  ]);
});

test("accepts only app/package source inputs in the Runtime bundle closure", () => {
  const repositoryRoot = path.resolve("artifact-closure-fixture");
  const appRoot = path.join(repositoryRoot, "apps", "runtime-node");
  assert.doesNotThrow(() =>
    assertRuntimeArtifactInputClosure(
      metafile([
        "src/main.ts",
        "../../packages/host/server/src/workbench-http-server.ts",
        "../../node_modules/ws/index.js",
      ]),
      { appRoot, repositoryRoot },
    ),
  );
  assert.throws(
    () =>
      assertRuntimeArtifactInputClosure(metafile(["../../workbench/server/private.ts"]), {
        appRoot,
        repositoryRoot,
      }),
    /outside apps\/runtime-node and packages/,
  );
  assert.throws(
    () =>
      assertRuntimeArtifactInputClosure(metafile(["../../node_modules/next/server.js"]), {
        appRoot,
        repositoryRoot,
      }),
    /outside apps\/runtime-node and packages/,
  );
});

test("keys artifacts by runtime ABI and rejects an unmaterialized Node target", () => {
  const current = currentNodeArtifactTarget();
  assert.match(runtimeArtifactTargetKey(current), /^node-(darwin|linux|win32)-(arm64|x64)-/u);
  assert.equal(
    outputDirectoryForTarget(current, "/artifacts"),
    path.join("/artifacts", runtimeArtifactTargetKey(current)),
  );
  assert.doesNotThrow(() => currentNodeRuntimeArtifactAdapter.validateTarget(current));
  assert.throws(
    () =>
      currentNodeRuntimeArtifactAdapter.validateTarget({
        ...current,
        nodeModuleAbi: current.nodeModuleAbi + 1,
      }),
    /must match the executing Node/,
  );
});

test("parses the app-owned artifact producer request and delegates target materialization", async (t) => {
  const target = currentNodeArtifactTarget();
  const repositoryRoot = await mkdtemp(path.join(temporaryRoot, "workbench-materializer-command-"));
  const outputDirectory = path.join(repositoryRoot, "candidate");
  await mkdir(outputDirectory);
  await writeFile(path.join(outputDirectory, "server.mjs"), "export {};\n");
  await writeNativePackageAliases(outputDirectory);
  t.after(() => rm(repositoryRoot, { force: true, recursive: true }));
  const request = parseRuntimeArtifactBuildRequest([
    "--request-json",
    JSON.stringify({
      schemaVersion: 1,
      target,
      outputDirectory,
      materializer: { command: "/virtual/materializer", args: ["adapter.cjs"] },
    }),
  ]);
  assert.ok(request);
  const calls: unknown[][] = [];
  const adapter = createCommandRuntimeArtifactTargetAdapter(request, {
    environment: { WORKBENCH_TEST: "1" },
    spawn: ((...args: unknown[]) => {
      calls.push(args);
      return { status: 0 };
    }) as never,
  });
  assert.equal(adapter.runtimeFlavor, target.runtimeFlavor);
  assert.doesNotThrow(() => adapter.validateTarget(target));
  assert.throws(
    () => adapter.validateTarget({ ...target, napiVersion: target.napiVersion + 1 }),
    /does not match the target materializer request/u,
  );
  await adapter.materialize?.({
    target,
    outputDirectory,
    repositoryRoot,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/virtual/materializer");
  assert.deepEqual((calls[0][1] as string[]).slice(0, 2), ["adapter.cjs", "--request-json"]);
  assert.deepEqual(JSON.parse((calls[0][1] as string[])[2]), {
    schemaVersion: 1,
    target,
    outputDirectory,
    repositoryRoot,
  });
  assert.deepEqual(calls[0][2], {
    cwd: repositoryRoot,
    env: { WORKBENCH_TEST: "1" },
    stdio: "inherit",
    windowsHide: true,
  });
});

test("materializer command may mutate only policy-derived native owner subtrees", async (t) => {
  const target = currentNodeArtifactTarget();
  const repositoryRoot = await mkdtemp(path.join(temporaryRoot, "workbench-native-mutation-"));
  t.after(() => rm(repositoryRoot, { force: true, recursive: true }));

  async function adapterWithMutation(mutate: (outputDirectory: string) => void) {
    const outputDirectory = path.join(repositoryRoot, `candidate-${Math.random()}`);
    await mkdir(outputDirectory);
    chmodSync(outputDirectory, 0o755);
    await writeNativePackageAliases(outputDirectory);
    await writeFile(path.join(outputDirectory, "server.mjs"), "export {};\n");
    const request = parseRuntimeArtifactBuildRequest([
      "--request-json",
      JSON.stringify({
        schemaVersion: 1,
        target,
        outputDirectory,
        materializer: { command: "/virtual/materializer", args: [] },
      }),
    ]);
    assert.ok(request);
    return {
      adapter: createCommandRuntimeArtifactTargetAdapter(request, {
        spawn: ((..._args: unknown[]) => {
          mutate(outputDirectory);
          return { status: 0 };
        }) as never,
      }),
      outputDirectory,
    };
  }

  async function adapterForMutation(relativePath: string) {
    return adapterWithMutation((outputDirectory) => {
      mkdirSync(path.dirname(path.join(outputDirectory, relativePath)), { recursive: true });
      writeFileSync(path.join(outputDirectory, relativePath), "changed\n");
    });
  }

  const allowed = await adapterForMutation("node_modules/node-pty/build/Release/pty.node");
  await assert.doesNotReject(async () => {
    await allowed.adapter.materialize?.({
      target,
      outputDirectory: allowed.outputDirectory,
      repositoryRoot,
    });
  });

  const internalNativeHardLinks = await adapterWithMutation((outputDirectory) => {
    const releaseDirectory = path.join(
      outputDirectory,
      "node_modules",
      "node-pty",
      "build",
      "Release",
    );
    const linkedOutput = path.join(releaseDirectory, "obj.target", "pty.node");
    mkdirSync(path.dirname(linkedOutput), { recursive: true });
    writeFileSync(path.join(releaseDirectory, "pty.node"), "native\n");
    linkSync(path.join(releaseDirectory, "pty.node"), linkedOutput);
  });
  await assert.doesNotReject(async () => {
    await internalNativeHardLinks.adapter.materialize?.({
      target,
      outputDirectory: internalNativeHardLinks.outputDirectory,
      repositoryRoot,
    });
  });

  for (const relativePath of [
    "server.mjs",
    "artifact-manifest.json",
    "resources/guide.md",
    "node_modules/node-pty/index.js",
    "node_modules/tree-sitter/package.json",
  ]) {
    const blocked = await adapterForMutation(relativePath);
    await assert.rejects(
      async () => {
        await blocked.adapter.materialize?.({
          target,
          outputDirectory: blocked.outputDirectory,
          repositoryRoot,
        });
      },
      /outside declared native owner subtrees/u,
      relativePath,
    );
  }

  const externalJavaScript = path.join(repositoryRoot, "external-protected-file.bin");
  await writeFile(externalJavaScript, "export {};\n");
  const protectedHardLink = await adapterWithMutation((outputDirectory) => {
    const server = path.join(outputDirectory, "server.mjs");
    rmSync(server);
    linkSync(externalJavaScript, server);
  });
  await assert.rejects(async () => {
    await protectedHardLink.adapter.materialize?.({
      target,
      outputDirectory: protectedHardLink.outputDirectory,
      repositoryRoot,
    });
  }, /regular file server\.mjs has 2 hard links but only 1 name inside the artifact/u);

  const externalNative = path.join(repositoryRoot, "external-pty.node");
  await writeFile(externalNative, "native\n");
  const allowedRootHardLink = await adapterWithMutation((outputDirectory) => {
    const nativeFile = path.join(
      outputDirectory,
      "node_modules",
      "node-pty",
      "build",
      "Release",
      "pty.node",
    );
    mkdirSync(path.dirname(nativeFile), { recursive: true });
    linkSync(externalNative, nativeFile);
  });
  await assert.rejects(async () => {
    await allowedRootHardLink.adapter.materialize?.({
      target,
      outputDirectory: allowedRootHardLink.outputDirectory,
      repositoryRoot,
    });
  }, /regular file node_modules\/\.pnpm\/node-pty\/node_modules\/node-pty\/build\/Release\/pty\.node has 2 hard links but only 1 name inside the artifact/u);

  if (process.platform !== "win32") {
    const rootModeMutation = await adapterWithMutation((outputDirectory) => {
      chmodSync(outputDirectory, 0o700);
    });
    await assert.rejects(async () => {
      await rootModeMutation.adapter.materialize?.({
        target,
        outputDirectory: rootModeMutation.outputDirectory,
        repositoryRoot,
      });
    }, /changed paths outside declared native owner subtrees: \./u);
  }

  const rootIdentityReplacement = await adapterWithMutation((outputDirectory) => {
    const displacedRoot = `${outputDirectory}-displaced`;
    renameSync(outputDirectory, displacedRoot);
    mkdirSync(outputDirectory, { mode: 0o755 });
    renameSync(
      path.join(displacedRoot, "node_modules"),
      path.join(outputDirectory, "node_modules"),
    );
    renameSync(path.join(displacedRoot, "server.mjs"), path.join(outputDirectory, "server.mjs"));
    rmSync(displacedRoot, { recursive: true });
  });
  await assert.rejects(async () => {
    await rootIdentityReplacement.adapter.materialize?.({
      target,
      outputDirectory: rootIdentityReplacement.outputDirectory,
      repositoryRoot,
    });
  }, /changed paths outside declared native owner subtrees: \./u);

  const rootTypeDirectory = path.join(repositoryRoot, "candidate-root-type");
  const physicalRootTypeDirectory = `${rootTypeDirectory}-physical`;
  await mkdir(rootTypeDirectory);
  await writeFile(path.join(rootTypeDirectory, "server.mjs"), "export {};\n");
  await runtimeArtifactMaterializationSnapshot(rootTypeDirectory);
  await rename(rootTypeDirectory, physicalRootTypeDirectory);
  await symlink(physicalRootTypeDirectory, rootTypeDirectory, "dir");
  await assert.rejects(
    runtimeArtifactMaterializationSnapshot(rootTypeDirectory),
    /materialization root must be a real directory/u,
  );

  const escapingOutput = path.join(repositoryRoot, "candidate-escaping-root");
  await mkdir(escapingOutput);
  await writeNativePackageAliases(escapingOutput);
  const nodePtyPackage = await realpath(path.join(escapingOutput, "node_modules", "node-pty"));
  const externalBuild = path.join(repositoryRoot, "external-node-pty-build");
  await mkdir(externalBuild);
  await rm(path.join(nodePtyPackage, "build"), { recursive: true });
  await symlink(externalBuild, path.join(nodePtyPackage, "build"), "dir");
  const escapingRequest = parseRuntimeArtifactBuildRequest([
    "--request-json",
    JSON.stringify({
      schemaVersion: 1,
      target,
      outputDirectory: escapingOutput,
      materializer: { command: "/virtual/materializer", args: [] },
    }),
  ]);
  assert.ok(escapingRequest);
  let spawned = false;
  const escapingAdapter = createCommandRuntimeArtifactTargetAdapter(escapingRequest, {
    spawn: (() => {
      spawned = true;
      return { status: 0 };
    }) as never,
  });
  await assert.rejects(async () => {
    await escapingAdapter.materialize?.({
      target,
      outputDirectory: escapingOutput,
      repositoryRoot,
    });
  }, /native mutation root node-pty\/build must be a real directory/u);
  assert.equal(spawned, false);

  const replacedOutput = path.join(repositoryRoot, "candidate-replaced-root");
  await mkdir(replacedOutput);
  await writeNativePackageAliases(replacedOutput);
  const replacedNodePtyPackage = await realpath(
    path.join(replacedOutput, "node_modules", "node-pty"),
  );
  const replacedBuild = path.join(replacedNodePtyPackage, "build");
  const replacementTarget = path.join(repositoryRoot, "replacement-build");
  await mkdir(replacementTarget);
  const replacedRequest = parseRuntimeArtifactBuildRequest([
    "--request-json",
    JSON.stringify({
      schemaVersion: 1,
      target,
      outputDirectory: replacedOutput,
      materializer: { command: "/virtual/materializer", args: [] },
    }),
  ]);
  assert.ok(replacedRequest);
  const replacingAdapter = createCommandRuntimeArtifactTargetAdapter(replacedRequest, {
    spawn: (() => {
      rmSync(replacedBuild, { recursive: true });
      symlinkSync(replacementTarget, replacedBuild, "dir");
      return { status: 0 };
    }) as never,
  });
  await assert.rejects(async () => {
    await replacingAdapter.materialize?.({
      target,
      outputDirectory: replacedOutput,
      repositoryRoot,
    });
  }, /must remain a real directory/u);

  const nestedOutput = path.join(repositoryRoot, "candidate-nested-link");
  await mkdir(nestedOutput);
  await writeNativePackageAliases(nestedOutput);
  const nestedNodePtyPackage = await realpath(path.join(nestedOutput, "node_modules", "node-pty"));
  const nestedExternal = path.join(repositoryRoot, "external-release");
  await mkdir(nestedExternal);
  const nestedRequest = parseRuntimeArtifactBuildRequest([
    "--request-json",
    JSON.stringify({
      schemaVersion: 1,
      target,
      outputDirectory: nestedOutput,
      materializer: { command: "/virtual/materializer", args: [] },
    }),
  ]);
  assert.ok(nestedRequest);
  const nestedLinkAdapter = createCommandRuntimeArtifactTargetAdapter(nestedRequest, {
    spawn: (() => {
      symlinkSync(nestedExternal, path.join(nestedNodePtyPackage, "build", "Release"), "dir");
      return { status: 0 };
    }) as never,
  });
  await assert.rejects(async () => {
    await nestedLinkAdapter.materialize?.({
      target,
      outputDirectory: nestedOutput,
      repositoryRoot,
    });
  }, /contains a symlink after materialization/u);
});

test("rejects malformed target-specific artifact producer requests", () => {
  const target = currentNodeArtifactTarget();
  const valid = {
    schemaVersion: 1,
    target,
    outputDirectory: "/repo/output",
    materializer: { command: "/virtual/materializer", args: [] },
  };
  assert.equal(parseRuntimeArtifactBuildRequest([]), undefined);
  assert.throws(() => parseRuntimeArtifactBuildRequest(["--unknown"]), /Usage/u);
  for (const invalid of [
    { ...valid, unexpected: true },
    Object.fromEntries(Object.entries(valid).filter(([key]) => key !== "materializer")),
    { ...valid, materializer: { ...valid.materializer, unexpected: true } },
    { ...valid, materializer: { command: valid.materializer.command } },
  ]) {
    assert.throws(
      () => parseRuntimeArtifactBuildRequest(["--request-json", JSON.stringify(invalid)]),
      /must contain exactly/u,
    );
  }
  assert.throws(
    () =>
      parseRuntimeArtifactBuildRequest([
        "--request-json",
        JSON.stringify({
          schemaVersion: 1,
          target,
          outputDirectory: "relative",
          materializer: { command: "/virtual/materializer", args: [] },
        }),
      ]),
    /output directory must be absolute/u,
  );
  assert.throws(
    () =>
      parseRuntimeArtifactBuildRequest([
        "--request-json",
        JSON.stringify({
          schemaVersion: 1,
          target,
          outputDirectory: "/repo/output",
          materializer: { command: "relative", args: [] },
        }),
      ]),
    /absolute executable path/u,
  );
});

test("writes measured native inventory before the strict api-only manifest", async (t) => {
  const directory = await mkdtemp(path.join(temporaryRoot, "workbench-runtime-artifact-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const target = currentNodeArtifactTarget();
  const tuple = `${target.platform}-${target.arch}`;
  const nodePtyFiles =
    target.platform === "win32"
      ? [
          "conpty.node",
          "conpty_console_list.node",
          "pty.node",
          "winpty-agent.exe",
          "winpty.dll",
          "conpty/conpty.dll",
          "conpty/OpenConsole.exe",
        ]
      : target.platform === "darwin"
        ? ["pty.node", "spawn-helper"]
        : ["pty.node"];
  const files = [
    ...nodePtyFiles.map((filename) => `node_modules/node-pty/build/Release/${filename}`),
    `node_modules/tree-sitter/prebuilds/${tuple}/tree-sitter.node`,
    `node_modules/tree-sitter-bash/prebuilds/${tuple}/tree-sitter-bash.node`,
  ];
  await Promise.all(
    files.map(async (file, index) => {
      const destination = path.join(directory, ...file.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, file, "utf8");
      chmodSync(destination, file.endsWith("spawn-helper") ? 0o700 : index === 0 ? 0o700 : 0o664);
    }),
  );
  await mkdir(path.join(directory, "node_modules", "@earendil-works", "pi-coding-agent"), {
    recursive: true,
  });
  await writeFile(
    path.join(directory, "node_modules", "@earendil-works", "pi-coding-agent", "README.md"),
    "runtime resource",
    "utf8",
  );
  const measured = await writeNativeInventory(directory, target);
  assert.equal(measured.reference.path, RUNTIME_ARTIFACT_NATIVE_INVENTORY_FILENAME);
  assert.equal(measured.inventory.files.length, files.length);
  assert.deepEqual(
    measured.inventory.files.map((file) => file.mode),
    measured.inventory.files.map((file) =>
      file.path.endsWith("spawn-helper") ? 0o755 : process.platform === "win32" ? 0o666 : 0o644,
    ),
  );
  assert.ok(measured.reference.size > 0);
  const manifest = createRuntimeArtifactManifest(
    target,
    RUNTIME_ARTIFACT_EXTERNAL_PACKAGES,
    measured.reference,
    measured.nativePackages,
    ["node_modules/@earendil-works/pi-coding-agent/README.md"],
  );
  assert.equal(manifest.runtimeMode, "api-only");
  assert.deepEqual(manifest.upgradeRequiredPaths, RUNTIME_ARTIFACT_UPGRADE_PATHS);
  assert.equal(manifest.nativeInventory.sha256, measured.reference.sha256);
  assert.deepEqual(manifest.resources, ["node_modules/@earendil-works/pi-coding-agent/README.md"]);
});

test("rejects a symlink whose resolved target leaves the artifact", async (t) => {
  const directory = await mkdtemp(path.join(temporaryRoot, "workbench-runtime-confinement-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const outside = path.join(directory, "..", `${path.basename(directory)}-outside`);
  await writeFile(outside, "outside", "utf8");
  await symlink(outside, path.join(directory, "escaped-link"));
  await assert.rejects(() => assertArtifactConfinement(directory), /escapes its closure/);
  await rm(outside, { force: true });
});

test("rewrites absolute source junction targets to relocatable artifact-local links", async (t) => {
  assert.equal(
    artifactLocalLinkTarget(
      String.raw`C:\workspace\node_modules\.pnpm\pkg@1\node_modules\pkg`,
      String.raw`C:\artifact\node_modules\pkg`,
      String.raw`C:\workspace`,
      String.raw`C:\artifact`,
      path.win32,
    ),
    ".pnpm/pkg@1/node_modules/pkg",
  );

  const repositoryRoot = await mkdtemp(path.join(temporaryRoot, "workbench-link-source-"));
  const outputDirectory = await mkdtemp(path.join(temporaryRoot, "workbench-link-artifact-"));
  t.after(() => rm(repositoryRoot, { force: true, recursive: true }));
  t.after(() => rm(outputDirectory, { force: true, recursive: true }));
  const ownerRelative = "node_modules/.pnpm/pkg@1/node_modules/pkg";
  const ownerDirectory = path.join(repositoryRoot, ...ownerRelative.split("/"));
  await mkdir(ownerDirectory, { recursive: true });
  await writeFile(path.join(ownerDirectory, "index.js"), "export {};\n");
  await mkdir(path.join(repositoryRoot, "node_modules"), { recursive: true });
  await symlink(ownerDirectory, path.join(repositoryRoot, "node_modules", "pkg"), "dir");

  await copyRuntimeArtifactClosurePath(ownerRelative, repositoryRoot, outputDirectory);
  await copyRuntimeArtifactClosurePath(
    `${ownerRelative}/index.js`,
    repositoryRoot,
    outputDirectory,
  );
  await copyRuntimeArtifactClosurePath("node_modules/pkg", repositoryRoot, outputDirectory);
  assert.equal(
    (await readlink(path.join(outputDirectory, "node_modules", "pkg"))).split(path.sep).join("/"),
    ".pnpm/pkg@1/node_modules/pkg",
  );
  assert.equal(
    await realpath(path.join(outputDirectory, "node_modules", "pkg")),
    path.join(outputDirectory, ...ownerRelative.split("/")),
  );
});

test("projects only a traced Runtime app package alias onto the artifact root owner", async (t) => {
  const fixtureRoot = await mkdtemp(
    path.join(temporaryRoot, "workbench-runtime-alias-projection-"),
  );
  t.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const repositoryRoot = path.join(fixtureRoot, "repository");
  const appRoot = path.join(repositoryRoot, "apps", "runtime-node");
  const ownerRelative = "node_modules/.pnpm/ws@fixture/node_modules/ws";
  const ownerDirectory = path.join(repositoryRoot, ...ownerRelative.split("/"));
  const sourceAlias = path.join(appRoot, "node_modules", "ws");
  await mkdir(ownerDirectory, { recursive: true });
  await writeFile(path.join(ownerDirectory, "package.json"), '{"name":"ws"}\n');
  await writeFile(path.join(ownerDirectory, "index.js"), "export {};\n");
  await mkdir(path.dirname(sourceAlias), { recursive: true });
  await symlink(path.relative(path.dirname(sourceAlias), ownerDirectory), sourceAlias, "dir");
  const [alias] = runtimeAppOwnedExternalTraceAliases({ appRoot, repositoryRoot });
  assert.ok(alias);

  await t.test("creates the root alias without copying the app alias subtree", async () => {
    const outputDirectory = path.join(fixtureRoot, "artifact");
    await mkdir(outputDirectory);
    await copyRuntimeArtifactClosurePath(ownerRelative, repositoryRoot, outputDirectory);
    await copyRuntimeArtifactClosurePath(
      `${ownerRelative}/package.json`,
      repositoryRoot,
      outputDirectory,
    );
    await copyRuntimeArtifactClosurePath(
      `${ownerRelative}/index.js`,
      repositoryRoot,
      outputDirectory,
    );
    await projectRuntimeAppOwnedExternalTraceAliases({
      tracedPaths: [alias.sourceRelativePath, ownerRelative],
      appRoot,
      repositoryRoot,
      outputDirectory,
    });

    assert.equal(
      await realpath(path.join(outputDirectory, "node_modules", "ws")),
      path.join(outputDirectory, ...ownerRelative.split("/")),
    );
    await assert.rejects(access(path.join(outputDirectory, "apps", "runtime-node")), {
      code: "ENOENT",
    });
  });

  await t.test("rejects an untraced public alias", async () => {
    const outputDirectory = path.join(fixtureRoot, "missing-alias-artifact");
    await mkdir(outputDirectory);
    await assert.rejects(
      () =>
        projectRuntimeAppOwnedExternalTraceAliases({
          tracedPaths: [ownerRelative],
          appRoot,
          repositoryRoot,
          outputDirectory,
        }),
      /NFT closure is missing Runtime app public alias ws/u,
    );
  });

  await t.test("rejects a missing traced physical owner", async () => {
    const outputDirectory = path.join(fixtureRoot, "missing-owner-artifact");
    await mkdir(outputDirectory);
    await assert.rejects(
      () =>
        projectRuntimeAppOwnedExternalTraceAliases({
          tracedPaths: [alias.sourceRelativePath, ownerRelative],
          appRoot,
          repositoryRoot,
          outputDirectory,
        }),
      /NFT closure is missing traced physical owner for Runtime app package ws/u,
    );
  });

  await t.test("rejects a traced artifact owner escaping the candidate", async () => {
    const outputDirectory = path.join(fixtureRoot, "escaping-owner-artifact");
    const outsideOwner = path.join(fixtureRoot, "outside-artifact-owner");
    const artifactOwner = path.join(outputDirectory, ...ownerRelative.split("/"));
    await mkdir(outsideOwner);
    await mkdir(path.dirname(artifactOwner), { recursive: true });
    await symlink(outsideOwner, artifactOwner, "dir");
    await assert.rejects(
      () =>
        projectRuntimeAppOwnedExternalTraceAliases({
          tracedPaths: [alias.sourceRelativePath, ownerRelative],
          appRoot,
          repositoryRoot,
          outputDirectory,
        }),
      /ws traced artifact owner resolves outside the repository/u,
    );
  });
});

test("projects package-local pnpm dependency links when both physical owners were traced", async (t) => {
  const fixtureRoot = await realpath(
    await mkdtemp(path.join(temporaryRoot, "workbench-runtime-pnpm-links-")),
  );
  t.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const outputDirectory = path.join(fixtureRoot, "artifact");
  const sourceOwner = path.join(fixtureRoot, "node_modules", ".pnpm", "issuer@1", "node_modules");
  const sourceTarget = path.join(
    fixtureRoot,
    "node_modules",
    ".pnpm",
    "dependency@1",
    "node_modules",
    "@scope",
    "dependency",
  );
  const artifactOwner = path.join(
    outputDirectory,
    "node_modules",
    ".pnpm",
    "issuer@1",
    "node_modules",
  );
  const artifactTarget = path.join(
    outputDirectory,
    "node_modules",
    ".pnpm",
    "dependency@1",
    "node_modules",
    "@scope",
    "dependency",
  );
  const sourceLink = path.join(sourceOwner, "@scope", "dependency");
  const artifactLink = path.join(artifactOwner, "@scope", "dependency");
  await mkdir(sourceTarget, { recursive: true });
  await mkdir(path.dirname(sourceLink), { recursive: true });
  await symlink(path.relative(path.dirname(sourceLink), sourceTarget), sourceLink, "dir");
  await mkdir(artifactTarget, { recursive: true });
  await mkdir(artifactOwner, { recursive: true });

  await projectTracedPnpmDependencyLinks({
    repositoryRoot: fixtureRoot,
    outputDirectory,
  });

  assert.equal((await lstat(artifactLink)).isSymbolicLink(), true);
  assert.equal(await realpath(artifactLink), await realpath(artifactTarget));
});

test("flattens the Windows Runtime dependency graph without losing version conflicts", async (t) => {
  const outputDirectory = await realpath(
    await mkdtemp(path.join(temporaryRoot, "workbench-runtime-standalone-modules-")),
  );
  t.after(() => rm(outputDirectory, { force: true, recursive: true }));
  const appTarget = path.join(
    outputDirectory,
    "node_modules",
    ".pnpm",
    "app@1.0.0",
    "node_modules",
    "app",
  );
  const dependencyOneTarget = path.join(
    outputDirectory,
    "node_modules",
    ".pnpm",
    "dependency@1.0.0",
    "node_modules",
    "dependency",
  );
  const dependencyTwoTarget = path.join(
    outputDirectory,
    "node_modules",
    ".pnpm",
    "dependency@2.0.0",
    "node_modules",
    "dependency",
  );
  for (const [directory, manifest, source] of [
    [
      appTarget,
      '{"name":"app","version":"1.0.0","main":"index.js"}\n',
      "module.exports = require('dependency');\n",
    ],
    [
      dependencyOneTarget,
      '{"name":"dependency","version":"1.0.0","main":"index.js"}\n',
      "module.exports = 'one';\n",
    ],
    [
      dependencyTwoTarget,
      '{"name":"dependency","version":"2.0.0","main":"index.js"}\n',
      "module.exports = 'two';\n",
    ],
  ] as const) {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "package.json"), manifest);
    await writeFile(path.join(directory, "index.js"), source);
  }
  const appAlias = path.join(outputDirectory, "node_modules", "app");
  const dependencyAlias = path.join(outputDirectory, "node_modules", "dependency");
  const appDependencyAlias = path.join(
    outputDirectory,
    "node_modules",
    ".pnpm",
    "app@1.0.0",
    "node_modules",
    "dependency",
  );
  for (const [alias, target] of [
    [appAlias, appTarget],
    [dependencyAlias, dependencyOneTarget],
    [appDependencyAlias, dependencyTwoTarget],
  ] as const) {
    await mkdir(path.dirname(alias), { recursive: true });
    await symlink(path.relative(path.dirname(alias), target), alias, "dir");
  }
  const links = await Promise.all(
    [appAlias, dependencyAlias, appDependencyAlias].map(async (alias) => ({
      path: path.relative(outputDirectory, alias).split(path.sep).join("/"),
      target: (await readlink(alias)).split(path.sep).join("/"),
    })),
  );

  await flattenWindowsRuntimeNodeModules(outputDirectory, links);

  assert.equal((await lstat(appAlias)).isDirectory(), true);
  assert.equal((await lstat(appAlias)).isSymbolicLink(), false);
  assert.equal((await lstat(dependencyAlias)).isSymbolicLink(), false);
  await assert.rejects(access(path.join(outputDirectory, "node_modules", ".pnpm")));
  const requireFromArtifact = createRequire(path.join(outputDirectory, "probe.cjs"));
  assert.equal(requireFromArtifact("dependency"), "one");
  assert.equal(requireFromArtifact("app"), "two");
});

async function createPiModelFixture(directory: string): Promise<{
  readonly packageDirectory: string;
  readonly examplesDirectory: string;
}> {
  const packageDirectory = path.join(
    directory,
    "node_modules",
    ".pnpm",
    "@earendil-works+pi-coding-agent@fixture",
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
  );
  const examplesDirectory = path.join(packageDirectory, "examples");
  const files = [
    [path.join(packageDirectory, "package.json"), '{"name":"@earendil-works/pi-coding-agent"}\n'],
    [path.join(packageDirectory, "README.md"), "Pi guide\n"],
    [path.join(packageDirectory, "docs", "guide.md"), "docs\n"],
    [path.join(packageDirectory, "docs", "guide.test.ts"), "export {};\n"],
    [path.join(examplesDirectory, "extensions", "example.ts"), "export {};\n"],
    [path.join(examplesDirectory, "binding_test.js"), "test();\n"],
    [path.join(examplesDirectory, "package-lock.json"), "{}\n"],
  ] as const;
  for (const [destination, content] of files) {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  const alias = path.join(directory, "node_modules", "@earendil-works", "pi-coding-agent");
  await mkdir(path.dirname(alias), { recursive: true });
  await symlink(path.relative(path.dirname(alias), packageDirectory), alias, "dir");
  return { packageDirectory, examplesDirectory };
}

test("derives and preserves the exact physical Pi model closure, with TS/test exceptions only in examples", async (t) => {
  const directory = await mkdtemp(path.join(temporaryRoot, "workbench-runtime-prune-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const { packageDirectory, examplesDirectory } = await createPiModelFixture(directory);
  const files = [
    [path.join(directory, "node_modules", "package", "binding_test.js"), "test();\n"],
    [path.join(directory, "node_modules", "package", "next-test.js"), "export {};\n"],
    [path.join(directory, "node_modules", "package", "folder-test.svg"), "<svg />\n"],
    [path.join(directory, "node_modules", "package", "npm-shrinkwrap.json"), "{}\n"],
  ] as const;
  for (const [destination, content] of files) {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  const beforePrune = await collectRuntimeModelReadableResources(directory);
  await pruneRuntimeTree(directory, directory, {
    modelReadableResources: beforePrune.resources,
    resolvedExamplesRoot: beforePrune.resolvedExamplesRoot,
  });
  await access(path.join(examplesDirectory, "extensions", "example.ts"));
  await access(path.join(examplesDirectory, "binding_test.js"));
  await assert.rejects(lstat(path.join(examplesDirectory, "package-lock.json")), /ENOENT/u);
  await assert.rejects(lstat(path.join(packageDirectory, "docs", "guide.test.ts")), /ENOENT/u);
  await assert.rejects(
    lstat(path.join(directory, "node_modules", "package", "binding_test.js")),
    /ENOENT/u,
  );
  await assert.rejects(
    lstat(path.join(directory, "node_modules", "package", "next-test.js")),
    /ENOENT/u,
  );
  await access(path.join(directory, "node_modules", "package", "folder-test.svg"));
  await assert.rejects(
    lstat(path.join(directory, "node_modules", "package", "npm-shrinkwrap.json")),
    /ENOENT/u,
  );

  const afterPrune = await collectRuntimeModelReadableResources(directory);
  const allResources = [...afterPrune.resources, "node_modules/package/folder-test.svg"].sort();
  assert.doesNotThrow(() =>
    assertRuntimeModelReadableResourceClassification({
      resources: allResources,
      modelReadableResources: afterPrune.resources,
      expectedModelReadableResources: afterPrune.resources,
      resolvedExamplesRoot: afterPrune.resolvedExamplesRoot,
    }),
  );

  assert.throws(
    () =>
      assertRuntimeModelReadableResourceClassification({
        resources: allResources,
        modelReadableResources: afterPrune.resources.slice(1),
        expectedModelReadableResources: afterPrune.resources,
        resolvedExamplesRoot: afterPrune.resolvedExamplesRoot,
      }),
    /do not match/u,
  );
  assert.throws(
    () =>
      assertRuntimeModelReadableResourceClassification({
        resources: allResources,
        modelReadableResources: [...afterPrune.resources, "outside/not-in-resources.md"].sort(),
        expectedModelReadableResources: [
          ...afterPrune.resources,
          "outside/not-in-resources.md",
        ].sort(),
        resolvedExamplesRoot: afterPrune.resolvedExamplesRoot,
      }),
    /outside the final resources/u,
  );
  assert.throws(
    () =>
      assertRuntimeModelReadableResourceClassification({
        resources: [...allResources, "node_modules/package/leaked.ts"].sort(),
        modelReadableResources: afterPrune.resources,
        expectedModelReadableResources: afterPrune.resources,
        resolvedExamplesRoot: afterPrune.resolvedExamplesRoot,
      }),
    /outside Pi's resolved examples tree/u,
  );
});

test("rejects a symlink inside the Pi model-readable closure", async (t) => {
  const directory = await mkdtemp(path.join(temporaryRoot, "workbench-runtime-model-symlink-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const { packageDirectory } = await createPiModelFixture(directory);
  const outside = path.join(directory, "outside.md");
  await writeFile(outside, "outside\n");
  await symlink(outside, path.join(packageDirectory, "docs", "escaped.md"));
  await assert.rejects(
    () => collectRuntimeModelReadableResources(directory),
    /contains a symlink/u,
  );
});

async function createPublishFixture(): Promise<{
  readonly root: string;
  readonly repositoryRoot: string;
  readonly outputDirectory: string;
  readonly finalDirectory: string;
  readonly target: ReturnType<typeof currentNodeArtifactTarget>;
}> {
  const root = await mkdtemp(path.join(temporaryRoot, "workbench-runtime-publish-"));
  const repositoryRoot = path.join(root, "repository");
  const outputDirectory = path.join(root, "output");
  await mkdir(repositoryRoot);
  await mkdir(outputDirectory);
  const target = currentNodeArtifactTarget();
  return {
    root,
    repositoryRoot,
    outputDirectory,
    finalDirectory: outputDirectoryForTarget(target, outputDirectory),
    target,
  };
}

function publishFixtureManifest(target: ReturnType<typeof currentNodeArtifactTarget>) {
  return createRuntimeArtifactManifest(target, RUNTIME_ARTIFACT_EXTERNAL_PACKAGES, {
    path: RUNTIME_ARTIFACT_NATIVE_INVENTORY_FILENAME,
    size: 1,
    sha256: "0".repeat(64),
  });
}

async function writePublishCandidate(
  directory: string,
  target: ReturnType<typeof currentNodeArtifactTarget>,
  marker: string,
): Promise<void> {
  await writeFile(path.join(directory, "marker.txt"), marker, "utf8");
  await writeFile(
    path.join(directory, RUNTIME_ARTIFACT_MANIFEST_FILENAME),
    `${JSON.stringify(publishFixtureManifest(target))}\n`,
    "utf8",
  );
}

function acceptingFixtureResolver(target: ReturnType<typeof currentNodeArtifactTarget>) {
  const manifest = publishFixtureManifest(target);
  return async ({ manifestPath }: { readonly manifestPath: string }) => ({
    artifactRoot: path.dirname(manifestPath),
    manifestPath,
    entrypoint: path.join(path.dirname(manifestPath), manifest.entrypoint),
    manifest,
  });
}

async function assertOnlyFinalTargetRemains(
  outputDirectory: string,
  target: ReturnType<typeof currentNodeArtifactTarget>,
): Promise<void> {
  assert.deepEqual(await readdir(outputDirectory), [runtimeArtifactTargetKey(target)]);
}

test("an injected candidate build failure preserves the exact old target", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  await mkdir(fixture.finalDirectory);
  await writeFile(path.join(fixture.finalDirectory, "marker.txt"), "old", "utf8");

  await assert.rejects(
    buildRuntimeArtifact({
      target: fixture.target,
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
      testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
      buildImpl: async () => {
        throw new Error("injected build failure");
      },
    }),
    /injected build failure/u,
  );

  assert.equal(await readFile(path.join(fixture.finalDirectory, "marker.txt"), "utf8"), "old");
  await assertOnlyFinalTargetRemains(fixture.outputDirectory, fixture.target);
});

test("candidate admission rejection preserves the exact old target", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  await mkdir(fixture.finalDirectory);
  await writeFile(path.join(fixture.finalDirectory, "marker.txt"), "old", "utf8");

  await assert.rejects(
    publishRuntimeArtifactTransaction({
      target: fixture.target,
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
      testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
      buildTemporaryArtifact: (directory) =>
        writePublishCandidate(directory, fixture.target, "new"),
      resolveArtifactImpl: async () => {
        throw new Error("injected admission rejection");
      },
    }),
    /injected admission rejection/u,
  );

  assert.equal(await readFile(path.join(fixture.finalDirectory, "marker.txt"), "utf8"), "old");
  await assertOnlyFinalTargetRemains(fixture.outputDirectory, fixture.target);
});

test("rejects an existing final symlink before running the candidate build", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  const aliasedDirectory = path.join(fixture.root, "aliased-final");
  await mkdir(aliasedDirectory);
  await writeFile(path.join(aliasedDirectory, "marker.txt"), "old", "utf8");
  await symlink(aliasedDirectory, fixture.finalDirectory, "dir");
  let buildCalled = false;

  await assert.rejects(
    publishRuntimeArtifactTransaction({
      target: fixture.target,
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
      testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
      buildTemporaryArtifact: async () => {
        buildCalled = true;
      },
    }),
    /final target must be a regular directory and not a symbolic link/u,
  );

  assert.equal(buildCalled, false);
  assert.equal(await readFile(path.join(aliasedDirectory, "marker.txt"), "utf8"), "old");
  assert.equal(await realpath(fixture.finalDirectory), aliasedDirectory);
});

test("atomically publishes an admitted candidate and removes the old backup", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  await mkdir(fixture.finalDirectory);
  await writeFile(path.join(fixture.finalDirectory, "marker.txt"), "old", "utf8");
  let admissionCount = 0;
  let temporaryBasename = "";
  const accept = acceptingFixtureResolver(fixture.target);

  await publishRuntimeArtifactTransaction({
    target: fixture.target,
    repositoryRoot: fixture.repositoryRoot,
    outputDirectory: fixture.outputDirectory,
    testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
    buildTemporaryArtifact: (directory) => {
      temporaryBasename = path.basename(directory);
      return writePublishCandidate(directory, fixture.target, "new");
    },
    resolveArtifactImpl: async (options) => {
      admissionCount += 1;
      return accept(options);
    },
  });

  assert.match(temporaryBasename, /^\.t-[a-f0-9]{8}-[0-9]+-[a-f0-9]{8}$/u);
  assert.ok(temporaryBasename.length <= 32, "temporary roots must preserve native path budget");
  assert.equal(admissionCount, 2);
  assert.equal(await readFile(path.join(fixture.finalDirectory, "marker.txt"), "utf8"), "new");
  await assertOnlyFinalTargetRemains(fixture.outputDirectory, fixture.target);
});

test("backup cleanup failure never rolls back an admitted final target", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  await mkdir(fixture.finalDirectory);
  await writeFile(path.join(fixture.finalDirectory, "marker.txt"), "old", "utf8");
  const accept = acceptingFixtureResolver(fixture.target);

  await assert.rejects(
    publishRuntimeArtifactTransaction({
      target: fixture.target,
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
      testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
      buildTemporaryArtifact: (directory) =>
        writePublishCandidate(directory, fixture.target, "new"),
      resolveArtifactImpl: accept,
      testOnlyRemoveOwnedDirectoryImpl: async () => {
        throw new Error("injected backup cleanup failure");
      },
    }),
    /published and admitted, but its old backup could not be cleaned/u,
  );

  assert.equal(await readFile(path.join(fixture.finalDirectory, "marker.txt"), "utf8"), "new");
  const entries = await readdir(fixture.outputDirectory);
  const backup = entries.find((entry) => entry.endsWith(".backup"));
  assert.ok(backup);
  assert.equal(entries.length, 2);
  assert.equal(
    await readFile(path.join(fixture.outputDirectory, backup, "marker.txt"), "utf8"),
    "old",
  );
});

test("post-publish admission failure rolls back the exact old target", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  await mkdir(fixture.finalDirectory);
  await writeFile(path.join(fixture.finalDirectory, "marker.txt"), "old", "utf8");
  let admissionCount = 0;
  const accept = acceptingFixtureResolver(fixture.target);

  await assert.rejects(
    publishRuntimeArtifactTransaction({
      target: fixture.target,
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
      testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
      buildTemporaryArtifact: (directory) =>
        writePublishCandidate(directory, fixture.target, "new"),
      resolveArtifactImpl: async (options) => {
        admissionCount += 1;
        if (admissionCount === 2) throw new Error("injected post-publish rejection");
        return accept(options);
      },
    }),
    /injected post-publish rejection/u,
  );

  assert.equal(admissionCount, 2);
  assert.equal(await readFile(path.join(fixture.finalDirectory, "marker.txt"), "utf8"), "old");
  await assertOnlyFinalTargetRemains(fixture.outputDirectory, fixture.target);
});

test("rejects a temporary target replaced by the candidate builder", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  await mkdir(fixture.finalDirectory);
  await writeFile(path.join(fixture.finalDirectory, "marker.txt"), "old", "utf8");
  const displacedBuiltTemporary = path.join(fixture.root, "built-temporary");
  let resolverCalled = false;

  await assert.rejects(
    publishRuntimeArtifactTransaction({
      target: fixture.target,
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
      testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
      buildTemporaryArtifact: async (directory) => {
        await writePublishCandidate(directory, fixture.target, "built-candidate");
        await rename(directory, displacedBuiltTemporary);
        await mkdir(directory);
        await writePublishCandidate(directory, fixture.target, "builder-replacement");
      },
      resolveArtifactImpl: async () => {
        resolverCalled = true;
        throw new Error("resolver must not admit a replaced build target");
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /rollback was incomplete/u);
      assert.match(String(error.errors[0]), /Built Runtime artifact temporary target changed/u);
      return true;
    },
  );

  assert.equal(resolverCalled, false);
  assert.equal(await readFile(path.join(fixture.finalDirectory, "marker.txt"), "utf8"), "old");
  assert.equal(
    await readFile(path.join(displacedBuiltTemporary, "marker.txt"), "utf8"),
    "built-candidate",
  );
});

test("fails closed when the admitted temporary target is replaced during admission", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  await mkdir(fixture.finalDirectory);
  await writeFile(path.join(fixture.finalDirectory, "marker.txt"), "old", "utf8");
  const accept = acceptingFixtureResolver(fixture.target);
  const displacedTemporary = path.join(fixture.root, "admitted-temporary");

  await assert.rejects(
    publishRuntimeArtifactTransaction({
      target: fixture.target,
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
      testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
      buildTemporaryArtifact: (directory) =>
        writePublishCandidate(directory, fixture.target, "admitted-new"),
      resolveArtifactImpl: async (options) => {
        const resolved = await accept(options);
        const admittedDirectory = path.dirname(options.manifestPath);
        await rename(admittedDirectory, displacedTemporary);
        await mkdir(admittedDirectory);
        await writePublishCandidate(admittedDirectory, fixture.target, "unadmitted-replacement");
        return resolved;
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /rollback was incomplete/u);
      assert.match(String(error.errors[0]), /Admitted Runtime artifact temporary target changed/u);
      return true;
    },
  );

  assert.equal(await readFile(path.join(fixture.finalDirectory, "marker.txt"), "utf8"), "old");
  assert.equal(await readFile(path.join(displacedTemporary, "marker.txt"), "utf8"), "admitted-new");
});

test("does not commit a replacement published final or remove its known-good backup", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  await mkdir(fixture.finalDirectory);
  await writeFile(path.join(fixture.finalDirectory, "marker.txt"), "old", "utf8");
  const accept = acceptingFixtureResolver(fixture.target);
  const displacedPublishedFinal = path.join(fixture.root, "admitted-published-final");
  const backupPath = path.join(
    fixture.outputDirectory,
    `.${runtimeArtifactTargetKey(fixture.target)}.backup`,
  );
  let admissionCount = 0;

  await assert.rejects(
    publishRuntimeArtifactTransaction({
      target: fixture.target,
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
      testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
      buildTemporaryArtifact: (directory) =>
        writePublishCandidate(directory, fixture.target, "admitted-new"),
      resolveArtifactImpl: async (options) => {
        admissionCount += 1;
        const resolved = await accept(options);
        if (admissionCount === 2) {
          await rename(fixture.finalDirectory, displacedPublishedFinal);
          await mkdir(fixture.finalDirectory);
          await writePublishCandidate(
            fixture.finalDirectory,
            fixture.target,
            "unadmitted-replacement",
          );
        }
        return resolved;
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /rollback was incomplete/u);
      assert.match(String(error.errors[0]), /Admitted published Runtime artifact target changed/u);
      return true;
    },
  );

  assert.equal(admissionCount, 2);
  assert.equal(
    await readFile(path.join(fixture.finalDirectory, "marker.txt"), "utf8"),
    "unadmitted-replacement",
  );
  assert.equal(await readFile(path.join(backupPath, "marker.txt"), "utf8"), "old");
  assert.equal(
    await readFile(path.join(displacedPublishedFinal, "marker.txt"), "utf8"),
    "admitted-new",
  );
});

test("does not commit when the known-good backup is replaced during final admission", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  await mkdir(fixture.finalDirectory);
  await writeFile(path.join(fixture.finalDirectory, "marker.txt"), "old", "utf8");
  const accept = acceptingFixtureResolver(fixture.target);
  const backupPath = path.join(
    fixture.outputDirectory,
    `.${runtimeArtifactTargetKey(fixture.target)}.backup`,
  );
  const displacedBackup = path.join(fixture.root, "known-good-backup");
  let admissionCount = 0;

  await assert.rejects(
    publishRuntimeArtifactTransaction({
      target: fixture.target,
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
      testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
      buildTemporaryArtifact: (directory) =>
        writePublishCandidate(directory, fixture.target, "admitted-new"),
      resolveArtifactImpl: async (options) => {
        admissionCount += 1;
        const resolved = await accept(options);
        if (admissionCount === 2) {
          await rename(backupPath, displacedBackup);
          await mkdir(backupPath);
          await writePublishCandidate(backupPath, fixture.target, "unadmitted-backup");
        }
        return resolved;
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /rollback was incomplete/u);
      assert.match(String(error.errors[0]), /Admitted Runtime artifact backup target changed/u);
      return true;
    },
  );

  assert.equal(admissionCount, 2);
  await assert.rejects(lstat(fixture.finalDirectory), /ENOENT/u);
  assert.equal(await readFile(path.join(displacedBackup, "marker.txt"), "utf8"), "old");
  assert.equal(await readFile(path.join(backupPath, "marker.txt"), "utf8"), "unadmitted-backup");
});

test("recovers one admitted legacy backup after an interrupted locked publish", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  const targetKey = runtimeArtifactTargetKey(fixture.target);
  const interruptedBackup = path.join(
    fixture.outputDirectory,
    `.${targetKey}.backup-1234-interrupted`,
  );
  await mkdir(interruptedBackup);
  await writePublishCandidate(interruptedBackup, fixture.target, "old");

  const staleLock = path.join(fixture.outputDirectory, `.${targetKey}.publish-lock`);
  await mkdir(staleLock);
  await writeFile(
    path.join(staleLock, "owner.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      targetKey,
      pid: 424_242,
      ownerId: "interrupted-publisher",
      acquiredAt: new Date(0).toISOString(),
    })}\n`,
    "utf8",
  );

  const admittedRoots: string[] = [];
  const accept = acceptingFixtureResolver(fixture.target);
  await publishRuntimeArtifactTransaction({
    target: fixture.target,
    repositoryRoot: fixture.repositoryRoot,
    outputDirectory: fixture.outputDirectory,
    testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
    testOnlyProcessIsAliveImpl: (pid) => pid !== 424_242,
    buildTemporaryArtifact: (directory) => writePublishCandidate(directory, fixture.target, "new"),
    resolveArtifactImpl: async (options) => {
      admittedRoots.push(path.dirname(options.manifestPath));
      return accept(options);
    },
  });

  assert.deepEqual(admittedRoots.slice(0, 2), [interruptedBackup, fixture.finalDirectory]);
  assert.equal(admittedRoots.length, 4);
  assert.equal(await readFile(path.join(fixture.finalDirectory, "marker.txt"), "utf8"), "new");
  await assertOnlyFinalTargetRemains(fixture.outputDirectory, fixture.target);
});

test("atomically claims an ownerless lock left before owner initialization", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  const targetKey = runtimeArtifactTargetKey(fixture.target);
  await mkdir(path.join(fixture.outputDirectory, `.${targetKey}.publish-lock`));

  await publishRuntimeArtifactTransaction({
    target: fixture.target,
    repositoryRoot: fixture.repositoryRoot,
    outputDirectory: fixture.outputDirectory,
    testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
    resolveArtifactImpl: acceptingFixtureResolver(fixture.target),
    buildTemporaryArtifact: (directory) => writePublishCandidate(directory, fixture.target, "new"),
  });

  assert.equal(await readFile(path.join(fixture.finalDirectory, "marker.txt"), "utf8"), "new");
  await assertOnlyFinalTargetRemains(fixture.outputDirectory, fixture.target);
});

test("never exposes a partial canonical owner when interrupted before hard-link publication", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  let interrupted = false;

  await assert.rejects(
    publishRuntimeArtifactTransaction({
      target: fixture.target,
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
      testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
      testOnlyBeforeOwnerClaimLinkImpl: ({ filename }) => {
        if (filename === "owner.json" && !interrupted) {
          interrupted = true;
          throw new Error("injected pre-link owner interruption");
        }
      },
      buildTemporaryArtifact: async () => {
        throw new Error("build must not start before owner publication");
      },
    }),
    /injected pre-link owner interruption/u,
  );

  assert.equal(interrupted, true);
  assert.deepEqual(await readdir(fixture.outputDirectory), []);

  await publishRuntimeArtifactTransaction({
    target: fixture.target,
    repositoryRoot: fixture.repositoryRoot,
    outputDirectory: fixture.outputDirectory,
    testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
    resolveArtifactImpl: acceptingFixtureResolver(fixture.target),
    buildTemporaryArtifact: (directory) => writePublishCandidate(directory, fixture.target, "new"),
  });
  await assertOnlyFinalTargetRemains(fixture.outputDirectory, fixture.target);
});

test("fails closed without mutating a partial legacy canonical owner", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  const targetKey = runtimeArtifactTargetKey(fixture.target);
  const staleLock = path.join(fixture.outputDirectory, `.${targetKey}.publish-lock`);
  await mkdir(staleLock);
  await writeFile(path.join(staleLock, "owner.json"), '{"schemaVersion":', "utf8");
  let buildCalled = false;

  await assert.rejects(
    publishRuntimeArtifactTransaction({
      target: fixture.target,
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
      testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
      buildTemporaryArtifact: async () => {
        buildCalled = true;
      },
    }),
    /incomplete or invalid/u,
  );

  assert.equal(buildCalled, false);
  assert.deepEqual(await readdir(staleLock), ["owner.json"]);
  assert.equal(await readFile(path.join(staleLock, "owner.json"), "utf8"), '{"schemaVersion":');
});

test("supersedes a dead recovery claim without stealing a live lock", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  const targetKey = runtimeArtifactTargetKey(fixture.target);
  const staleLock = path.join(fixture.outputDirectory, `.${targetKey}.publish-lock`);
  await mkdir(staleLock);
  await writeFile(
    path.join(staleLock, "owner.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      targetKey,
      pid: 424_242,
      ownerId: "interrupted-publisher",
      acquiredAt: new Date(0).toISOString(),
    })}\n`,
    "utf8",
  );
  const staleLockStats = await lstat(staleLock);
  const recoveryFilename = `recovery-owner-${staleLockStats.dev.toString(16)}-${staleLockStats.ino.toString(16)}.json`;
  await writeFile(
    path.join(staleLock, recoveryFilename),
    `${JSON.stringify({
      schemaVersion: 1,
      targetKey,
      pid: 424_243,
      ownerId: "interrupted-recovery-owner",
      acquiredAt: new Date(1).toISOString(),
    })}\n`,
    "utf8",
  );

  await publishRuntimeArtifactTransaction({
    target: fixture.target,
    repositoryRoot: fixture.repositoryRoot,
    outputDirectory: fixture.outputDirectory,
    testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
    testOnlyProcessIsAliveImpl: (pid) => pid === process.pid,
    resolveArtifactImpl: acceptingFixtureResolver(fixture.target),
    buildTemporaryArtifact: (directory) => writePublishCandidate(directory, fixture.target, "new"),
  });

  assert.equal(await readFile(path.join(fixture.finalDirectory, "marker.txt"), "utf8"), "new");
  await assertOnlyFinalTargetRemains(fixture.outputDirectory, fixture.target);
});

test("never exposes a partial recovery claim when interrupted before hard-link publication", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  const targetKey = runtimeArtifactTargetKey(fixture.target);
  const staleLock = path.join(fixture.outputDirectory, `.${targetKey}.publish-lock`);
  await mkdir(staleLock);
  await writeFile(
    path.join(staleLock, "owner.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      targetKey,
      pid: 424_245,
      ownerId: "interrupted-publisher",
      acquiredAt: new Date(0).toISOString(),
    })}\n`,
    "utf8",
  );
  let interrupted = false;

  await assert.rejects(
    publishRuntimeArtifactTransaction({
      target: fixture.target,
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
      testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
      testOnlyProcessIsAliveImpl: (pid) => pid === process.pid,
      testOnlyBeforeOwnerClaimLinkImpl: ({ filename }) => {
        if (filename.startsWith("recovery-owner-") && !interrupted) {
          interrupted = true;
          throw new Error("injected pre-link recovery interruption");
        }
      },
      buildTemporaryArtifact: async () => {
        throw new Error("build must not start before recovery claim publication");
      },
    }),
    /injected pre-link recovery interruption/u,
  );

  assert.equal(interrupted, true);
  assert.deepEqual(await readdir(staleLock), ["owner.json"]);

  await publishRuntimeArtifactTransaction({
    target: fixture.target,
    repositoryRoot: fixture.repositoryRoot,
    outputDirectory: fixture.outputDirectory,
    testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
    testOnlyProcessIsAliveImpl: (pid) => pid === process.pid,
    resolveArtifactImpl: acceptingFixtureResolver(fixture.target),
    buildTemporaryArtifact: (directory) => writePublishCandidate(directory, fixture.target, "new"),
  });
  await assertOnlyFinalTargetRemains(fixture.outputDirectory, fixture.target);
});

test("fails closed without mutating a partial legacy canonical recovery claim", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  const targetKey = runtimeArtifactTargetKey(fixture.target);
  const staleLock = path.join(fixture.outputDirectory, `.${targetKey}.publish-lock`);
  await mkdir(staleLock);
  await writeFile(
    path.join(staleLock, "owner.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      targetKey,
      pid: 424_246,
      ownerId: "interrupted-publisher",
      acquiredAt: new Date(0).toISOString(),
    })}\n`,
    "utf8",
  );
  const staleLockStats = await lstat(staleLock);
  const recoveryFilename = `recovery-owner-${staleLockStats.dev.toString(16)}-${staleLockStats.ino.toString(16)}.json`;
  await writeFile(path.join(staleLock, recoveryFilename), "{", "utf8");
  let buildCalled = false;

  await assert.rejects(
    publishRuntimeArtifactTransaction({
      target: fixture.target,
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
      testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
      testOnlyProcessIsAliveImpl: () => false,
      buildTemporaryArtifact: async () => {
        buildCalled = true;
      },
    }),
    /incomplete or invalid/u,
  );

  assert.equal(buildCalled, false);
  assert.deepEqual((await readdir(staleLock)).sort(), ["owner.json", recoveryFilename].sort());
  assert.equal(await readFile(path.join(staleLock, recoveryFilename), "utf8"), "{");
});

test("resolves deterministic final-plus-backup interruption states by admission", async (t) => {
  await t.test("keeps an admitted final and removes its prior generation", async (t) => {
    const fixture = await createPublishFixture();
    t.after(() => rm(fixture.root, { force: true, recursive: true }));
    const backupPath = path.join(
      fixture.outputDirectory,
      `.${runtimeArtifactTargetKey(fixture.target)}.backup`,
    );
    await mkdir(fixture.finalDirectory);
    await writePublishCandidate(fixture.finalDirectory, fixture.target, "committed");
    await mkdir(backupPath);
    await writePublishCandidate(backupPath, fixture.target, "old");
    const accept = acceptingFixtureResolver(fixture.target);
    const admittedMarkers: string[] = [];

    await publishRuntimeArtifactTransaction({
      target: fixture.target,
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
      testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
      resolveArtifactImpl: async (options) => {
        admittedMarkers.push(
          await readFile(path.join(path.dirname(options.manifestPath), "marker.txt"), "utf8"),
        );
        return accept(options);
      },
      buildTemporaryArtifact: (directory) =>
        writePublishCandidate(directory, fixture.target, "new"),
    });

    assert.deepEqual(admittedMarkers, ["committed", "old", "new", "new"]);
    assert.equal(await readFile(path.join(fixture.finalDirectory, "marker.txt"), "utf8"), "new");
    await assertOnlyFinalTargetRemains(fixture.outputDirectory, fixture.target);
  });

  await t.test("restores an admitted backup when the interrupted final is invalid", async (t) => {
    const fixture = await createPublishFixture();
    t.after(() => rm(fixture.root, { force: true, recursive: true }));
    const backupPath = path.join(
      fixture.outputDirectory,
      `.${runtimeArtifactTargetKey(fixture.target)}.backup`,
    );
    await mkdir(fixture.finalDirectory);
    await writePublishCandidate(fixture.finalDirectory, fixture.target, "invalid");
    await mkdir(backupPath);
    await writePublishCandidate(backupPath, fixture.target, "old");
    const accept = acceptingFixtureResolver(fixture.target);
    const admittedMarkers: string[] = [];

    await assert.rejects(
      publishRuntimeArtifactTransaction({
        target: fixture.target,
        repositoryRoot: fixture.repositoryRoot,
        outputDirectory: fixture.outputDirectory,
        testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
        resolveArtifactImpl: async (options) => {
          const marker = await readFile(
            path.join(path.dirname(options.manifestPath), "marker.txt"),
            "utf8",
          );
          admittedMarkers.push(marker);
          if (marker === "invalid") throw new Error("injected invalid interrupted final");
          return accept(options);
        },
        buildTemporaryArtifact: async () => {
          throw new Error("stop after interrupted generation recovery");
        },
      }),
      /stop after interrupted generation recovery/u,
    );

    assert.deepEqual(admittedMarkers, ["invalid", "old", "old"]);
    assert.equal(await readFile(path.join(fixture.finalDirectory, "marker.txt"), "utf8"), "old");
    await assertOnlyFinalTargetRemains(fixture.outputDirectory, fixture.target);
  });

  await t.test("fails closed when neither generation is admissible", async (t) => {
    const fixture = await createPublishFixture();
    t.after(() => rm(fixture.root, { force: true, recursive: true }));
    const backupPath = path.join(
      fixture.outputDirectory,
      `.${runtimeArtifactTargetKey(fixture.target)}.backup`,
    );
    await mkdir(fixture.finalDirectory);
    await writePublishCandidate(fixture.finalDirectory, fixture.target, "invalid-final");
    await mkdir(backupPath);
    await writePublishCandidate(backupPath, fixture.target, "invalid-backup");
    let buildCalled = false;

    await assert.rejects(
      publishRuntimeArtifactTransaction({
        target: fixture.target,
        repositoryRoot: fixture.repositoryRoot,
        outputDirectory: fixture.outputDirectory,
        testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
        resolveArtifactImpl: async () => {
          throw new Error("injected invalid interrupted generation");
        },
        buildTemporaryArtifact: async () => {
          buildCalled = true;
        },
      }),
      /Neither interrupted Runtime artifact generation is admissible/u,
    );

    assert.equal(buildCalled, false);
    assert.equal(
      await readFile(path.join(fixture.finalDirectory, "marker.txt"), "utf8"),
      "invalid-final",
    );
    assert.equal(await readFile(path.join(backupPath, "marker.txt"), "utf8"), "invalid-backup");
  });
});

test("rechecks the output root inode inside the acquired lock before recovery", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  const targetKey = runtimeArtifactTargetKey(fixture.target);
  const staleLock = path.join(fixture.outputDirectory, `.${targetKey}.publish-lock`);
  await mkdir(staleLock);
  await writeFile(
    path.join(staleLock, "owner.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      targetKey,
      pid: 424_244,
      ownerId: "root-swap-trigger",
      acquiredAt: new Date(0).toISOString(),
    })}\n`,
    "utf8",
  );
  const displacedOutput = path.join(fixture.root, "displaced-output");
  const replacementOutput = path.join(fixture.root, "replacement-output");
  const replacementBackup = path.join(replacementOutput, `.${targetKey}.backup`);
  await mkdir(replacementOutput);
  await mkdir(replacementBackup);
  await writePublishCandidate(replacementBackup, fixture.target, "must-not-be-recovered");
  let rootSwapped = false;
  let buildCalled = false;

  await assert.rejects(
    publishRuntimeArtifactTransaction({
      target: fixture.target,
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
      testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
      testOnlyProcessIsAliveImpl: (pid) => {
        assert.equal(pid, 424_244);
        renameSync(fixture.outputDirectory, displacedOutput);
        renameSync(replacementOutput, fixture.outputDirectory);
        rootSwapped = true;
        return false;
      },
      buildTemporaryArtifact: async () => {
        buildCalled = true;
      },
    }),
    /Runtime artifact output root changed during/u,
  );

  assert.equal(rootSwapped, true);
  assert.equal(buildCalled, false);
  assert.equal(
    await readFile(
      path.join(fixture.outputDirectory, `.${targetKey}.backup`, "marker.txt"),
      "utf8",
    ),
    "must-not-be-recovered",
  );
});

test("serializes overlapping publishers for the same target", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  const accept = acceptingFixtureResolver(fixture.target);
  let firstBuildStarted!: () => void;
  let releaseFirstBuild!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    firstBuildStarted = resolve;
  });
  const firstRelease = new Promise<void>((resolve) => {
    releaseFirstBuild = resolve;
  });
  let secondObservedLiveLock!: () => void;
  const secondWaiting = new Promise<void>((resolve) => {
    secondObservedLiveLock = resolve;
  });
  let secondBuildStarted = false;

  const firstPublish = publishRuntimeArtifactTransaction({
    target: fixture.target,
    repositoryRoot: fixture.repositoryRoot,
    outputDirectory: fixture.outputDirectory,
    testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
    resolveArtifactImpl: accept,
    buildTemporaryArtifact: async (directory) => {
      firstBuildStarted();
      await firstRelease;
      await writePublishCandidate(directory, fixture.target, "first");
    },
  });
  await firstStarted;

  const secondPublish = publishRuntimeArtifactTransaction({
    target: fixture.target,
    repositoryRoot: fixture.repositoryRoot,
    outputDirectory: fixture.outputDirectory,
    testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
    resolveArtifactImpl: accept,
    testOnlyProcessIsAliveImpl: (pid) => {
      assert.equal(pid, process.pid);
      secondObservedLiveLock();
      return true;
    },
    buildTemporaryArtifact: async (directory) => {
      secondBuildStarted = true;
      await writePublishCandidate(directory, fixture.target, "second");
    },
  });
  await secondWaiting;
  assert.equal(secondBuildStarted, false);
  releaseFirstBuild();

  await Promise.all([firstPublish, secondPublish]);
  assert.equal(secondBuildStarted, true);
  assert.equal(await readFile(path.join(fixture.finalDirectory, "marker.txt"), "utf8"), "second");
  await assertOnlyFinalTargetRemains(fixture.outputDirectory, fixture.target);
});

test("fails closed on ambiguous, non-directory, or invalid recovery backups", async (t) => {
  await t.test("multiple backup candidates", async (t) => {
    const fixture = await createPublishFixture();
    t.after(() => rm(fixture.root, { force: true, recursive: true }));
    const backupName = `.${runtimeArtifactTargetKey(fixture.target)}.backup`;
    await mkdir(path.join(fixture.outputDirectory, backupName));
    await mkdir(path.join(fixture.outputDirectory, `${backupName}-legacy`));
    let buildCalled = false;

    await assert.rejects(
      publishRuntimeArtifactTransaction({
        target: fixture.target,
        repositoryRoot: fixture.repositoryRoot,
        outputDirectory: fixture.outputDirectory,
        testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
        buildTemporaryArtifact: async () => {
          buildCalled = true;
        },
      }),
      /multiple backup candidates/u,
    );
    assert.equal(buildCalled, false);
  });

  await t.test("non-directory backup candidate", async (t) => {
    const fixture = await createPublishFixture();
    t.after(() => rm(fixture.root, { force: true, recursive: true }));
    const backupPath = path.join(
      fixture.outputDirectory,
      `.${runtimeArtifactTargetKey(fixture.target)}.backup`,
    );
    await writeFile(backupPath, "not a directory", "utf8");
    let buildCalled = false;

    await assert.rejects(
      publishRuntimeArtifactTransaction({
        target: fixture.target,
        repositoryRoot: fixture.repositoryRoot,
        outputDirectory: fixture.outputDirectory,
        testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
        buildTemporaryArtifact: async () => {
          buildCalled = true;
        },
      }),
      /must be a regular directory/u,
    );
    assert.equal(buildCalled, false);
  });

  await t.test("backup rejected by public admission", async (t) => {
    const fixture = await createPublishFixture();
    t.after(() => rm(fixture.root, { force: true, recursive: true }));
    const backupPath = path.join(
      fixture.outputDirectory,
      `.${runtimeArtifactTargetKey(fixture.target)}.backup`,
    );
    await mkdir(backupPath);
    await writePublishCandidate(backupPath, fixture.target, "old");
    let buildCalled = false;

    await assert.rejects(
      publishRuntimeArtifactTransaction({
        target: fixture.target,
        repositoryRoot: fixture.repositoryRoot,
        outputDirectory: fixture.outputDirectory,
        testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
        resolveArtifactImpl: async () => {
          throw new Error("injected invalid recovery backup");
        },
        buildTemporaryArtifact: async () => {
          buildCalled = true;
        },
      }),
      /injected invalid recovery backup/u,
    );
    assert.equal(buildCalled, false);
    assert.equal(await readFile(path.join(backupPath, "marker.txt"), "utf8"), "old");
  });
});

test("default output authority rejects wrong and aliased roots before building", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.root, { force: true, recursive: true }));
  let buildCalled = false;
  const buildTemporaryArtifact = async () => {
    buildCalled = true;
  };

  await assert.rejects(
    publishRuntimeArtifactTransaction({
      target: fixture.target,
      outputDirectory: fixture.outputDirectory,
      buildTemporaryArtifact,
    }),
    /output owner must be exactly/u,
  );
  await assert.rejects(
    publishRuntimeArtifactTransaction({
      target: fixture.target,
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: `${fixture.outputDirectory}/../${path.basename(fixture.outputDirectory)}`,
      testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_RUNTIME_ARTIFACT_OUTPUT,
      buildTemporaryArtifact,
    }),
    /canonical path without aliases/u,
  );
  assert.equal(buildCalled, false);
});

test("rejects a package-internal symlink escaping its canonical package owner", async (t) => {
  const repositoryRoot = await mkdtemp(path.join(temporaryRoot, "workbench-package-provenance-"));
  t.after(() => rm(repositoryRoot, { force: true, recursive: true }));
  const packageDirectory = path.join(repositoryRoot, "node_modules", "package");
  const siblingFile = path.join(repositoryRoot, "outside-package.txt");
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(path.join(packageDirectory, "index.js"), "export {};\n", "utf8");
  await writeFile(siblingFile, "outside package\n", "utf8");
  await symlink(siblingFile, path.join(packageDirectory, "escaped.js"));

  await assert.rejects(
    () => assertPackageOverlaySourceProvenance(packageDirectory, repositoryRoot),
    /escapes its canonical package\/repository/u,
  );
});
