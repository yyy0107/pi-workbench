import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseWorkspacePackagePatterns } from "./check-workspace-dependencies.mjs";
import { testGlobs } from "./run-typescript-tests.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));

async function json(relativeFile) {
  return JSON.parse(await readFile(path.join(REPOSITORY_ROOT, relativeFile), "utf8"));
}

test("uses exact, non-overlapping workspace leaf patterns", async () => {
  const source = await readFile(path.join(REPOSITORY_ROOT, "pnpm-workspace.yaml"), "utf8");
  assert.deepEqual(parseWorkspacePackagePatterns(source), [
    "packages/contracts/*",
    "packages/server/*",
    "packages/agent-runtime/core/*",
    "packages/agent-runtime/adapters/pi/*",
  ]);
});

test("keeps Next and the root alias out of the shared TypeScript config", async () => {
  const base = await json("tsconfig.base.json");
  assert.equal(base.compilerOptions.paths, undefined);
  assert.equal(base.compilerOptions.plugins, undefined);
  assert.equal(base.compilerOptions.noEmit, true);
  assert.equal(base.compilerOptions.strict, true);
});

test("the root app TypeScript project does not claim workspace package sources", async () => {
  const root = await json("tsconfig.json");
  assert.equal(root.extends, "./tsconfig.base.json");
  assert.ok(root.exclude.includes("packages"));
  assert.equal(root.include.includes("**/*.ts"), false);
  assert.equal(root.include.includes("**/*.tsx"), false);
  assert.deepEqual(root.compilerOptions.paths, { "@/*": ["./*"] });
});

test("root package scripts run app and package checks without recursively selecting the root", async () => {
  const manifest = await json("package.json");
  assert.equal(manifest.scripts.typecheck, "pnpm typecheck:root && pnpm typecheck:packages");
  assert.equal(manifest.scripts.test, "pnpm test:root && pnpm test:packages");
  assert.match(manifest.scripts["typecheck:packages"], /--filter '\.\/packages\/\*\*'/);
  assert.match(manifest.scripts["test:packages"], /--filter '\.\/packages\/\*\*'/);
  assert.doesNotMatch(manifest.scripts["typecheck:root"], /recursive|\s-r\s/);
  assert.doesNotMatch(manifest.scripts["test:root"], /recursive|\s-r\s/);
});

test("the central test runner discovers repository tests without reading the caller cwd", async () => {
  const runnerSource = await readFile(
    path.join(REPOSITORY_ROOT, "scripts/run-typescript-tests.mjs"),
    "utf8",
  );
  const globs = await testGlobs();
  assert.equal(runnerSource.includes("process.cwd()"), false);
  for (const directory of ["electron", "run_scripts", "runtime", "scripts"]) {
    assert.ok(
      globs.includes(`${directory}/**/*.{test,spec}.{js,cjs,mjs,ts,cts,mts,jsx,tsx}`),
      `${directory} tests must remain in the root test suite`,
    );
  }
  assert.equal(
    globs.some((glob) => glob.startsWith("packages/")),
    false,
  );
});
