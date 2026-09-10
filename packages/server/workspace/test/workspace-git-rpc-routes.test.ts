import assert from "node:assert/strict";
import test from "node:test";

import { WORKSPACE_GIT_BRANCH_NAME_LENGTH_LIMIT } from "@workbench/agent-runtime-contracts/runtime-capabilities";
import { type RpcIssue, type ServerResponse } from "@workbench/host-contracts/rpc";

import type { WorkspaceGitProtocol } from "../src/git";
import { rpcBusinessError } from "@workbench/host-server/rpc";
import { createWorkspaceGitRpcRoutes } from "../src/git-rpc-routes";

function rpcRequest(
  method: string,
  payload: unknown,
  options: { host?: string; origin?: string } = {},
): Request {
  const host = options.host ?? "127.0.0.1:3000";
  return new Request(`http://${host}/api/${method}`, {
    method: "POST",
    headers: {
      host,
      "content-type": "application/json",
      ...(options.origin === undefined ? {} : { origin: options.origin }),
    },
    body: JSON.stringify({ type: "client-request", rpcId: "rpc-1", method, payload }),
  });
}

async function successValue<Value>(response: Response): Promise<Value> {
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<Value>;
  if (!body.result.ok) assert.fail(`Unexpected RPC error: ${body.result.error.code}`);
  return body.result.value;
}

const unexpectedDomainError = (error: unknown): never => {
  throw error;
};

