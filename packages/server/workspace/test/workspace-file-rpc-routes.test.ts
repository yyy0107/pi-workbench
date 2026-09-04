import { RPC_REQUEST_BODY_LIMITS } from "../src/file-rpc-routes";
import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKSPACE_FILE_EDITABLE_SIZE_LIMIT,
  WORKSPACE_FILE_RELATIVE_PATH_LENGTH_LIMIT,
  WORKSPACE_FILE_SEARCH_QUERY_LENGTH_LIMIT,
  WORKSPACE_FILE_SEARCH_RESULT_LIMIT,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";
import { type RpcIssue, type ServerResponse } from "@workbench/host-contracts/rpc";
import type { WorkspaceFileProtocol } from "../src/files";
import { DEFAULT_MAX_RPC_REQUEST_BODY_BYTES, rpcBusinessError } from "@workbench/host-server/rpc";
import { createWorkspaceFileRpcRoutes } from "../src/file-rpc-routes";

function rpcRequest(
  method: string,
  payload: unknown,
  options: {
    host?: string;
    origin?: string;
    rpcId?: string;
    headers?: Record<string, string>;
  } = {},
): Request {
  const host = options.host ?? "127.0.0.1:3000";
  return new Request(`http://${host}/api/${method}`, {
    method: "POST",
    headers: {
      host,
      "content-type": "application/json",
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...options.headers,
    },
    body: JSON.stringify({
      type: "client-request",
      rpcId: options.rpcId ?? "rpc-1",
      method,
      payload,
    }),
  });
}

function protocol(overrides: Partial<WorkspaceFileProtocol>): WorkspaceFileProtocol {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      const implementation = Reflect.get(target, property, receiver);
      if (implementation !== undefined) return implementation;
      return async () => {
        throw new Error(`Unexpected Workspace file protocol call: ${String(property)}`);
      };
    },
  }) as WorkspaceFileProtocol;
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

