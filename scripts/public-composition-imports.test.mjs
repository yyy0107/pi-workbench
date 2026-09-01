import assert from "node:assert/strict";
import test from "node:test";

test("the shared TypeScript loader imports public Shell and Pi composition entries", async () => {
  const [shell, piContributions] = await Promise.all([
    import("@workbench/shell/workbench"),
    import("@workbench/agent-runtime-pi-contributions/installation"),
  ]);

  assert.equal(typeof shell.WorkbenchShell, "function");
  assert.equal(typeof piContributions.PiAgentRuntimeContributionsProvider, "function");
  assert.ok(piContributions.piAgentRuntimeExtensions.length > 0);
});
