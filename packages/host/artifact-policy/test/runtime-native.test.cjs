const assert = require("node:assert/strict");
const {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  collectNativeRuntimeInventory,
  contentDigest,
  expectedNativeRuntimeFiles,
  isNativeRuntimeFile,
  prunePackageNativeVariants,
  verifyNodePtyNativeBuildManifest,
} = require("../src/runtime-native.cjs");

const TARGET = Object.freeze({ platform: "linux", arch: "x64" });

function temporaryDirectory(t) {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "workbench-native-helper-")));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
}

function file(directory, relativePath, content = relativePath) {
  const destination = path.join(directory, ...relativePath.split("/"));
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

test("one native winner policy drives Node and Electron target shapes", () => {
  const expected = expectedNativeRuntimeFiles(TARGET);
  assert.deepEqual(
    expected.map((item) => `${item.packageName}/${item.relativePath}`),
    [
      "node-pty/build/Release/pty.node",
      "tree-sitter/prebuilds/linux-x64/tree-sitter.node",
      "tree-sitter-bash/prebuilds/linux-x64/tree-sitter-bash.node",
    ],
  );
  assert.equal(isNativeRuntimeFile("node_modules/example/native.node"), true);
  assert.equal(isNativeRuntimeFile("node_modules/example/index.js"), false);
  assert.equal(
    expectedNativeRuntimeFiles({ platform: "darwin", arch: "arm64" }).find((item) =>
      item.relativePath.endsWith("/spawn-helper"),
    )?.executable,
    true,
  );
});

test("prunes non-target native variants and measures only actual regular bytes", (t) => {
  const runtime = temporaryDirectory(t);
  for (const packageName of ["tree-sitter", "tree-sitter-bash"]) {
    const filename = packageName === "tree-sitter" ? "tree-sitter.node" : "tree-sitter-bash.node";
    file(runtime, `node_modules/${packageName}/prebuilds/linux-x64/${filename}`);
    file(runtime, `node_modules/${packageName}/prebuilds/darwin-x64/${filename}`);
    file(runtime, `node_modules/${packageName}/build/Release/${filename}`);
    if (packageName === "tree-sitter-bash") {
      file(runtime, `node_modules/${packageName}/bindings/node/binding_test.js`);
      file(runtime, `node_modules/${packageName}/bindings/node/next-test.js`);
    }
    prunePackageNativeVariants(
      path.join(runtime, "node_modules", packageName),
      packageName,
      TARGET,
    );
  }
  file(runtime, "node_modules/node-pty/build/Release/pty.node");
  file(runtime, "node_modules/node-pty/prebuilds/darwin-x64/pty.node");
  prunePackageNativeVariants(path.join(runtime, "node_modules/node-pty"), "node-pty", TARGET);
  assert.deepEqual(
    collectNativeRuntimeInventory(runtime).map((item) => item.path),
    [
      "node_modules/node-pty/build/Release/pty.node",
      "node_modules/tree-sitter-bash/prebuilds/linux-x64/tree-sitter-bash.node",
      "node_modules/tree-sitter/prebuilds/linux-x64/tree-sitter.node",
    ],
  );
  assert.equal(
    require("node:fs").existsSync(
      path.join(runtime, "node_modules/tree-sitter-bash/bindings/node/binding_test.js"),
    ),
    false,
  );
  assert.equal(
    require("node:fs").existsSync(
      path.join(runtime, "node_modules/tree-sitter-bash/bindings/node/next-test.js"),
    ),
    true,
  );
  assert.equal(
    collectNativeRuntimeInventory(runtime).every((item) => Number.isInteger(item.mode)),
    true,
  );
});

test("materializes the selected Windows node-pty prebuild before pruning", (t) => {
  const runtime = temporaryDirectory(t);
  const packageDirectory = path.join(runtime, "node_modules", "node-pty");
  const target = { platform: "win32", arch: "x64" };
  const expected = expectedNativeRuntimeFiles(target).filter(
    ({ packageName }) => packageName === "node-pty",
  );
  for (const item of expected) {
    file(
      packageDirectory,
      `prebuilds/win32-x64/${item.relativePath.replace(/^build\/Release\//u, "")}`,
      item.role,
    );
  }

  prunePackageNativeVariants(packageDirectory, "node-pty", target);

  assert.equal(existsSync(path.join(packageDirectory, "prebuilds")), false);
  for (const item of expected) {
    assert.equal(readFileSync(path.join(packageDirectory, item.relativePath), "utf8"), item.role);
  }
});

test("defines the complete node-pty release files for all six CI targets", () => {
  const targets = [
    { platform: "win32", arch: "x64", expected: 7 },
    { platform: "win32", arch: "arm64", expected: 7 },
    { platform: "darwin", arch: "x64", expected: 2 },
    { platform: "darwin", arch: "arm64", expected: 2 },
    { platform: "linux", arch: "x64", expected: 1 },
    { platform: "linux", arch: "arm64", expected: 1 },
  ];
  for (const target of targets) {
    const files = expectedNativeRuntimeFiles(target).filter(
      ({ packageName }) => packageName === "node-pty",
    );
    assert.equal(files.length, target.expected, `${target.platform}-${target.arch}`);
  }
  assert.throws(
    () => expectedNativeRuntimeFiles({ platform: "aix", arch: "x64" }),
    /no native policy/u,
  );
});

test("verifies source-built node-pty bytes against the confined CI manifest", (t) => {
  const repositoryRoot = temporaryDirectory(t);
  const packageDirectory = path.join(repositoryRoot, "artifact", "node_modules", "node-pty");
  const target = {
    platform: "linux",
    arch: "x64",
    libc: "glibc",
    targetTriple: "x86_64-unknown-linux-gnu",
  };
  file(packageDirectory, "package.json", JSON.stringify({ name: "node-pty", version: "1.1.0" }));
  const expected = expectedNativeRuntimeFiles(target).filter(
    ({ packageName }) => packageName === "node-pty",
  );
  for (const item of expected) file(packageDirectory, item.relativePath, item.role);
  const manifest = {
    schemaVersion: 1,
    kind: "workbench-node-pty-native-build",
    sourceBuild: true,
    package: { name: "node-pty", version: "1.1.0" },
    target: {
      platform: target.platform,
      arch: target.arch,
      libc: target.libc,
      targetTriple: target.targetTriple,
    },
    files: expected.map((item) => {
      const filePath = path.join(packageDirectory, item.relativePath);
      const stats = require("node:fs").lstatSync(filePath);
      return {
        path: item.relativePath,
        size: stats.size,
        sha256: contentDigest(filePath),
        mode: stats.mode & 0o777,
      };
    }),
  };
  const manifestPath = path.join(repositoryRoot, "native", "node-pty-native-build.json");
  file(repositoryRoot, "native/node-pty-native-build.json", `${JSON.stringify(manifest)}\n`);

  assert.equal(
    verifyNodePtyNativeBuildManifest(packageDirectory, target, manifestPath, { repositoryRoot })
      .sourceBuild,
    true,
  );
  file(packageDirectory, expected[0].relativePath, "drifted");
  assert.throws(
    () =>
      verifyNodePtyNativeBuildManifest(packageDirectory, target, manifestPath, { repositoryRoot }),
    /output drifted/u,
  );
});

test("rejects an unconfined or wrong-target node-pty native build manifest", (t) => {
  const repositoryRoot = temporaryDirectory(t);
  const externalRoot = temporaryDirectory(t);
  const packageDirectory = path.join(repositoryRoot, "node_modules", "node-pty");
  file(packageDirectory, "package.json", JSON.stringify({ name: "node-pty", version: "1.1.0" }));
  const target = { platform: "linux", arch: "x64", libc: "glibc" };
  const manifestPath = path.join(externalRoot, "node-pty-native-build.json");
  file(
    externalRoot,
    "node-pty-native-build.json",
    JSON.stringify({
      schemaVersion: 1,
      kind: "workbench-node-pty-native-build",
      sourceBuild: true,
      package: { name: "node-pty", version: "1.1.0" },
      target: {
        platform: "linux",
        arch: "arm64",
        libc: "glibc",
        targetTriple: "aarch64-unknown-linux-gnu",
      },
      files: [],
    }),
  );
  assert.throws(
    () =>
      verifyNodePtyNativeBuildManifest(packageDirectory, target, manifestPath, { repositoryRoot }),
    /escapes/u,
  );
  assert.throws(
    () => verifyNodePtyNativeBuildManifest(packageDirectory, target, manifestPath),
    /target does not match/u,
  );
});

test("rejects missing, extra, and non-executable manifest-owned native files", (t) => {
  const repositoryRoot = temporaryDirectory(t);
  const packageDirectory = path.join(repositoryRoot, "node_modules", "node-pty");
  const target = {
    platform: "darwin",
    arch: "arm64",
    libc: "none",
    targetTriple: "aarch64-apple-darwin",
  };
  file(packageDirectory, "package.json", JSON.stringify({ name: "node-pty", version: "1.1.0" }));
  const expected = expectedNativeRuntimeFiles(target).filter(
    ({ packageName }) => packageName === "node-pty",
  );
  for (const item of expected) file(packageDirectory, item.relativePath, item.role);
  const manifest = {
    schemaVersion: 1,
    kind: "workbench-node-pty-native-build",
    sourceBuild: true,
    package: { name: "node-pty", version: "1.1.0" },
    target: {
      platform: target.platform,
      arch: target.arch,
      libc: target.libc,
      targetTriple: target.targetTriple,
    },
    files: expected.map((item) => {
      const filePath = path.join(packageDirectory, item.relativePath);
      const stats = require("node:fs").lstatSync(filePath);
      return {
        path: item.relativePath,
        size: stats.size,
        sha256: contentDigest(filePath),
        mode: stats.mode & 0o777,
      };
    }),
  };
  const manifestPath = path.join(repositoryRoot, "node-pty-native-build.json");
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, files: manifest.files.slice(0, 1) }));
  assert.throws(
    () => verifyNodePtyNativeBuildManifest(packageDirectory, target, manifestPath),
    /file set does not match/u,
  );
  writeFileSync(
    manifestPath,
    JSON.stringify({
      ...manifest,
      files: [
        ...manifest.files,
        { path: "build/Release/extra.node", size: 1, sha256: "0".repeat(64), mode: 0o644 },
      ],
    }),
  );
  assert.throws(
    () => verifyNodePtyNativeBuildManifest(packageDirectory, target, manifestPath),
    /file set does not match/u,
  );

  const helperPath = path.join(packageDirectory, "build", "Release", "spawn-helper");
  chmodSync(helperPath, 0o644);
  const helper = manifest.files.find(({ path: filePath }) => filePath.endsWith("spawn-helper"));
  helper.mode = require("node:fs").lstatSync(helperPath).mode & 0o777;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(
    () => verifyNodePtyNativeBuildManifest(packageDirectory, target, manifestPath),
    /not executable/u,
  );
});
