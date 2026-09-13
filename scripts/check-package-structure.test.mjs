import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkPackageStructure,
  packageStructureInventory,
  compareStructureBaseline,
} from "./check-package-structure.mjs";

async function fixture(t, files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-structure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "scripts"));
  for (const [name, value] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), value);
  }
  return root;
}

test("accepts a two-level package with shallow src and lib and root tests", async (t) => {
  const root = await fixture(t, {
    "packages/client/ui/package.json": "{}",
    "packages/client/ui/src/index.ts": 'export * from "./components/button";',
    "packages/client/ui/src/components/button.tsx":
      'import type { X } from "../../types"; export interface Button { value: X }',
    "packages/client/ui/lib/components/button.tsx": "export const button = true;",
    "packages/client/ui/tests/button.test.ts": 'import "../src/components/button";',
    "packages/client/ui/tests/fixtures/inner/package.json": "{}",
  });
  const inventory = await checkPackageStructure(root);
  assert.equal(inventory.packages.length, 1);
  assert.equal(inventory.tests.length, 1);
  assert.deepEqual(inventory.violations, []);
});

test("detects unlisted deep roots, nested packages, deep assets, relative imports and old test locations", async (t) => {
  const root = await fixture(t, {
    "packages/pi/pi-server/package.json": "{}",
    "packages/pi/pi-server/src/styles/nested/theme.css": "",
    "packages/pi/pi-server/src/internal/browser/package.json": "{}",
    "packages/pi/pi-server/src/internal/browser/src/index.ts": "",
    "packages/pi/pi-server/src/session.test.ts":
      'import "../../../contracts"; const fixture = `import "../../../../fake";`;',
  });
  const { violations } = await packageStructureInventory(root);
  assert.deepEqual([...new Set(violations.map((item) => item.rule))].sort(), [
    "nested-package",
    "package-root",
    "relative-import",
    "source-layout",
    "src-depth",
    "test-location",
  ]);
  assert.equal(violations.filter((item) => item.rule === "relative-import").length, 1);
  await assert.rejects(checkPackageStructure(root), /Package structure violations/);
});

test("requires actual source in both roots and checks lib depth, imports and misplaced tests", async (t) => {
  const root = await fixture(t, {
    "packages/client/ui/package.json": "{}",
    "packages/client/ui/src/index.ts": 'export const createButton = () => "button";',
    "packages/client/ui/lib/.gitkeep": "",
  });
  await assert.rejects(checkPackageStructure(root), /lib\/ must contain actual package source/);
  await writeFile(path.join(root, "packages/client/ui/lib/index.ts"), "");
  await assert.rejects(checkPackageStructure(root), /lib\/ must contain actual package source/);
  await writeFile(
    path.join(root, "packages/client/ui/lib/index.ts"),
    "export const button = true;",
  );
  await checkPackageStructure(root);
  await writeFile(
    path.join(root, "packages/client/ui/package.json"),
    JSON.stringify({ exports: { ".": "./lib/index.ts" } }),
  );
  await assert.rejects(checkPackageStructure(root), /public source entry must be in src/);
  await writeFile(
    path.join(root, "packages/client/ui/package.json"),
    JSON.stringify({ exports: { ".": "./src/index.ts" } }),
  );
  await mkdir(path.join(root, "packages/client/ui/lib/components/deep"), { recursive: true });
  await writeFile(
    path.join(root, "packages/client/ui/lib/components/deep/button.test.ts"),
    'import "../../../src/index";',
  );
  const { violations, tests } = await packageStructureInventory(root);
  assert.deepEqual(violations.map(({ rule }) => rule).sort(), [
    "lib-depth",
    "relative-import",
    "test-location",
  ]);
  assert.equal(tests.length, 1);
});

