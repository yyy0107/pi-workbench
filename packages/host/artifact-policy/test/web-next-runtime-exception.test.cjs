const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertWebArtifactNextRuntimeExceptionResource,
  assertWebArtifactNextWebpackRuntimeResources,
  resolveWebArtifactNextRuntimeException,
  resolveWebArtifactNextWebpackRuntime,
} = require("../src/web-next-runtime-exception.cjs");

function writeFile(filename, contents = "") {
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, contents);
}

function fixture(t) {
  const artifactRoot = mkdtempSync(path.join(os.tmpdir(), "workbench-web-next-runtime-"));
  t.after(() => rmSync(artifactRoot, { force: true, recursive: true }));
  const packageRoot = path.join(
    artifactRoot,
    "node_modules",
    ".pnpm",
    "next@fixture",
    "node_modules",
    "next",
  );
  const runtimeFile = path.join(packageRoot, "dist", "cli", "next-test.js");
  const configSchema = path.join(packageRoot, "dist", "server", "config-schema.js");
  writeFile(path.join(packageRoot, "package.json"), '{"name":"next","version":"16.3.1"}\n');
  writeFile(configSchema, '"use strict";\nconst _nexttest = require("../cli/next-test");\n');
  writeFile(runtimeFile, '"use strict";\n');
  const alias = path.join(artifactRoot, "node_modules", "next");
  symlinkSync(path.relative(path.dirname(alias), packageRoot), alias, "dir");
  return {
    alias,
    artifactRoot,
    configSchema,
    packageRoot,
    relativeRuntimeFile: path.relative(artifactRoot, runtimeFile).split(path.sep).join("/"),
    runtimeFile,
  };
}

function writeWebpackRuntime(value) {
  const configUtils = path.join(value.packageRoot, "dist", "server", "config-utils.js");
  const webpackRoot = path.join(value.packageRoot, "dist", "compiled", "webpack");
  const babelManifest = path.join(
    value.packageRoot,
    "dist",
    "compiled",
    "@babel",
    "runtime",
    "package.json",
  );
  writeFile(
    configUtils,
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
  );
  writeFile(
    path.join(webpackRoot, "webpack-lib.js"),
    'module.exports = require("./webpack.js").webpack;\n',
  );
  writeFile(path.join(webpackRoot, "webpack.js"), 'module.exports = require("./bundle5")();\n');
  writeFile(path.join(webpackRoot, "bundle5.js"), "module.exports = () => ({});\n");
  writeFile(babelManifest, '{"name":"@babel/runtime","version":"fixture"}\n');
  return {
    babelManifest,
    bundle: path.join(webpackRoot, "bundle5.js"),
    configUtils,
    resources: [
      babelManifest,
      path.join(webpackRoot, "bundle5.js"),
      path.join(webpackRoot, "webpack-lib.js"),
      path.join(webpackRoot, "webpack.js"),
    ],
    webpackRoot,
  };
}

test("derives the one physical Next runtime exception and requires manifest resource ownership", (t) => {
  const value = fixture(t);
  const exception = resolveWebArtifactNextRuntimeException({ artifactRoot: value.artifactRoot });
  assert.equal(exception.artifactRelativePath, value.relativeRuntimeFile);
  assert.equal(exception.nextPackageRoot, value.packageRoot);
  assert.equal(exception.runtimeFile, value.runtimeFile);
  assert.deepEqual(exception.packageIdentity, { name: "next", version: "16.3.1" });

  assert.equal(
    assertWebArtifactNextRuntimeExceptionResource({
      artifactRoot: value.artifactRoot,
      resources: [value.relativeRuntimeFile],
    }).artifactRelativePath,
    value.relativeRuntimeFile,
  );
  for (const resources of [[], [value.relativeRuntimeFile, value.relativeRuntimeFile]]) {
    assert.throws(
      () =>
        assertWebArtifactNextRuntimeExceptionResource({
          artifactRoot: value.artifactRoot,
          resources,
        }),
      /owned exactly once by Web manifest resources/u,
    );
  }
});

