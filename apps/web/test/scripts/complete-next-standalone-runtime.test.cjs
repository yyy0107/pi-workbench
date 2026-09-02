const assert = require("node:assert/strict");
const {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createWorkbenchPaths } = require("../../../../scripts/workbench-paths.cjs");
const {
  completeNextStandaloneRuntime,
} = require("../../scripts/complete-next-standalone-runtime.cjs");
const { assertCompletedRuntime } = require("../../scripts/web-standalone-smoke.cjs");

function writeFile(filePath, contents = "") {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writePackage(packageRoot, manifest, files = {}) {
  writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify(manifest)}\n`);
  for (const [relativeFile, contents] of Object.entries(files)) {
    writeFile(path.join(packageRoot, ...relativeFile.split("/")), contents);
  }
}

function fixture(t) {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "workbench-next-completion-"));
  t.after(() => rmSync(repositoryRoot, { force: true, recursive: true }));
  const paths = createWorkbenchPaths({ repositoryRoot });
  writeFile(path.join(paths.webRoot, "package.json"), '{"name":"web-fixture"}\n');
  const sourceNextRoot = path.join(
    repositoryRoot,
    "node_modules",
    ".pnpm",
    "next@16.3.1_fixture",
    "node_modules",
    "next",
  );
  const sourceHelpersRoot = path.join(
    repositoryRoot,
    "node_modules",
    ".pnpm",
    "@swc+helpers@0.5.23",
    "node_modules",
    "@swc",
    "helpers",
  );
  const sourceTslibRoot = path.join(
    repositoryRoot,
    "node_modules",
    ".pnpm",
    "tslib@2.8.1",
    "node_modules",
    "tslib",
  );
  writePackage(sourceNextRoot, {
    name: "next",
    version: "16.3.1",
    exports: { "./package.json": "./package.json" },
  });
  writePackage(
    sourceHelpersRoot,
    {
      name: "@swc/helpers",
      version: "0.5.23",
      dependencies: { tslib: "^2.8.0" },
      exports: {
        "./package.json": "./package.json",
        "./_/_interop_require_default": {
          "module-sync": "./esm/_interop_require_default.js",
          default: "./cjs/_interop_require_default.cjs",
        },
      },
    },
    {
      LICENSE: "helper license",
      "cjs/_interop_require_default.cjs": "module.exports = {};",
      "esm/_interop_require_default.js": "export function _() {}",
      "esm/index.js": "export {};",
      "src/_interop_require_default.mjs": "export function _() {}",
    },
  );
  writePackage(
    sourceTslibRoot,
    { name: "tslib", version: "2.8.1" },
    {
      "LICENSE.txt": "tslib license",
      "modules/index.js": "export {};",
      "tslib.js": "module.exports = {};",
    },
  );
  const sourceNextHelpersAlias = path.join(path.dirname(sourceNextRoot), "@swc", "helpers");
  mkdirSync(path.dirname(sourceNextHelpersAlias), { recursive: true });
  symlinkSync(
    path.relative(path.dirname(sourceNextHelpersAlias), sourceHelpersRoot),
    sourceNextHelpersAlias,
    "dir",
  );
  const sourceHelpersTslibAlias = path.join(path.dirname(path.dirname(sourceHelpersRoot)), "tslib");
  symlinkSync(
    path.relative(path.dirname(sourceHelpersTslibAlias), sourceTslibRoot),
    sourceHelpersTslibAlias,
    "dir",
  );
  const sourceNextApplicationAlias = path.join(paths.webRoot, "node_modules", "next");
  mkdirSync(path.dirname(sourceNextApplicationAlias), { recursive: true });
  symlinkSync(
    path.relative(path.dirname(sourceNextApplicationAlias), sourceNextRoot),
    sourceNextApplicationAlias,
    "dir",
  );

  const standaloneRoot = paths.webStandaloneRoot;
  const runtimeNextRoot = path.join(standaloneRoot, path.relative(repositoryRoot, sourceNextRoot));
  const runtimeNextApplicationAlias = path.join(
    standaloneRoot,
    "apps",
    "web",
    "node_modules",
    "next",
  );
  const runtimeNextRootAlias = path.join(standaloneRoot, "node_modules", "next");
  const runtimeHelpersRoot = path.join(
    standaloneRoot,
    "node_modules",
    ".pnpm",
    "@swc+helpers@0.5.23",
    "node_modules",
    "@swc",
    "helpers",
  );
  writePackage(runtimeNextRoot, { name: "next", version: "16.3.1" });
  mkdirSync(path.dirname(runtimeNextApplicationAlias), { recursive: true });
  symlinkSync(
    path.relative(path.dirname(runtimeNextApplicationAlias), runtimeNextRoot),
    runtimeNextApplicationAlias,
    "dir",
  );
  writePackage(
    runtimeHelpersRoot,
    {
      name: "@swc/helpers",
      version: "0.5.23",
      exports: {
        "./package.json": "./package.json",
        "./_/_interop_require_default": {
          "module-sync": "./esm/_interop_require_default.js",
          default: "./cjs/_interop_require_default.cjs",
        },
      },
    },
    {
      "cjs/_interop_require_default.cjs": "partial CommonJS trace",
      "obsolete.txt": "remove me",
    },
  );
  const runtimeHelpersLink = path.join(path.dirname(runtimeNextRoot), "@swc", "helpers");
  mkdirSync(path.dirname(runtimeHelpersLink), { recursive: true });
  symlinkSync(
    path.relative(path.dirname(runtimeHelpersLink), runtimeHelpersRoot),
    runtimeHelpersLink,
  );
  return {
    paths,
    repositoryRoot,
    runtimeHelpersLink,
    runtimeHelpersRoot,
    runtimeNextApplicationAlias,
    runtimeNextRoot,
    runtimeNextRootAlias,
    standaloneRoot,
  };
}

test("completes the full helper and tslib packages and is idempotent", (t) => {
  const {
    paths,
    runtimeHelpersRoot,
    runtimeNextApplicationAlias,
    runtimeNextRoot,
    runtimeNextRootAlias,
    standaloneRoot,
  } = fixture(t);
  const first = completeNextStandaloneRuntime({ paths, standaloneRoot });

  assert.equal(first.nextVersion, "16.3.1");
  assert.deepEqual(
    first.completedPackages.map(({ name, version }) => `${name}@${version}`),
    ["@swc/helpers@0.5.23", "tslib@2.8.1"],
  );
  assert.equal(
    readFileSync(path.join(runtimeHelpersRoot, "esm", "_interop_require_default.js"), "utf8"),
    "export function _() {}",
  );
  assert.equal(
    readFileSync(path.join(runtimeHelpersRoot, "src", "_interop_require_default.mjs"), "utf8"),
    "export function _() {}",
  );
  assert.equal(existsSync(path.join(runtimeHelpersRoot, "obsolete.txt")), false);
  assert.equal(
    readFileSync(path.join(standaloneRoot, "node_modules", "tslib", "tslib.js"), "utf8"),
    "module.exports = {};",
  );
  assert.equal(realpathSync(runtimeNextRootAlias), runtimeNextRoot);
  assert.equal(realpathSync(runtimeNextApplicationAlias), runtimeNextRoot);
  const closure = assertCompletedRuntime(standaloneRoot);
  assert.match(
    closure.helperModule.split(path.sep).join("/"),
    /\/@swc\/helpers\/esm\/_interop_require_default\.js$/u,
  );
  assert.equal(
    closure.tslibManifest,
    path.join(standaloneRoot, "node_modules", "tslib", "package.json"),
  );

  const second = completeNextStandaloneRuntime({ paths, standaloneRoot });
  assert.deepEqual(second, first);
  assert.equal(
    readFileSync(path.join(runtimeHelpersRoot, "esm", "_interop_require_default.js"), "utf8"),
    "export function _() {}",
  );
  assert.equal(realpathSync(runtimeNextRootAlias), runtimeNextRoot);
});

test("restores the application Next alias when it is absent", (t) => {
  const {
    paths,
    runtimeNextApplicationAlias,
    runtimeNextRoot,
    runtimeNextRootAlias,
    standaloneRoot,
  } = fixture(t);
  rmSync(runtimeNextApplicationAlias);
  symlinkSync(
    path.relative(path.dirname(runtimeNextRootAlias), runtimeNextRoot),
    runtimeNextRootAlias,
    "dir",
  );

  const report = completeNextStandaloneRuntime({ paths, standaloneRoot });

  assert.equal(report.nextVersion, "16.3.1");
  assert.equal(realpathSync(runtimeNextApplicationAlias), runtimeNextRoot);
  assert.equal(realpathSync(runtimeNextRootAlias), runtimeNextRoot);
});

test("repairs a partial Next directory left by Windows trace copying", (t) => {
  const {
    paths,
    runtimeNextApplicationAlias,
    runtimeNextRoot,
    runtimeNextRootAlias,
    standaloneRoot,
  } = fixture(t);
  rmSync(runtimeNextApplicationAlias);
  writeFile(path.join(runtimeNextApplicationAlias, "dist", "partial.js"), "partial trace");

  const report = completeNextStandaloneRuntime({ paths, standaloneRoot });

  assert.equal(report.nextVersion, "16.3.1");
  assert.equal(realpathSync(runtimeNextApplicationAlias), runtimeNextRoot);
  assert.equal(realpathSync(runtimeNextRootAlias), runtimeNextRoot);
  assert.equal(existsSync(path.join(runtimeNextApplicationAlias, "dist", "partial.js")), false);
});

test("rejects a standalone dependency version mismatch before replacing files", (t) => {
  const { paths, runtimeHelpersRoot, standaloneRoot } = fixture(t);
  writePackage(
    runtimeHelpersRoot,
    {
      name: "@swc/helpers",
      version: "0.5.22",
      exports: { "./package.json": "./package.json" },
    },
    { "obsolete.txt": "preserved" },
  );

  assert.throws(
    () => completeNextStandaloneRuntime({ paths, standaloneRoot }),
    /Standalone @swc\/helpers does not match the installed build dependency/u,
  );
  assert.equal(readFileSync(path.join(runtimeHelpersRoot, "obsolete.txt"), "utf8"), "preserved");
});

test("repairs an absolute helper alias without touching its external target", (t) => {
  const { paths, repositoryRoot, runtimeHelpersLink, runtimeHelpersRoot, standaloneRoot } =
    fixture(t);
  const outsideHelpersRoot = path.join(repositoryRoot, "outside", "@swc", "helpers");
  writePackage(
    outsideHelpersRoot,
    {
      name: "@swc/helpers",
      version: "0.5.23",
      exports: { "./package.json": "./package.json" },
    },
    { "outside-marker.txt": "untouched" },
  );
  rmSync(runtimeHelpersLink);
  symlinkSync(outsideHelpersRoot, runtimeHelpersLink, "dir");

  completeNextStandaloneRuntime({ paths, standaloneRoot });

  assert.equal(realpathSync(runtimeHelpersLink), runtimeHelpersRoot);
  assert.equal(
    readFileSync(path.join(outsideHelpersRoot, "outside-marker.txt"), "utf8"),
    "untouched",
  );
  assert.equal(existsSync(path.join(runtimeHelpersRoot, "obsolete.txt")), false);
});

test("repairs an absolute application Next alias without touching its external target", (t) => {
  const {
    paths,
    repositoryRoot,
    runtimeNextApplicationAlias,
    runtimeNextRoot,
    runtimeNextRootAlias,
    standaloneRoot,
  } = fixture(t);
  const outsideNextRoot = path.join(repositoryRoot, "outside", "next");
  writePackage(outsideNextRoot, { name: "next", version: "16.3.1" });
  rmSync(runtimeNextApplicationAlias);
  symlinkSync(outsideNextRoot, runtimeNextApplicationAlias, "dir");

  completeNextStandaloneRuntime({ paths, standaloneRoot });

  assert.equal(realpathSync(runtimeNextApplicationAlias), runtimeNextRoot);
  assert.equal(realpathSync(runtimeNextRootAlias), runtimeNextRoot);
  assert.equal(
    readFileSync(path.join(outsideNextRoot, "package.json"), "utf8"),
    '{"name":"next","version":"16.3.1"}\n',
  );
});

test("rejects a preexisting root Next alias with a different physical owner", (t) => {
  const { paths, runtimeNextRootAlias, standaloneRoot } = fixture(t);
  const conflictingNextRoot = path.join(
    standaloneRoot,
    "node_modules",
    ".pnpm",
    "next@conflict",
    "node_modules",
    "next",
  );
  writePackage(conflictingNextRoot, { name: "next", version: "16.3.1" });
  symlinkSync(
    path.relative(path.dirname(runtimeNextRootAlias), conflictingNextRoot),
    runtimeNextRootAlias,
    "dir",
  );

  assert.throws(
    () => completeNextStandaloneRuntime({ paths, standaloneRoot }),
    /Standalone root Next alias does not resolve to the traced package owner/u,
  );
  assert.equal(realpathSync(runtimeNextRootAlias), conflictingNextRoot);
});
