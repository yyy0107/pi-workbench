const assert = require("node:assert/strict");
const {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { materializeDesktopRuntime } = require("../scripts/after-pack.cjs");
const { assertRuntimeTreeEquivalent } = require("../scripts/artifact-tree.cjs");

const ELECTRON_TARGET = Object.freeze({
  runtimeFlavor: "electron-node",
  platform: "linux",
  arch: "x64",
  targetTriple: "x86_64-unknown-linux-gnu",
  libc: "glibc",
  nodeVersion: "24.18.1",
  nodeModuleAbi: 148,
  napiVersion: 10,
  electronVersion: "43.4.1",
});

function writeFile(filename, contents = "") {
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, contents);
}

function temporaryDirectory(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "workbench-after-pack-"));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
}

function contextFor(appDirectory, appOutDirectory, resourcesDirectory) {
  return {
    appOutDir: appOutDirectory,
    packager: {
      info: { appDir: appDirectory },
      getResourcesDir(receivedAppOutDirectory) {
        assert.equal(receivedAppOutDirectory, appOutDirectory);
        return resourcesDirectory;
      },
    },
  };
}

test("afterPack replaces builder-mutated output with the exact curated runtime tree", async (t) => {
  const root = temporaryDirectory(t);
  const appDirectory = path.join(root, "staged-app");
  const source = path.join(appDirectory, "desktop-runtime");
  const appOutDirectory = path.join(root, "linux-unpacked");
  const resourcesDirectory = path.join(appOutDirectory, "resources");
  const destination = path.join(resourcesDirectory, "desktop-runtime");
  writeFile(path.join(source, "desktop-artifacts.json"), "{}\n");
  writeFile(
    path.join(source, "node_modules/.pnpm/node-addon-api/node_addon_api.target.mk"),
    "target\n",
  );
  writeFile(
    path.join(source, "node_modules/.pnpm/tree-sitter-bash/bindings/node/binding.cc"),
    "// binding\n",
  );
  writeFile(
    path.join(source, "node_modules/.pnpm/runtime/node_modules/runtime/package.json"),
    '{"name":"runtime","scripts":{"test":"node test.js"}}\n',
  );
  const restrictedFile = path.join(
    source,
    "node_modules/.pnpm/runtime/node_modules/runtime/runtime.js",
  );
  writeFile(restrictedFile, "module.exports = {};\n");
  chmodSync(restrictedFile, 0o600);
  mkdirSync(path.join(source, "node_modules"), { recursive: true });
  symlinkSync(".pnpm/runtime/node_modules/runtime", path.join(source, "node_modules", "runtime"));

  writeFile(path.join(destination, "stale.js"), "stale\n");
  const calls = [];
  const sourceLayout = {
    runtime: { manifest: { target: ELECTRON_TARGET } },
    renderer: { manifest: { buildId: "renderer-build" } },
  };
  const packagedLayout = { packaged: true };
  const result = await materializeDesktopRuntime(
    contextFor(appDirectory, appOutDirectory, resourcesDirectory),
    {
      async resolveLayout(directory, options) {
        calls.push([directory, options]);
        return directory === source ? sourceLayout : packagedLayout;
      },
      resolveTarget: () => ELECTRON_TARGET,
    },
  );

  assert.deepEqual(result, { source, destination, sourceLayout, packagedLayout });
  assert.deepEqual(calls, [
    [source, { expectedTarget: ELECTRON_TARGET }],
    [
      destination,
      {
        expectedTarget: ELECTRON_TARGET,
        expectedRendererBuildId: "renderer-build",
      },
    ],
  ]);
  assert.equal(existsSync(path.join(destination, "stale.js")), false);
  assert.equal(
    readlinkSync(path.join(destination, "node_modules", "runtime"))
      .split(path.sep)
      .join("/"),
    ".pnpm/runtime/node_modules/runtime",
  );
  assertRuntimeTreeEquivalent(source, destination);
});

test("afterPack rejects a staged Runtime built for a different Electron ABI before copying", async (t) => {
  const root = temporaryDirectory(t);
  const appDirectory = path.join(root, "staged-app");
  const source = path.join(appDirectory, "desktop-runtime");
  const appOutDirectory = path.join(root, "linux-unpacked");
  const resourcesDirectory = path.join(appOutDirectory, "resources");
  writeFile(path.join(source, "desktop-artifacts.json"), "{}\n");
  mkdirSync(resourcesDirectory, { recursive: true });
  let copied = false;
  await assert.rejects(
    materializeDesktopRuntime(contextFor(appDirectory, appOutDirectory, resourcesDirectory), {
      copy() {
        copied = true;
      },
      resolveTarget: () => ELECTRON_TARGET,
      async resolveLayout(_directory, options) {
        assert.deepEqual(options, { expectedTarget: ELECTRON_TARGET });
        throw new Error("Runtime artifact target does not match its executable (Node module ABI).");
      },
    }),
    /Node module ABI/u,
  );
  assert.equal(copied, false);
});

test("afterPack confines both the curated source and packaged destination", async (t) => {
  const root = temporaryDirectory(t);
  const appDirectory = path.join(root, "staged-app");
  const appOutDirectory = path.join(root, "linux-unpacked");
  const resourcesDirectory = path.join(appOutDirectory, "resources");
  const outsideSource = path.join(root, "outside-runtime");
  mkdirSync(resourcesDirectory, { recursive: true });
  writeFile(path.join(appDirectory, "desktop-runtime", "desktop-artifacts.json"), "{}\n");
  writeFile(path.join(outsideSource, "desktop-artifacts.json"), "{}\n");

  await assert.rejects(
    materializeDesktopRuntime(
      contextFor(appDirectory, appOutDirectory, path.join(root, "outside-resources")),
    ),
    /Resources directory escapes appOutDir/,
  );
  await assert.rejects(
    materializeDesktopRuntime(contextFor(appDirectory, appOutDirectory, resourcesDirectory), {
      sourceDirectory: outsideSource,
    }),
    /staged desktop-runtime escapes/,
  );
});
