import assert from "node:assert/strict";
import test from "node:test";

import type { ServerResponse } from "@/runtime/pi/contracts/rpc";
import type { ModelProviderProtocol } from "../../models/model-service";
import { DEFAULT_MAX_RPC_REQUEST_BODY_BYTES, rpcBusinessError } from "../rpc-transport";
import { createModelProviderRpcRoutes } from "./model-provider-rpc-routes";

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

function protocol(overrides: Partial<ModelProviderProtocol>): ModelProviderProtocol {
  return new Proxy(overrides, {
    get(target, property, receiver) {
      const implementation = Reflect.get(target, property, receiver);
      if (implementation !== undefined) return implementation;
      return async () => {
        throw new Error(`Unexpected Model Provider protocol call: ${String(property)}`);
      };
    },
  }) as ModelProviderProtocol;
}

function providerView(provider: string, active = true) {
  return {
    provider,
    displayName: provider,
    kind: "built-in" as const,
    settingsNs: provider,
    settingsPath: [],
    active,
    configured: true,
    apiKeyConfigurable: true,
    removable: true,
    configurationDefined: false,
  };
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

test("claims only the Model Provider RPC subdomain", async () => {
  const routes = createModelProviderRpcRoutes({
    service: protocol({ providers: async () => ({ providers: [] }) }),
    notifyProviderConfigurationChanged() {},
    projectDomainError: unexpectedDomainError,
  });
  const claimed = routes.handle(rpcRequest("llm.providers", {}), "llm.providers");

  assert.ok(claimed);
  assert.deepEqual(await successValue(await claimed), { providers: [] });
  for (const method of [
    "llm.modelContextWindow",
    "llm.updateModelContextWindow",
    "llm.unknown",
    "session.models",
  ]) {
    assert.equal(routes.handle(rpcRequest(method, {}), method), undefined);
  }
});

test("maps provider operations to sanitized inputs, preserves signals, and publishes refreshes", async () => {
  const calls: Array<{
    operation: PropertyKey;
    payload?: unknown;
    signal?: AbortSignal;
  }> = [];
  const notifications: string[] = [];
  const service = protocol({
    async providers() {
      calls.push({ operation: "providers" });
      return { providers: [providerView("openai"), providerView("offline", false)] };
    },
    async providerConfig(payload) {
      calls.push({ operation: "providerConfig", payload });
      return {
        provider: payload.provider,
        displayName: "OpenAI",
        configurationDefined: false,
        modelsSource: "adapter",
        models: [],
      };
    },
    async configureProvider(payload, options) {
      calls.push({ operation: "configureProvider", payload, signal: options?.signal });
      return { providers: [] };
    },
    async discoverModels(payload, options) {
      calls.push({ operation: "discoverModels", payload, signal: options?.signal });
      return { models: [] };
    },
    async testModelImageInput(payload, options) {
      calls.push({ operation: "testModelImageInput", payload, signal: options?.signal });
      return { outcome: "supported", reason: "verified" };
    },
  });
  const routes = createModelProviderRpcRoutes({
    service,
    notifyProviderConfigurationChanged(provider) {
      notifications.push(provider);
    },
    projectDomainError: unexpectedDomainError,
  });
  const requests = [
    rpcRequest("llm.providers", { ignored: true }),
    rpcRequest("llm.providerConfig", { provider: "openai", ignored: true }),
    rpcRequest("llm.configureProvider", {
      provider: "openai",
      apiKey: "  secret  ",
      configuration: {
        displayName: "OpenAI",
        baseURL: "https://api.openai.test/v1",
        api: "openai-responses",
        models: [
          {
            id: "gpt-test",
            reasoning: true,
            thinkingLevelMap: { medium: "medium", ignored: true },
            input: ["text", "image"],
            ignored: true,
          },
        ],
        ignored: true,
      },
      ignored: true,
    }),
    rpcRequest("llm.discoverModels", {
      settingsNs: "custom",
      provider: "openai",
      baseURL: "https://api.openai.test/v1",
      api: "openai-responses",
      source: "provider",
      ignored: true,
    }),
    rpcRequest("llm.testModelImageInput", {
      provider: "openai",
      model: "gpt-test",
      ignored: true,
    }),
  ];
  const methods = [
    "llm.providers",
    "llm.providerConfig",
    "llm.configureProvider",
    "llm.discoverModels",
    "llm.testModelImageInput",
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
      { operation: "providers", payload: undefined },
      { operation: "providerConfig", payload: { provider: "openai" } },
      {
        operation: "configureProvider",
        payload: {
          provider: "openai",
          apiKey: "secret",
          configuration: {
            displayName: "OpenAI",
            baseURL: "https://api.openai.test/v1",
            api: "openai-responses",
            models: [
              {
                id: "gpt-test",
                reasoning: true,
                thinkingLevelMap: { medium: "medium" },
                input: ["text", "image"],
              },
            ],
          },
        },
      },
      {
        operation: "discoverModels",
        payload: {
          settingsNs: "custom",
          provider: "openai",
          baseURL: "https://api.openai.test/v1",
          api: "openai-responses",
          source: "provider",
        },
      },
      {
        operation: "testModelImageInput",
        payload: { provider: "openai", model: "gpt-test" },
      },
    ],
  );
  assert.equal(calls[2]?.signal, requests[2]?.signal);
  assert.equal(calls[3]?.signal, requests[3]?.signal);
  assert.equal(calls[4]?.signal, requests[4]?.signal);
  assert.deepEqual(notifications, ["openai", "openai"]);
});

