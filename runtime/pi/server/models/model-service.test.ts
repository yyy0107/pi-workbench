import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === "../contracts" || specifier === "../rpc-contracts"
        ? `${specifier}.ts`
        : specifier,
      context,
    );
  },
});
const { ModelService, ModelServiceError, toModelCatalogModel } = (await import(
  new URL("./model-service.ts", import.meta.url).href
)) as typeof import("./model-service");
moduleHooks.deregister();

type ModelRuntimeLike = import("./model-service").ModelRuntimeLike;
type ModelRuntimeModel = import("./model-service").ModelRuntimeModel;
type ModelRuntimeProvider = import("./model-service").ModelRuntimeProvider;

const providers: ModelRuntimeProvider[] = [
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic" },
];

const models: ModelRuntimeModel[] = [
  {
    provider: "openai",
    id: "gpt-reasoning",
    name: "GPT Reasoning",
    reasoning: true,
    thinkingLevelMap: { minimal: null, max: null },
    contextWindow: 200_000,
    maxTokens: 32_000,
  },
  {
    provider: "anthropic",
    id: "claude-fast",
    name: "Claude Fast",
    reasoning: false,
    contextWindow: 100_000,
    maxTokens: 8_000,
  },
];

function runtime(overrides: Partial<ModelRuntimeLike> = {}): ModelRuntimeLike {
  return {
    getProviders: () => providers,
    getModels: (provider) => models.filter((model) => !provider || model.provider === provider),
    getAvailable: async (provider) =>
      models.filter((model) => !provider || model.provider === provider),
    getAvailableSnapshot: () => models,
    getRegisteredProviderIds: () => ["openai"],
    getProviderAuthStatus: (provider) => ({ configured: provider === "openai" }),
    refresh: async () => ({ aborted: false, errors: new Map() }),
    ...overrides,
  };
}

test("maps the configurable directory independently from active routes and credentials", async () => {
  let credentialReads = 0;
  const service = new ModelService({
    runtime: runtime({
      getProviderAuthStatus: () => {
        credentialReads += 1;
        return { configured: false };
      },
      getAuth: async () => {
        credentialReads += 1;
        return { auth: { apiKey: "must-not-leak" } };
      },
    }),
    providerSettings: {
      openai: {
        settingsNs: "llm.openai",
        settingsPath: ["connection"],
      },
      dormant: {
        displayName: "Dormant gateway",
        settingsNs: "llm.pi",
        settingsPath: ["providers", "dormant"],
        declared: true,
      },
    },
  });

  const providerViews = await service.providers();
  assert.deepEqual(providerViews, {
    providers: [
      {
        provider: "anthropic",
        displayName: "Anthropic",
        settingsNs: "",
        settingsPath: [],
        active: true,
      },
      {
        provider: "dormant",
        displayName: "Dormant gateway",
        settingsNs: "llm.pi",
        settingsPath: ["providers", "dormant"],
        active: false,
        declared: true,
      },
      {
        provider: "openai",
        displayName: "OpenAI",
        settingsNs: "llm.openai",
        settingsPath: ["connection"],
        active: true,
      },
    ],
  });
  assert.equal(credentialReads, 0);
  assert.equal(JSON.stringify(providerViews).includes("must-not-leak"), false);

  const catalog = await service.models();
  assert.deepEqual(
    catalog.groups.map(({ id, name }) => ({ id, name })),
    [
      { id: "anthropic", name: "Anthropic" },
      { id: "openai", name: "OpenAI" },
    ],
  );
  assert.deepEqual(catalog.failures, []);
  assert.deepEqual(catalog.groups[0].models[0], {
    id: "claude-fast",
    name: "Claude Fast",
  });
  assert.deepEqual(catalog.groups[1].models[0].reasoning, {
    efforts: [
      { id: "off", name: "Off" },
      { id: "low", name: "Low" },
      { id: "medium", name: "Medium" },
      { id: "high", name: "High" },
      { id: "xhigh", name: "Extra high" },
    ],
    defaultEffort: "medium",
  });
});

