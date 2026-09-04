import assert from "node:assert/strict";
import test from "node:test";

import type { RpcIssue, ServerResponse } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { WorkspaceProtocolService } from "../../../src/workspaces/workspace-protocol-service";
import { rpcBusinessError } from "../../../src/transport/rpc-transport";
import { createWorkspaceRpcRoutes } from "../../../src/transport/routes/workspace-rpc-routes";

function rpcRequest(
  method: string,
  payload: unknown,
  options: { host?: string; origin?: string; rpcId?: string } = {},
): Request {
  const host = options.host ?? "127.0.0.1:3000";
  return new Request(`http://${host}/api/${method}`, {
    method: "POST",
    headers: {
      host,
      "content-type": "application/json",
      ...(options.origin === undefined ? {} : { origin: options.origin }),
    },
    body: JSON.stringify({
      type: "client-request",
      rpcId: options.rpcId ?? "rpc-1",
      method,
      payload,
    }),
  });
}

function protocol(overrides: Partial<WorkspaceProtocolService>): WorkspaceProtocolService {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      const implementation = Reflect.get(target, property, receiver);
      if (implementation !== undefined) return implementation;
      return async () => {
        throw new Error(`Unexpected Workspace protocol call: ${String(property)}`);
      };
    },
  }) as WorkspaceProtocolService;
}

async function successValue<Value>(response: Response): Promise<Value> {
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<Value>;
  assert.equal(body.type, "server-response");
  if (!body.result.ok) assert.fail(`Unexpected RPC error: ${body.result.error.code}`);
  return body.result.value;
}

const unexpectedDomainError = (error: unknown): never => {
  throw error;
};

