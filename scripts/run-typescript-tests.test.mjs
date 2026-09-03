import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { nodeImportSpecifier, typescriptTestNodeArguments } from "./run-typescript-tests.mjs";

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