test("maps PI reasoning effort fallbacks", () => {
  assert.deepEqual(
    toModelCatalogModel({ ...models[0], thinkingLevelMap: { medium: null } }).reasoning
      ?.defaultEffort,
    "low",
  );
});

test("returns per-provider and runtime catalog failures without dropping healthy groups", async () => {
  const service = new ModelService({
    serviceFactory: async ({ cwd }) => {
      assert.equal(cwd, "/workspace");
      return {
        modelRuntime: runtime({
          getAvailable: async (provider) => {
            if (provider === "openai") throw new Error("credential lookup failed");
            return models.filter((model) => model.provider === provider);
          },
          getError: () => "models.json is invalid",
        }),
        diagnostics: [{ type: "error", message: "extension provider failed" }],
      };
    },
    cwd: "/workspace",
  });

  assert.deepEqual(await service.models(), {
    groups: [
      {
        id: "anthropic",
        name: "Anthropic",
        models: [{ id: "claude-fast", name: "Claude Fast" }],
      },
    ],
    failures: [
      { id: "openai", name: "OpenAI", message: "credential lookup failed" },
      { id: "model-runtime", name: "Model runtime", message: "extension provider failed" },
      { id: "model-runtime", name: "Model runtime", message: "models.json is invalid" },
    ],
  });
});

test("keeps project extensions untrusted unless the workbench trust flag is exactly enabled", async (t) => {
  const previousTrust = process.env.PI_WORKBENCH_TRUST_PROJECT;
  t.after(() => {
    if (previousTrust === undefined) delete process.env.PI_WORKBENCH_TRUST_PROJECT;
    else process.env.PI_WORKBENCH_TRUST_PROJECT = previousTrust;
  });

  let resolveProjectTrust: (() => Promise<boolean>) | undefined;
  const service = new ModelService({
    cwd: "/workspace",
    serviceFactory: async (options) => {
      assert.equal(options.cwd, "/workspace");
      resolveProjectTrust = options.resourceLoaderReloadOptions.resolveProjectTrust;
      return { modelRuntime: runtime() };
    },
  });

  await service.providers();
  assert.ok(resolveProjectTrust);
  process.env.PI_WORKBENCH_TRUST_PROJECT = "true";
  assert.equal(await resolveProjectTrust(), false);
  process.env.PI_WORKBENCH_TRUST_PROJECT = "1";
  assert.equal(await resolveProjectTrust(), true);
});

test("answers a known provider from the installed catalog without using the endpoint or key", async () => {
  const runtimeCalls: string[] = [];
  const discoveryRuntime = runtime({
    getModels: (provider) => {
      runtimeCalls.push(`models:${provider ?? "all"}`);
      return models.filter((model) => !provider || model.provider === provider);
    },
    setRuntimeApiKey: async () => {
      runtimeCalls.push("set-key");
    },
    removeRuntimeApiKey: async () => {
      runtimeCalls.push("remove-key");
    },
    refresh: async () => {
      runtimeCalls.push("refresh");
      return { aborted: false, errors: new Map() };
    },
  });
  let factoryCalls = 0;
  const service = new ModelService({
    serviceFactory: async () => {
      factoryCalls += 1;
      return { modelRuntime: discoveryRuntime };
    },
    fetcher: async () => {
      throw new Error("catalog discovery must not use the endpoint");
    },
  });

  const result = await service.discoverModels({
    settingsNs: "openai",
    provider: "openai",
    baseURL: "https://unused.example.test/v1",
    apiKey: "key",
  });

  assert.equal(factoryCalls, 1);
  assert.deepEqual(result, {
    models: [
      {
        id: "gpt-reasoning",
        name: "GPT Reasoning",
        contextWindow: 200_000,
        maxTokens: 32_000,
      },
    ],
  });
  assert.deepEqual(runtimeCalls, ["models:openai"]);
});

