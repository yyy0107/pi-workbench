import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { AgentExecutionPort } from "@workbench/agent-runtime-server/execution";
import type { FlowRevision } from "@workbench/execution-contracts";
import { ExecutionEngine } from "@workbench/execution-server/engine";
import {
  ExecutionNodeExecutorRegistry,
  type ExecutionNodeContext,
  type ExecutionNodeExecutor,
} from "@workbench/execution-server/node-executor";
import { ExecutionRepository } from "@workbench/execution-server/repository";
import { ExecutionService } from "@workbench/execution-server/service";

import { getInstalledPiExecutionService } from "../src/composition/installed-execution";

interface ExecutionServiceTestGlobal {
  __workbenchExecutionService?: ExecutionService;
  __workbenchExecutionNodeExecutors?: ExecutionNodeExecutorRegistry;
}

const blockingCommandRevision: FlowRevision = {
  schemaVersion: 3,
  revisionId: "hmr-active-run",
  workflowId: "hmr-active-run",
  kind: "workflow",
  scope: { type: "personal" },
  name: "HMR active run",
  agents: [],
  graph: {
    nodes: [
      { id: "start", type: "start", name: "Start", position: { x: 0, y: 0 }, config: {} },
      {
        id: "command",
        type: "command",
        name: "Block",
        position: { x: 100, y: 0 },
        config: { command: "true" },
      },
      { id: "end", type: "end", name: "End", position: { x: 200, y: 0 }, config: {} },
    ],
    edges: [
      { id: "start-command", source: "start", target: "command" },
      { id: "command-end", source: "command", target: "end" },
    ],
    editor: {},
  },
  concurrency: { mode: "queue" },
  publishedAt: 1,
};

test("rebinds the cached execution graph and retires legacy triggers after a module reload", () => {
  const registryGlobal = globalThis as typeof globalThis & ExecutionServiceTestGlobal;
  const previousService = registryGlobal.__workbenchExecutionService;
  const previousExecutors = registryGlobal.__workbenchExecutionNodeExecutors;
  delete registryGlobal.__workbenchExecutionService;
  delete registryGlobal.__workbenchExecutionNodeExecutors;

  const nodeExecutors = new ExecutionNodeExecutorRegistry();
  const execution = {
    async submit() {
      return { kind: "started" as const };
    },
    async cancel() {},
  } satisfies AgentExecutionPort;
  let currentService: ExecutionService | undefined;
  try {
    const firstService = getInstalledPiExecutionService({ execution, nodeExecutors });
    const firstRepository = firstService.repository;
    const firstEngine = firstService.engine;
    const firstRegistry = firstEngine.nodeExecutorRegistry();
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

    currentService = getInstalledPiExecutionService({ execution, nodeExecutors });

    assert.equal(currentService, firstService);
    assert.equal(currentService.repository, firstRepository);
    assert.equal(currentService.engine, firstEngine);
    assert.equal(Object.getPrototypeOf(currentService), ExecutionService.prototype);
    assert.equal(Object.getPrototypeOf(currentService.repository), ExecutionRepository.prototype);
    assert.equal(Object.getPrototypeOf(currentService.engine), ExecutionEngine.prototype);
    assert.equal(legacyTriggersDisposed, true);
    assert.notEqual(
      (currentService as ExecutionService & { triggers?: unknown }).triggers,
      legacyTriggers,
    );
    assert.equal(currentService.engine.nodeExecutorRegistry(), nodeExecutors);
    assert.equal(currentService.engine.nodeExecutorRegistry(), firstRegistry);
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

test("keeps an active run and its AbortSignal stable across repeated installed-service getters", async (t) => {
  const registryGlobal = globalThis as typeof globalThis & ExecutionServiceTestGlobal;
  const previousService = registryGlobal.__workbenchExecutionService;
  const previousExecutors = registryGlobal.__workbenchExecutionNodeExecutors;
  delete registryGlobal.__workbenchExecutionService;
  delete registryGlobal.__workbenchExecutionNodeExecutors;

  const rootDirectory = await mkdtemp(path.join(tmpdir(), "workbench-execution-hmr-active-"));
  t.after(() => rm(rootDirectory, { recursive: true, force: true }));
  const nodeExecutors = new ExecutionNodeExecutorRegistry();
  const execution = {
    async submit() {
      return { kind: "started" as const };
    },
    async cancel() {},
  } satisfies AgentExecutionPort;
  let service: ExecutionService | undefined;
  try {
    service = getInstalledPiExecutionService({ execution, nodeExecutors, rootDirectory });
    const repository = service.repository;
    const markInterruptedRuns = repository.markInterruptedRuns.bind(repository);
    let initializeCount = 0;
    repository.markInterruptedRuns = async () => {
      initializeCount += 1;
      return markInterruptedRuns();
    };
    await service.initialize();
    assert.equal(initializeCount, 1);

    let activeContext: ExecutionNodeContext | undefined;
    let began!: () => void;
    const executing = new Promise<void>((resolve) => {
      began = resolve;
    });
    const blockingExecutor: ExecutionNodeExecutor = {
      async execute(context) {
        activeContext = context;
        began();
        return await new Promise<never>((_, reject) => {
          const abort = () => reject(new DOMException("Run cancelled", "AbortError"));
          if (context.signal.aborted) abort();
          else context.signal.addEventListener("abort", abort, { once: true });
        });
      },
    };
    nodeExecutors.register("command", blockingExecutor);

    const admission = await service.engine.start({
      revision: blockingCommandRevision,
      source: "manual",
      targetWorkspaceId: "workspace-1",
      workspacePath: rootDirectory,
    });
    assert.equal(admission.kind, "started");
    if (admission.kind !== "started") return;
    await executing;
    assert.ok(activeContext);

    const rebound = getInstalledPiExecutionService({ execution, rootDirectory });
    assert.equal(rebound, service);
    assert.equal(rebound.repository, repository);
    assert.equal(rebound.engine, service.engine);
    assert.equal(rebound.engine.nodeExecutorRegistry(), nodeExecutors);
    assert.equal(
      initializeCount,
      1,
      "rebind does not reinitialize or mark active runs interrupted",
    );
    assert.equal(activeContext.signal.aborted, false);

    const cancelled = await rebound.engine.cancel(admission.run.id);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(activeContext.signal.aborted, true);
  } finally {
    if (previousService) registryGlobal.__workbenchExecutionService = previousService;
    else delete registryGlobal.__workbenchExecutionService;
    if (previousExecutors) registryGlobal.__workbenchExecutionNodeExecutors = previousExecutors;
    else delete registryGlobal.__workbenchExecutionNodeExecutors;
  }
});
