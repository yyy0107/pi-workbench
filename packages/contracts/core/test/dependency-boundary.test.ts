import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SOURCE_ROOTS = [
  path.resolve(REPOSITORY_ROOT, "packages/contracts"),
  path.resolve(REPOSITORY_ROOT, "packages/agent-runtime/core/contracts"),
];
const ENVIRONMENT_IMPORT =
  /(?:from\s+|import\s*\()\s*["'](?:node:|react(?:\/|["'])|next(?:\/|["'])|@earendil-works\/|@\/runtime\/(?:pi|server|terminal)(?:\/|["']))/;
const REMOVED_UI_PACKAGE_PREFIX = ["@assistant", "ui/"].join("-");

async function productionSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return productionSources(target);
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
        return [];
      }
      return [target];
    }),
  );
  return nested.flat();
}

test("contract packages do not depend on UI, host, or concrete Runtime modules", async () => {
  const violations: string[] = [];
  for (const sourceRoot of SOURCE_ROOTS) {
    for (const file of await productionSources(sourceRoot)) {
      const source = await readFile(file, "utf8");
      if (ENVIRONMENT_IMPORT.test(source) || source.includes(REMOVED_UI_PACKAGE_PREFIX)) {
        violations.push(path.relative(REPOSITORY_ROOT, file));
      }
    }
  }

  assert.deepEqual(violations, []);
});
