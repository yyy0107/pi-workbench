import assert from "node:assert/strict";
import test from "node:test";

import { ExecutionNodeExecutorRegistry } from "@/runtime/server/executions/execution-node-executor";
import type { ExecutionService } from "@/runtime/server/executions/execution-service";

import { getExecutionService } from "./pi-execution-service";

interface ExecutionServiceTestGlobal {
  __workbenchExecutionService?: ExecutionService;
  __workbenchExecutionNodeExecutors?: ExecutionNodeExecutorRegistry;
}

test("rebinds the cached execution service to current node executor instances", () => {
  const registryGlobal = globalThis as typeof globalThis & ExecutionServiceTestGlobal;
  const previousService = registryGlobal.__workbenchExecutionService;
  const previousExecutors = registryGlobal.__workbenchExecutionNodeExecutors;
  delete registryGlobal.__workbenchExecutionService;
  delete registryGlobal.__workbenchExecutionNodeExecutors;

  const nodeExecutors = new ExecutionNodeExecutorRegistry();
  let currentService: ExecutionService | undefined;
  try {
    const firstService = getExecutionService({ nodeExecutors });
    const firstAgentExecutor = nodeExecutors.get("agent");
    const firstCommandExecutor = nodeExecutors.get("command");

    currentService = getExecutionService({ nodeExecutors });

    assert.equal(currentService, firstService);
    assert.notEqual(nodeExecutors.get("agent"), firstAgentExecutor);
    assert.notEqual(nodeExecutors.get("command"), firstCommandExecutor);
  } finally {
    currentService?.triggers.dispose();
    if (previousService) registryGlobal.__workbenchExecutionService = previousService;
    else delete registryGlobal.__workbenchExecutionService;
    if (previousExecutors) registryGlobal.__workbenchExecutionNodeExecutors = previousExecutors;
    else delete registryGlobal.__workbenchExecutionNodeExecutors;
  }
});
