import assert from "node:assert/strict";
import test from "node:test";

import type { ServerResponse } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { ModelContextWindowProtocol } from "../../../src/models/model-service";
import { rpcBusinessError } from "../../../src/transport/rpc-transport";
import { createModelContextWindowRpcRoutes } from "../../../src/transport/routes/model-context-window-rpc-routes";

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

function protocol(overrides: Partial<ModelContextWindowProtocol>): ModelContextWindowProtocol {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      const implementation = Reflect.get(target, property, receiver);
      if (implementation !== undefined) return implementation;
      return async () => {
        throw new Error(`Unexpected Model Context Window protocol call: ${String(property)}`);
      };
    },
  }) as ModelContextWindowProtocol;
}

async function successValue<Value>(response: Response): Promise<Value> {
  assert.equal(response.status, 200);
  const body = (await response.json()) as ServerResponse<Value>;
  if (!body.result.ok) assert.fail(`Unexpected RPC error: ${body.result.error.code}`);
  return body.result.value;
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected an RPC error");
  return body.result.error.code;
}

const unexpectedDomainError = (error: unknown): never => {
  throw error;
};

const contextWindow = (value: number, source: "provider" | "override" = "provider") => ({
  provider: "openai",
  model: "gpt-test",
  name: "GPT Test",
  contextWindow: value,
  source,
});

