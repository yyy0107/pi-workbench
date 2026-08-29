import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { ServerResponse } from "@/runtime/pi/contracts/rpc";
import { ExecutionRepository } from "@/runtime/server/executions/execution-repository";
import { ExecutionService } from "@/runtime/server/executions/execution-service";
import { projectRpcDomainError } from "../rpc-domain-error-projector";
import { createExecutionRpcRoutes } from "./execution-rpc-routes";

function rpcRequest(method: string, payload: unknown): Request {
  return new Request(`http://127.0.0.1:3000/api/${method}`, {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId: "rpc-save-draft", method, payload }),
  });
}

test("rejects Automation definitions at the Workflow HTTP RPC boundary", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-execution-rpc-"));
  const repository = new ExecutionRepository({ rootDirectory: root });
  const service = new ExecutionService({ repository, isWorkspaceTrusted: () => true });
  try {
    const routes = createExecutionRpcRoutes({
      service,
      projectDomainError(error): never {
        throw error;
      },
    });
    const response = routes.handle(
      rpcRequest("workflow.create", {
        kind: "automation",
        scope: { type: "personal" },
        name: "Scheduled task",
      }),
      "workflow.create",
    );

    assert.ok(response);
    const resolved = await response;
    assert.equal(resolved.status, 200);
    const body = (await resolved.json()) as ServerResponse<never>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected Workflow to reject Automation.");
    assert.equal(body.result.error.code, "bad-request");
  } finally {
    service.triggers.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("returns a workflow-invalid envelope instead of HTTP 500 for an invalid draft run", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-execution-rpc-invalid-run-"));
  const repository = new ExecutionRepository({ rootDirectory: root });
  const service = new ExecutionService({ repository, isWorkspaceTrusted: () => true });
  try {
    const created = await service.create({
      kind: "workflow",
      scope: { type: "personal" },
      name: "Incomplete workflow",
    });
    await service.saveDraft({
      workflowId: created.document.id,
      baseDraftRevision: created.document.draftRevision,
      draft: {
        ...created.document,
        agents: [{ id: "unreachable-agent", name: "Unreachable Agent" }],
        graph: {
          ...created.document.graph,
          nodes: [
            ...created.document.graph.nodes,
            {
              id: "unreachable",
              type: "agent",
              name: "Unreachable Agent",
              position: { x: 300, y: 400 },
              config: {
                agentId: "unreachable-agent",
                output: { schema: {} },
              },
            },
          ],
        },
      },
    });
    const routes = createExecutionRpcRoutes({ service, projectDomainError: projectRpcDomainError });
    const response = routes.handle(
      rpcRequest("workflow.run.start", {
        workflowId: created.document.id,
        revisionSource: "draft",
      }),
      "workflow.run.start",
    );

    assert.ok(response);
    const resolved = await response;
    assert.equal(resolved.status, 200);
    const body = (await resolved.json()) as ServerResponse<never>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected the invalid run to be rejected.");
    assert.equal(body.result.error.code, "workflow-invalid");
    assert.equal(body.result.error.details?.workflowId, created.document.id);
  } finally {
    service.triggers.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