test("claims only the Workspace Git subdomain and forwards sanitized payloads", async () => {
  const calls: Array<{ operation: PropertyKey; payload: unknown; signal: AbortSignal }> = [];
  const service = new Proxy(
    {},
    {
      get(_target, operation) {
        return async (payload: unknown, signal: AbortSignal) => {
          calls.push({ operation, payload, signal });
          return { repository: false as const };
        };
      },
    },
  ) as WorkspaceGitProtocol;
  const routes = createWorkspaceGitRpcRoutes({
    service,
    projectDomainError: unexpectedDomainError,
  });
  const cases = [
    {
      method: "workspace.git.describe",
      payload: { workspaceId: "workspace-1", ignored: true },
      operation: "describe",
      expected: { workspaceId: "workspace-1" },
    },
    {
      method: "workspace.git.diff",
      payload: {
        workspaceId: "workspace-1",
        scope: "branch",
        revision: "main",
        path: "a.ts",
        offset: 100,
        ignored: true,
      },
      operation: "diff",
      expected: {
        workspaceId: "workspace-1",
        scope: "branch",
        revision: "main",
        path: "a.ts",
        offset: 100,
      },
    },
    {
      method: "workspace.git.log",
      payload: { workspaceId: "workspace-1", offset: 500, ignored: true },
      operation: "log",
      expected: { workspaceId: "workspace-1", offset: 500 },
    },
    {
      method: "workspace.git.switchBranch",
      payload: { workspaceId: "workspace-1", branch: "  feature/a  ", ignored: true },
      operation: "switchBranch",
      expected: { workspaceId: "workspace-1", branch: "feature/a" },
    },
    {
      method: "workspace.git.createBranch",
      payload: { workspaceId: "workspace-1", branch: "  feature/b  ", ignored: true },
      operation: "createBranch",
      expected: { workspaceId: "workspace-1", branch: "feature/b" },
    },
  ] as const;

  for (const entry of cases) {
    const request = rpcRequest(entry.method, entry.payload);
    const response = routes.handle(request, entry.method);
    assert.ok(response);
    assert.deepEqual(await successValue(await response), { repository: false });
    const call = calls.at(-1);
    assert.equal(call?.operation, entry.operation);
    assert.deepEqual(call?.payload, entry.expected);
    assert.equal(call?.signal, request.signal);
  }
  for (const method of ["workspace.list", "workspace.files.list", "workspace.git.unknown"]) {
    assert.equal(routes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("validates bounded Workspace Git identities before invoking the service", async () => {
  let calls = 0;
  const service = new Proxy(
    {},
    {
      get() {
        return async () => {
          calls += 1;
          return { repository: false as const };
        };
      },
    },
  ) as WorkspaceGitProtocol;
  const routes = createWorkspaceGitRpcRoutes({
    service,
    projectDomainError: unexpectedDomainError,
  });
  const cases = [
    ["workspace.git.describe", { workspaceId: "" }],
    ["workspace.git.diff", { workspaceId: "workspace-1", scope: "unstaged", fullContext: "true" }],
    ["workspace.git.diff", { workspaceId: "workspace-1", scope: "unstaged", exportPatch: 1 }],
    ...[undefined, "unknown-scope", "--cached"].map(
      (scope) => ["workspace.git.diff", { workspaceId: "workspace-1", scope }] as const,
    ),
    ...[-1, 0.5, "100", Number.MAX_SAFE_INTEGER + 1].map(
      (offset) =>
        ["workspace.git.diff", { workspaceId: "workspace-1", scope: "unstaged", offset }] as const,
    ),
    [
      "workspace.git.diff",
      { workspaceId: "workspace-1", scope: "unstaged", path: "x".repeat(4097) },
    ],
    ["workspace.git.diff", { workspaceId: "workspace-1", scope: "unstaged", patchVersion: "bad" }],
    ["workspace.git.log", { workspaceId: "" }],
    ...[-1, 0.5, "500", Number.MAX_SAFE_INTEGER + 1].map(
      (offset) => ["workspace.git.log", { workspaceId: "workspace-1", offset }] as const,
    ),
    ["workspace.git.switchBranch", { workspaceId: "workspace-1", branch: "   " }],
    [
      "workspace.git.createBranch",
      {
        workspaceId: "workspace-1",
        branch: "x".repeat(WORKSPACE_GIT_BRANCH_NAME_LENGTH_LIMIT + 1),
      },
    ],
  ] as const;

  for (const [method, payload] of cases) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    const body = (await (await response).json()) as ServerResponse<never, { issues: RpcIssue[] }>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected a Workspace Git validation failure.");
    assert.equal(body.result.error.code, "bad-request");
  }
  assert.equal(calls, 0);
});

test("keeps Git reads available to trusted hosts but restricts mutations to loopback", async (t) => {
  const previousTrustedHosts = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example:3080";
  t.after(() => {
    if (previousTrustedHosts === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previousTrustedHosts;
  });
  const service = {
    diff: async () => ({ repository: false as const }),
    describe: async () => ({ repository: false as const }),
    log: async () => ({ commits: [], truncated: false }),
    switchBranch: async () => ({ repository: false as const }),
    createBranch: async () => ({ repository: false as const }),
  } satisfies WorkspaceGitProtocol;
  const routes = createWorkspaceGitRpcRoutes({
    service,
    projectDomainError: unexpectedDomainError,
  });
  const remote = {
    host: "workbench.example:3080",
    origin: "http://workbench.example:3080",
  };
  const describe = routes.handle(
    rpcRequest("workspace.git.describe", { workspaceId: "workspace-1" }, remote),
    "workspace.git.describe",
  );
  const log = routes.handle(
    rpcRequest("workspace.git.log", { workspaceId: "workspace-1" }, remote),
    "workspace.git.log",
  );
  const mutation = routes.handle(
    rpcRequest(
      "workspace.git.switchBranch",
      { workspaceId: "workspace-1", branch: "main" },
      remote,
    ),
    "workspace.git.switchBranch",
  );

  assert.ok(describe);
  assert.ok(log);
  assert.ok(mutation);
  assert.equal((await describe).status, 200);
  assert.equal((await log).status, 200);
  assert.equal((await mutation).status, 403);
});

test("delegates Workspace Git domain failures to the shared projector", async () => {
  const failure = new Error("git failed");
  const service = {
    async diff() {
      throw new Error("Unexpected diff call");
    },
    async describe() {
      throw failure;
    },
    async log() {
      throw new Error("Unexpected log call");
    },
    async switchBranch() {
      throw new Error("Unexpected switchBranch call");
    },
    async createBranch() {
      throw new Error("Unexpected createBranch call");
    },
  } satisfies WorkspaceGitProtocol;
  const routes = createWorkspaceGitRpcRoutes({
    service,
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("git-status-failed", "Git failed.", { workspaceId: "workspace-1" });
    },
  });
  const response = routes.handle(
    rpcRequest("workspace.git.describe", { workspaceId: "workspace-1" }),
    "workspace.git.describe",
  );

  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a projected Workspace Git failure.");
  assert.equal(body.result.error.code, "git-status-failed");
});
