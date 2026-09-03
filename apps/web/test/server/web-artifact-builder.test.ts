import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { BuildOptions, BuildResult, Metafile } from "esbuild";

import {
  WEB_ARTIFACT_MANIFEST_FILENAME,
  WEB_ARTIFACT_PRIMARY_ENTRYPOINT,
} from "@workbench/host-contracts/web-artifact-manifest";
import {
  resolveWebArtifact,
  type ResolveWebArtifactOptions,
  type ResolvedWebArtifact,
} from "@workbench/host-server/web-artifact";

import {
  TEST_ONLY_ALLOW_NONSTANDARD_WEB_ARTIFACT_OUTPUT,
  buildWebArtifact,
  createWebArtifactBuildOptions,
  measureWebArtifactTree,
  publishWebArtifactTransaction,
  readNextStandaloneMetadata,
} from "../../scripts/build-web-artifact";

const RELATIVE_APP_DIRECTORY = "apps/web";
const BUILD_ID = "web-artifact-fixture-123";
const NEXT_NODE_MODULE_ALIAS = `${RELATIVE_APP_DIRECTORY}/.next/node_modules/shiki-fixture`;
const NEXT_PACKAGE_STORE_PATH = "node_modules/.pnpm/next@16.3.1_fixture/node_modules/next";
const NEXT_PACKAGE_ALIAS = "node_modules/next";
const NEXT_RUNTIME_EXCEPTION_PATH = `${NEXT_PACKAGE_STORE_PATH}/dist/cli/next-test.js`;
const NEXT_WEBPACK_RUNTIME_PATHS = Object.freeze([
  `${NEXT_PACKAGE_STORE_PATH}/dist/compiled/@babel/runtime/package.json`,
  `${NEXT_PACKAGE_STORE_PATH}/dist/compiled/webpack/bundle5.js`,
  `${NEXT_PACKAGE_STORE_PATH}/dist/compiled/webpack/webpack-lib.js`,
  `${NEXT_PACKAGE_STORE_PATH}/dist/compiled/webpack/webpack.js`,
]);
const FILE_VIEWER_ASSETS = [
  "vendor/ppt/index.mjs",
  "vendor/ppt/worker.mjs",
  "vendor/ppt/ppt-native.wasm",
  "vendor/ppt/ppt-font-cjk.otf",
  "vendor/pptx/pptx.worker.js",
] as const;

async function writeFixtureFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const destination = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content, "utf8");
}

interface WebFixture {
  readonly repositoryRoot: string;
  readonly webRoot: string;
  readonly webBuildRoot: string;
  readonly standaloneRoot: string;
  readonly publicRoot: string;
}

interface ImageOptimizerFixture {
  readonly removedAliases: readonly string[];
  readonly removedEntries: readonly string[];
  readonly retainedNextPackage: string;
}