test("discovers an unknown OpenAI-compatible endpoint with a one-shot bearer key", async () => {
  const requests: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const service = new ModelService({
    runtime: runtime({
      getProviders: () => [],
      getModels: () => [],
    }),
    fetcher: async (input, init) => {
      requests.push({ input, init });
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "acme-large",
              display_name: "Acme Large",
              context_length: 65_536,
              max_output_tokens: 4096,
            },
            { id: "acme-small", context_window: 0, max_tokens: -1 },
            { id: "acme-large", name: "Duplicate" },
            { name: "missing id" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.deepEqual(
    await service.discoverModels({
      settingsNs: "custom",
      provider: "acme-gateway",
      baseURL: "https://models.example.test/openai/v1/",
      api: "openai-responses",
      apiKey: "  k  ",
    }),
    {
      models: [
        {
          id: "acme-large",
          name: "Acme Large",
          contextWindow: 65_536,
          maxTokens: 4096,
        },
        { id: "acme-small" },
      ],
    },
  );
  assert.equal(requests.length, 1);
  assert.equal(String(requests[0].input), "https://models.example.test/openai/v1/models");
  assert.equal(requests[0].init?.method, "GET");
  const headers = new Headers(requests[0].init?.headers);
  assert.equal(headers.get("accept"), "application/json");
  assert.equal(headers.get("authorization"), "Bearer k");
});

test("uses stored provider auth only as a request-scoped discovery fallback", async () => {
  const controller = new AbortController();
  const authorizations: Array<string | null> = [];
  const fetchSignals: Array<AbortSignal | null | undefined> = [];
  const authSignals: Array<AbortSignal | undefined> = [];
  let authCalls = 0;
  const service = new ModelService({
    runtime: runtime({
      getModels: () => [],
      getAuth: async (provider, options) => {
        authCalls += 1;
        assert.equal(provider, "openai");
        authSignals.push(options?.signal);
        return { auth: { apiKey: "stored-private-key" } };
      },
      setRuntimeApiKey: async () => assert.fail("discovery must not store credentials"),
      removeRuntimeApiKey: async () => assert.fail("discovery must not mutate credentials"),
    }),
    fetcher: async (_input, init) => {
      authorizations.push(new Headers(init?.headers).get("authorization"));
      fetchSignals.push(init?.signal);
      return new Response(JSON.stringify({ data: [{ id: "remote-model" }] }));
    },
  });

  const storedResult = await service.discoverModels(
    {
      settingsNs: "openai",
      provider: "openai",
      baseURL: "https://models.example.test/v1",
    },
    { signal: controller.signal },
  );
  assert.deepEqual(storedResult, { models: [{ id: "remote-model" }] });
  assert.equal(JSON.stringify(storedResult).includes("stored-private-key"), false);
  assert.deepEqual(authorizations, ["Bearer stored-private-key"]);
  assert.deepEqual(authSignals, [controller.signal]);
  assert.deepEqual(fetchSignals, [controller.signal]);

  const explicitResult = await service.discoverModels({
    settingsNs: "openai",
    provider: "openai",
    baseURL: "https://models.example.test/v1",
    apiKey: "explicit-private-key",
  });
  assert.deepEqual(explicitResult, { models: [{ id: "remote-model" }] });
  assert.equal(authCalls, 1);
  assert.deepEqual(authorizations, ["Bearer stored-private-key", "Bearer explicit-private-key"]);
});

test("cancels an in-progress model-listing body read", async () => {
  const controller = new AbortController();
  let bodyCancelled = false;
  let fetchSignal: AbortSignal | null | undefined;
  const service = new ModelService({
    runtime: runtime({ getProviders: () => [], getModels: () => [] }),
    fetcher: async (_input, init) => {
      fetchSignal = init?.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            bodyCancelled = true;
          },
        }),
      );
    },
  });

  const discovery = service.discoverModels(
    { settingsNs: "custom", baseURL: "https://models.example.test/v1" },
    { signal: controller.signal },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(discovery, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "AbortError");
    return true;
  });
  assert.equal(fetchSignal, controller.signal);
  assert.equal(bodyCancelled, true);
});

