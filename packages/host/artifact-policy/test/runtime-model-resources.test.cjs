const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertRuntimeArtifactModelReadableResourceClassification,
  collectRuntimeArtifactModelReadableResources,
} = require("../src/runtime-model-resources.cjs");

function fixture(t) {
  const artifactRoot = mkdtempSync(path.join(os.tmpdir(), "workbench-runtime-model-resources-"));
  t.after(() => rmSync(artifactRoot, { force: true, recursive: true }));
  const packageRoot = path.join(
    artifactRoot,
    "node_modules",
    ".pnpm",
    "@earendil-works+pi-coding-agent@fixture",
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
  );
  const examplesRoot = path.join(packageRoot, "examples");
  for (const [filename, content] of [
    ["package.json", '{"name":"@earendil-works/pi-coding-agent"}\n'],
    ["README.md", "README\n"],
    ["docs/guide.md", "guide\n"],
    ["examples/sdk/model-readable.ts", "export {};\n"],
    ["examples/sdk/model-readable.test.ts", "export {};\n"],
  ]) {
    const destination = path.join(packageRoot, ...filename.split("/"));
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  const alias = path.join(artifactRoot, "node_modules", "@earendil-works", "pi-coding-agent");
  mkdirSync(path.dirname(alias), { recursive: true });
  symlinkSync(path.relative(path.dirname(alias), packageRoot), alias, "dir");
  return { artifactRoot, examplesRoot, packageRoot };
}

test("derives the exact resolved Pi README/docs/examples closure", (t) => {
  const value = fixture(t);
  const closure = collectRuntimeArtifactModelReadableResources({
    artifactRoot: value.artifactRoot,
  });
  assert.deepEqual(closure.resources, [
    "node_modules/.pnpm/@earendil-works+pi-coding-agent@fixture/node_modules/@earendil-works/pi-coding-agent/README.md",
    "node_modules/.pnpm/@earendil-works+pi-coding-agent@fixture/node_modules/@earendil-works/pi-coding-agent/docs/guide.md",
    "node_modules/.pnpm/@earendil-works+pi-coding-agent@fixture/node_modules/@earendil-works/pi-coding-agent/examples/sdk/model-readable.test.ts",
    "node_modules/.pnpm/@earendil-works+pi-coding-agent@fixture/node_modules/@earendil-works/pi-coding-agent/examples/sdk/model-readable.ts",
  ]);
  assertRuntimeArtifactModelReadableResourceClassification({
    resources: [...closure.resources, "support/regular.json"].sort(),
    modelReadableResources: closure.resources,
    expectedModelReadableResources: closure.resources,
    resolvedExamplesRoot: closure.resolvedExamplesRoot,
  });
});

test("rejects wrong, missing, out-of-resource, and outside-examples model exceptions", (t) => {
  const value = fixture(t);
  const closure = collectRuntimeArtifactModelReadableResources({
    artifactRoot: value.artifactRoot,
  });

  assert.throws(
    () =>
      assertRuntimeArtifactModelReadableResourceClassification({
        resources: closure.resources,
        modelReadableResources: closure.resources.slice(1),
        expectedModelReadableResources: closure.resources,
        resolvedExamplesRoot: closure.resolvedExamplesRoot,
      }),
    /do not match/u,
  );
  assert.throws(
    () =>
      assertRuntimeArtifactModelReadableResourceClassification({
        resources: closure.resources,
        modelReadableResources: [...closure.resources, "outside/not-owned.md"].sort(),
        expectedModelReadableResources: [...closure.resources, "outside/not-owned.md"].sort(),
        resolvedExamplesRoot: closure.resolvedExamplesRoot,
      }),
    /outside the final resources/u,
  );
  assert.throws(
    () =>
      assertRuntimeArtifactModelReadableResourceClassification({
        resources: [...closure.resources, "support/rogue.ts"].sort(),
        modelReadableResources: closure.resources,
        expectedModelReadableResources: closure.resources,
        resolvedExamplesRoot: closure.resolvedExamplesRoot,
      }),
    /outside Pi's resolved examples tree/u,
  );
});

test("keeps the Pi examples exception exact for hyphenated test code", (t) => {
  const value = fixture(t);
  const admittedExample = path.join(value.examplesRoot, "sdk", "model-readable-test.js");
  mkdirSync(path.dirname(admittedExample), { recursive: true });
  writeFileSync(admittedExample, "export {};\n");
  const closure = collectRuntimeArtifactModelReadableResources({
    artifactRoot: value.artifactRoot,
  });
  const ordinaryAsset = "support/folder-test.svg";

  assertRuntimeArtifactModelReadableResourceClassification({
    resources: [...closure.resources, ordinaryAsset].sort(),
    modelReadableResources: closure.resources,
    expectedModelReadableResources: closure.resources,
    resolvedExamplesRoot: closure.resolvedExamplesRoot,
  });
  assert.throws(
    () =>
      assertRuntimeArtifactModelReadableResourceClassification({
        resources: [...closure.resources, ordinaryAsset, "support/next-test.js"].sort(),
        modelReadableResources: closure.resources,
        expectedModelReadableResources: closure.resources,
        resolvedExamplesRoot: closure.resolvedExamplesRoot,
      }),
    /outside Pi's resolved examples tree/u,
  );
});

test("rejects symlinks inside actual Pi model-readable roots", (t) => {
  const value = fixture(t);
  const outside = path.join(value.artifactRoot, "outside.md");
  writeFileSync(outside, "outside\n");
  symlinkSync(outside, path.join(value.packageRoot, "docs", "escaped.md"));
  assert.throws(
    () => collectRuntimeArtifactModelReadableResources({ artifactRoot: value.artifactRoot }),
    /contains a symlink/u,
  );
});

test("admits only inventoried Workbench extension source snapshots and rejects links", (t) => {
  const value = fixture(t);
  const root = path.join(value.artifactRoot, "internal-extensions");
  mkdirSync(path.join(root, "rpiv-todo"), { recursive: true });
  writeFileSync(path.join(root, "rpiv-todo", "index.ts"), "export {};\n");
  const closure = collectRuntimeArtifactModelReadableResources({
    artifactRoot: value.artifactRoot,
  });
  assert.ok(closure.resources.includes("internal-extensions/rpiv-todo/index.ts"));
  const classification = {
    resources: closure.resources,
    modelReadableResources: closure.resources,
    expectedModelReadableResources: closure.resources,
    resolvedExamplesRoot: closure.resolvedExamplesRoot,
  };
  assertRuntimeArtifactModelReadableResourceClassification(classification);
  assert.throws(
    () =>
      assertRuntimeArtifactModelReadableResourceClassification({
        ...classification,
        resources: [...closure.resources, "internal-extensions/not-in-inventory.ts"],
      }),
    /outside Pi's/,
  );
  symlinkSync(path.join(value.packageRoot, "README.md"), path.join(root, "linked.md"));
  assert.throws(
    () => collectRuntimeArtifactModelReadableResources({ artifactRoot: value.artifactRoot }),
    /contains a symlink/,
  );
});
