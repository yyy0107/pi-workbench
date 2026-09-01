const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const runtimeHostControl = require("@workbench/host-contracts/runtime-host-control");
const { resolveDesktopArtifactLayout } = require("../scripts/desktop-artifact-layout.cjs");
const support = require("../scripts/desktop-artifact-support.cjs");

test("exports only desktop artifact layout and child control contracts", () => {
  assert.deepEqual(Object.keys(support).sort(), [
    "resolveDesktopArtifactLayout",
    "runtimeHostControl",
  ]);
  assert.equal(support.resolveDesktopArtifactLayout, resolveDesktopArtifactLayout);
  assert.equal(support.runtimeHostControl, runtimeHostControl);
});

test("has no executable launcher or compatibility-supervisor authority", () => {
  const source = readFileSync(
    path.join(__dirname, "..", "scripts", "desktop-artifact-support.cjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /require\.main|pathToFileURL|\blaunch\b/u);
  assert.doesNotMatch(
    source,
    /loadStandaloneConfig|applyTrustedRuntimeArtifact|compatibilityEntrypoint/u,
  );
});
