import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MATERIALIZED_TREE_ALGORITHM,
  digestLinkFreeTree,
  materializeLinkFreeTree,
  nodeTargetFromIdentity,
  parseTauriSidecarEnvelope,
  stageTauriSidecarEnvelope,
  tauriExternalBinaryFilename,
  type RuntimeArtifactProducerRequest,
  type StageTauriSidecarOptions,
} from "../scripts/tauri-sidecar-envelope";
import { main as stageTauriSidecarMain } from "../scripts/stage-tauri-sidecar-envelope";
import {
  RUNTIME_ARTIFACT_MANIFEST_FILENAME,
  runtimeArtifactTargetKey,
  type RuntimeArtifactManifest,
} from "@workbench/host-contracts/runtime-artifact-manifest";
import type {
  ResolvedRuntimeArtifact,
  RuntimeProcessIdentity,
} from "@workbench/host-server/runtime-artifact";

const TEST_IDENTITY = Object.freeze({
  runtimeFlavor: "node" as const,
  platform: "linux" as const,
  arch: "x64",
  libc: "glibc" as const,
  nodeVersion: "24.16.0",
  nodeModuleAbi: 137,
  napiVersion: 10,
}) satisfies RuntimeProcessIdentity;

test("derives the exact Tauri sidecar filename for every desktop target", () => {
  const cases = [
    ["darwin", "x64", "none", "x86_64-apple-darwin", "workbench-runtime-node-x86_64-apple-darwin"],
    [
      "darwin",
      "arm64",
      "none",
      "aarch64-apple-darwin",
      "workbench-runtime-node-aarch64-apple-darwin",
    ],
    [
      "win32",
      "x64",
      "none",
      "x86_64-pc-windows-msvc",
      "workbench-runtime-node-x86_64-pc-windows-msvc.exe",
    ],
    [
      "win32",
      "arm64",
      "none",
      "aarch64-pc-windows-msvc",
      "workbench-runtime-node-aarch64-pc-windows-msvc.exe",
    ],
    [
      "linux",
      "x64",
      "glibc",
      "x86_64-unknown-linux-gnu",
      "workbench-runtime-node-x86_64-unknown-linux-gnu",
    ],
    [
      "linux",
      "arm64",
      "glibc",
      "aarch64-unknown-linux-gnu",
      "workbench-runtime-node-aarch64-unknown-linux-gnu",
    ],
    [
      "linux",
      "x64",
      "musl",
      "x86_64-unknown-linux-musl",
      "workbench-runtime-node-x86_64-unknown-linux-musl",
    ],
    [
      "linux",
      "arm64",
      "musl",
      "aarch64-unknown-linux-musl",
      "workbench-runtime-node-aarch64-unknown-linux-musl",
    ],
  ] as const;

  for (const [platform, arch, libc, targetTriple, filename] of cases) {
    const target = nodeTargetFromIdentity({ ...TEST_IDENTITY, platform, arch, libc });
    assert.equal(target.targetTriple, targetTriple);
    assert.equal(tauriExternalBinaryFilename(target), filename);
  }
});

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function temporaryDirectory(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-tauri-sidecar-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function assertLinkFree(directory: string): Promise<void> {
  for (const name of await readdir(directory)) {
    const entry = path.join(directory, name);
    const stats = await lstat(entry);
    assert.equal(stats.isSymbolicLink(), false, entry);
    assert.equal(stats.isFile() || stats.isDirectory(), true, entry);
    if (stats.isDirectory()) await assertLinkFree(entry);
  }
}

interface StagingFixture {
  readonly root: string;
  readonly repositoryRoot: string;
  readonly runtimeArtifactRoot: string;
  readonly artifactRoot: string;
  readonly manifestPath: string;
  readonly tauriSourceRoot: string;
  readonly nodeExecutable: string;
  readonly target: ReturnType<typeof nodeTargetFromIdentity>;
  readonly manifest: RuntimeArtifactManifest;
  readonly producerCalls: RuntimeArtifactProducerRequest[];
  readonly options: StageTauriSidecarOptions;
}

async function createStagingFixture(t: test.TestContext): Promise<StagingFixture> {
  const root = await temporaryDirectory(t);
  const repositoryRoot = path.join(root, "repository");
  const runtimeArtifactRoot = path.join(repositoryRoot, ".desktop-build", "runtime-node");
  const tauriSourceRoot = path.join(repositoryRoot, "apps", "desktop-tauri", "src-tauri");
  const target = nodeTargetFromIdentity(TEST_IDENTITY);
  const artifactRoot = path.join(runtimeArtifactRoot, runtimeArtifactTargetKey(target));
  const manifestPath = path.join(artifactRoot, RUNTIME_ARTIFACT_MANIFEST_FILENAME);
  const nodeExecutable = path.join(root, "node");
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(tauriSourceRoot, { recursive: true });
  await mkdir(path.join(artifactRoot, "payload"));
  await writeFile(path.join(artifactRoot, "server.mjs"), "export const runtime = true;\n");
  await writeFile(path.join(artifactRoot, "payload", "data.txt"), "runtime payload\n");
  await symlink("payload/data.txt", path.join(artifactRoot, "data-link.txt"));
  await symlink("payload", path.join(artifactRoot, "payload-link"));
  const manifest = {
    schemaVersion: 2,
    artifactKind: "workbench-runtime-node",
    runtimeMode: "api-only",
    controlVersion: 1,
    hostProtocolVersion: 1,
    target,
    entrypoint: "server.mjs",
    externalPackages: [],
    dynamicPackages: [],
    resources: [],
    modelReadableResources: [],
    nativePackages: [],
    nativeInventory: { path: "native-runtime-inventory.json", size: 1, sha256: "0".repeat(64) },
    links: [],
    upgradeRequiredPaths: [],
  } as unknown as RuntimeArtifactManifest;
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  await writeFile(nodeExecutable, "injected node executable\n", { mode: 0o755 });
  await chmod(nodeExecutable, 0o755);
  const producerCalls: RuntimeArtifactProducerRequest[] = [];
  const resolveArtifact = async ({
    manifestPath: requestedManifest,
  }: {
    readonly manifestPath: string;
  }): Promise<ResolvedRuntimeArtifact> => {
    assert.equal(requestedManifest, manifestPath);
    return Object.freeze({
      artifactRoot,
      manifestPath,
      entrypoint: path.join(artifactRoot, "server.mjs"),
      manifest,
    });
  };
  const options = Object.freeze({
    repositoryRoot,
    runtimeArtifactRoot,
    tauriSourceRoot,
    nodeExecutable,
    expectedProcessExecutable: nodeExecutable,
    processIdentity: TEST_IDENTITY,
    probeNodeIdentity: async () => TEST_IDENTITY,
    runProducer: async (request: RuntimeArtifactProducerRequest) => {
      producerCalls.push(request);
    },
    resolveArtifact,
    environment: Object.freeze({
      WORKBENCH_TEST: "1",
      npm_execpath: "/virtual/pnpm.cjs",
    }),
  }) satisfies StageTauriSidecarOptions;
  return {
    root,
    repositoryRoot,
    runtimeArtifactRoot,
    artifactRoot,
    manifestPath,
    tauriSourceRoot,
    nodeExecutable,
    target,
    manifest,
    producerCalls,
    options,
  };
}

async function outputSnapshot(fixture: StagingFixture): Promise<string> {
  const binaries = await digestLinkFreeTree(path.join(fixture.tauriSourceRoot, "binaries"));
  const runtime = await digestLinkFreeTree(
    path.join(fixture.tauriSourceRoot, "resources", "runtime"),
  );
  return JSON.stringify({ binaries, runtime });
}

test("materializes file and directory links into a deterministic link-free tree", async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, "source");
  const first = path.join(root, "first");
  const second = path.join(root, "second");
  await mkdir(path.join(source, "payload"), { recursive: true });
  await writeFile(path.join(source, "payload", "data.txt"), "payload\n", { mode: 0o640 });
  await chmod(path.join(source, "payload", "data.txt"), 0o640);
  await symlink("payload/data.txt", path.join(source, "file-link"));
  await symlink("payload", path.join(source, "directory-link"));

  const firstDigest = await materializeLinkFreeTree(source, first);
  const secondDigest = await materializeLinkFreeTree(source, second);

  assert.deepEqual(firstDigest, secondDigest);
  assert.equal(firstDigest.algorithm, "sha256-utf8-path-type-size-content-v1");
  assert.equal(firstDigest.algorithm, MATERIALIZED_TREE_ALGORITHM);
  assert.equal(await readFile(path.join(first, "file-link"), "utf8"), "payload\n");
  assert.equal(await readFile(path.join(first, "directory-link", "data.txt"), "utf8"), "payload\n");
  assert.equal(firstDigest.fileCount, 3);
  assert.equal(firstDigest.directoryCount, 3);
  await assertLinkFree(first);
  assert.deepEqual(await digestLinkFreeTree(first), firstDigest);
  if (process.platform !== "win32") {
    assert.equal((await lstat(path.join(first, "file-link"))).mode & 0o777, 0o640);
    await chmod(path.join(first, "file-link"), 0o600);
    assert.deepEqual(await digestLinkFreeTree(first), firstDigest);
  }
});

