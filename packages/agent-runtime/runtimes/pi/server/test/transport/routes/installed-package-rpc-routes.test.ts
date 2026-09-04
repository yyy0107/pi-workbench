import assert from "node:assert/strict";
import test from "node:test";

import type { RpcIssue, ServerResponse } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { InstalledPackageProtocol } from "../../../src/packages/installed-package-service";
import { rpcBusinessError } from "@workbench/host-server/rpc";
import { createInstalledPackageRpcRoutes } from "../../../src/transport/routes/installed-package-rpc-routes";

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

function protocol(overrides: Partial<InstalledPackageProtocol>): InstalledPackageProtocol {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      const implementation = Reflect.get(target, property, receiver);
      if (implementation !== undefined) return implementation;
      return async () => {
        throw new Error(`Unexpected Installed Package protocol call: ${String(property)}`);
      };
    },
  }) as InstalledPackageProtocol;
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

test("claims only the Installed Package RPC subdomain", async () => {
  const routes = createInstalledPackageRpcRoutes({
    service: protocol({ list: async () => ({ packages: [] }) }),
    projectDomainError: unexpectedDomainError,
  });
  const claimed = routes.handle(
    rpcRequest("package.list", { sessionId: "session-1" }),
    "package.list",
  );

  assert.ok(claimed);
  assert.deepEqual(await successValue(await claimed), { packages: [] });
  for (const method of [
    "extension.list",
    "package.unknown",
    "packageCatalog.search",
    "skill.list",
  ]) {
    assert.equal(routes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("maps all six Installed Package methods to sanitized protocol inputs", async () => {
  const calls: Array<{ operation: PropertyKey; payload: unknown }> = [];
  const service = new Proxy(
    {},
    {
      get(_target, operation) {
        return async (payload: unknown) => {
          calls.push({ operation, payload });
          return {};
        };
      },
    },
  ) as InstalledPackageProtocol;
  const routes = createInstalledPackageRpcRoutes({
    service,
    projectDomainError: unexpectedDomainError,
  });
  const cases = [
    {
      method: "package.list",
      payload: { sessionId: "session-1", ignored: true },
      operation: "list",
      expectedPayload: { sessionId: "session-1" },
    },
    {
      method: "package.describe",
      payload: {
        source: " npm:pi-tools ",
        target: { scope: "user", ignored: true },
        ignored: true,
      },
      operation: "describe",
      expectedPayload: { source: "npm:pi-tools", target: { scope: "user" } },
    },
    {
      method: "package.updates",
      payload: {
        target: { scope: "project", workspaceId: "workspace-1", ignored: true },
        ignored: true,
      },
      operation: "updates",
      expectedPayload: { target: { scope: "project", workspaceId: "workspace-1" } },
    },
    {
      method: "package.install",
      payload: {
        name: " @scope/pi-tools ",
        target: { scope: "user", sessionId: "session-1", ignored: true },
        ignored: true,
      },
      operation: "install",
      expectedPayload: {
        name: "@scope/pi-tools",
        target: { scope: "user", sessionId: "session-1" },
      },
    },
    {
      method: "package.update",
      payload: {
        source: " git:github.com/example/pi-tools ",
        target: { scope: "project", workspaceId: "workspace-1", ignored: true },
        ignored: true,
      },
      operation: "update",
      expectedPayload: {
        source: "git:github.com/example/pi-tools",
        target: { scope: "project", workspaceId: "workspace-1" },
      },
    },
    {
      method: "package.remove",
      payload: {
        source: " npm:pi-tools ",
        target: { scope: "user", ignored: true },
        ignored: true,
      },
      operation: "remove",
      expectedPayload: { source: "npm:pi-tools", target: { scope: "user" } },
    },
  ] as const;

  for (const entry of cases) {
    const response = routes.handle(rpcRequest(entry.method, entry.payload), entry.method);
    assert.ok(response);
    await successValue(await response);
  }
  assert.deepEqual(
    calls,
    cases.map(({ operation, expectedPayload }) => ({ operation, payload: expectedPayload })),
  );
});

test("validates Installed Package identities before invoking the protocol", async () => {
  let calls = 0;
  const routes = createInstalledPackageRpcRoutes({
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
    ) as InstalledPackageProtocol,
    projectDomainError: unexpectedDomainError,
  });
  const cases = [
    ["package.list", {}],
    ["package.updates", { sessionId: "session-1", target: { scope: "user" } }],
    [
      "package.describe",
      { source: "npm:pi-tools\ninvalid", target: { scope: "project", workspaceId: "" } },
    ],
    [
      "package.install",
      { name: "https://example.com/pi-tools", target: { scope: "project", workspaceId: "" } },
    ],
    ["package.update", { source: "npm:pi-tools\ninvalid", target: { scope: "user" } }],
    ["package.remove", { source: "npm:pi-tools", target: { scope: "workspace" } }],
  ] as const;

  for (const [method, payload] of cases) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    const body = (await (await response).json()) as ServerResponse<never, { issues: RpcIssue[] }>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected an Installed Package validation failure.");
    assert.equal(body.result.error.code, "bad-request");
  }
  assert.equal(calls, 0);
});

test("keeps Installed Package mutations loopback-only while allowing reads from trusted hosts", async (t) => {
  const previousTrustedHosts = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example:3080";
  t.after(() => {
    if (previousTrustedHosts === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previousTrustedHosts;
  });
  const calls: PropertyKey[] = [];
  const service = new Proxy(
    {},
    {
      get(_target, operation) {
        return async () => {
          calls.push(operation);
          return {};
        };
      },
    },
  ) as InstalledPackageProtocol;
  const routes = createInstalledPackageRpcRoutes({
    service,
    projectDomainError: unexpectedDomainError,
  });
  const options = {
    host: "workbench.example:3080",
    origin: "http://workbench.example:3080",
  };

  for (const [method, payload] of [
    ["package.install", { name: "pi-tools", target: { scope: "user" } }],
    ["package.update", { source: "npm:pi-tools", target: { scope: "user" } }],
    ["package.remove", { source: "npm:pi-tools", target: { scope: "user" } }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload, options), method);
    assert.ok(response);
    assert.equal((await response).status, 403);
  }
  assert.deepEqual(calls, []);

  for (const [method, payload, operation] of [
    ["package.list", { sessionId: "session-1" }, "list"],
    ["package.describe", { source: "npm:pi-tools", target: { scope: "user" } }, "describe"],
    ["package.updates", { target: { scope: "user" } }, "updates"],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload, options), method);
    assert.ok(response);
    await successValue(await response);
    assert.equal(calls.at(-1), operation);
  }
  assert.deepEqual(calls, ["list", "describe", "updates"]);
});

test("delegates Installed Package failures to the shared error projector", async () => {
  const failure = new Error("package failed");
  const routes = createInstalledPackageRpcRoutes({
    service: protocol({
      async list() {
        throw failure;
      },
    }),
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("package-failed", "Package failed.", { operation: "list" });
    },
  });
  const response = routes.handle(
    rpcRequest("package.list", { sessionId: "session-1" }),
    "package.list",
  );

  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a projected Installed Package failure.");
  assert.equal(body.result.error.code, "package-failed");
  assert.deepEqual(body.result.error.details, { operation: "list" });
});