async function createWebFixture(repositoryRoot: string): Promise<WebFixture> {
  const webRoot = path.join(repositoryRoot, ...RELATIVE_APP_DIRECTORY.split("/"));
  const webBuildRoot = path.join(webRoot, ".next");
  const standaloneRoot = path.join(webBuildRoot, "standalone");
  const publicRoot = path.join(webRoot, "public");
  const requiredServerFiles = JSON.stringify({
    version: 1,
    config: {
      distDir: ".next",
      images: { unoptimized: true },
      output: "standalone",
      outputFileTracingRoot: repositoryRoot,
    },
    appDir: webRoot,
    relativeAppDir: RELATIVE_APP_DIRECTORY,
  });

  await Promise.all([
    writeFixtureFile(webBuildRoot, "BUILD_ID", BUILD_ID + "\n"),
    writeFixtureFile(webBuildRoot, "required-server-files.json", requiredServerFiles),
    writeFixtureFile(webBuildRoot, "static/media/next-only.bin", "next static asset\n"),
    writeFixtureFile(webBuildRoot, "static/media/duplicate.bin", "canonical presentation asset\n"),
    ...FILE_VIEWER_ASSETS.map((asset) =>
      writeFixtureFile(
        publicRoot,
        `file-viewer/${asset}`,
        asset === FILE_VIEWER_ASSETS[0] ? "canonical presentation asset\n" : `${asset}\n`,
      ),
    ),
    writeFixtureFile(standaloneRoot, `${RELATIVE_APP_DIRECTORY}/.next/BUILD_ID`, BUILD_ID + "\n"),
    writeFixtureFile(
      standaloneRoot,
      `${RELATIVE_APP_DIRECTORY}/.next/required-server-files.json`,
      requiredServerFiles,
    ),
    writeFixtureFile(standaloneRoot, `${RELATIVE_APP_DIRECTORY}/server.js`, "legacy Next server\n"),
    writeFixtureFile(standaloneRoot, `${RELATIVE_APP_DIRECTORY}/payload.txt`, "linked payload\n"),
    writeFixtureFile(standaloneRoot, `${RELATIVE_APP_DIRECTORY}/stale-source.ts`, "export {};\n"),
    writeFixtureFile(standaloneRoot, `${RELATIVE_APP_DIRECTORY}/stale-source.js.map`, "{}\n"),
    writeFixtureFile(standaloneRoot, `${RELATIVE_APP_DIRECTORY}/next-test.js`, "export {};\n"),
    writeFixtureFile(standaloneRoot, `${RELATIVE_APP_DIRECTORY}/folder-test.svg`, "<svg />\n"),
    writeFixtureFile(
      standaloneRoot,
      `${NEXT_PACKAGE_STORE_PATH}/package.json`,
      '{"name":"next","version":"fixture"}\n',
    ),
    writeFixtureFile(
      standaloneRoot,
      `${NEXT_PACKAGE_STORE_PATH}/dist/server/config-schema.js`,
      '"use strict";\nconst _nexttest = require("../cli/next-test");\n',
    ),
    writeFixtureFile(
      standaloneRoot,
      `${NEXT_PACKAGE_STORE_PATH}/dist/server/config-utils.js`,
      [
        '"use strict";',
        "function loadWebpackHook() {",
        "  require('../server/require-hook').addHookAliases([",
        "    ['webpack', 'next/dist/compiled/webpack/webpack-lib'],",
        "    ['@babel/runtime', 'next/dist/compiled/@babel/runtime/package.json'],",
        "  ].map(([request, replacement]) => [request, require.resolve(replacement)]));",
        "}",
        "module.exports = { loadWebpackHook };",
        "",
      ].join("\n"),
    ),
    writeFixtureFile(standaloneRoot, NEXT_RUNTIME_EXCEPTION_PATH, '"use strict";\n'),
    writeFixtureFile(
      standaloneRoot,
      NEXT_WEBPACK_RUNTIME_PATHS[0],
      '{"name":"@babel/runtime","version":"fixture"}\n',
    ),
    writeFixtureFile(
      standaloneRoot,
      NEXT_WEBPACK_RUNTIME_PATHS[1],
      '"use strict";\nmodule.exports = () => ({});\n',
    ),
    writeFixtureFile(
      standaloneRoot,
      NEXT_WEBPACK_RUNTIME_PATHS[2],
      '"use strict";\nmodule.exports = require("./webpack.js").webpack;\n',
    ),
    writeFixtureFile(
      standaloneRoot,
      NEXT_WEBPACK_RUNTIME_PATHS[3],
      '"use strict";\nmodule.exports = require("./bundle5")();\n',
    ),
    writeFixtureFile(
      standaloneRoot,
      "node_modules/another-runtime/package.json",
      '{"name":"another-runtime","version":"1.0.0"}\n',
    ),
    writeFixtureFile(
      standaloneRoot,
      "node_modules/another-runtime/dist/cli/next-test.js",
      '"use strict";\n',
    ),
  ]);

  const applicationRoot = path.join(standaloneRoot, ...RELATIVE_APP_DIRECTORY.split("/"));
  await symlink("payload.txt", path.join(applicationRoot, "payload-link.txt"), "file");

  const nextPackage = path.join(standaloneRoot, ...NEXT_PACKAGE_STORE_PATH.split("/"));
  const nextPackageAlias = path.join(standaloneRoot, ...NEXT_PACKAGE_ALIAS.split("/"));
  await mkdir(path.dirname(nextPackageAlias), { recursive: true });
  await symlink(
    path.relative(path.dirname(nextPackageAlias), nextPackage),
    nextPackageAlias,
    "dir",
  );

  const piPackage = path.join(
    standaloneRoot,
    "node_modules",
    ".pnpm",
    "@earendil-works+pi-coding-agent@fixture",
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
  );
  await writeFixtureFile(
    piPackage,
    "package.json",
    '{"name":"@earendil-works/pi-coding-agent","version":"fixture"}\n',
  );
  const piAlias = path.join(standaloneRoot, "node_modules", "@earendil-works", "pi-coding-agent");
  await mkdir(path.dirname(piAlias), { recursive: true });
  await symlink(path.relative(path.dirname(piAlias), piPackage), piAlias, "dir");

  const nextAliasTarget = path.join(
    standaloneRoot,
    "node_modules",
    ".pnpm",
    "shiki@1.0.0",
    "node_modules",
    "shiki",
  );
  await writeFixtureFile(nextAliasTarget, "index.js", "export {};\n");
  const nextAlias = path.join(standaloneRoot, ...NEXT_NODE_MODULE_ALIAS.split("/"));
  await mkdir(path.dirname(nextAlias), { recursive: true });
  await symlink("../../../../node_modules/.pnpm/shiki@1.0.0/node_modules/shiki", nextAlias, "dir");

  const orphanHubEntry = path.join(
    standaloneRoot,
    "node_modules",
    ".pnpm",
    "@fixture+orphan-core@1.0.0",
    "node_modules",
    "@fixture",
    "orphan-core",
  );
  await writeFixtureFile(orphanHubEntry, "index.js", "export {};\n");
  const orphanHubAlias = path.join(
    standaloneRoot,
    "node_modules",
    ".pnpm",
    "node_modules",
    "@fixture",
    "orphan-core",
  );
  await mkdir(path.dirname(orphanHubAlias), { recursive: true });
  await symlink(
    "../../@fixture+orphan-core@1.0.0/node_modules/@fixture/orphan-core",
    orphanHubAlias,
    "dir",
  );

  return { repositoryRoot, webRoot, webBuildRoot, standaloneRoot, publicRoot };
}

async function createUnoptimizedImageOptimizerFixture(
  fixture: WebFixture,
): Promise<ImageOptimizerFixture> {
  const nodeModules = path.join(fixture.standaloneRoot, "node_modules");
  const pnpmDirectory = path.join(nodeModules, ".pnpm");
  const nextPackage = path.join(fixture.standaloneRoot, ...NEXT_PACKAGE_STORE_PATH.split("/"));
  const sharpPackage = path.join(pnpmDirectory, "sharp@0.34.3_fixture", "node_modules", "sharp");
  const sharpPlatformPackage = path.join(
    pnpmDirectory,
    "@img+sharp-linux-x64@0.34.3_fixture",
    "node_modules",
    "@img",
    "sharp-linux-x64",
  );
  const aliases = [
    path.join(nodeModules, "sharp"),
    path.join(nodeModules, "@img", "sharp-linux-x64"),
    path.join(nextPackage, "node_modules", "sharp"),
    path.join(nextPackage, "node_modules", "@img", "sharp-linux-x64"),
  ];
  const linkDirectory = async (source: string, destination: string): Promise<void> => {
    await mkdir(path.dirname(destination), { recursive: true });
    await symlink(path.relative(path.dirname(destination), source), destination, "dir");
  };

  await Promise.all([
    writeFixtureFile(sharpPackage, "package.json", '{"name":"sharp","version":"fixture"}\n'),
    writeFixtureFile(
      sharpPlatformPackage,
      "package.json",
      '{"name":"@img/sharp-linux-x64","version":"fixture"}\n',
    ),
  ]);
  await Promise.all([
    linkDirectory(sharpPackage, aliases[0]),
    linkDirectory(sharpPlatformPackage, aliases[1]),
    linkDirectory(sharpPackage, aliases[2]),
    linkDirectory(sharpPlatformPackage, aliases[3]),
  ]);

  const relative = (filename: string): string =>
    path.relative(fixture.standaloneRoot, filename).split(path.sep).join("/");
  return {
    removedAliases: aliases.map(relative),
    removedEntries: [sharpPackage, sharpPlatformPackage].map(relative),
    retainedNextPackage: relative(nextPackage),
  };
}

function buildResult(
  outputFile: string,
): BuildResult<BuildOptions> & { readonly metafile: Metafile } {
  return {
    errors: [],
    warnings: [],
    metafile: {
      inputs: {},
      outputs: {
        [outputFile]: {
          bytes: 1,
          exports: [],
          imports: [{ path: "next", kind: "import-statement", external: true }],
          inputs: {},
        },
      },
    },
  } as unknown as BuildResult<BuildOptions> & { readonly metafile: Metafile };
}

