const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  RUNTIME_ARTIFACT_OVERRIDE_ENVIRONMENT_VARIABLES,
  removeRuntimeArtifactOverrides,
  resolveDesktopArtifactSupport,
} = require("../src/runtime-artifact-environment.cjs");

test("packaged Electron removes both external Runtime artifact override channels", () => {
  const environment = {
    HOME: "/preserved",
    WORKBENCH_RUNTIME_ARTIFACT_MANIFEST: "/malicious/outside/artifact-manifest.json",
    WORKBENCH_RUNTIME_ARTIFACT_TARGET_JSON: '{"runtimeFlavor":"node"}',
  };
  assert.equal(removeRuntimeArtifactOverrides(environment), environment);
  assert.deepEqual(RUNTIME_ARTIFACT_OVERRIDE_ENVIRONMENT_VARIABLES, [
    "WORKBENCH_RUNTIME_ARTIFACT_MANIFEST",
    "WORKBENCH_RUNTIME_ARTIFACT_TARGET_JSON",
  ]);
  assert.deepEqual(environment, { HOME: "/preserved" });
});

test("admits only the exact canonical regular desktop artifact support module", (t) => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "workbench-support-admission-"));
  t.after(() => rmSync(parent, { force: true, recursive: true }));
  const runtimeRoot = path.join(parent, "desktop-runtime");
  const supportPath = path.join(runtimeRoot, "desktop-artifact-support.cjs");
  mkdirSync(runtimeRoot);
  writeFileSync(supportPath, "module.exports = {};\n");
  assert.deepEqual(resolveDesktopArtifactSupport(runtimeRoot), { runtimeRoot, supportPath });

  const runtimeAlias = path.join(parent, "runtime-alias");
  symlinkSync(runtimeRoot, runtimeAlias);
  assert.throws(() => resolveDesktopArtifactSupport(runtimeAlias), /regular directory/u);

  rmSync(supportPath);
  const outsideSupport = path.join(parent, "outside-support.cjs");
  writeFileSync(outsideSupport, "module.exports = {};\n");
  symlinkSync(outsideSupport, supportPath);
  assert.throws(
    () => resolveDesktopArtifactSupport(runtimeRoot),
    /support module must be a regular file/u,
  );
});
