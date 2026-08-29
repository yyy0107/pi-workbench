import assert from "node:assert/strict";
import test from "node:test";

import { ExecutionEngine } from "@/runtime/server/executions/execution-engine";
import { ExecutionNodeExecutorRegistry } from "@/runtime/server/executions/execution-node-executor";
import { ExecutionRepository } from "@/runtime/server/executions/execution-repository";
import { ExecutionService } from "@/runtime/server/executions/execution-service";

import { getExecutionService } from "./pi-execution-service";

interface ExecutionServiceTestGlobal {
  __workbenchExecutionService?: ExecutionService;
  __workbenchExecutionNodeExecutors?: ExecutionNodeExecutorRegistry;
}

test("rebinds the cached execution graph and retires legacy triggers after a module reload", () => {
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

    class PreviousExecutionService {}
    class PreviousExecutionRepository {}
    class PreviousExecutionEngine {}
    class PreviousExecutionNodeExecutorRegistry {}
    let legacyTriggersDisposed = false;
    const legacyTriggers = {
      dispose() {
        legacyTriggersDisposed = true;
      },
      async handleInternalEvent() {},
    };
    Object.assign(firstService, { triggers: legacyTriggers });
    Object.setPrototypeOf(firstService, PreviousExecutionService.prototype);
    Object.setPrototypeOf(firstService.repository, PreviousExecutionRepository.prototype);
    Object.setPrototypeOf(firstService.engine, PreviousExecutionEngine.prototype);
    Object.setPrototypeOf(nodeExecutors, PreviousExecutionNodeExecutorRegistry.prototype);
    delete registryGlobal.__workbenchExecutionNodeExecutors;

    currentService = getExecutionService({ nodeExecutors });

    assert.equal(currentService, firstService);
    assert.equal(Object.getPrototypeOf(currentService), ExecutionService.prototype);
    assert.equal(Object.getPrototypeOf(currentService.repository), ExecutionRepository.prototype);
    assert.equal(Object.getPrototypeOf(currentService.engine), ExecutionEngine.prototype);
    assert.equal(legacyTriggersDisposed, true);
    assert.notEqual(
      (currentService as ExecutionService & { triggers?: unknown }).triggers,
      legacyTriggers,
    );
    assert.equal(currentService.engine.nodeExecutorRegistry(), nodeExecutors);
    assert.equal(registryGlobal.__workbenchExecutionNodeExecutors, nodeExecutors);
    assert.equal(Object.getPrototypeOf(nodeExecutors), ExecutionNodeExecutorRegistry.prototype);
    assert.notEqual(nodeExecutors.get("agent"), firstAgentExecutor);
    assert.notEqual(nodeExecutors.get("command"), firstCommandExecutor);
  } finally {
    if (previousService) registryGlobal.__workbenchExecutionService = previousService;
    else delete registryGlobal.__workbenchExecutionService;
    if (previousExecutors) registryGlobal.__workbenchExecutionNodeExecutors = previousExecutors;
    else delete registryGlobal.__workbenchExecutionNodeExecutors;
  }
});