interface PublishFixture {
  readonly repositoryRoot: string;
  readonly parent: string;
  readonly finalRoot: string;
  readonly backupRoot: string;
  readonly lockPath: string;
}

async function createPublishFixture(): Promise<PublishFixture> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-web-publish-"));
  const parent = path.join(repositoryRoot, ".desktop-build");
  await mkdir(parent);
  return Object.freeze({
    repositoryRoot,
    parent,
    finalRoot: path.join(parent, "web"),
    backupRoot: path.join(parent, ".web.backup"),
    lockPath: path.join(parent, ".web.publish-lock"),
  });
}

async function writePublishMarker(directory: string, marker: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "marker.txt"), marker, "utf8");
}

async function acceptingMarkerResolver(
  options: ResolveWebArtifactOptions,
): Promise<ResolvedWebArtifact> {
  const artifactRoot = options.artifactRoot ?? path.dirname(options.manifestPath!);
  const marker = await readFile(path.join(artifactRoot, "marker.txt"), "utf8");
  if (marker.startsWith("invalid")) throw new Error("injected invalid Web artifact " + marker);
  if (options.expectedBuildId !== undefined && marker !== options.expectedBuildId) {
    throw new Error(
      `Web artifact build identity changed: ${marker}; expected ${options.expectedBuildId}.`,
    );
  }
  return Object.freeze({
    artifactRoot,
    manifestPath: path.join(artifactRoot, WEB_ARTIFACT_MANIFEST_FILENAME),
    manifest: Object.freeze({ buildId: marker }) as never,
    appRoot: artifactRoot,
    entrypoint: path.join(artifactRoot, WEB_ARTIFACT_PRIMARY_ENTRYPOINT),
    requiredServerFiles: path.join(artifactRoot, "required-server-files.json"),
    nextConfig: Object.freeze({}),
  });
}

function staleWebPublishOwner(pid: number, ownerId = "interrupted-publisher"): string {
  return (
    JSON.stringify({
      schemaVersion: 1,
      target: "web",
      pid,
      ownerId,
      acquiredAt: new Date(0).toISOString(),
    }) + "\n"
  );
}

function webPublishRecoveryClaimPath(
  fixture: PublishFixture,
  lockIdentity: { readonly dev: number; readonly ino: number },
  generation?: number,
  predecessorOwnerId?: string,
): string {
  const base = `.web.publish-lock.recovery-${lockIdentity.dev.toString(16)}-${lockIdentity.ino.toString(16)}`;
  if (generation === undefined || predecessorOwnerId === undefined) {
    return path.join(fixture.parent, base);
  }
  const predecessorHash = createHash("sha256")
    .update(predecessorOwnerId)
    .digest("hex")
    .slice(0, 16);
  return path.join(fixture.parent, `${base}-${generation}-${predecessorHash}`);
}

function publishTransaction(
  fixture: PublishFixture,
  marker: string,
  overrides: Partial<
    Omit<Parameters<typeof publishWebArtifactTransaction>[0], "buildTemporaryArtifact">
  > & {
    readonly buildTemporaryArtifact?: (temporaryRoot: string) => Promise<void>;
  } = {},
) {
  return publishWebArtifactTransaction({
    repositoryRoot: fixture.repositoryRoot,
    outputDirectory: fixture.finalRoot,
    expectedBuildId: marker,
    resolveArtifactImpl: acceptingMarkerResolver,
    testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_WEB_ARTIFACT_OUTPUT,
    buildTemporaryArtifact:
      overrides.buildTemporaryArtifact ??
      ((temporaryRoot) => writePublishMarker(temporaryRoot, marker)),
    ...overrides,
  });
}

async function buildFixtureArtifact(fixture: WebFixture) {
  return buildWebArtifact({
    ...fixture,
    outputDirectory: path.join(fixture.repositoryRoot, ".desktop-build", "web"),
    testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_WEB_ARTIFACT_OUTPUT,
    primaryEntryPoint: path.join(fixture.webRoot, "primary-fixture.ts"),
    async buildImpl(options) {
      assert.ok(typeof options.outfile === "string");
      await writeFile(options.outfile, `// ${path.basename(options.outfile)}\n`, "utf8");
      return buildResult(options.outfile);
    },
    completeStandaloneRuntime() {
      return Object.freeze({});
    },
  });
}

