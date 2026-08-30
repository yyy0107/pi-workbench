import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const AUTOMATION_ROOTS = [
  "packages/contracts/automation/src",
  "packages/agent-runtime/adapters/pi/client/src/automations",
  "packages/agent-runtime/adapters/pi/server/src/automations",
  "runtime/server/automations",
];
const WORKFLOW_ROOTS = [
  "packages/contracts/execution/src",
  "packages/agent-runtime/adapters/pi/client/src/workflows",
  "packages/agent-runtime/adapters/pi/server/src/executions",
  "runtime/server/executions",
];

async function productionSources(target: string): Promise<string[]> {
  const absolute = path.resolve(REPOSITORY_ROOT, target);
  if (absolute.endsWith(".ts")) return [absolute];
  const entries = await readdir(absolute, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) return productionSources(child);
      if (!entry.isFile() || !/\.tsx?$/u.test(entry.name) || /\.test\.tsx?$/u.test(entry.name)) {
        return [];
      }
      return [child];
    }),
  );
  return nested.flat();
}

async function sources(roots: readonly string[]): Promise<string[]> {
  return (await Promise.all(roots.map(productionSources))).flat();
}

test("Automation and Workflow production domains remain mutually independent", async () => {
  const automationViolations: string[] = [];
  for (const file of await sources(AUTOMATION_ROOTS)) {
    const content = await readFile(file, "utf8");
    if (
      /(?:@workbench\/execution-contracts|packages\/agent-runtime\/adapters\/pi\/(?:client\/src\/workflows|server\/src\/executions)|runtime\/server\/executions)/u.test(
        content,
      )
    ) {
      automationViolations.push(path.relative(REPOSITORY_ROOT, file));
    }
  }

  const workflowViolations: string[] = [];
  for (const file of await sources(WORKFLOW_ROOTS)) {
    const content = await readFile(file, "utf8");
    if (
      /(?:@workbench\/automation-contracts|packages\/agent-runtime\/adapters\/pi\/(?:client\/src\/automations|server\/src\/automations)|runtime\/server\/automations)/u.test(
        content,
      )
    ) {
      workflowViolations.push(path.relative(REPOSITORY_ROOT, file));
    }
  }

  assert.deepEqual(automationViolations, []);
  assert.deepEqual(workflowViolations, []);
  assert.doesNotMatch(
    await readFile(
      path.resolve(REPOSITORY_ROOT, "packages/contracts/execution/src/index.ts"),
      "utf8",
    ),
    /automation/iu,
  );
});