test("fails closed when the Next runtime exception lacks exact identity or dependency provenance", async (t) => {
  await t.test("missing dependency", (t) => {
    const value = fixture(t);
    rmSync(value.runtimeFile);
    assert.throws(
      () => resolveWebArtifactNextRuntimeException({ artifactRoot: value.artifactRoot }),
      /ENOENT/u,
    );
  });

  await t.test("wrong package identity", (t) => {
    const value = fixture(t);
    writeFile(path.join(value.packageRoot, "package.json"), '{"name":"not-next","version":"1"}');
    assert.throws(
      () => resolveWebArtifactNextRuntimeException({ artifactRoot: value.artifactRoot }),
      /exact Next package/u,
    );
  });

  await t.test("comment-only dependency text", (t) => {
    const value = fixture(t);
    writeFile(value.configSchema, '// require("../cli/next-test")\nmodule.exports = {};\n');
    assert.throws(
      () => resolveWebArtifactNextRuntimeException({ artifactRoot: value.artifactRoot }),
      /required top-level/u,
    );
  });

  await t.test("nested dead dependency", (t) => {
    const value = fixture(t);
    writeFile(value.configSchema, 'if (false) require("../cli/next-test");\n');
    assert.throws(
      () => resolveWebArtifactNextRuntimeException({ artifactRoot: value.artifactRoot }),
      /required top-level/u,
    );
  });

  await t.test("shadowed require", (t) => {
    const value = fixture(t);
    writeFile(
      value.configSchema,
      '"use strict";\nconst require = () => ({});\nconst _nexttest = require("../cli/next-test");\n',
    );
    assert.throws(
      () => resolveWebArtifactNextRuntimeException({ artifactRoot: value.artifactRoot }),
      /required top-level/u,
    );
  });

  await t.test("shadowed require function", (t) => {
    const value = fixture(t);
    writeFile(
      value.configSchema,
      '"use strict";\nfunction require() {}\nconst _nexttest = require("../cli/next-test");\n',
    );
    assert.throws(
      () => resolveWebArtifactNextRuntimeException({ artifactRoot: value.artifactRoot }),
      /required top-level/u,
    );
  });

  await t.test("ESM import is not the current CommonJS edge", (t) => {
    const value = fixture(t);
    writeFile(value.configSchema, 'import "../cli/next-test";\n');
    assert.throws(
      () => resolveWebArtifactNextRuntimeException({ artifactRoot: value.artifactRoot }),
      /not parseable CommonJS/u,
    );
  });

  await t.test("escaping package alias", (t) => {
    const value = fixture(t);
    const outside = mkdtempSync(path.join(os.tmpdir(), "workbench-web-next-outside-"));
    t.after(() => rmSync(outside, { force: true, recursive: true }));
    rmSync(value.alias);
    symlinkSync(outside, value.alias, "dir");
    assert.throws(
      () => resolveWebArtifactNextRuntimeException({ artifactRoot: value.artifactRoot }),
      /alias escapes the artifact/u,
    );
  });

  await t.test("symlink dependency", (t) => {
    const value = fixture(t);
    writeFile(path.join(value.packageRoot, "dist", "cli", "actual.js"), '"use strict";\n');
    rmSync(value.runtimeFile);
    symlinkSync("actual.js", value.runtimeFile, "file");
    assert.throws(
      () => resolveWebArtifactNextRuntimeException({ artifactRoot: value.artifactRoot }),
      /must be a canonical regular file/u,
    );
  });
});

test("derives Next's exact dynamic webpack runtime closure from config-utils", (t) => {
  const value = fixture(t);
  const webpack = writeWebpackRuntime(value);
  const runtime = resolveWebArtifactNextWebpackRuntime({ artifactRoot: value.artifactRoot });
  const expected = webpack.resources
    .map((filename) => path.relative(value.artifactRoot, filename).split(path.sep).join("/"))
    .sort();
  assert.deepEqual(
    runtime.resources.map((resource) => resource.artifactRelativePath),
    expected,
  );
  assert.deepEqual(runtime.aliasSpecifiers, [
    "next/dist/compiled/@babel/runtime/package.json",
    "next/dist/compiled/webpack/webpack-lib",
  ]);
  assert.deepEqual(
    assertWebArtifactNextWebpackRuntimeResources({
      artifactRoot: value.artifactRoot,
      resources: expected,
    }).resources.map((resource) => resource.artifactRelativePath),
    expected,
  );
  assert.throws(
    () =>
      assertWebArtifactNextWebpackRuntimeResources({
        artifactRoot: value.artifactRoot,
        resources: expected.slice(1),
      }),
    /owned exactly once by Web manifest resources/u,
  );
});

test("derives tracing closure through an exact confined non-root Next alias", (t) => {
  const value = fixture(t);
  const webpack = writeWebpackRuntime(value);
  const confinedAlias = path.join(
    value.artifactRoot,
    "application-fixture",
    "node_modules",
    "next",
  );
  mkdirSync(path.dirname(confinedAlias), { recursive: true });
  symlinkSync(path.relative(path.dirname(confinedAlias), value.packageRoot), confinedAlias, "dir");

  const runtime = resolveWebArtifactNextWebpackRuntime({
    artifactRoot: value.artifactRoot,
    nextAlias: confinedAlias,
  });
  assert.deepEqual(
    runtime.resources.map((resource) => resource.nextPackageRelativePath),
    webpack.resources
      .map((filename) => path.relative(value.packageRoot, filename).split(path.sep).join("/"))
      .sort(),
  );

  assert.throws(
    () =>
      resolveWebArtifactNextWebpackRuntime({
        artifactRoot: value.artifactRoot,
        nextAlias: path.join(path.dirname(value.artifactRoot), "node_modules", "next"),
      }),
    /exact confined node_modules\/next path/u,
  );
});

test("fails closed when Next's webpack alias provenance or dependency closure drifts", async (t) => {
  await t.test("missing alias target", (t) => {
    const value = fixture(t);
    const webpack = writeWebpackRuntime(value);
    rmSync(path.join(webpack.webpackRoot, "webpack-lib.js"));
    assert.throws(
      () => resolveWebArtifactNextWebpackRuntime({ artifactRoot: value.artifactRoot }),
      /cannot resolve next\/dist\/compiled\/webpack\/webpack-lib/u,
    );
  });

  await t.test("tampered require.resolve map", (t) => {
    const value = fixture(t);
    const webpack = writeWebpackRuntime(value);
    writeFile(
      webpack.configUtils,
      '"use strict";\nrequire("../server/require-hook").addHookAliases([["webpack", "next/dist/compiled/webpack/webpack-lib"]]);\n',
    );
    assert.throws(
      () => resolveWebArtifactNextWebpackRuntime({ artifactRoot: value.artifactRoot }),
      /does not resolve its alias table through require\.resolve/u,
    );
  });

  await t.test("symlinked shared bundle", (t) => {
    const value = fixture(t);
    const webpack = writeWebpackRuntime(value);
    writeFile(path.join(webpack.webpackRoot, "actual-bundle.js"), "module.exports = {};\n");
    rmSync(webpack.bundle);
    symlinkSync("actual-bundle.js", webpack.bundle, "file");
    assert.throws(
      () => resolveWebArtifactNextWebpackRuntime({ artifactRoot: value.artifactRoot }),
      /Next compiled webpack bundle must be a canonical regular file/u,
    );
  });
});