test("claims only the Workspace file unary subdomain", async () => {
  const routes = createWorkspaceFileRpcRoutes({
    service: protocol({
      listDirectory: async () => ({
        workspaceId: "workspace-1",
        relativePath: "",
        absolutePath: "/projects/one",
        entries: [],
        truncated: false,
      }),
    }),
    projectDomainError: unexpectedDomainError,
  });
  const claimed = routes.handle(
    rpcRequest("workspace.files.list", { workspaceId: "workspace-1" }),
    "workspace.files.list",
  );

  assert.ok(claimed);
  assert.deepEqual(await successValue(await claimed), {
    workspaceId: "workspace-1",
    relativePath: "",
    absolutePath: "/projects/one",
    entries: [],
    truncated: false,
  });
  for (const method of [
    "workspace.list",
    "workspace.create",
    "workspace.files.content",
    "workspace.files.unknown",
    "session.list",
  ]) {
    assert.equal(routes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("maps all five file methods to sanitized payloads and the request AbortSignal", async () => {
  const calls: Array<{ operation: PropertyKey; payload: unknown; signal: unknown }> = [];
  const service = new Proxy(
    {},
    {
      get(_target, operation) {
        return async (payload: unknown, signal: unknown) => {
          calls.push({ operation, payload, signal });
          return {};
        };
      },
    },
  ) as WorkspaceFileProtocol;
  const routes = createWorkspaceFileRpcRoutes({
    service,
    projectDomainError: unexpectedDomainError,
  });
  const cases = [
    {
      method: "workspace.files.list",
      payload: { workspaceId: "workspace-1", relativePath: "src", ignored: true },
      operation: "listDirectory",
      expectedPayload: { workspaceId: "workspace-1", relativePath: "src" },
    },
    {
      method: "workspace.files.search",
      payload: { workspaceId: "workspace-1", query: "app", limit: 20, ignored: true },
      operation: "searchFiles",
      expectedPayload: { workspaceId: "workspace-1", query: "app", limit: 20 },
    },
    {
      method: "workspace.files.describe",
      payload: { workspaceId: "workspace-1", relativePath: "src/app.ts", ignored: true },
      operation: "describeFile",
      expectedPayload: { workspaceId: "workspace-1", relativePath: "src/app.ts" },
    },
    {
      method: "workspace.files.read",
      payload: { workspaceId: "workspace-1", relativePath: "src/app.ts", ignored: true },
      operation: "readFile",
      expectedPayload: { workspaceId: "workspace-1", relativePath: "src/app.ts" },
    },
    {
      method: "workspace.files.write",
      payload: {
        workspaceId: "workspace-1",
        relativePath: "src/app.ts",
        content: "export const value = 2;\n",
        expectedVersion: "sha256:before",
        ignored: true,
      },
      operation: "writeFile",
      expectedPayload: {
        workspaceId: "workspace-1",
        relativePath: "src/app.ts",
        content: "export const value = 2;\n",
        expectedVersion: "sha256:before",
      },
    },
  ] as const;

  for (const entry of cases) {
    const request = rpcRequest(entry.method, entry.payload);
    const response = routes.handle(request, entry.method);
    assert.ok(response);
    await successValue(await response);
    const call = calls.at(-1);
    assert.equal(call?.operation, entry.operation);
    assert.deepEqual(call?.payload, entry.expectedPayload);
    assert.equal(call?.signal, request.signal);
  }
  assert.equal(calls.length, cases.length);
});

test("validates bounded Workspace file identities before invoking the service", async () => {
  let calls = 0;
  const routes = createWorkspaceFileRpcRoutes({
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
    ) as WorkspaceFileProtocol,
    projectDomainError: unexpectedDomainError,
  });
  const cases = [
    ["workspace.files.list", { workspaceId: "" }],
    [
      "workspace.files.list",
      {
        workspaceId: "workspace-1",
        relativePath: "x".repeat(WORKSPACE_FILE_RELATIVE_PATH_LENGTH_LIMIT + 1),
      },
    ],
    ["workspace.files.describe", { workspaceId: "workspace-1", relativePath: "" }],
    [
      "workspace.files.search",
      {
        workspaceId: "workspace-1",
        query: "x".repeat(WORKSPACE_FILE_SEARCH_QUERY_LENGTH_LIMIT + 1),
      },
    ],
    [
      "workspace.files.search",
      {
        workspaceId: "workspace-1",
        query: "app",
        limit: WORKSPACE_FILE_SEARCH_RESULT_LIMIT + 1,
      },
    ],
    ["workspace.files.read", { workspaceId: "", relativePath: "app.ts" }],
    [
      "workspace.files.write",
      {
        workspaceId: "workspace-1",
        relativePath: "app.ts",
        content: "source",
        expectedVersion: "",
      },
    ],
  ] as const;

  for (const [method, payload] of cases) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    const body = (await (await response).json()) as ServerResponse<never, { issues: RpcIssue[] }>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected a Workspace file validation failure.");
    assert.equal(body.result.error.code, "bad-request");
  }
  assert.equal(calls, 0);
});

test("preserves the larger write carrier budget while enforcing the editable content limit", async () => {
  const calls: number[] = [];
  const routes = createWorkspaceFileRpcRoutes({
    service: protocol({
      async writeFile(payload) {
        calls.push(payload.content.length);
        return {
          workspaceId: payload.workspaceId,
          relativePath: payload.relativePath,
          absolutePath: "/projects/one/large.txt",
          name: "large.txt",
          content: payload.content,
          encoding: "utf-8",
          version: "sha256:after",
          size: payload.content.length,
          modifiedAt: 1,
        };
      },
    }),
    projectDomainError: unexpectedDomainError,
  });
  const aboveOrdinaryLimit = "x".repeat(DEFAULT_MAX_RPC_REQUEST_BODY_BYTES + 1);
  const accepted = routes.handle(
    rpcRequest("workspace.files.write", {
      workspaceId: "workspace-1",
      relativePath: "large.txt",
      content: aboveOrdinaryLimit,
      expectedVersion: "sha256:before",
    }),
    "workspace.files.write",
  );

  assert.ok(accepted);
  await successValue(await accepted);
  assert.deepEqual(calls, [aboveOrdinaryLimit.length]);

  const oversizedContent = routes.handle(
    rpcRequest("workspace.files.write", {
      workspaceId: "workspace-1",
      relativePath: "too-large.txt",
      content: "x".repeat(WORKSPACE_FILE_EDITABLE_SIZE_LIMIT + 1),
      expectedVersion: "sha256:before",
    }),
    "workspace.files.write",
  );
  assert.ok(oversizedContent);
  const oversizedBody = (await (await oversizedContent).json()) as ServerResponse<never>;
  assert.equal(oversizedBody.result.ok, false);
  if (oversizedBody.result.ok) assert.fail("Expected the editable content limit.");
  assert.equal(oversizedBody.result.error.code, "bad-request");

  const overCarrierBudget = routes.handle(
    rpcRequest(
      "workspace.files.write",
      {
        workspaceId: "workspace-1",
        relativePath: "declared-too-large.txt",
        content: "source",
        expectedVersion: "sha256:before",
      },
      {
        headers: {
          "content-length": String(RPC_REQUEST_BODY_LIMITS.workspaceFileWrite + 1),
        },
      },
    ),
    "workspace.files.write",
  );
  assert.ok(overCarrierBudget);
  assert.equal((await overCarrierBudget).status, 413);
  assert.deepEqual(calls, [aboveOrdinaryLimit.length]);
});

test("normalizes cancellation independently for each file operation", async () => {
  const abortError = Object.assign(new Error("cancelled"), { name: "AbortError" });
  const service = new Proxy(
    {},
    {
      get() {
        return async () => {
          throw abortError;
        };
      },
    },
  ) as WorkspaceFileProtocol;
  const routes = createWorkspaceFileRpcRoutes({
    service,
    projectDomainError: unexpectedDomainError,
  });
  const cases = [
    ["workspace.files.list", { workspaceId: "workspace-1" }, "Directory listing was cancelled."],
    [
      "workspace.files.search",
      { workspaceId: "workspace-1", query: "app" },
      "Workspace file search was cancelled.",
    ],
    [
      "workspace.files.describe",
      { workspaceId: "workspace-1", relativePath: "app.ts" },
      "File inspection was cancelled.",
    ],
    [
      "workspace.files.read",
      { workspaceId: "workspace-1", relativePath: "app.ts" },
      "File reading was cancelled.",
    ],
    [
      "workspace.files.write",
      {
        workspaceId: "workspace-1",
        relativePath: "app.ts",
        content: "source",
        expectedVersion: "sha256:before",
      },
      "File writing was cancelled.",
    ],
  ] as const;

  for (const [method, payload, message] of cases) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    const body = (await (await response).json()) as ServerResponse<never>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected a cancellation error.");
    assert.equal(body.result.error.code, "cancelled");
    assert.equal(body.result.error.message, message);
  }
});

test("delegates Workspace file domain failures to the shared error projector", async () => {
  const failure = new Error("file failed");
  const routes = createWorkspaceFileRpcRoutes({
    service: protocol({
      async readFile() {
        throw failure;
      },
    }),
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("workspace-file-failed", "Workspace file failed.", {
        operation: "read",
      });
    },
  });
  const response = routes.handle(
    rpcRequest("workspace.files.read", {
      workspaceId: "workspace-1",
      relativePath: "app.ts",
    }),
    "workspace.files.read",
  );

  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a projected Workspace file failure.");
  assert.equal(body.result.error.code, "workspace-file-failed");
  assert.deepEqual(body.result.error.details, { operation: "read" });
});

test("keeps Workspace file RPC available to explicitly trusted hosts", async (t) => {
  const previousTrustedHosts = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example:3080";
  t.after(() => {
    if (previousTrustedHosts === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previousTrustedHosts;
  });
  const routes = createWorkspaceFileRpcRoutes({
    service: protocol({
      listDirectory: async () => ({
        workspaceId: "workspace-1",
        relativePath: "",
        absolutePath: "/projects/one",
        entries: [],
        truncated: false,
      }),
    }),
    projectDomainError: unexpectedDomainError,
  });
  const response = routes.handle(
    rpcRequest(
      "workspace.files.list",
      { workspaceId: "workspace-1" },
      {
        host: "workbench.example:3080",
        origin: "http://workbench.example:3080",
      },
    ),
    "workspace.files.list",
  );

  assert.ok(response);
  assert.equal((await response).status, 200);
});
