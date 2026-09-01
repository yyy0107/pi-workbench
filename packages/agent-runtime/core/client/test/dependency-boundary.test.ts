import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const PACKAGE_SOURCE_ROOT = fileURLToPath(new URL("../src/", import.meta.url));
const CONCRETE_RUNTIME_IMPORT =
  /(?:from\s+|import\s*\()\s*["'](?:@\/runtime\/pi|@workbench\/agent-runtime-pi(?:[-/]|["'])|\.\.\/pi)(?:\/|["'])?/;
const GENERIC_THREAD_PRESENTATION_CONSUMERS = [
  "packages/agent-runtime/adapters/pi/contributions/src/extensions/terminal/terminal-target.ts",
  "packages/workbench/shell/src/sidebar/thread-list-groups.ts",
  "packages/workbench/shell/src/sidebar/thread-list-item.tsx",
  "packages/workbench/shell/src/sidebar/thread-list.tsx",
  "packages/workbench/shell/src/sidebar/workspace-thread-list.tsx",
  "packages/workbench/shell/src/shell/workbench-header.tsx",
  "packages/workbench/shell/src/shell/workbench-sidebar.tsx",
] as const;
const GENERIC_AGENT_COMMAND_CONSUMERS = [
  "packages/workbench/shell/src/chat/composer-message-text.tsx",
  "packages/workbench/shell/src/chat/workbench-composer.tsx",
] as const;

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

test("the generic Agent Runtime client package does not import a concrete implementation", async () => {
  const violations: string[] = [];
  for (const file of await productionSources(PACKAGE_SOURCE_ROOT)) {
    if (CONCRETE_RUNTIME_IMPORT.test(await readFile(file, "utf8"))) {
      violations.push(path.relative(REPOSITORY_ROOT, file));
    }
  }

  assert.deepEqual(violations, []);
});

test("Workbench thread presentation consumers stay backend-neutral", async () => {
  const violations: string[] = [];
  for (const relativeFile of GENERIC_THREAD_PRESENTATION_CONSUMERS) {
    const file = path.resolve(REPOSITORY_ROOT, relativeFile);
    if (CONCRETE_RUNTIME_IMPORT.test(await readFile(file, "utf8"))) violations.push(relativeFile);
  }

  assert.deepEqual(violations, []);
});

test("Workbench Composer consumers stay backend-neutral", async () => {
  const violations: string[] = [];
  for (const relativeFile of GENERIC_AGENT_COMMAND_CONSUMERS) {
    const file = path.resolve(REPOSITORY_ROOT, relativeFile);
    if (CONCRETE_RUNTIME_IMPORT.test(await readFile(file, "utf8"))) violations.push(relativeFile);
  }

  assert.deepEqual(violations, []);
});