test("projects each pnpm package's virtual dependency context without flattening versions", async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  const virtualStore = path.join(source, "node_modules", ".pnpm");
  const app = path.join(virtualStore, "@fixture+app@1.0.0", "node_modules", "@fixture", "app");
  const appContext = path.join(virtualStore, "@fixture+app@1.0.0", "node_modules");
  const dependency = path.join(virtualStore, "dependency@1.0.0", "node_modules", "dependency");
  const dependencyContext = path.join(virtualStore, "dependency@1.0.0", "node_modules");
  const chalkV1 = path.join(virtualStore, "chalk@1.0.0", "node_modules", "chalk");
  const chalkV2 = path.join(virtualStore, "chalk@2.0.0", "node_modules", "chalk");

  const writePackage = async (
    directory: string,
    name: string,
    version: string,
    sourceText: string,
  ): Promise<void> => {
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      `${JSON.stringify({ name, version, type: "module", exports: "./index.mjs" })}\n`,
    );
    await writeFile(path.join(directory, "index.mjs"), sourceText);
  };
  const linkDirectory = async (target: string, link: string): Promise<void> => {
    await mkdir(path.dirname(link), { recursive: true });
    await symlink(path.relative(path.dirname(link), target), link);
  };

  await writePackage(
    app,
    "@fixture/app",
    "1.0.0",
    'import chalk from "chalk";\nimport dependency from "dependency";\nconsole.log(`${dependency}:${chalk}`);\n',
  );
  await writePackage(
    dependency,
    "dependency",
    "1.0.0",
    'import chalk from "chalk";\nexport default chalk;\n',
  );
  await writePackage(chalkV1, "chalk", "1.0.0", 'export default "chalk-v1";\n');
  await writePackage(chalkV2, "chalk", "2.0.0", 'export default "chalk-v2";\n');

  await linkDirectory(dependency, path.join(appContext, "dependency"));
  await linkDirectory(chalkV1, path.join(appContext, "chalk"));
  await linkDirectory(app, path.join(dependencyContext, "@fixture", "app"));
  await linkDirectory(chalkV2, path.join(dependencyContext, "chalk"));
  await linkDirectory(app, path.join(source, "node_modules", "@fixture", "app"));
  await linkDirectory(chalkV1, path.join(source, "node_modules", "chalk"));

  const runApp = (entrypoint: string): string => {
    const result = spawnSync(process.execPath, [entrypoint], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  assert.equal(runApp(path.join(app, "index.mjs")), "chalk-v2:chalk-v1\n");

  await materializeLinkFreeTree(source, output);

  const outputApp = path.join(output, "node_modules", "@fixture", "app");
  assert.equal(runApp(path.join(outputApp, "index.mjs")), "chalk-v2:chalk-v1\n");
  assert.equal(
    JSON.parse(await readFile(path.join(output, "node_modules", "chalk", "package.json"), "utf8"))
      .version,
    "1.0.0",
  );
  assert.equal(
    JSON.parse(
      await readFile(
        path.join(outputApp, "node_modules", "dependency", "node_modules", "chalk", "package.json"),
        "utf8",
      ),
    ).version,
    "2.0.0",
  );
  await assert.rejects(lstat(path.join(outputApp, "node_modules", "chalk")), {
    code: "ENOENT",
  });
  await assertLinkFree(output);
});

