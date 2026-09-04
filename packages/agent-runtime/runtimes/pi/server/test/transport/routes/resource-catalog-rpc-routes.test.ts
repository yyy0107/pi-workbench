import assert from "node:assert/strict";
import test from "node:test";

import type { ServerResponse } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { CommandCatalogProtocol } from "../../../src/commands/command-service";
import type { PromptCatalogProtocol } from "../../../src/prompts/prompt-service";
import { rpcBusinessError } from "@workbench/host-server/rpc";
import { createResourceCatalogRpcRoutes } from "../../../src/transport/routes/resource-catalog-rpc-routes";

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

async function responseBody(response: Response): Promise<ServerResponse<unknown>> {
  assert.equal(response.status, 200);
  return (await response.json()) as ServerResponse<unknown>;
}

const unexpectedDomainError = (error: unknown): never => {
  throw error;
};

test("maps Command and Prompt catalogs to separate narrow protocols", async () => {
  const calls: unknown[] = [];
  const commands: CommandCatalogProtocol = {
    async list(payload) {
      calls.push(["commands", payload]);
      return { commands: [] };
    },
  };
  const prompts: PromptCatalogProtocol = {
    async list(payload) {
      calls.push(["prompts", payload]);
      return { prompts: [] };
    },
  };
  const routes = createResourceCatalogRpcRoutes({
    commands,
    prompts,
    projectDomainError: unexpectedDomainError,
  });

  for (const [method, payload] of [
    ["command.list", { target: { scope: "project", workspaceId: "workspace-1" }, ignored: true }],
    ["prompt.list", { target: { scope: "user" }, ignored: true }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    const body = await responseBody(await response);
    assert.equal(body.result.ok, true);
  }
  assert.deepEqual(calls, [
    ["commands", { target: { scope: "project", workspaceId: "workspace-1" } }],
    ["prompts", { target: { scope: "user" } }],
  ]);
  for (const method of ["skill.list", "extension.list", "package.list", "command.unknown"]) {
    assert.equal(routes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("preserves the legacy session identity for Command catalogs", async () => {
  const payloads: unknown[] = [];
  const routes = createResourceCatalogRpcRoutes({
    commands: {
      async list(payload) {
        payloads.push(payload);
        return { commands: [] };
      },
    },
    prompts: {
      async list() {
        return { prompts: [] };
      },
    },
    projectDomainError: unexpectedDomainError,
  });
  const response = routes.handle(
    rpcRequest("command.list", { sessionId: "session-1", ignored: true }),
    "command.list",
  );

  assert.ok(response);
  assert.equal((await responseBody(await response)).result.ok, true);
  assert.deepEqual(payloads, [{ sessionId: "session-1" }]);
});

test("validates catalog identities before invoking either protocol", async () => {
  let calls = 0;
  const unexpectedProtocol = new Proxy(
    {},
    {
      get() {
        return async () => {
          calls += 1;
          return {};
        };
      },
    },
  );
  const routes = createResourceCatalogRpcRoutes({
    commands: unexpectedProtocol as CommandCatalogProtocol,
    prompts: unexpectedProtocol as PromptCatalogProtocol,
    projectDomainError: unexpectedDomainError,
  });
  for (const [method, payload] of [
    ["command.list", {}],
    ["command.list", { sessionId: "session-1", target: { scope: "user" } }],
    ["command.list", { sessionId: "" }],
    ["prompt.list", { target: { scope: "project", workspaceId: "" } }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    const body = await responseBody(await response);
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected Resource Catalog validation to fail");
    assert.equal(body.result.error.code, "bad-request");
  }
  assert.equal(calls, 0);
});

test("delegates Command and Prompt catalog failures to the shared error projector", async () => {
  const failure = new Error("catalog failed");
  const routes = createResourceCatalogRpcRoutes({
    commands: {
      async list() {
        throw failure;
      },
    },
    prompts: {
      async list() {
        throw failure;
      },
    },
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("catalog-failed", "Catalog failed.", {});
    },
  });

  for (const [method, payload] of [
    ["command.list", { target: { scope: "user" } }],
    ["prompt.list", { target: { scope: "user" } }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    const body = await responseBody(await response);
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected projected Resource Catalog failure");
    assert.equal(body.result.error.code, "catalog-failed");
  }
});

test("keeps read-only Resource Catalogs available to explicitly trusted hosts", async (t) => {
  const previousTrustedHosts = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example:3080";
  t.after(() => {
    if (previousTrustedHosts === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previousTrustedHosts;
  });
  const routes = createResourceCatalogRpcRoutes({
    commands: { list: async () => ({ commands: [] }) },
    prompts: { list: async () => ({ prompts: [] }) },
    projectDomainError: unexpectedDomainError,
  });
  const options = { host: "workbench.example:3080", origin: "http://workbench.example:3080" };

  for (const [method, payload] of [
    ["command.list", { target: { scope: "user" } }],
    ["prompt.list", { target: { scope: "user" } }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload, options), method);
    assert.ok(response);
    assert.equal((await response).status, 200);
  }
});