test("keeps provider-login refresh notifications tied to completed snapshots", async () => {
  const notifications: string[] = [];
  const login = (status: "running" | "complete" | "cancelled") => ({
    loginId: "login-1",
    provider: "openai-codex",
    authType: "oauth" as const,
    status,
    revision: 1,
    events: [],
  });
  const routes = createModelProviderRpcRoutes({
    service: protocol({
      startProviderLogin: async () => login("running"),
      providerLogin: () => login("complete"),
      respondProviderLogin: () => login("running"),
      cancelProviderLogin: () => login("cancelled"),
    }),
    notifyProviderConfigurationChanged(provider) {
      notifications.push(provider);
    },
    projectDomainError: unexpectedDomainError,
  });
  for (const [method, payload] of [
    ["llm.startProviderLogin", { provider: "openai-codex", authType: "oauth" }],
    ["llm.providerLogin", { loginId: "login-1" }],
    ["llm.respondProviderLogin", { loginId: "login-1", promptId: "prompt-1", value: "browser" }],
    ["llm.cancelProviderLogin", { loginId: "login-1" }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    await successValue(await response);
  }
  assert.deepEqual(notifications, ["openai-codex"]);
});

test("validates provider payloads before invoking the protocol", async () => {
  let calls = 0;
  const routes = createModelProviderRpcRoutes({
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
    ) as ModelProviderProtocol,
    notifyProviderConfigurationChanged() {},
    projectDomainError: unexpectedDomainError,
  });
  for (const [method, payload] of [
    ["llm.providerConfig", { provider: "" }],
    ["llm.startProviderLogin", { provider: "openai", authType: "api_key" }],
    ["llm.providerLogin", { loginId: "" }],
    ["llm.respondProviderLogin", { loginId: "login-1", promptId: "", value: "x" }],
    ["llm.configureProvider", { provider: "openai", apiKey: "   " }],
    [
      "llm.configureProvider",
      {
        provider: "custom",
        configuration: {
          baseURL: "https://models.test/v1",
          api: "unknown",
          models: [{ id: "model", contextWindow: 0 }],
        },
      },
    ],
    ["llm.discoverModels", { settingsNs: "custom", source: "remote" }],
    ["llm.testModelImageInput", { provider: "openai", model: "" }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    assert.equal(await errorCode(await response), "bad-request");
  }
  assert.equal(calls, 0);
});

test("preserves trusted-host reads and loopback-only provider capabilities", async (t) => {
  const previousTrustedHosts = process.env.PI_WORKBENCH_TRUSTED_HOSTS;
  process.env.PI_WORKBENCH_TRUSTED_HOSTS = "workbench.example:3080";
  t.after(() => {
    if (previousTrustedHosts === undefined) delete process.env.PI_WORKBENCH_TRUSTED_HOSTS;
    else process.env.PI_WORKBENCH_TRUSTED_HOSTS = previousTrustedHosts;
  });
  let calls = 0;
  const service = protocol({
    async providers() {
      calls += 1;
      return { providers: [] };
    },
    async providerConfig(payload) {
      calls += 1;
      return {
        provider: payload.provider,
        displayName: payload.provider,
        configurationDefined: false,
        modelsSource: "adapter",
        models: [],
      };
    },
    async models() {
      calls += 1;
      return { groups: [], failures: [] };
    },
  });
  const routes = createModelProviderRpcRoutes({
    service,
    notifyProviderConfigurationChanged() {},
    projectDomainError: unexpectedDomainError,
  });
  const options = {
    host: "workbench.example:3080",
    origin: "http://workbench.example:3080",
  };
  for (const [method, payload] of [
    ["llm.providers", {}],
    ["llm.providerConfig", { provider: "openai" }],
    ["llm.models", {}],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload, options), method);
    assert.ok(response);
    await successValue(await response);
  }
  assert.equal(calls, 3);

  for (const [method, payload] of [
    ["llm.startProviderLogin", { provider: "openai", authType: "oauth" }],
    ["llm.providerLogin", { loginId: "login-1" }],
    ["llm.respondProviderLogin", { loginId: "login-1", promptId: "prompt-1", value: "answer" }],
    ["llm.cancelProviderLogin", { loginId: "login-1" }],
    ["llm.configureProvider", { provider: "openai", apiKey: "secret" }],
    ["llm.removeProvider", { provider: "openai" }],
    ["llm.discoverModels", { settingsNs: "openai" }],
    ["llm.testModelImageInput", { provider: "openai", model: "gpt-test" }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload, options), method);
    assert.ok(response);
    assert.equal((await response).status, 403);
  }
  assert.equal(calls, 3);
});

test("keeps provider configuration's large carrier budget while stripping unknown data", async () => {
  let received: unknown;
  const routes = createModelProviderRpcRoutes({
    service: protocol({
      async configureProvider(payload) {
        received = payload;
        return { providers: [] };
      },
    }),
    notifyProviderConfigurationChanged() {},
    projectDomainError: unexpectedDomainError,
  });
  const response = routes.handle(
    rpcRequest("llm.configureProvider", {
      provider: "openai",
      apiKey: "secret",
      ignored: "x".repeat(DEFAULT_MAX_RPC_REQUEST_BODY_BYTES),
    }),
    "llm.configureProvider",
  );

  assert.ok(response);
  await successValue(await response);
  assert.deepEqual(received, { provider: "openai", apiKey: "secret" });
});

test("maps cancellable provider operations without publishing refresh notifications", async () => {
  const aborted = new DOMException("aborted", "AbortError");
  const notifications: string[] = [];
  const service = new Proxy(
    {},
    {
      get() {
        return async () => {
          throw aborted;
        };
      },
    },
  ) as ModelProviderProtocol;
  const routes = createModelProviderRpcRoutes({
    service,
    notifyProviderConfigurationChanged(provider) {
      notifications.push(provider);
    },
    projectDomainError: unexpectedDomainError,
  });
  for (const [method, payload] of [
    ["llm.configureProvider", { provider: "openai", apiKey: "secret" }],
    ["llm.removeProvider", { provider: "openai" }],
    ["llm.discoverModels", { settingsNs: "openai" }],
    ["llm.testModelImageInput", { provider: "openai", model: "gpt-test" }],
  ] as const) {
    const response = routes.handle(rpcRequest(method, payload), method);
    assert.ok(response);
    assert.equal(await errorCode(await response), "cancelled");
  }
  assert.deepEqual(notifications, []);
});

test("delegates provider failures to the shared error projector", async () => {
  const failure = new Error("login failed");
  const routes = createModelProviderRpcRoutes({
    service: protocol({
      async startProviderLogin() {
        throw failure;
      },
    }),
    notifyProviderConfigurationChanged() {},
    projectDomainError(error): never {
      assert.equal(error, failure);
      throw rpcBusinessError("provider-failed", "Provider failed.", { provider: "openai" });
    },
  });
  const response = routes.handle(
    rpcRequest("llm.startProviderLogin", { provider: "openai", authType: "oauth" }),
    "llm.startProviderLogin",
  );

  assert.ok(response);
  const body = (await (await response).json()) as ServerResponse<never>;
  assert.equal(body.result.ok, false);
  if (body.result.ok) assert.fail("Expected a projected provider failure");
  assert.equal(body.result.error.code, "provider-failed");
  assert.deepEqual(body.result.error.details, { provider: "openai" });
});