test("claims the Workspace organization domain but not Workspace files", async () => {
  const routes = createWorkspaceRpcRoutes({
    service: protocol({ list: async () => ({ items: [] }) }),
    projectDomainError: unexpectedDomainError,
  });
  const claimed = routes.handle(rpcRequest("workspace.list", { ignored: true }), "workspace.list");

  assert.ok(claimed);
  assert.deepEqual(await successValue(await claimed), { items: [] });
  for (const method of [
    "workspace.files.list",
    "workspace.files.describe",
    "workspace.files.read",
    "workspace.files.write",
    "workspace.unknown",
    "session.list",
  ]) {
    assert.equal(routes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("maps all eleven organization methods to sanitized protocol inputs", async () => {
  const calls: Array<{ operation: PropertyKey; args: unknown[] }> = [];
  const service = new Proxy(
    {},
    {
      get(_target, operation) {
        return async (...args: unknown[]) => {
          calls.push({ operation, args });
          return {};
        };
      },
    },
  ) as WorkspaceProtocolService;
  const routes = createWorkspaceRpcRoutes({
    service,
    projectDomainError: unexpectedDomainError,
  });
  const cases = [
    { method: "workspace.list", payload: { ignored: true }, operation: "list", args: [] },
    {
      method: "workspace.listArchivedSessions",
      payload: { ignored: true },
      operation: "listArchivedSessions",
      args: [],
    },
    {
      method: "workspace.create",
      payload: { path: "/projects/one", ignored: true },
      operation: "create",
      args: [{ path: "/projects/one" }],
    },
    {
      method: "workspace.rename",
      payload: { workspaceId: "workspace-1", title: "  Renamed  ", ignored: true },
      operation: "rename",
      args: [{ workspaceId: "workspace-1", title: "Renamed" }],
    },
    {
      method: "workspace.delete",
      payload: { workspaceId: "workspace-1", ignored: true },
      operation: "delete",
      args: [{ workspaceId: "workspace-1" }],
    },
    {
      method: "workspace.insertBefore",
      payload: {
        workspaceId: "workspace-1",
        beforeWorkspaceId: "workspace-2",
        ignored: true,
      },
      operation: "insertBefore",
      args: [{ workspaceId: "workspace-1", beforeWorkspaceId: "workspace-2" }],
    },
    {
      method: "workspace.insertSessionBefore",
      payload: {
        workspaceId: "workspace-1",
        sessionId: "session-1",
        beforeSessionId: "session-2",
        ignored: true,
      },
      operation: "insertSessionBefore",
      args: [
        {
          workspaceId: "workspace-1",
          sessionId: "session-1",
          beforeSessionId: "session-2",
        },
      ],
    },
    {
      method: "workspace.setPinned",
      payload: { workspaceId: "workspace-1", pinned: true, ignored: true },
      operation: "setPinned",
      args: [{ workspaceId: "workspace-1", pinned: true }],
    },
    {
      method: "workspace.setSessionPinned",
      payload: { sessionId: "session-1", pinned: true, ignored: true },
      operation: "setSessionPinned",
      args: [{ sessionId: "session-1", pinned: true }],
    },
    {
      method: "workspace.archiveSession",
      payload: { sessionId: "session-1", ignored: true },
      operation: "archiveSession",
      args: [{ sessionId: "session-1" }],
    },
    {
      method: "workspace.unarchiveSession",
      payload: { sessionId: "session-1", ignored: true },
      operation: "unarchiveSession",
      args: [{ sessionId: "session-1" }],
    },
  ] as const;

  for (const entry of cases) {
    const response = routes.handle(rpcRequest(entry.method, entry.payload), entry.method);
    assert.ok(response);
    await successValue(await response);
  }
  assert.deepEqual(
    calls,
    cases.map(({ operation, args }) => ({ operation, args })),
  );
});

test("validates organization payloads before invoking the protocol", async () => {
  let calls = 0;
  const routes = createWorkspaceRpcRoutes({
    service: new Proxy(
      {},
      {
        get() {
          return async () => {
            calls += 1;
            return {};
          };
        },
      },
    ) as WorkspaceProtocolService,
    projectDomainError: unexpectedDomainError,
  });
  const cases = [
    ["workspace.list", []],
    ["workspace.create", { path: 42 }],
    ["workspace.rename", { workspaceId: "workspace-1", title: "   " }],
    ["workspace.delete", { workspaceId: "" }],
    ["workspace.insertBefore", { workspaceId: "workspace-1", beforeWorkspaceId: "" }],
    [
      "workspace.insertSessionBefore",
      { workspaceId: "workspace-1", sessionId: "session-1", beforeSessionId: "" },
    ],
    ["workspace.setPinned", { workspaceId: "workspace-1", pinned: "true" }],
    ["workspace.setSessionPinned", { sessionId: "", pinned: true }],
    ["workspace.archiveSession", { sessionId: "" }],
    ["workspace.unarchiveSession", { sessionId: "" }],
  ] as const;

  for (const [method, payload] of cases) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    const body = (await (await response).json()) as ServerResponse<never, { issues: RpcIssue[] }>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected a Workspace validation failure.");
    assert.equal(body.result.error.code, "bad-request");
  }
  assert.equal(calls, 0);
});

test("delegates Workspace domain failures to the shared error projector", async () => {
  const failure = new Error("store failed");
  const routes = createWorkspaceRpcRoutes({
    service: protocol({
      async create() {
        throw failure;
      },
    }),
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("workspace-failed", "Workspace failed.", { operation: "create" });
    },
  });
  const response = routes.handle(
    rpcRequest("workspace.create", { path: "/projects/one" }),
    "workspace.create",
  );

  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a projected Workspace failure.");
  assert.equal(body.result.error.code, "workspace-failed");
  assert.deepEqual(body.result.error.details, { operation: "create" });
});

test("keeps Workspace organization RPC available to explicitly trusted hosts", async (t) => {
  const previousTrustedHosts = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example:3080";
  t.after(() => {
    if (previousTrustedHosts === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previousTrustedHosts;
  });
  const routes = createWorkspaceRpcRoutes({
    service: protocol({ list: async () => ({ items: [] }) }),
    projectDomainError: unexpectedDomainError,
  });
  const response = routes.handle(
    rpcRequest(
      "workspace.list",
      {},
      {
        host: "workbench.example:3080",
        origin: "http://workbench.example:3080",
      },
    ),
    "workspace.list",
  );

  assert.ok(response);
  assert.equal((await response).status, 200);
});