test("preserves transport AbortError for the RPC cancellation boundary", async () => {
  const service = new ModelService({
    runtime: runtime({ getProviders: () => [], getModels: () => [] }),
    fetcher: async () => {
      throw new DOMException("transport aborted", "AbortError");
    },
  });

  await assert.rejects(
    service.discoverModels({
      settingsNs: "custom",
      baseURL: "https://models.example.test/v1",
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "AbortError");
      assert.equal(error instanceof ModelServiceError, false);
      return true;
    },
  );
});

test("can probe a draft endpoint even when the local model runtime cannot load", async () => {
  let authorization: string | null = "not-called";
  const service = new ModelService({
    serviceFactory: async () => {
      throw new Error("models.json failed to load");
    },
    fetcher: async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify({ data: [{ id: "draft-model" }] }));
    },
  });

  assert.deepEqual(
    await service.discoverModels({
      settingsNs: "custom",
      baseURL: "https://draft.example.test/v1",
    }),
    { models: [{ id: "draft-model" }] },
  );
  assert.equal(authorization, null);
});

test("maps unsupported protocols and endpoint failures to credential-safe domain errors", async () => {
  let fetchCalls = 0;
  const service = new ModelService({
    runtime: runtime({ getProviders: () => [], getModels: () => [] }),
    fetcher: async () => {
      fetchCalls += 1;
      return new Response('{"error":"denied"}', { status: 401 });
    },
  });

  await assert.rejects(
    service.discoverModels({
      settingsNs: "custom",
      baseURL: "https://models.example.test/v1",
      api: "anthropic-messages",
      apiKey: "hide",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ModelServiceError);
      assert.equal(error.code, "model-discovery-failed");
      assert.match(error.message, /has no model listing/);
      assert.deepEqual(error.details, {
        settingsNs: "custom",
        baseURL: "https://models.example.test/v1",
      });
      assert.equal(JSON.stringify(error).includes("hide"), false);
      return true;
    },
  );
  assert.equal(fetchCalls, 0);

  await assert.rejects(
    service.discoverModels({
      settingsNs: "custom",
      baseURL: "https://models.example.test/v1",
      apiKey: "hide",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ModelServiceError);
      assert.match(error.message, /answered 401; check the API key/);
      assert.equal(JSON.stringify(error).includes("hide"), false);
      return true;
    },
  );
  assert.equal(fetchCalls, 1);
});

test("rejects malformed, oversized, and unusably authenticated listings", async () => {
  const responses = [
    new Response('{"models":[]}', { status: 200 }),
    new Response("{}", {
      status: 200,
      headers: { "content-length": String(4 * 1024 * 1024 + 1) },
    }),
  ];
  const service = new ModelService({
    runtime: runtime({ getProviders: () => [], getModels: () => [] }),
    fetcher: async () => responses.shift() ?? new Response('{"data":[]}'),
  });

  await assert.rejects(
    service.discoverModels({
      settingsNs: "custom",
      baseURL: "https://models.example.test/v1",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ModelServiceError);
      assert.match(error.message, /has no "data" array/);
      return true;
    },
  );
  await assert.rejects(
    service.discoverModels({
      settingsNs: "custom",
      baseURL: "https://models.example.test/v1",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ModelServiceError);
      assert.match(error.message, /more than 4194304 bytes/);
      return true;
    },
  );
  await assert.rejects(
    service.discoverModels({
      settingsNs: "custom",
      baseURL: "https://models.example.test/v1",
      apiKey: "key-😀",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ModelServiceError);
      assert.match(error.message, /cannot be sent in an HTTP header/);
      assert.equal(JSON.stringify(error).includes("key-"), false);
      return true;
    },
  );
});
