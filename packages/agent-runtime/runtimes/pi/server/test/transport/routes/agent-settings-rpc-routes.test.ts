import assert from "node:assert/strict";
import test from "node:test";

import type { ServerResponse } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { AgentSettingsProtocol } from "../../../src/settings/agent-settings-service";
import { rpcBusinessError } from "@workbench/host-server/rpc";
import { createAgentSettingsRpcRoutes } from "../../../src/transport/routes/agent-settings-rpc-routes";

function rpcRequest(
  method: string,
  payload: unknown,
  options: { host?: string; origin?: string; rpcId?: string; signal?: AbortSignal } = {},
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
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

function protocol(overrides: Partial<AgentSettingsProtocol>): AgentSettingsProtocol {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      const implementation = Reflect.get(target, property, receiver);
      if (implementation !== undefined) return implementation;
      return async () => {
        throw new Error(`Unexpected Agent Settings protocol call: ${String(property)}`);
      };
    },
  }) as AgentSettingsProtocol;
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

test("claims only the Pi Agent Settings RPC subdomain", async () => {
  const routes = createAgentSettingsRpcRoutes({
    service: protocol({
      describe: async () => ({ writable: true, hasDocument: false, namespaces: [] }),
    }),
    openDocument: async () => ({ opened: true }),
    projectDomainError: unexpectedDomainError,
  });
  const claimed = routes.handle(rpcRequest("settings.describe", {}), "settings.describe");

  assert.ok(claimed);
  assert.deepEqual(await successValue(await claimed), {
    writable: true,
    hasDocument: false,
    namespaces: [],
  });
  for (const method of [
    "imageUnderstanding.describe",
    "settings.unknown",
    "workbenchSettings.describe",
  ]) {
    assert.equal(routes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("maps Agent Settings calls, sanitizes updates, and preserves the open request signal", async () => {
  const calls: Array<{ operation: PropertyKey; payload?: unknown }> = [];
  const service = protocol({
    async describe() {
      calls.push({ operation: "describe" });
      return { writable: true, hasDocument: false, namespaces: [] };
    },
    async prepareDocument() {
      calls.push({ operation: "prepareDocument" });
      return "/tmp/pi-agent-settings.json";
    },
    async update(payload) {
      calls.push({ operation: "update", payload });
      return {} as never;
    },
  });
  const opened: Array<{ path: string; signal: AbortSignal }> = [];
  const routes = createAgentSettingsRpcRoutes({
    service,
    openDocument: async (path, signal) => {
      opened.push({ path, signal });
      return { opened: true };
    },
    projectDomainError: unexpectedDomainError,
  });

  const describe = routes.handle(
    rpcRequest("settings.describe", { ignored: true }),
    "settings.describe",
  );
  assert.ok(describe);
  await successValue(await describe);

  const update = routes.handle(
    rpcRequest("settings.update", {
      ns: "pi.agent",
      patch: {
        systemPrompt: "system",
        appendSystemPrompt: "addition",
        compaction: { enabled: false, reserveTokens: 1_024, ignored: true },
        ignored: true,
      },
      expectedRevision: 7,
      ignored: true,
    }),
    "settings.update",
  );
  assert.ok(update);
  await successValue(await update);

  const openRequest = rpcRequest("settings.openDocument", { ignored: true });
  const open = routes.handle(openRequest, "settings.openDocument");
  assert.ok(open);
  assert.deepEqual(await successValue(await open), { opened: true });

  assert.deepEqual(calls, [
    { operation: "describe" },
    {
      operation: "update",
      payload: {
        ns: "pi.agent",
        patch: {
          systemPrompt: "system",
          appendSystemPrompt: "addition",
          compaction: { enabled: false, reserveTokens: 1_024 },
        },
        expectedRevision: 7,
      },
    },
    { operation: "prepareDocument" },
  ]);
  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.path, "/tmp/pi-agent-settings.json");
  assert.equal(opened[0]?.signal, openRequest.signal);
});

test("validates Agent Settings updates before invoking the protocol", async () => {
  let calls = 0;
  const routes = createAgentSettingsRpcRoutes({
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
    ) as AgentSettingsProtocol,
    openDocument: async () => ({ opened: true }),
    projectDomainError: unexpectedDomainError,
  });

  for (const payload of [
    { ns: "", patch: {} },
    { ns: "pi.agent", patch: { compaction: { reserveTokens: 0 } } },
    { ns: "pi.agent", patch: { compaction: { keepRecentTokens: 10_000_001 } } },
    { ns: "pi.agent", patch: { systemPrompt: "x".repeat(500_001) } },
    { ns: "pi.agent", patch: { appendSystemPrompt: "x".repeat(500_001) } },
    { ns: "pi.agent", patch: { appendSystemPrompt: 42 } },
    { ns: "pi.agent", patch: {}, expectedRevision: -1 },
  ]) {
    const response = routes.handle(rpcRequest("settings.update", payload), "settings.update");
    assert.ok(response);
    const body = (await (await response).json()) as ServerResponse<never>;
    assert.equal(body.result.ok, false);
    if (body.result.ok) assert.fail("Expected an Agent Settings validation failure.");
    assert.equal(body.result.error.code, "bad-request");
  }
  assert.equal(calls, 0);
});

test("scoped settings require and forward a validated target for reads and writes", async () => {
  const calls: unknown[] = [];
  const routes = createAgentSettingsRpcRoutes({
    service: protocol({
      async describe(target) {
        calls.push(target);
        return { writable: true, hasDocument: false, namespaces: [] };
      },
      async update(payload) {
        calls.push(payload);
        return {} as never;
      },
    }),
    openDocument: async () => ({ opened: true }),
    projectDomainError: unexpectedDomainError,
  });
  for (const target of [{ scope: "user" }, { scope: "project", workspaceId: "project-one" }]) {
    const payload = {
      ns: "pi.agent",
      target,
      patch: { appendSystemPrompt: "Scoped addition" },
      expectedRevision: 4,
    };
    await successValue(
      await routes.handle(
        rpcRequest("settings.describeScoped", { target }),
        "settings.describeScoped",
      )!,
    );
    await successValue(
      await routes.handle(rpcRequest("settings.updateScoped", payload), "settings.updateScoped")!,
    );
    assert.deepEqual(calls.splice(0), [target, payload]);
  }
  for (const target of [
    undefined,
    {},
    { scope: "project" },
    { scope: "project", workspaceId: "" },
    { scope: "all" },
  ]) {
    for (const method of ["settings.describeScoped", "settings.updateScoped"]) {
      const response = await routes.handle(
        rpcRequest(method, { target, ns: "pi.agent", patch: {} }),
        method,
      )!;
      const body = await response.json();
      assert.equal(body.result.ok, false);
      assert.equal(body.result.error.code, "bad-request");
    }
  }
  assert.deepEqual(calls, []);
});

test("keeps every Agent Settings method loopback-only", async (t) => {
  const previousTrustedHosts = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example:3080";
  t.after(() => {
    if (previousTrustedHosts === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previousTrustedHosts;
  });
  let calls = 0;
  const routes = createAgentSettingsRpcRoutes({
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
    ) as AgentSettingsProtocol,
    openDocument: async () => {
      calls += 1;
      return { opened: true };
    },
    projectDomainError: unexpectedDomainError,
  });
  const options = {
    host: "workbench.example:3080",
    origin: "http://workbench.example:3080",
  };

  for (const [method, payload] of [
    ["settings.describe", {}],
    ["settings.describeScoped", { target: { scope: "project", workspaceId: "one" } }],
    ["settings.openDocument", {}],
    ["settings.update", { ns: "pi.agent", patch: {} }],
    ["settings.updateScoped", { ns: "pi.agent", target: { scope: "user" }, patch: {} }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload, options), method);
    assert.ok(response);
    assert.equal((await response).status, 403);
  }
  assert.equal(calls, 0);
});

test("preserves the Agent Settings carrier budget and maps open cancellation", async () => {
  let received: unknown;
  const routes = createAgentSettingsRpcRoutes({
    service: protocol({
      async prepareDocument() {
        return "/tmp/pi-agent-settings.json";
      },
      async update(payload) {
        received = payload;
        return {} as never;
      },
    }),
    openDocument: async () => {
      const error = new Error("cancelled");
      error.name = "AbortError";
      throw error;
    },
    projectDomainError: unexpectedDomainError,
  });
  const large = routes.handle(
    rpcRequest("settings.update", {
      ns: "pi.agent",
      patch: {},
      ignoredCarrierPadding: "x".repeat(1024 * 1024),
    }),
    "settings.update",
  );
  assert.ok(large);
  await successValue(await large);
  assert.deepEqual(received, { ns: "pi.agent", patch: {} });

  const cancelled = routes.handle(rpcRequest("settings.openDocument", {}), "settings.openDocument");
  assert.ok(cancelled);
  const body = (await (await cancelled).json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected settings document opening to be cancelled.");
  assert.equal(body.result.error.code, "cancelled");
});

test("delegates Agent Settings service failures to the shared error projector", async () => {
  const failure = new Error("settings failed");
  const routes = createAgentSettingsRpcRoutes({
    service: protocol({
      async describe() {
        throw failure;
      },
    }),
    openDocument: async () => ({ opened: true }),
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("settings-failed", "Settings failed.", {});
    },
  });
  const response = routes.handle(rpcRequest("settings.describe", {}), "settings.describe");

  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a projected Agent Settings failure.");
  assert.equal(body.result.error.code, "settings-failed");
});
