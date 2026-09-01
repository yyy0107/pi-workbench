import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { AgentExecutionPort } from "@workbench/agent-runtime-server/execution";
import { AutomationService } from "@workbench/automation-server/service";
import { getInstalledPiAutomationService } from "../src/composition/installed-automation";

interface AutomationServiceTestGlobal {
  __workbenchAutomationService?: AutomationService;
}

test("retains one Automation timer/repository owner across module generations", async (t) => {
  const registry = globalThis as typeof globalThis & AutomationServiceTestGlobal;
  const previous = registry.__workbenchAutomationService;
  delete registry.__workbenchAutomationService;
  const rootDirectory = await mkdtemp(path.join(tmpdir(), "workbench-automation-hmr-"));
  t.after(async () => {
    if (previous) registry.__workbenchAutomationService = previous;
    else delete registry.__workbenchAutomationService;
    await rm(rootDirectory, { recursive: true, force: true });
  });
  const execution = {
    async submit() {
      return { kind: "started" as const };
    },
    async cancel() {},
  } satisfies AgentExecutionPort;

  const first = getInstalledPiAutomationService({ agentExecution: execution, rootDirectory });
  const repository = first.repository;
  delete (first as unknown as { closed?: boolean }).closed;
  delete (first as unknown as { generation?: number }).generation;

  const rebound = getInstalledPiAutomationService({ agentExecution: execution, rootDirectory });
  assert.equal(rebound, first);
  assert.equal(rebound.repository, repository);
  assert.equal(Object.getPrototypeOf(rebound), AutomationService.prototype);
  rebound.dispose();
  await assert.rejects(rebound.initialize(), /shutting down/u);
});
