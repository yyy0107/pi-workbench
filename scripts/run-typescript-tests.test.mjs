import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  nodeImportSpecifier,
  typescriptTestNodeArguments,
  testGlobs,
} from "./run-typescript-tests.mjs";

test("discovers each migrated, legacy and colocated test directory exactly once", async (t) => {
  const projectDirectory = await mkdtemp(path.join(os.tmpdir(), "workbench-test-discovery-"));
  t.after(() => rm(projectDirectory, { recursive: true, force: true }));
  for (const directory of [
    "src/nested",
    "lib/nested",
    "test",
    "tests",
    "node_modules/example",
    "src/.cache",
  ]) {
    await mkdir(path.join(projectDirectory, directory), { recursive: true });
    await writeFile(path.join(projectDirectory, directory, "example.test.ts"), "");
  }
  const globs = await testGlobs({ projectDirectory });
  assert.equal(globs.length, 4);
  assert.equal(new Set(globs).size, 4);
  assert.ok(globs[0].includes("/src/"));
  assert.ok(globs[1].includes("/lib/"));
  assert.ok(globs[2].includes("/test/"));
  assert.ok(globs[3].includes("/tests/"));
});

test("converts the TypeScript loader path to a portable file URL", () => {
  const loaderPath = path.resolve("scripts/register-typescript-test-loader.mjs");
  const specifier = nodeImportSpecifier(loaderPath);

  assert.equal(new URL(specifier).protocol, "file:");
  assert.equal(fileURLToPath(specifier), loaderPath);
});

test("passes a file URL rather than a drive-letter path to Node --import", () => {
  const arguments_ = typescriptTestNodeArguments(["scripts/example.test.ts"]);
  const importIndex = arguments_.indexOf("--import");

  assert.notEqual(importIndex, -1);
  assert.match(arguments_[importIndex + 1] ?? "", /^file:\/\//u);
  assert.deepEqual(arguments_.slice(-2), ["--test", "scripts/example.test.ts"]);
});