test("orders tree records by UTF-8 bytes rather than JavaScript UTF-16 code units", async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  const bmpName = "\uE000";
  const astralName = "\u{10000}";
  const bmpBytes = "bmp\n";
  const astralBytes = "astral\n";
  await mkdir(source);
  await writeFile(path.join(source, bmpName), bmpBytes);
  await writeFile(path.join(source, astralName), astralBytes);

  assert.equal(bmpName < astralName, false);
  assert.equal(Buffer.compare(Buffer.from(bmpName), Buffer.from(astralName)) < 0, true);
  const expectedRecords = [
    { path: ".", type: "directory" },
    { path: bmpName, type: "file", size: Buffer.byteLength(bmpBytes), sha256: sha256(bmpBytes) },
    {
      path: astralName,
      type: "file",
      size: Buffer.byteLength(astralBytes),
      sha256: sha256(astralBytes),
    },
  ];
  const expectedHashState = createHash("sha256");
  for (const record of expectedRecords) {
    const pathBytes = Buffer.from(record.path, "utf8");
    expectedHashState.update(record.type === "directory" ? "D\0" : "F\0", "ascii");
    expectedHashState.update(`${pathBytes.byteLength}\0`, "ascii");
    expectedHashState.update(pathBytes);
    expectedHashState.update(
      record.type === "file" ? `\0${record.size}\0${record.sha256}\n` : "\n",
      "ascii",
    );
  }
  const expectedHash = expectedHashState.digest("hex");

  assert.equal((await materializeLinkFreeTree(source, output)).sha256, expectedHash);
});