test("rejects source roots containing only forwarding entries or placeholders", async (t) => {
  const root = await fixture(t, {
    "packages/client/ui/package.json": "{}",
    "packages/client/ui/src/index.ts": '"use client"; export * from "../lib/index";',
    "packages/client/ui/src/helpers.ts":
      'import { helper } from "../lib/index"; export { helper };',
    "packages/client/ui/lib/index.ts": "export function helper() { return 1; }",
  });
  await assert.rejects(
    checkPackageStructure(root),
    /src\/ must contain implementation or contracts/,
  );
  await writeFile(
    path.join(root, "packages/client/ui/src/helpers.ts"),
    "export interface Options { value: string }",
  );
  await checkPackageStructure(root);
  for (const placeholder of ["// implementation goes here", '"use strict";', "export {};"]) {
    await writeFile(path.join(root, "packages/client/ui/lib/index.ts"), placeholder);
    await assert.rejects(checkPackageStructure(root), /lib\/ must contain actual package source/);
  }
});

test("rejects JavaScript capability and helper source while retaining existing build-tool CommonJS", async (t) => {
  const root = await fixture(t, {
    "packages/client/ui/package.json": "{}",
    "packages/client/ui/src/index.ts": "export interface Button {}",
    "packages/client/ui/lib/normalize.js":
      "export function normalize(value) { return value.trim(); }",
    "packages/host/host-artifact-policy/package.json": "{}",
    "packages/host/host-artifact-policy/src/policy.cjs":
      "function check() { return true; } module.exports={check};",
    "packages/host/host-artifact-policy/lib/filesystem.cjs":
      "function inside() { return true; } module.exports={inside};",
  });
  const { violations } = await packageStructureInventory(root);
  assert.deepEqual(
    violations.map(({ rule, path }) => ({ rule, path })),
    [{ rule: "source-language", path: "packages/client/ui/lib/normalize.js" }],
  );
  await assert.rejects(checkPackageStructure(root), /source-language/);
});

test("baseline allows only exact existing violations and rejects both new and stale entries", async (t) => {
  const root = await fixture(t, {
    "packages/a/b/c/package.json": "{}",
  });
  await checkPackageStructure(root, { writeBaseline: true });
  await assert.rejects(checkPackageStructure(root), /package-root/);
  await checkPackageStructure(root, { strict: false });
  await assert.rejects(checkPackageStructure(root, { writeBaseline: true }), /EEXIST/);
  await assert.rejects(checkPackageStructure(root, { strict: true }), /package-root/);
  await rm(path.join(root, "packages/a/b/c"), { recursive: true });
  await assert.rejects(checkPackageStructure(root, { strict: false }), /stale baseline/);
  await checkPackageStructure(root, { pruneBaseline: true });
  await checkPackageStructure(root);
  const original = { rule: "src-depth", path: "a.ts", detail: "deep" };
  const changed = { ...original, path: "b.ts" };
  assert.deepEqual(compareStructureBaseline([changed], [original]), {
    added: [changed],
    stale: [original],
    retained: [],
  });
  assert.throws(() => compareStructureBaseline([], [original, original]), /duplicate/);
});

test("library directory names match their scoped package identity", async (t) => {
  const root = await fixture(t, {
    "packages/client/ui-settings/package.json": JSON.stringify({ name: "@workbench/ui-settings" }),
    "packages/client/ui-settings/src/index.ts": "export const settings = true;",
    "packages/client/ui-settings/lib/settings.ts": "export const helper = true;",
  });
  await checkPackageStructure(root);
  for (const name of ["@workbench/settings-ui", "@another/ui-settings"]) {
    await writeFile(
      path.join(root, "packages/client/ui-settings/package.json"),
      JSON.stringify({ name }),
    );
    const { violations } = await packageStructureInventory(root);
    assert.deepEqual(
      violations.map(({ rule }) => rule),
      ["package-name"],
    );
    await assert.rejects(
      checkPackageStructure(root),
      /expected package name @workbench\/ui-settings/,
    );
  }
});
