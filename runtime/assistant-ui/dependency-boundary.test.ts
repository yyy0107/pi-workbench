import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const SOURCE_ROOT = path.resolve(process.cwd(), "runtime/assistant-ui");
const CONCRETE_RUNTIME_IMPORT =
  /(?:from\s+|import\s*\()\s*["'](?:@\/runtime\/pi|\.\.\/pi)(?:\/|["'])/;
const GENERIC_THREAD_PRESENTATION_CONSUMERS = [
  "extensions/builtin/terminal/terminal-target.ts",
  "workbench/sidebar/thread-list-groups.ts",
  "workbench/sidebar/thread-list-item.tsx",
  "workbench/sidebar/thread-list.tsx",
  "workbench/sidebar/workspace-thread-list.tsx",
  "workbench/shell/workbench-header.tsx",
  "workbench/shell/workbench-sidebar.tsx",
] as const;
const GENERIC_AGENT_COMMAND_CONSUMERS = [
  "workbench/chat/composer-message-text.tsx",
  "workbench/chat/workbench-composer.tsx",
] as const;

async function productionSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "testing") return [];
        return productionSources(target);
      }
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
        return [];
      }
      return [target];
    }),
  );
  return nested.flat();
}

test("the generic assistant-ui runtime does not import the Pi implementation", async () => {
  const violations: string[] = [];
  for (const file of await productionSources(SOURCE_ROOT)) {
    if (CONCRETE_RUNTIME_IMPORT.test(await readFile(file, "utf8"))) {
      violations.push(path.relative(process.cwd(), file));
    }
  }

  assert.deepEqual(violations, []);
});

test("Workbench thread presentation consumers do not import the Pi implementation", async () => {
  const violations: string[] = [];
  for (const relativeFile of GENERIC_THREAD_PRESENTATION_CONSUMERS) {
    const file = path.resolve(process.cwd(), relativeFile);
    if (CONCRETE_RUNTIME_IMPORT.test(await readFile(file, "utf8"))) violations.push(relativeFile);
  }

  assert.deepEqual(violations, []);
});

test("Workbench Composer consumers do not import the Pi implementation", async () => {
  const violations: string[] = [];
  for (const relativeFile of GENERIC_AGENT_COMMAND_CONSUMERS) {
    const file = path.resolve(process.cwd(), relativeFile);
    if (CONCRETE_RUNTIME_IMPORT.test(await readFile(file, "utf8"))) violations.push(relativeFile);
  }

  assert.deepEqual(violations, []);
});