test("creates the sole control entry only after finalizing a raw standalone Web artifact", async (t) => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-web-artifact-builder-"));
  t.after(() => rm(repositoryRoot, { force: true, recursive: true }));
  const fixture = await createWebFixture(repositoryRoot);
  const outputDirectory = path.join(repositoryRoot, ".desktop-build", "web");
  const bundledOutputs: string[] = [];
  const completedStandaloneRoots: Array<string | undefined> = [];
  let resolverCalls = 0;
  await writeFixtureFile(outputDirectory, "obsolete-from-prior-build.txt", "old artifact\n");

  const artifact = await buildWebArtifact({
    ...fixture,
    outputDirectory,
    testOnlyOutputPolicy: TEST_ONLY_ALLOW_NONSTANDARD_WEB_ARTIFACT_OUTPUT,
    primaryEntryPoint: path.join(fixture.webRoot, "primary-fixture.ts"),
    async buildImpl(options) {
      assert.equal(options.absWorkingDir, fixture.webRoot);
      assert.ok(typeof options.outfile === "string");
      assert.deepEqual(options.external, ["next", "next/*"]);
      bundledOutputs.push(options.outfile);
      await writeFile(options.outfile, `// ${path.basename(options.outfile)}\n`, "utf8");
      return buildResult(options.outfile);
    },
    completeStandaloneRuntime(options) {
      completedStandaloneRoots.push(options.standaloneRoot);
      return Object.freeze({});
    },
    resolveArtifact(options) {
      resolverCalls += 1;
      return resolveWebArtifact(options);
    },
  });

  assert.deepEqual(completedStandaloneRoots, [fixture.standaloneRoot]);
  assert.deepEqual(
    bundledOutputs.map((filename) => path.basename(filename)),
    [WEB_ARTIFACT_PRIMARY_ENTRYPOINT],
  );
  assert.equal(resolverCalls, 2, "the producer must self-admit before and after publication");
  assert.equal(artifact.artifactRoot, outputDirectory);
  assert.equal(artifact.manifestPath, path.join(outputDirectory, WEB_ARTIFACT_MANIFEST_FILENAME));
  assert.equal(artifact.manifest.buildId, BUILD_ID);
  assert.equal(artifact.manifest.relativeAppDir, RELATIVE_APP_DIRECTORY);
  assert.equal(
    artifact.manifest.requiredServerFiles,
    `${RELATIVE_APP_DIRECTORY}/.next/required-server-files.json`,
  );
  assert.deepEqual(artifact.manifest.links, [
    {
      path: NEXT_NODE_MODULE_ALIAS,
      target: "../../../../node_modules/.pnpm/shiki@1.0.0/node_modules/shiki",
    },
    { path: `${RELATIVE_APP_DIRECTORY}/payload-link.txt`, target: "payload.txt" },
    {
      path: NEXT_PACKAGE_ALIAS,
      target: ".pnpm/next@16.3.1_fixture/node_modules/next",
    },
  ]);

  const filePaths = artifact.manifest.files.map((file) => file.path);
  const resourcePaths = artifact.manifest.resources;
  assert.ok(filePaths.includes(WEB_ARTIFACT_PRIMARY_ENTRYPOINT));
  assert.equal(filePaths.includes("server.mjs"), false);
  assert.ok(filePaths.includes(`${RELATIVE_APP_DIRECTORY}/.next/BUILD_ID`));
  assert.ok(filePaths.includes(`${RELATIVE_APP_DIRECTORY}/.next/required-server-files.json`));
  assert.equal(filePaths.includes(WEB_ARTIFACT_MANIFEST_FILENAME), false);
  assert.equal(filePaths.includes(`${RELATIVE_APP_DIRECTORY}/server.js`), false);
  assert.equal(filePaths.includes(`${RELATIVE_APP_DIRECTORY}/stale-source.ts`), false);
  assert.equal(filePaths.includes(`${RELATIVE_APP_DIRECTORY}/stale-source.js.map`), false);
  assert.equal(filePaths.includes(`${RELATIVE_APP_DIRECTORY}/next-test.js`), false);
  assert.ok(filePaths.includes(NEXT_RUNTIME_EXCEPTION_PATH));
  assert.ok(resourcePaths.includes(NEXT_RUNTIME_EXCEPTION_PATH));
  for (const runtimePath of NEXT_WEBPACK_RUNTIME_PATHS) {
    assert.ok(filePaths.includes(runtimePath), runtimePath);
    assert.ok(resourcePaths.includes(runtimePath), runtimePath);
  }
  assert.equal(filePaths.includes("node_modules/another-runtime/dist/cli/next-test.js"), false);
  assert.ok(filePaths.includes(`${RELATIVE_APP_DIRECTORY}/folder-test.svg`));
  assert.equal(
    filePaths.includes(`${RELATIVE_APP_DIRECTORY}/.next/static/media/duplicate.bin`),
    false,
  );
  assert.equal(
    filePaths.some((pathname) => pathname.includes("@earendil-works+pi-coding-agent@fixture")),
    false,
  );
  assert.ok(resourcePaths.includes(`${RELATIVE_APP_DIRECTORY}/.next/BUILD_ID`));
  assert.ok(resourcePaths.includes(`${RELATIVE_APP_DIRECTORY}/.next/required-server-files.json`));
  assert.equal(resourcePaths.includes(WEB_ARTIFACT_PRIMARY_ENTRYPOINT), false);
  assert.equal(resourcePaths.includes("server.mjs"), false);

  assert.equal(
    await readFile(path.join(fixture.standaloneRoot, RELATIVE_APP_DIRECTORY, "server.js"), "utf8"),
    "legacy Next server\n",
  );
  await assert.rejects(
    lstat(path.join(outputDirectory, RELATIVE_APP_DIRECTORY, "server.js")),
    /ENOENT/u,
  );
  await assert.rejects(
    lstat(path.join(outputDirectory, "obsolete-from-prior-build.txt")),
    /ENOENT/u,
  );
  assert.equal(
    await readFile(
      path.join(outputDirectory, ...NEXT_NODE_MODULE_ALIAS.split("/"), "index.js"),
      "utf8",
    ),
    "export {};\n",
  );
  await assert.rejects(
    lstat(
      path.join(
        outputDirectory,
        "node_modules",
        ".pnpm",
        "node_modules",
        "@fixture",
        "orphan-core",
      ),
    ),
    /ENOENT/u,
  );
  assert.equal(
    await readFile(path.join(outputDirectory, RELATIVE_APP_DIRECTORY, ".next", "BUILD_ID"), "utf8"),
    BUILD_ID + "\n",
  );
});

test("keeps the Web producer fail-closed around the Next runtime exception provenance", async (t) => {
  await t.test("missing dependency", async (t) => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-web-next-missing-"));
    t.after(() => rm(repositoryRoot, { force: true, recursive: true }));
    const fixture = await createWebFixture(repositoryRoot);
    await rm(path.join(fixture.standaloneRoot, ...NEXT_RUNTIME_EXCEPTION_PATH.split("/")));
    await assert.rejects(buildFixtureArtifact(fixture), /ENOENT/u);
  });

  await t.test("comment-only dependency text", async (t) => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-web-next-tampered-"));
    t.after(() => rm(repositoryRoot, { force: true, recursive: true }));
    const fixture = await createWebFixture(repositoryRoot);
    await writeFixtureFile(
      fixture.standaloneRoot,
      `${NEXT_PACKAGE_STORE_PATH}/dist/server/config-schema.js`,
      '// require("../cli/next-test")\nmodule.exports = {};\n',
    );
    await assert.rejects(buildFixtureArtifact(fixture), /required top-level/u);
  });

  await t.test("symlink dependency", async (t) => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-web-next-symlink-"));
    t.after(() => rm(repositoryRoot, { force: true, recursive: true }));
    const fixture = await createWebFixture(repositoryRoot);
    const runtimeFile = path.join(
      fixture.standaloneRoot,
      ...NEXT_RUNTIME_EXCEPTION_PATH.split("/"),
    );
    await writeFixtureFile(
      fixture.standaloneRoot,
      `${NEXT_PACKAGE_STORE_PATH}/dist/cli/actual.js`,
      '"use strict";\n',
    );
    await rm(runtimeFile);
    await symlink("actual.js", runtimeFile, "file");
    await assert.rejects(
      buildFixtureArtifact(fixture),
      /package alias is broken|must be a canonical regular file/u,
    );
  });

  await t.test("missing dynamic webpack runtime", async (t) => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-web-next-webpack-"));
    t.after(() => rm(repositoryRoot, { force: true, recursive: true }));
    const fixture = await createWebFixture(repositoryRoot);
    await rm(path.join(fixture.standaloneRoot, ...NEXT_WEBPACK_RUNTIME_PATHS[2].split("/")));
    await assert.rejects(
      buildFixtureArtifact(fixture),
      /cannot resolve next\/dist\/compiled\/webpack\/webpack-lib/u,
    );
  });
});

