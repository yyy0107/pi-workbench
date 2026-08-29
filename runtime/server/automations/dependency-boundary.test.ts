import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const AUTOMATION_ROOTS = [
  "runtime/shared/automation.ts",
  "runtime/server/automations",
  "runtime/pi/client/automations",
  "runtime/pi/server/automations",
];
const WORKFLOW_ROOTS = [
  "runtime/shared/execution.ts",
  "runtime/server/executions",
  "runtime/pi/client/workflows",
  "runtime/pi/server/executions",
];

async function productionSources(target: string): Promise<string[]> {
  const absolute = path.resolve(process.cwd(), target);
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
      /runtime\/(?:shared\/execution|server\/executions|pi\/(?:client\/workflows|server\/executions))/u.test(
        content,
      )
    ) {
      automationViolations.push(path.relative(process.cwd(), file));
    }
  }

  const workflowViolations: string[] = [];
  for (const file of await sources(WORKFLOW_ROOTS)) {
    const content = await readFile(file, "utf8");
    if (
      /runtime\/(?:shared\/automation|server\/automations|pi\/(?:client|server)\/automations)/u.test(
        content,
      )
    ) {
      workflowViolations.push(path.relative(process.cwd(), file));
    }
  }

  assert.deepEqual(automationViolations, []);
  assert.deepEqual(workflowViolations, []);
  assert.doesNotMatch(
    await readFile(path.resolve("runtime/shared/execution.ts"), "utf8"),
    /automation/iu,
  );
});
