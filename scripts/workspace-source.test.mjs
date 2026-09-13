import assert from "node:assert/strict";
import test from "node:test";
import { moduleSpecifiers, pathReferenceValues } from "./workspace-source.mjs";

test("module references use syntax rather than fixture, regex, or template text", () => {
  const source = [
    'import "side-effect";',
    'import type { Value } from "types";',
    'export { item } from "exports";',
    'const a = import("dynamic");',
    'const b = require("commonjs");',
    'type C = import("type-query").C;',
    'const fixture = `import { value } from "not-a-dependency";`;',
    'const nested = `fixture ${JSON.stringify(`export * from "also-not"`)} tail`;',
    'const regex = /import.*from "not-a-module"/;',
    '// import "comment";',
  ].join("\n");
  assert.deepEqual(moduleSpecifiers(source), [
    "side-effect",
    "types",
    "exports",
    "dynamic",
    "commonjs",
    "type-query",
  ]);
});

test("filesystem boundaries inspect real calls, including nested URL and join", () => {
  const source = [
    'await readFile(new URL("../src/entry.ts", import.meta.url), "utf8");',
    'await readFile(path.join(repositoryRoot, "apps", "web", "src", "entry.ts"));',
    'const fixture = `await readFile(new URL("../fake.ts", import.meta.url))`;',
    'const regex = /new URL("fake")/;',
  ].join("\n");
  assert.deepEqual(pathReferenceValues(source), [
    { reference: "../src/entry.ts", repositoryRelative: false },
    { reference: "apps/web/src/entry.ts", repositoryRelative: true },
  ]);
});

test("checks actual code inside template substitutions and TypeScript import-equals", () => {
  assert.deepEqual(
    moduleSpecifiers(
      'import A = require("legacy"); const a = `text ${require("real")} end`; const b = import(`literal`);',
    ),
    ["legacy", "real", "literal"],
  );
});

test("malformed syntax fails closed instead of silently omitting dependencies", () => {
  assert.throws(
    () => moduleSpecifiers('import { from "broken";'),
    /cannot check module boundaries/,
  );
});
