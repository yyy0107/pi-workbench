import assert from "node:assert/strict";
import test from "node:test";

import type { ServerResponse } from "@workbench/api/contracts";

import type { WorkspaceFileChangeProtocol } from "../src/file-changes";
import { createWorkspaceFileChangeRpcRoutes } from "../src/file-change-rpc-routes";

function rpcRequest(method: string, payload: unknown, host = "127.0.0.1:3000"): Request {
  return new Request(`http://${host}/api/${method}`, {
    method: "POST",
    headers: { host, "content-type": "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId: "rpc-1", method, payload }),
  });
}

async function successValue<Value>(response: Response): Promise<Value> {
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<Value>;
  if (!body.result.ok) assert.fail(`Unexpected RPC error: ${body.result.error.code}`);
  return body.result.value;
}

test("claims generic workspace undo and redo routes and sanitizes their payload", async () => {
  const calls: Array<{ direction: string; payload: unknown; signal: AbortSignal }> = [];
  const service: WorkspaceFileChangeProtocol = {
    undo: async (payload, signal) => {
      calls.push({ direction: "undo", payload, signal });
      return { applied: true, direction: "undo", merged: false };
    },
    redo: async (payload, signal) => {
      calls.push({ direction: "redo", payload, signal });
      return { applied: true, direction: "redo", merged: true };
    },
  };
  const routes = createWorkspaceFileChangeRpcRoutes({
    service,
    projectDomainError(error): never {
      throw error;
    },
  });
  const payload = {
    workspaceId: "workspace-1",
    threadId: "thread-1",
    changeSetId: "change-1",
    ignored: true,
  };
  const undo = routes.handle(
    rpcRequest("workspace.fileChanges.undo", payload),
    "workspace.fileChanges.undo",
  );
  const redo = routes.handle(
    rpcRequest("workspace.fileChanges.redo", payload),
    "workspace.fileChanges.redo",
  );
  assert.ok(undo);
  assert.ok(redo);
  assert.deepEqual(await successValue(await undo), {
    applied: true,
    direction: "undo",
    merged: false,
  });
  assert.deepEqual(await successValue(await redo), {
    applied: true,
    direction: "redo",
    merged: true,
  });
  assert.deepEqual(
    calls.map(({ direction, payload: callPayload }) => ({ direction, payload: callPayload })),
    [
      {
        direction: "undo",
        payload: { workspaceId: "workspace-1", threadId: "thread-1", changeSetId: "change-1" },
      },
      {
        direction: "redo",
        payload: { workspaceId: "workspace-1", threadId: "thread-1", changeSetId: "change-1" },
      },
    ],
  );
  assert.equal(
    routes.handle(rpcRequest("workspace.git.diff", payload), "workspace.git.diff"),
    undefined,
  );
});

test("rejects non-loopback mutation requests before invoking the service", async () => {
  let invoked = false;
  const operation = async () => {
    invoked = true;
    return { applied: true as const, direction: "undo" as const, merged: false };
  };
  const routes = createWorkspaceFileChangeRpcRoutes({
    service: { undo: operation, redo: operation },
    projectDomainError(error): never {
      throw error;
    },
  });
  const claimed = routes.handle(
    rpcRequest(
      "workspace.fileChanges.undo",
      { workspaceId: "workspace", threadId: "thread", changeSetId: "change" },
      "example.com",
    ),
    "workspace.fileChanges.undo",
  );
  assert.ok(claimed);
  assert.equal((await claimed).status, 403);
  assert.equal(invoked, false);
});
