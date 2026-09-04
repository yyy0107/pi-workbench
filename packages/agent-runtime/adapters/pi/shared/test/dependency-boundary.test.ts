import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_ROOT = path.join(PACKAGE_ROOT, "src");
const FORBIDDEN_IMPORT =
  /(?:from\s+|import\s*\()\s*["'](?:@\/|node:|react(?:\/|["'])|next(?:\/|["'])|@earendil-works\/pi-coding-agent|@workbench\/agent-runtime-pi-(?:client|server)|\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/runtime\/pi)/u;
const REMOVED_UI_PACKAGE_PREFIX = ["@assistant", "ui/"].join("-");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(target);
      return entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
    }),
  );
  return nested.flat();
}

test("shared Pi logic does not depend on a UI, host, or coding-agent runtime", async () => {
  const violations: string[] = [];
  for (const file of await sourceFiles(SOURCE_ROOT)) {
    const source = await readFile(file, "utf8");
    if (FORBIDDEN_IMPORT.test(source) || source.includes(REMOVED_UI_PACKAGE_PREFIX)) {
      violations.push(path.relative(PACKAGE_ROOT, file));
    }
  }
  assert.deepEqual(violations, []);
});

test("the package exposes only the five intentional adapter subpaths", async () => {
  const manifest = JSON.parse(await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    sideEffects?: boolean;
    exports?: Record<string, unknown>;
  };
  assert.equal(manifest.sideEffects, false);
  assert.deepEqual(Object.keys(manifest.exports ?? {}).sort(), [
    "./commands",
    "./descriptor",
    "./messages",
    "./models",
    "./sessions",
  ]);
});