test("publishes an admitted candidate under the target lock and removes the old backup", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
  await writePublishMarker(fixture.finalRoot, "old");
  await writePublishMarker(path.join(fixture.parent, "w"), "stale");
  let admissionCount = 0;
  let temporaryBasename = "";

  await publishTransaction(fixture, "new", {
    async buildTemporaryArtifact(temporaryRoot) {
      temporaryBasename = path.basename(temporaryRoot);
      await writePublishMarker(temporaryRoot, "new");
    },
    async resolveArtifactImpl(options) {
      admissionCount += 1;
      return acceptingMarkerResolver(options);
    },
  });

  assert.equal(temporaryBasename, "w");
  assert.equal(admissionCount, 2, "the candidate and published final must both be admitted");
  assert.equal(await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"), "new");
  assert.deepEqual((await readdir(fixture.parent)).sort(), ["web"]);
});

test("candidate and post-publication rejection preserve the exact old target", async (t) => {
  await t.test("candidate rejection", async (t) => {
    const fixture = await createPublishFixture();
    t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
    await writePublishMarker(fixture.finalRoot, "old");

    await assert.rejects(
      publishTransaction(fixture, "new", {
        async resolveArtifactImpl() {
          throw new Error("injected candidate rejection");
        },
      }),
      /injected candidate rejection/u,
    );

    assert.equal(await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"), "old");
    assert.deepEqual((await readdir(fixture.parent)).sort(), ["web"]);
  });

  await t.test("post-publication rejection", async (t) => {
    const fixture = await createPublishFixture();
    t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
    await writePublishMarker(fixture.finalRoot, "old");
    let admissionCount = 0;

    await assert.rejects(
      publishTransaction(fixture, "new", {
        async resolveArtifactImpl(options) {
          admissionCount += 1;
          if (admissionCount === 2) throw new Error("injected post-publication rejection");
          return acceptingMarkerResolver(options);
        },
      }),
      /injected post-publication rejection/u,
    );

    assert.equal(admissionCount, 2);
    assert.equal(await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"), "old");
    assert.deepEqual((await readdir(fixture.parent)).sort(), ["web"]);
  });
});

test("rechecks candidate, published-final, and backup identities across admission", async (t) => {
  await t.test("candidate replacement is never swapped or deleted", async (t) => {
    const fixture = await createPublishFixture();
    t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
    await writePublishMarker(fixture.finalRoot, "old");
    let candidateRoot = "";
    let replaced = false;

    await assert.rejects(
      publishTransaction(fixture, "new", {
        async buildTemporaryArtifact(temporaryRoot) {
          candidateRoot = temporaryRoot;
          await writePublishMarker(temporaryRoot, "new");
        },
        async resolveArtifactImpl(options) {
          const resolved = await acceptingMarkerResolver(options);
          if (!replaced && options.artifactRoot === candidateRoot) {
            replaced = true;
            await rm(candidateRoot, { recursive: true });
            await writePublishMarker(candidateRoot, "external-candidate");
          }
          return resolved;
        },
      }),
      /rollback was incomplete/u,
    );

    assert.equal(await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"), "old");
    assert.equal(
      await readFile(path.join(candidateRoot, "marker.txt"), "utf8"),
      "external-candidate",
    );
  });

  await t.test("published-final replacement is never rolled back over", async (t) => {
    const fixture = await createPublishFixture();
    t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
    await writePublishMarker(fixture.finalRoot, "old");
    let replaced = false;

    await assert.rejects(
      publishTransaction(fixture, "new", {
        async resolveArtifactImpl(options) {
          const resolved = await acceptingMarkerResolver(options);
          if (
            !replaced &&
            options.artifactRoot === fixture.finalRoot &&
            options.expectedBuildId === "new"
          ) {
            replaced = true;
            await rm(fixture.finalRoot, { recursive: true });
            await writePublishMarker(fixture.finalRoot, "external-final");
          }
          return resolved;
        },
      }),
      /rollback was incomplete/u,
    );

    assert.equal(
      await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"),
      "external-final",
    );
    assert.equal(await readFile(path.join(fixture.backupRoot, "marker.txt"), "utf8"), "old");
  });

  await t.test(
    "backup replacement after final admission is never restored or deleted",
    async (t) => {
      const fixture = await createPublishFixture();
      t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
      await writePublishMarker(fixture.finalRoot, "old");
      let replaced = false;

      await assert.rejects(
        publishTransaction(fixture, "new", {
          async resolveArtifactImpl(options) {
            const resolved = await acceptingMarkerResolver(options);
            if (
              !replaced &&
              options.artifactRoot === fixture.finalRoot &&
              options.expectedBuildId === "new"
            ) {
              replaced = true;
              await rm(fixture.backupRoot, { recursive: true });
              await writePublishMarker(fixture.backupRoot, "external-backup");
            }
            return resolved;
          },
        }),
        /rollback was incomplete/u,
      );

      await assert.rejects(lstat(fixture.finalRoot), /ENOENT/u);
      assert.equal(
        await readFile(path.join(fixture.backupRoot, "marker.txt"), "utf8"),
        "external-backup",
      );
    },
  );
});

test("backup cleanup failure after the commit point never rolls back the admitted final", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
  await writePublishMarker(fixture.finalRoot, "old");

  await assert.rejects(
    publishTransaction(fixture, "new", {
      async testOnlyRemoveOwnedDirectoryImpl() {
        throw new Error("injected backup cleanup failure");
      },
    }),
    /published and admitted, but its old backup could not be cleaned/u,
  );

  assert.equal(await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"), "new");
  assert.equal(await readFile(path.join(fixture.backupRoot, "marker.txt"), "utf8"), "old");
  assert.deepEqual((await readdir(fixture.parent)).sort(), [".web.backup", "web"]);
});

test("reclaims a dead lock and restores an admitted backup before the next publish", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
  await writePublishMarker(fixture.backupRoot, "old");
  await writeFile(fixture.lockPath, staleWebPublishOwner(424_242), "utf8");
  const admittedRoots: string[] = [];

  await publishTransaction(fixture, "new", {
    testOnlyProcessIsAliveImpl(pid) {
      assert.equal(pid, 424_242);
      return false;
    },
    async resolveArtifactImpl(options) {
      admittedRoots.push(options.artifactRoot ?? path.dirname(options.manifestPath!));
      return acceptingMarkerResolver(options);
    },
  });

  assert.deepEqual(admittedRoots.slice(0, 2), [fixture.backupRoot, fixture.finalRoot]);
  assert.equal(admittedRoots.length, 4);
  assert.equal(await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"), "new");
  assert.deepEqual((await readdir(fixture.parent)).sort(), ["web"]);
});

test("supersedes a complete dead recovery claim", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
  await writeFile(fixture.lockPath, staleWebPublishOwner(424_242), "utf8");
  const lockIdentity = await lstat(fixture.lockPath);
  const recoveryClaim = webPublishRecoveryClaimPath(fixture, lockIdentity);
  await writeFile(
    recoveryClaim,
    staleWebPublishOwner(424_243, "interrupted-recovery-owner"),
    "utf8",
  );

  await publishTransaction(fixture, "new", {
    testOnlyProcessIsAliveImpl: (pid) => pid === process.pid,
  });

  assert.equal(await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"), "new");
  assert.deepEqual((await readdir(fixture.parent)).sort(), ["web"]);
});

test("walks a bounded deterministic chain past a complete dead successor", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
  await writeFile(fixture.lockPath, staleWebPublishOwner(424_242), "utf8");
  const lockIdentity = await lstat(fixture.lockPath);
  const firstOwnerId = "interrupted-recovery-owner-0";
  const secondOwnerId = "interrupted-recovery-owner-1";
  const initialClaim = webPublishRecoveryClaimPath(fixture, lockIdentity);
  const successorClaim = webPublishRecoveryClaimPath(fixture, lockIdentity, 1, firstOwnerId);
  await writeFile(initialClaim, staleWebPublishOwner(424_243, firstOwnerId), "utf8");
  await writeFile(successorClaim, staleWebPublishOwner(424_244, secondOwnerId), "utf8");

  await publishTransaction(fixture, "new", {
    testOnlyProcessIsAliveImpl: (pid) => pid === process.pid,
  });

  assert.equal(await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"), "new");
  assert.deepEqual((await readdir(fixture.parent)).sort(), ["web"]);
});

test("waits for a live recovery owner without installing a successor claim", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
  await writeFile(fixture.lockPath, staleWebPublishOwner(424_242), "utf8");
  const lockIdentity = await lstat(fixture.lockPath);
  const liveClaim = webPublishRecoveryClaimPath(fixture, lockIdentity);
  const liveClaimContent = staleWebPublishOwner(424_243, "live-recovery-owner");
  await writeFile(liveClaim, liveClaimContent, "utf8");
  let observedLiveOwner!: () => void;
  const liveOwnerObserved = new Promise<void>((resolve) => {
    observedLiveOwner = resolve;
  });

  const publish = publishTransaction(fixture, "new", {
    testOnlyProcessIsAliveImpl(pid) {
      if (pid === 424_243) {
        observedLiveOwner();
        return true;
      }
      return pid === process.pid;
    },
  });
  await liveOwnerObserved;
  assert.equal(await readFile(liveClaim, "utf8"), liveClaimContent);
  assert.deepEqual(
    (await readdir(fixture.parent)).filter((entry) => entry.startsWith(path.basename(liveClaim))),
    [path.basename(liveClaim)],
  );

  await rm(liveClaim);
  await publish;
  assert.equal(await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"), "new");
  assert.deepEqual((await readdir(fixture.parent)).sort(), ["web"]);
});

test("recovers the deterministic final-plus-backup crash states", async (t) => {
  await t.test("an admitted final wins and its older backup is removed", async (t) => {
    const fixture = await createPublishFixture();
    t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
    await writePublishMarker(fixture.finalRoot, "committed");
    await writePublishMarker(fixture.backupRoot, "old");

    await assert.rejects(
      publishTransaction(fixture, "unused", {
        async buildTemporaryArtifact() {
          throw new Error("stop after recovery");
        },
      }),
      /stop after recovery/u,
    );

    assert.equal(await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"), "committed");
    assert.deepEqual((await readdir(fixture.parent)).sort(), ["web"]);
  });

  await t.test("an admitted backup replaces a rejected final", async (t) => {
    const fixture = await createPublishFixture();
    t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
    await writePublishMarker(fixture.finalRoot, "invalid-new");
    await writePublishMarker(fixture.backupRoot, "old");

    await assert.rejects(
      publishTransaction(fixture, "unused", {
        async buildTemporaryArtifact() {
          throw new Error("stop after recovery");
        },
      }),
      /stop after recovery/u,
    );

    assert.equal(await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"), "old");
    assert.deepEqual((await readdir(fixture.parent)).sort(), ["web"]);
  });

  await t.test("two rejected generations fail closed without mutation", async (t) => {
    const fixture = await createPublishFixture();
    t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
    await writePublishMarker(fixture.finalRoot, "invalid-new");
    await writePublishMarker(fixture.backupRoot, "invalid-old");
    let buildCalled = false;

    await assert.rejects(
      publishTransaction(fixture, "unused", {
        async buildTemporaryArtifact() {
          buildCalled = true;
        },
      }),
      /Neither Web artifact recovery target is admitted/u,
    );

    assert.equal(buildCalled, false);
    assert.equal(await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"), "invalid-new");
    assert.equal(
      await readFile(path.join(fixture.backupRoot, "marker.txt"), "utf8"),
      "invalid-old",
    );
  });
});

test("rechecks every interrupted-generation identity after asynchronous admission", async (t) => {
  await t.test("backup-only replacement is not promoted or deleted", async (t) => {
    const fixture = await createPublishFixture();
    t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
    await writePublishMarker(fixture.backupRoot, "old");
    let buildCalled = false;

    await assert.rejects(
      publishTransaction(fixture, "unused", {
        async resolveArtifactImpl(options) {
          const resolved = await acceptingMarkerResolver(options);
          if (options.artifactRoot === fixture.backupRoot) {
            await rm(fixture.backupRoot, { recursive: true });
            await writePublishMarker(fixture.backupRoot, "external-backup");
          }
          return resolved;
        },
        async buildTemporaryArtifact() {
          buildCalled = true;
        },
      }),
      /Web artifact publish recovery backup changed/u,
    );

    assert.equal(buildCalled, false);
    await assert.rejects(lstat(fixture.finalRoot), /ENOENT/u);
    assert.equal(
      await readFile(path.join(fixture.backupRoot, "marker.txt"), "utf8"),
      "external-backup",
    );
  });

  await t.test("final-valid cleanup never deletes a replacement backup", async (t) => {
    const fixture = await createPublishFixture();
    t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
    await writePublishMarker(fixture.finalRoot, "committed");
    await writePublishMarker(fixture.backupRoot, "old");
    let buildCalled = false;

    await assert.rejects(
      publishTransaction(fixture, "unused", {
        async resolveArtifactImpl(options) {
          const resolved = await acceptingMarkerResolver(options);
          if (options.artifactRoot === fixture.finalRoot) {
            await rm(fixture.backupRoot, { recursive: true });
            await writePublishMarker(fixture.backupRoot, "external-backup");
          }
          return resolved;
        },
        async buildTemporaryArtifact() {
          buildCalled = true;
        },
      }),
      /old backup could not be cleaned/u,
    );

    assert.equal(buildCalled, false);
    assert.equal(await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"), "committed");
    assert.equal(
      await readFile(path.join(fixture.backupRoot, "marker.txt"), "utf8"),
      "external-backup",
    );
  });

  await t.test("backup-valid restore never swaps over a replacement final", async (t) => {
    const fixture = await createPublishFixture();
    t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
    await writePublishMarker(fixture.finalRoot, "invalid-new");
    await writePublishMarker(fixture.backupRoot, "old");
    let buildCalled = false;

    await assert.rejects(
      publishTransaction(fixture, "unused", {
        async resolveArtifactImpl(options) {
          const resolved = await acceptingMarkerResolver(options);
          if (options.artifactRoot === fixture.backupRoot) {
            await rm(fixture.finalRoot, { recursive: true });
            await writePublishMarker(fixture.finalRoot, "external-final");
          }
          return resolved;
        },
        async buildTemporaryArtifact() {
          buildCalled = true;
        },
      }),
      /Interrupted Web artifact final target changed/u,
    );

    assert.equal(buildCalled, false);
    assert.equal(
      await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"),
      "external-final",
    );
    assert.equal(await readFile(path.join(fixture.backupRoot, "marker.txt"), "utf8"), "old");
  });

  await t.test(
    "promoted-final replacement after re-admission is never rolled back over",
    async (t) => {
      const fixture = await createPublishFixture();
      t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
      await writePublishMarker(fixture.finalRoot, "invalid-new");
      await writePublishMarker(fixture.backupRoot, "old");
      let promoted = false;

      await assert.rejects(
        publishTransaction(fixture, "unused", {
          async resolveArtifactImpl(options) {
            const resolved = await acceptingMarkerResolver(options);
            if (
              !promoted &&
              options.artifactRoot === fixture.finalRoot &&
              (await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8")) === "old"
            ) {
              promoted = true;
              await rm(fixture.finalRoot, { recursive: true });
              await writePublishMarker(fixture.finalRoot, "external-promoted-final");
            }
            return resolved;
          },
        }),
        /rollback was incomplete/u,
      );

      assert.equal(promoted, true);
      assert.equal(
        await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"),
        "external-promoted-final",
      );
      const rejected = (await readdir(fixture.parent)).find((entry) =>
        entry.startsWith(".web.rejected-final-"),
      );
      assert.ok(rejected);
      assert.equal(
        await readFile(path.join(fixture.parent, rejected, "marker.txt"), "utf8"),
        "invalid-new",
      );
    },
  );
});

test("serializes overlapping publishers for the sole Web target", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
  let firstBuildStarted!: () => void;
  let releaseFirstBuild!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    firstBuildStarted = resolve;
  });
  const releaseFirst = new Promise<void>((resolve) => {
    releaseFirstBuild = resolve;
  });
  let secondObservedLock!: () => void;
  const secondWaiting = new Promise<void>((resolve) => {
    secondObservedLock = resolve;
  });
  let secondBuildStarted = false;

  const firstPublish = publishTransaction(fixture, "first", {
    async buildTemporaryArtifact(temporaryRoot) {
      firstBuildStarted();
      await releaseFirst;
      await writePublishMarker(temporaryRoot, "first");
    },
  });
  await firstStarted;
  const secondPublish = publishTransaction(fixture, "second", {
    testOnlyProcessIsAliveImpl(pid) {
      assert.equal(pid, process.pid);
      secondObservedLock();
      return true;
    },
    async buildTemporaryArtifact(temporaryRoot) {
      secondBuildStarted = true;
      await writePublishMarker(temporaryRoot, "second");
    },
  });
  await secondWaiting;
  assert.equal(secondBuildStarted, false);
  releaseFirstBuild();

  await Promise.all([firstPublish, secondPublish]);
  assert.equal(secondBuildStarted, true);
  assert.equal(await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"), "second");
  assert.deepEqual((await readdir(fixture.parent)).sort(), ["web"]);
});

test("refuses to swap over a final target whose directory identity changed during build", async (t) => {
  const fixture = await createPublishFixture();
  t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
  await writePublishMarker(fixture.finalRoot, "old");

  await assert.rejects(
    publishTransaction(fixture, "new", {
      async buildTemporaryArtifact(temporaryRoot) {
        await writePublishMarker(temporaryRoot, "new");
        await rm(fixture.finalRoot, { recursive: true });
        await writePublishMarker(fixture.finalRoot, "external-replacement");
      },
    }),
    /Web artifact final target changed during the Web artifact build/u,
  );

  assert.equal(
    await readFile(path.join(fixture.finalRoot, "marker.txt"), "utf8"),
    "external-replacement",
  );
  assert.deepEqual((await readdir(fixture.parent)).sort(), ["web"]);
});

test("empty or partial canonical lock metadata stays fail-closed", async (t) => {
  for (const [name, content] of [
    ["empty", ""],
    ["partial", '{"schemaVersion":1'],
    ["invalid", '{"schemaVersion":1}\n'],
  ] as const) {
    await t.test(name, async (t) => {
      const fixture = await createPublishFixture();
      t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
      await writeFile(fixture.lockPath, content, "utf8");
      let buildCalled = false;

      await assert.rejects(
        publishTransaction(fixture, "new", {
          async buildTemporaryArtifact() {
            buildCalled = true;
          },
        }),
        /incomplete or invalid; refusing to steal/u,
      );

      assert.equal(buildCalled, false);
      assert.equal(await readFile(fixture.lockPath, "utf8"), content);
    });
  }
});

test("empty or partial canonical stale-recovery claims stay fail-closed", async (t) => {
  for (const [name, content] of [
    ["empty", ""],
    ["partial", '{"schemaVersion":1'],
    ["invalid", '{"schemaVersion":1}\n'],
  ] as const) {
    await t.test(name, async (t) => {
      const fixture = await createPublishFixture();
      t.after(() => rm(fixture.repositoryRoot, { force: true, recursive: true }));
      await writeFile(fixture.lockPath, staleWebPublishOwner(424_242), "utf8");
      const lockStats = await lstat(fixture.lockPath);
      const recoveryClaim = path.join(
        fixture.parent,
        `.web.publish-lock.recovery-${lockStats.dev.toString(16)}-${lockStats.ino.toString(16)}`,
      );
      await writeFile(recoveryClaim, content, "utf8");
      let buildCalled = false;

      await assert.rejects(
        publishTransaction(fixture, "new", {
          testOnlyProcessIsAliveImpl(pid) {
            assert.equal(pid, 424_242);
            return false;
          },
          async buildTemporaryArtifact() {
            buildCalled = true;
          },
        }),
        /incomplete or invalid; refusing to steal/u,
      );

      assert.equal(buildCalled, false);
      assert.equal(await readFile(fixture.lockPath, "utf8"), staleWebPublishOwner(424_242));
      assert.equal(await readFile(recoveryClaim, "utf8"), content);
    });
  }
});

test("removes only unoptimized image optimizer aliases before strict pnpm reachability", async (t) => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-web-image-prune-"));
  t.after(() => rm(repositoryRoot, { force: true, recursive: true }));
  const fixture = await createWebFixture(repositoryRoot);
  const imageOptimizer = await createUnoptimizedImageOptimizerFixture(fixture);
  const artifact = await buildFixtureArtifact(fixture);

  for (const relativePath of [...imageOptimizer.removedAliases, ...imageOptimizer.removedEntries]) {
    await assert.rejects(
      lstat(path.join(artifact.artifactRoot, ...relativePath.split("/"))),
      /ENOENT/u,
    );
  }
  assert.equal(
    await readFile(
      path.join(
        artifact.artifactRoot,
        ...imageOptimizer.retainedNextPackage.split("/"),
        "package.json",
      ),
      "utf8",
    ),
    '{"name":"next","version":"fixture"}\n',
  );
});

test("keeps broken and escaping non-optimizer links fail-closed", async (t) => {
  await t.test("broken link", async (t) => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-web-broken-link-"));
    t.after(() => rm(repositoryRoot, { force: true, recursive: true }));
    const fixture = await createWebFixture(repositoryRoot);
    await symlink(
      "missing-package",
      path.join(fixture.standaloneRoot, "node_modules", "unaccounted-broken"),
      "dir",
    );
    await assert.rejects(buildFixtureArtifact(fixture), /Web artifact contains a broken symlink/u);
  });

  await t.test("escaping link", async (t) => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-web-escaping-link-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "workbench-web-outside-artifact-"));
    t.after(() =>
      Promise.all([
        rm(repositoryRoot, { force: true, recursive: true }),
        rm(outside, { force: true, recursive: true }),
      ]),
    );
    const fixture = await createWebFixture(repositoryRoot);
    await symlink(
      outside,
      path.join(fixture.standaloneRoot, "node_modules", "unaccounted-escape"),
      "dir",
    );
    await assert.rejects(
      buildFixtureArtifact(fixture),
      /(?:Web artifact symlink escapes the artifact|Raw standalone symlink target is outside its admitted package roots)/u,
    );
  });
});

test("derives relativeAppDir only from canonical standalone metadata", async (t) => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-web-artifact-metadata-"));
  t.after(() => rm(repositoryRoot, { force: true, recursive: true }));
  const fixture = await createWebFixture(repositoryRoot);
  const metadataPath = path.join(fixture.webBuildRoot, "required-server-files.json");
  const source = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
  await writeFile(
    metadataPath,
    JSON.stringify({ ...source, relativeAppDir: "apps/not-web" }),
    "utf8",
  );
  await assert.rejects(
    readNextStandaloneMetadata(fixture),
    /relativeAppDir is not derived from its metadata roots/u,
  );
});