test("rejects broken, escaping, cyclic, and special artifact links", async (t) => {
  await t.test("broken link", async (t) => {
    const root = await temporaryDirectory(t);
    const source = path.join(root, "source");
    await mkdir(source);
    await symlink("missing", path.join(source, "broken"));
    await assert.rejects(
      materializeLinkFreeTree(source, path.join(root, "output")),
      /broken or cyclic/u,
    );
  });

  await t.test("escaping link", async (t) => {
    const root = await temporaryDirectory(t);
    const source = path.join(root, "source");
    const outside = path.join(root, "outside.txt");
    await mkdir(source);
    await writeFile(outside, "outside\n");
    await symlink(outside, path.join(source, "escape"));
    await assert.rejects(
      materializeLinkFreeTree(source, path.join(root, "output")),
      /escapes the admitted root/u,
    );
  });

  await t.test("directory cycle", async (t) => {
    const root = await temporaryDirectory(t);
    const source = path.join(root, "source");
    await mkdir(path.join(source, "directory"), { recursive: true });
    await symlink("..", path.join(source, "directory", "cycle"));
    await assert.rejects(
      materializeLinkFreeTree(source, path.join(root, "output")),
      /symlink cycle/u,
    );
  });

  await t.test(
    "link to special file",
    { skip: process.platform === "win32" ? "mkfifo is a Unix fixture" : false },
    async (t) => {
      const root = await temporaryDirectory(t);
      const source = path.join(root, "source");
      await mkdir(source);
      const fifo = path.join(source, "z-fifo");
      const result = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      await symlink("z-fifo", path.join(source, "a-special-link"));
      await assert.rejects(
        materializeLinkFreeTree(source, path.join(root, "output")),
        /unsupported special entry/u,
      );
    },
  );
});

test("stages the exact target-suffixed binary and canonical deterministic envelope", async (t) => {
  const fixture = await createStagingFixture(t);
  assert.equal(typeof stageTauriSidecarMain, "function");
  const first = await stageTauriSidecarEnvelope(fixture.options);
  const firstEnvelopeBytes = await readFile(first.envelopePath, "utf8");
  const firstTree = first.envelope.materializedTree;
  const second = await stageTauriSidecarEnvelope({
    ...fixture.options,
    environment: {
      WORKBENCH_TEST: "1",
      npm_execpath: "C:\\Tools\\pnpm.exe",
    },
  });
  const secondEnvelopeBytes = await readFile(second.envelopePath, "utf8");

  assert.equal(first.envelope.nodeBinary.filename, tauriExternalBinaryFilename(fixture.target));
  assert.equal(path.basename(first.binaryPath), first.envelope.nodeBinary.filename);
  assert.equal(first.envelope.sourceManifest.filename, RUNTIME_ARTIFACT_MANIFEST_FILENAME);
  assert.equal(first.envelope.sourceManifest.sha256, sha256(await readFile(fixture.manifestPath)));
  assert.deepEqual(second.envelope.materializedTree, firstTree);
  assert.equal(secondEnvelopeBytes, firstEnvelopeBytes);
  assert.deepEqual(parseTauriSidecarEnvelope(JSON.parse(firstEnvelopeBytes)), first.envelope);
  assert.equal(
    parseTauriSidecarEnvelope({ ...JSON.parse(firstEnvelopeBytes), unexpected: true }),
    undefined,
  );
  assert.deepEqual(
    fixture.producerCalls.map(({ command, args, cwd, environment }) => ({
      command,
      args,
      cwd,
      environment,
    })),
    [
      {
        command: process.execPath,
        args: ["/virtual/pnpm.cjs", "--filter", "@workbench/runtime-node", "run", "build:artifact"],
        cwd: fixture.repositoryRoot,
        environment: { WORKBENCH_TEST: "1", npm_execpath: "/virtual/pnpm.cjs" },
      },
      {
        command: "C:\\Tools\\pnpm.exe",
        args: ["--filter", "@workbench/runtime-node", "run", "build:artifact"],
        cwd: fixture.repositoryRoot,
        environment: { WORKBENCH_TEST: "1", npm_execpath: "C:\\Tools\\pnpm.exe" },
      },
    ],
  );
  await assertLinkFree(first.runtimeDirectory);
  const names = await readdir(fixture.tauriSourceRoot);
  assert.equal(
    names.some((name) => name.startsWith(".sidecar-envelope-")),
    false,
  );
});

