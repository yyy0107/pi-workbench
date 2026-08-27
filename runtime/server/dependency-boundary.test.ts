import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const SOURCE_ROOT = path.resolve(process.cwd(), "runtime/server");
const CONCRETE_RUNTIME_IMPORT =
  /(?:from\s+|import\s*\()\s*["'](?:@\/runtime\/(?:pi|codex|claude-code)|\.\.\/(?:pi|codex|claude-code)|@earendil-works\/pi-)(?:\/|["'])?/;

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

test("the generic Agent server ports do not import a concrete Runtime", async () => {
  const violations: string[] = [];
  for (const file of await productionSources(SOURCE_ROOT)) {
    if (CONCRETE_RUNTIME_IMPORT.test(await readFile(file, "utf8"))) {
      violations.push(path.relative(process.cwd(), file));
    }
  }

  assert.deepEqual(violations, []);
});