test("normalizes Windows separators in standalone metadata", async (t) => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-web-windows-metadata-"));
  t.after(() => rm(repositoryRoot, { force: true, recursive: true }));
  const fixture = await createWebFixture(repositoryRoot);
  const metadataPaths = [
    path.join(fixture.webBuildRoot, "required-server-files.json"),
    path.join(
      fixture.standaloneRoot,
      ...RELATIVE_APP_DIRECTORY.split("/"),
      ".next",
      "required-server-files.json",
    ),
  ];
  for (const metadataPath of metadataPaths) {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    await writeFile(
      metadataPath,
      JSON.stringify({ ...metadata, relativeAppDir: String.raw`apps\web` }),
      "utf8",
    );
  }

  const artifact = await buildFixtureArtifact(fixture);

  assert.equal(artifact.manifest.relativeAppDir, RELATIVE_APP_DIRECTORY);
});

test("uses the production-only esbuild policy for the sole Web control entry", () => {
  const options = createWebArtifactBuildOptions({
    appRoot: "/fixture/apps/web",
    entryPoint: "/fixture/apps/web/src/server/web-artifact-main.ts",
    outputFile: "/fixture/.desktop-build/web/web-server.mjs",
  });
  assert.equal(options.absWorkingDir, "/fixture/apps/web");
  assert.deepEqual(options.banner, {
    js:
      'import { createRequire as __workbenchCreateRequire } from "node:module";\n' +
      "const require = __workbenchCreateRequire(import.meta.url);",
  });
  assert.deepEqual(options.external, ["next", "next/*"]);
  assert.equal(options.format, "esm");
  assert.equal(options.platform, "node");
  assert.equal(options.target, "node22");
  assert.equal(options.sourcemap, false);
});

test("measures scoped and hidden artifact paths in strict contract byte order", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-web-artifact-order-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const paths = [
    "node_modules/_private/payload.js",
    "node_modules/.pnpm/store/payload.js",
    "node_modules/@scope/package/payload.js",
    "node_modules/alpha/payload.js",
  ];
  await Promise.all(paths.map((pathname) => writeFixtureFile(root, pathname, pathname)));

  const inventory = await measureWebArtifactTree(root);
  assert.deepEqual(
    inventory.files.map((file) => file.path),
    [...paths].sort(),
  );
});