test("fails closed when the admitted Runtime target differs from process.execPath", async (t) => {
  const fixture = await createStagingFixture(t);
  const mismatchedTarget = Object.freeze({ ...fixture.target, napiVersion: 11 });
  const options: StageTauriSidecarOptions = {
    ...fixture.options,
    resolveArtifact: async () => ({
      artifactRoot: fixture.artifactRoot,
      manifestPath: fixture.manifestPath,
      entrypoint: path.join(fixture.artifactRoot, "server.mjs"),
      manifest: { ...fixture.manifest, target: mismatchedTarget },
    }),
  };
  await assert.rejects(stageTauriSidecarEnvelope(options), /does not match its executable/u);
  assert.equal(
    await lstat(path.join(fixture.tauriSourceRoot, "resources")).then(
      () => true,
      (error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? false : Promise.reject(error)),
    ),
    false,
  );
});

test("rejects a missing package manager and Windows batch shims without a shell", async (t) => {
  const fixture = await createStagingFixture(t);
  await assert.rejects(
    stageTauriSidecarEnvelope({ ...fixture.options, environment: {} }),
    /Missing npm_execpath/u,
  );
  await assert.rejects(
    stageTauriSidecarEnvelope({
      ...fixture.options,
      environment: { npm_execpath: "C:\\Users\\developer\\pnpm.cmd" },
    }),
    /Windows batch shim/u,
  );
  assert.deepEqual(fixture.producerCalls, []);
});

test("rolls back binary and resources when publication fails before the envelope commit", async (t) => {
  const fixture = await createStagingFixture(t);
  await stageTauriSidecarEnvelope(fixture.options);
  const baseline = await outputSnapshot(fixture);
  await writeFile(fixture.nodeExecutable, "replacement node executable\n", { mode: 0o755 });
  await chmod(fixture.nodeExecutable, 0o755);
  await writeFile(path.join(fixture.artifactRoot, "server.mjs"), "export const runtime = false;\n");
  const steps: string[] = [];

  await assert.rejects(
    stageTauriSidecarEnvelope({
      ...fixture.options,
      beforePublishStep(step) {
        steps.push(step);
        if (step === "commit-runtime") throw new Error("injected commit failure");
      },
    }),
    /injected commit failure/u,
  );

  assert.deepEqual(steps, ["backup-runtime", "backup-binary", "publish-binary", "commit-runtime"]);
  assert.equal(await outputSnapshot(fixture), baseline);
  assert.equal(
    (await readdir(fixture.tauriSourceRoot)).some((name) => name.startsWith(".sidecar-envelope-")),
    false,
  );
});

test("does not overwrite a published tree that drifts while a replacement is staged", async (t) => {
  const fixture = await createStagingFixture(t);
  const staged = await stageTauriSidecarEnvelope(fixture.options);
  const publishedServer = path.join(staged.runtimeDirectory, "server.mjs");

  await assert.rejects(
    stageTauriSidecarEnvelope({
      ...fixture.options,
      beforePublish: async () => appendFile(publishedServer, "// concurrent drift\n"),
    }),
    /drifted from its envelope/u,
  );

  assert.match(await readFile(publishedServer, "utf8"), /concurrent drift/u);
  assert.equal(
    (await readdir(fixture.tauriSourceRoot)).some((name) => name.startsWith(".sidecar-envelope-")),
    false,
  );
});
