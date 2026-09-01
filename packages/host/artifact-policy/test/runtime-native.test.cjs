const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  collectNativeRuntimeInventory,
  expectedNativeRuntimeFiles,
  isNativeRuntimeFile,
  prunePackageNativeVariants,
} = require("../src/runtime-native.cjs");

const TARGET = Object.freeze({ platform: "linux", arch: "x64" });

function temporaryDirectory(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "workbench-native-helper-"));
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
