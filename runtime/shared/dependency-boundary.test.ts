import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const SOURCE_ROOT = path.resolve(process.cwd(), "runtime/shared");
const ENVIRONMENT_IMPORT =
  /(?:from\s+|import\s*\()\s*["'](?:react|@assistant-ui\/|@\/runtime\/(?:assistant-ui|pi|server|terminal))(?:\/|["'])/;

async function productionSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
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

test("shared Runtime domains do not depend on a UI, host, or concrete Runtime", async () => {
  const violations: string[] = [];
  for (const file of await productionSources(SOURCE_ROOT)) {
    if (ENVIRONMENT_IMPORT.test(await readFile(file, "utf8"))) {
      violations.push(path.relative(process.cwd(), file));
    }
  }

  assert.deepEqual(violations, []);
});