test("claims only the Model Context Window RPC subdomain", async () => {
  const routes = createModelContextWindowRpcRoutes({
    service: protocol({ modelContextWindow: async () => contextWindow(128_000) }),
    notifyProviderConfigurationChanged() {},
    projectDomainError: unexpectedDomainError,
  });
  const claimed = routes.handle(
    rpcRequest("llm.modelContextWindow", { provider: "openai", model: "gpt-test" }),
    "llm.modelContextWindow",
  );

  assert.ok(claimed);
  assert.deepEqual(await successValue(await claimed), contextWindow(128_000));
  for (const method of ["llm.models", "llm.providerConfig", "llm.unknown", "session.models"]) {
    assert.equal(routes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("sanitizes context-window inputs, preserves mutation signals, and publishes refreshes", async () => {
  const calls: Array<{
    operation: PropertyKey;
    payload: unknown;
    signal?: AbortSignal;
  }> = [];
  const notifications: string[] = [];
  const service = protocol({
    async modelContextWindow(payload) {
      calls.push({ operation: "modelContextWindow", payload });
      return contextWindow(128_000);
    },
    async updateModelContextWindow(payload, options) {
      calls.push({ operation: "updateModelContextWindow", payload, signal: options?.signal });
      return contextWindow(payload.contextWindow, "override");
    },
    async resetModelContextWindow(payload, options) {
      calls.push({ operation: "resetModelContextWindow", payload, signal: options?.signal });
      return contextWindow(128_000);
    },
  });
  const routes = createModelContextWindowRpcRoutes({
    service,
    notifyProviderConfigurationChanged(provider) {
      notifications.push(provider);
    },
    projectDomainError: unexpectedDomainError,
  });
  const requests = [
    rpcRequest("llm.modelContextWindow", {
      provider: "openai",
      model: "gpt-test",
      ignored: true,
    }),
    rpcRequest("llm.updateModelContextWindow", {
      provider: "openai",
      model: "gpt-test",
      contextWindow: 256_000,
      ignored: true,
    }),
    rpcRequest("llm.resetModelContextWindow", {
      provider: "openai",
      model: "gpt-test",
      ignored: true,
    }),
  ];
  const methods = [
    "llm.modelContextWindow",
    "llm.updateModelContextWindow",
    "llm.resetModelContextWindow",
  ] as const;

  for (const [index, method] of methods.entries()) {
    const request = requests[index];
    assert.ok(request);
    const response = routes.handle(request, method);
    assert.ok(response);
    await successValue(await response);
  }
  assert.deepEqual(
    calls.map(({ operation, payload }) => ({ operation, payload })),
    [
      {
        operation: "modelContextWindow",
        payload: { provider: "openai", model: "gpt-test" },
      },
      {
        operation: "updateModelContextWindow",
        payload: { provider: "openai", model: "gpt-test", contextWindow: 256_000 },
      },
      {
        operation: "resetModelContextWindow",
        payload: { provider: "openai", model: "gpt-test" },
      },
    ],
  );
  assert.equal(calls[1]?.signal, requests[1]?.signal);
  assert.equal(calls[2]?.signal, requests[2]?.signal);
  assert.deepEqual(notifications, ["openai", "openai"]);
});

test("validates context-window payloads before invoking the protocol", async () => {
  let calls = 0;
  const routes = createModelContextWindowRpcRoutes({
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
    ) as ModelContextWindowProtocol,
    notifyProviderConfigurationChanged() {},
    projectDomainError: unexpectedDomainError,
  });
  for (const [method, payload] of [
    ["llm.modelContextWindow", { provider: "", model: "gpt-test" }],
    ["llm.modelContextWindow", { provider: "openai", model: "" }],
    ["llm.updateModelContextWindow", { provider: "openai", model: "gpt-test", contextWindow: 0 }],
    [
      "llm.updateModelContextWindow",
      { provider: "openai", model: "gpt-test", contextWindow: 10_000_001 },
    ],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    assert.equal(await errorCode(await response), "bad-request");
  }
  assert.equal(calls, 0);
});

test("allows context-window reads from trusted hosts but keeps mutations loopback-only", async (t) => {
  const previousTrustedHosts = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example:3080";
  t.after(() => {
    if (previousTrustedHosts === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previousTrustedHosts;
  });
  let calls = 0;
  const routes = createModelContextWindowRpcRoutes({
    service: protocol({
      async modelContextWindow() {
        calls += 1;
        return contextWindow(128_000);
      },
    }),
    notifyProviderConfigurationChanged() {},
    projectDomainError: unexpectedDomainError,
  });
  const options = {
    host: "workbench.example:3080",
    origin: "http://workbench.example:3080",
  };
  const read = routes.handle(
    rpcRequest("llm.modelContextWindow", { provider: "openai", model: "gpt-test" }, options),
    "llm.modelContextWindow",
  );
  assert.ok(read);
  await successValue(await read);
  assert.equal(calls, 1);

  for (const [method, payload] of [
    [
      "llm.updateModelContextWindow",
      { provider: "openai", model: "gpt-test", contextWindow: 256_000 },
    ],
    ["llm.resetModelContextWindow", { provider: "openai", model: "gpt-test" }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload, options), method);
    assert.ok(response);
    assert.equal((await response).status, 403);
  }
  assert.equal(calls, 1);
});

test("maps cancelled context-window mutations without publishing refreshes", async () => {
  const aborted = new DOMException("aborted", "AbortError");
  const notifications: string[] = [];
  const routes = createModelContextWindowRpcRoutes({
    service: protocol({
      async updateModelContextWindow() {
        throw aborted;
      },
      async resetModelContextWindow() {
        throw aborted;
      },
    }),
    notifyProviderConfigurationChanged(provider) {
      notifications.push(provider);
    },
    projectDomainError: unexpectedDomainError,
  });
  for (const [method, payload] of [
    [
      "llm.updateModelContextWindow",
      { provider: "openai", model: "gpt-test", contextWindow: 256_000 },
    ],
    ["llm.resetModelContextWindow", { provider: "openai", model: "gpt-test" }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    assert.equal(await errorCode(await response), "cancelled");
  }
  assert.deepEqual(notifications, []);
});

test("delegates context-window failures to the shared error projector", async () => {
  const failure = new Error("model missing");
  const routes = createModelContextWindowRpcRoutes({
    service: protocol({
      async modelContextWindow() {
        throw failure;
      },
    }),
    notifyProviderConfigurationChanged() {},
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("model-not-found", "Model not found.", { model: "gpt-test" });
    },
  });
  const response = routes.handle(
    rpcRequest("llm.modelContextWindow", { provider: "openai", model: "gpt-test" }),
    "llm.modelContextWindow",
  );

  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a projected context-window failure");
  assert.equal(body.result.error.code, "model-not-found");
  assert.deepEqual(body.result.error.details, { model: "gpt-test" });
});
