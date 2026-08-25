import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier.endsWith("/contracts") ||
        specifier.endsWith("/rpc-contracts") ||
        specifier === "./model-config-store"
        ? `${specifier}.ts`
        : specifier,
      context,
    );
  },
});
const { ModelService, ModelServiceError, toModelCatalogModel } = (await import(
  new URL("./model-service.ts", import.meta.url).href
)) as typeof import("./model-service");
const { ModelConfigStore } = (await import(
  new URL("./model-config-store.ts", import.meta.url).href
)) as typeof import("./model-config-store");
moduleHooks.deregister();

type ModelRuntimeLike = import("./model-service").ModelRuntimeLike;
type ModelRuntimeModel = import("./model-service").ModelRuntimeModel;
type ModelRuntimeProvider = import("./model-service").ModelRuntimeProvider;
type ModelConfigStorage = import("./model-config-store").ModelConfigStorage;
type StoredModelProviderConfiguration =
  import("./model-config-store").StoredModelProviderConfiguration;

function memoryModelConfigStore(
  initial: Record<string, StoredModelProviderConfiguration> = {},
): ModelConfigStorage {
  let configurations = structuredClone(initial);
  return {
    providers: async () => structuredClone(configurations),
    setModelContextWindow: async () => ({ rollback: async () => undefined }),
    setProvider: async (provider, configuration) => {
      const previous = structuredClone(configurations);
      configurations[provider] = {
        ...(configuration.displayName ? { displayName: configuration.displayName } : {}),
        baseURL: configuration.baseURL,
        api: configuration.api,
        ...(configuration.models ? { models: structuredClone(configuration.models) } : {}),
      };
      return {
        rollback: async () => {
          configurations = previous;
        },
      };
    },
    removeProvider: async (provider) => {
      if (!(provider in configurations)) return undefined;
      const previous = structuredClone(configurations);
      delete configurations[provider];
      return {
        rollback: async () => {
          configurations = previous;
        },
      };
    },
  };
}

function modelService(options: ConstructorParameters<typeof ModelService>[0] = {}) {
  return new ModelService({
    ...options,
    modelConfigStore: options.modelConfigStore ?? memoryModelConfigStore(),
  });
}

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

const imageTestModel = {
  provider: "openai",
  id: "gpt-vision-check",
  name: "GPT Vision Check",
  api: "openai-responses",
  baseUrl: "https://api.openai.test/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 4_096,
  samplingParams: { top_p: 0.9 },
} satisfies import("@earendil-works/pi-ai").Model<"openai-responses">;

function imageTestAssistantMessage(
  text: string,
  overrides: Partial<import("@earendil-works/pi-ai").AssistantMessage> = {},
): import("@earendil-works/pi-ai").AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: imageTestModel.provider,
    model: imageTestModel.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides,
  };
}

test("verifies image input with a real multimodal model request", async () => {
  const received: {
    model?: import("@earendil-works/pi-ai").Model<import("@earendil-works/pi-ai").Api>;
    context?: import("@earendil-works/pi-ai").Context;
    options?: import("@earendil-works/pi-ai").ModelsApiStreamOptions<
      import("@earendil-works/pi-ai").Api
    >;
  } = {};
  const service = modelService({
    runtime: runtime({
      getModel: () => imageTestModel,
      complete: async (model, context, options) => {
        received.model = model;
        received.context = context;
        received.options = options;
        return imageTestAssistantMessage("K7P3");
      },
    }),
  });

  assert.deepEqual(
    await service.testModelImageInput({ provider: "openai", model: imageTestModel.id }),
    { outcome: "supported", reason: "verified" },
  );
  assert.deepEqual(received.model?.input, ["text", "image"]);
  assert.equal(received.model?.reasoning, false);
  assert.equal(received.model?.samplingParams, undefined);
  assert.equal(received.context?.systemPrompt, undefined);
  assert.equal(received.context?.messages[0]?.role, "user");
  const content = received.context?.messages[0]?.content;
  assert.ok(Array.isArray(content));
  const image = content.find((part) => part.type === "image");
  assert.equal(image?.mimeType, "image/png");
  assert.ok((image?.data.length ?? 0) > 0);
  assert.equal(Buffer.from(image?.data ?? "", "base64")[25], 2);
  assert.equal(received.options?.maxTokens, undefined);
  assert.equal(received.options?.maxRetries, 0);
  assert.equal(received.options?.timeoutMs, 90_000);
});

test("marks image input unsupported only when the provider explicitly rejects it", async () => {
  for (const errorMessage of [
    "This model does not support image input.",
    "No endpoints found that support image input.",
  ]) {
    const service = modelService({
      runtime: runtime({
        getModel: () => imageTestModel,
        complete: async () =>
          imageTestAssistantMessage("", {
            stopReason: "error",
            errorMessage,
          }),
      }),
    });

    assert.deepEqual(
      await service.testModelImageInput({ provider: "openai", model: imageTestModel.id }),
      { outcome: "unsupported", reason: "provider-rejected-image" },
    );
  }
});

test("keeps image input inconclusive for authentication and unexpected model responses", async () => {
  const authentication = modelService({
    runtime: runtime({
      getModel: () => imageTestModel,
      complete: async () => {
        throw new Error("401 Unauthorized");
      },
    }),
  });
  const unexpected = modelService({
    runtime: runtime({
      getModel: () => imageTestModel,
      complete: async () => imageTestAssistantMessage("I cannot read that clearly."),
    }),
  });

  assert.deepEqual(
    await authentication.testModelImageInput({
      provider: "openai",
      model: imageTestModel.id,
    }),
    { outcome: "inconclusive", reason: "authentication" },
  );
  assert.deepEqual(
    await unexpected.testModelImageInput({ provider: "openai", model: imageTestModel.id }),
    { outcome: "inconclusive", reason: "unexpected-response" },
  );
});

test("classifies non-capability failures without exposing provider error text", async () => {
  const cases = [
    ["402 Insufficient credits", "quota-exceeded"],
    ["429 Too many requests", "rate-limited"],
    ["Request timed out", "timeout"],
    ["fetch failed: ECONNREFUSED", "network"],
    ["503 Service unavailable", "provider-unavailable"],
    ["Unknown parameter input_image", "protocol-mismatch"],
    ["Model was not found", "model-unavailable"],
    ["No endpoints found for this model", "model-unavailable"],
    ["Invalid image data", "invalid-image"],
    ["Blocked by content_filter", "safety"],
    ["400 Invalid request payload", "provider-error"],
  ] as const;

  for (const [errorMessage, reason] of cases) {
    const service = modelService({
      runtime: runtime({
        getModel: () => imageTestModel,
        complete: async () =>
          imageTestAssistantMessage("", {
            stopReason: "error",
            errorMessage,
          }),
      }),
    });
    assert.deepEqual(
      await service.testModelImageInput({ provider: "openai", model: imageTestModel.id }),
      { outcome: "inconclusive", reason },
    );
  }
});

test("asks the user to save before testing a model missing from the runtime", async () => {
  const service = modelService({
    runtime: runtime({
      getModel: () => undefined,
      complete: async () => imageTestAssistantMessage("K7P3"),
    }),
  });

  assert.deepEqual(await service.testModelImageInput({ provider: "openai", model: "not-saved" }), {
    outcome: "inconclusive",
    reason: "model-not-found",
  });
});

test("reads and updates a model context-window override", async () => {
  const store = memoryModelConfigStore();
  let saved: { provider: string; model: string; contextWindow: number } | undefined;
  let refreshCalls = 0;
  store.setModelContextWindow = async (provider, model, contextWindow) => {
    saved = { provider, model, contextWindow };
    return { rollback: async () => undefined };
  };
  const service = modelService({
    modelConfigStore: store,
    runtime: runtime({
      refresh: async () => {
        refreshCalls += 1;
        return { aborted: false, errors: new Map() };
      },
    }),
  });

  assert.deepEqual(
    await service.modelContextWindow({ provider: "openai", model: "gpt-reasoning" }),
    {
      provider: "openai",
      model: "gpt-reasoning",
      name: "GPT Reasoning",
      contextWindow: 200_000,
    },
  );
  assert.deepEqual(
    await service.updateModelContextWindow({
      provider: "openai",
      model: "gpt-reasoning",
      contextWindow: 256_000,
    }),
    {
      provider: "openai",
      model: "gpt-reasoning",
      name: "GPT Reasoning",
      contextWindow: 256_000,
    },
  );
  assert.deepEqual(saved, {
    provider: "openai",
    model: "gpt-reasoning",
    contextWindow: 256_000,
  });
  assert.equal(refreshCalls, 1);

  await assert.rejects(
    service.modelContextWindow({ provider: "openai", model: "missing" }),
    (error) => {
      assert.ok(error instanceof ModelServiceError);
      assert.equal(error.code, "model-not-found");
      return true;
    },
  );
});

test("maps provider auth status without reading credential values", async () => {
  let statusReads = 0;
  let credentialReads = 0;
  const service = modelService({
    runtime: runtime({
      getProviderAuthStatus: (provider) => {
        statusReads += 1;
        return provider === "openai"
          ? { configured: true, source: "environment" }
          : { configured: false };
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
        kind: "built-in",
        settingsNs: "",
        settingsPath: [],
        active: true,
        configured: false,
        apiKeyConfigurable: false,
        removable: false,
        configurationDefined: false,
      },
      {
        provider: "dormant",
        displayName: "Dormant gateway",
        kind: "built-in",
        settingsNs: "llm.pi",
        settingsPath: ["providers", "dormant"],
        active: false,
        declared: true,
        configured: false,
        apiKeyConfigurable: false,
        removable: false,
        configurationDefined: false,
      },
      {
        provider: "openai",
        displayName: "OpenAI",
        kind: "built-in",
        settingsNs: "llm.openai",
        settingsPath: ["connection"],
        active: true,
        configured: true,
        authSource: "environment",
        apiKeyConfigurable: false,
        removable: false,
        configurationDefined: false,
      },
    ],
  });
  assert.equal(statusReads, 2);
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
    input: ["text"],
    imageInput: "unknown",
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

test("refreshes externally changed Pi account authentication before listing providers", async () => {
  let authRefreshed = false;
  const service = modelService({
    runtime: runtime({
      getProviders: () => [
        {
          id: "openai-codex",
          name: "OpenAI Codex",
          auth: {
            oauth: {
              name: "OpenAI (ChatGPT Plus/Pro)",
              isSubscription: true,
              login() {},
            },
          },
        },
      ],
      getModels: () => [],
      getAvailable: async (provider) => {
        assert.equal(provider, undefined);
        authRefreshed = true;
        return [];
      },
      getProviderAuthStatus: () =>
        authRefreshed ? { configured: true, source: "stored" } : { configured: false },
      isUsingOAuth: () => true,
      getRegisteredProviderIds: () => [],
    }),
  });

  const result = await service.providers();
  assert.equal(authRefreshed, true);
  assert.deepEqual(result.providers[0], {
    provider: "openai-codex",
    displayName: "OpenAI Codex",
    kind: "built-in",
    settingsNs: "",
    settingsPath: [],
    active: true,
    configured: true,
    authSource: "stored",
    authType: "oauth",
    authMethods: [
      {
        type: "oauth",
        label: "OpenAI (ChatGPT Plus/Pro)",
        isSubscription: true,
      },
    ],
    apiKeyConfigurable: false,
    removable: true,
    configurationDefined: false,
  });
});

test("runs provider-owned account login prompts and keeps answers out of snapshots", async () => {
  let configured = false;
  const oauthProviders: ModelRuntimeProvider[] = [
    {
      id: "openai-codex",
      name: "OpenAI Codex",
      auth: {
        oauth: {
          name: "OpenAI (ChatGPT Plus/Pro)",
          loginLabel: "Sign in with ChatGPT",
          isSubscription: true,
          login() {},
        },
        apiKey: { name: "OpenAI API key", login() {} },
      },
    },
  ];
  const service = modelService({
    runtime: runtime({
      getProviders: () => oauthProviders,
      getModels: () => [],
      getAvailable: async () => [],
      getProviderAuthStatus: () =>
        configured ? { configured: true, source: "stored" } : { configured: false },
      isUsingOAuth: () => configured,
      login: async (provider, type, interaction) => {
        assert.equal(provider, "openai-codex");
        assert.equal(type, "oauth");
        assert.ok(interaction.signal);
        interaction.notify({
          type: "auth_url",
          url: "https://auth.example.test/start",
          instructions: "Open the provider login page.",
        });
        const flow = await interaction.prompt({
          type: "select",
          message: "Choose a login flow",
          options: [
            { id: "browser", label: "Browser" },
            { id: "device", label: "Device code" },
          ],
        });
        assert.equal(flow, "browser");
        interaction.notify({ type: "progress", message: "Waiting for authorization" });
        const code = await interaction.prompt({
          type: "manual_code",
          message: "Paste the authorization code",
          placeholder: "code",
        });
        assert.equal(code, "private-oauth-code");
        configured = true;
      },
    }),
  });

  const providersValue = await service.providers();
  assert.deepEqual(providersValue.providers[0]?.authMethods, [
    {
      type: "oauth",
      label: "Sign in with ChatGPT",
      isSubscription: true,
    },
    { type: "api_key", label: "OpenAI API key" },
  ]);

  const started = await service.startProviderLogin({
    provider: "openai-codex",
    authType: "oauth",
  });
  assert.equal(started.status, "running");
  assert.equal(started.events[0]?.type, "auth_url");
  assert.equal(started.prompt?.type, "select");

  service.respondProviderLogin({
    loginId: started.loginId,
    promptId: started.prompt!.id,
    value: "browser",
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const manualCode = service.providerLogin({ loginId: started.loginId });
  assert.equal(manualCode.prompt?.type, "manual_code");
  assert.equal(manualCode.events.at(-1)?.type, "progress");

  service.respondProviderLogin({
    loginId: started.loginId,
    promptId: manualCode.prompt!.id,
    value: "private-oauth-code",
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const completed = service.providerLogin({ loginId: started.loginId });
  assert.equal(completed.status, "complete");
  assert.equal(completed.prompt, undefined);
  assert.equal(JSON.stringify(completed).includes("private-oauth-code"), false);
});

test("cancels a pending provider account login", async () => {
  const service = modelService({
    runtime: runtime({
      getProviders: () => [
        {
          id: "anthropic",
          name: "Anthropic",
          auth: { oauth: { name: "Anthropic account", login() {} } },
        },
      ],
      getModels: () => [],
      login: async (_provider, _type, interaction) => {
        await interaction.prompt({ type: "text", message: "Organization" });
      },
    }),
  });
  const started = await service.startProviderLogin({
    provider: "anthropic",
    authType: "oauth",
  });
  assert.equal(started.prompt?.type, "text");
  const cancelled = service.cancelProviderLogin({ loginId: started.loginId });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.prompt, undefined);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(service.providerLogin({ loginId: started.loginId }).status, "cancelled");
});

test("persists and removes an internal provider API key without deleting the provider", async () => {
  const controller = new AbortController();
  const configurableProviders: ModelRuntimeProvider[] = [
    {
      id: "openai",
      name: "OpenAI",
      auth: { apiKey: { login() {} } },
    },
  ];
  let status: ReturnType<NonNullable<ModelRuntimeLike["getProviderAuthStatus"]>> = {
    configured: false,
  };
  let receivedKey: string | undefined;
  let logoutCalls = 0;
  const service = modelService({
    runtime: runtime({
      getProviders: () => configurableProviders,
      getProviderAuthStatus: () => status,
      login: async (provider, type, interaction) => {
        assert.equal(provider, "openai");
        assert.equal(type, "api_key");
        assert.equal(interaction.signal, controller.signal);
        receivedKey = await interaction.prompt({ type: "secret" });
        status = { configured: true, source: "stored" };
        return { type: "api_key", key: receivedKey };
      },
      logout: async (provider, options) => {
        assert.equal(provider, "openai");
        assert.equal(options?.signal, controller.signal);
        logoutCalls += 1;
        status = { configured: false };
      },
    }),
  });

  const saved = await service.configureProvider(
    { provider: "openai", apiKey: "  private-key  " },
    { signal: controller.signal },
  );
  assert.equal(receivedKey, "private-key");
  assert.deepEqual(saved.providers[0], {
    provider: "openai",
    displayName: "OpenAI",
    kind: "built-in",
    settingsNs: "",
    settingsPath: [],
    active: true,
    configured: true,
    authSource: "stored",
    authMethods: [{ type: "api_key", label: "API key" }],
    apiKeyConfigurable: true,
    removable: true,
    configurationDefined: false,
  });
  assert.equal(JSON.stringify(saved).includes("private-key"), false);

  const removed = await service.removeProvider(
    { provider: "openai" },
    { signal: controller.signal },
  );
  assert.deepEqual(removed.providers[0], {
    provider: "openai",
    displayName: "OpenAI",
    kind: "built-in",
    settingsNs: "",
    settingsPath: [],
    active: true,
    configured: false,
    authMethods: [{ type: "api_key", label: "API key" }],
    apiKeyConfigurable: true,
    removable: false,
    configurationDefined: false,
  });
  assert.equal(logoutCalls, 1);
});

test("persists a custom provider catalog, refreshes its route, and keeps credentials separate", async () => {
  const store = memoryModelConfigStore();
  let routes: ModelRuntimeProvider[] = [];
  let catalog: ModelRuntimeModel[] = [];
  let status: ReturnType<NonNullable<ModelRuntimeLike["getProviderAuthStatus"]>> = {
    configured: false,
  };
  let receivedKey: string | undefined;
  const refreshes: Array<Parameters<ModelRuntimeLike["refresh"]>[0]> = [];
  const customRuntime = runtime({
    getProviders: () => routes,
    getModels: (provider) => catalog.filter((model) => !provider || model.provider === provider),
    getProviderAuthStatus: () => status,
    refresh: async (options) => {
      refreshes.push(options);
      const stored = (await store.providers()).acme;
      if (stored) {
        routes = [
          {
            id: "acme",
            name: stored.displayName ?? "acme",
            baseUrl: stored.baseURL,
            auth: { apiKey: { login() {} } },
          },
        ];
        catalog = (stored.models ?? []).map((model) => ({
          provider: "acme",
          id: model.id,
          name: model.name ?? model.id,
          reasoning: false,
          contextWindow: model.contextWindow ?? 128_000,
          maxTokens: model.maxTokens ?? 16_384,
          api: stored.api,
          baseUrl: stored.baseURL,
        }));
      } else {
        routes = [];
        catalog = [];
      }
      return { aborted: false, errors: new Map() };
    },
    login: async (_provider, _type, interaction) => {
      receivedKey = await interaction.prompt({ type: "secret" });
      status = { configured: true, source: "stored" };
      return { type: "api_key", key: receivedKey };
    },
    logout: async () => {
      status = { configured: false };
    },
  });
  const service = modelService({ runtime: customRuntime, modelConfigStore: store });

  const saved = await service.configureProvider({
    provider: "acme",
    apiKey: "private-key",
    configuration: {
      displayName: "Acme AI",
      baseURL: "https://api.acme.test/v1/",
      api: "openai-responses",
      models: [
        {
          id: "acme-large",
          name: "Acme Large",
          contextWindow: 1_000_000,
          maxTokens: 256_000,
          reasoning: true,
          thinkingLevelMap: { minimal: "low", xhigh: null },
        },
      ],
    },
  });

  assert.equal(receivedKey, "private-key");
  assert.deepEqual(refreshes[0], {
    allowNetwork: false,
    providers: ["acme"],
  });
  assert.deepEqual(await store.providers(), {
    acme: {
      displayName: "Acme AI",
      baseURL: "https://api.acme.test/v1",
      api: "openai-responses",
      models: [
        {
          id: "acme-large",
          name: "Acme Large",
          contextWindow: 1_000_000,
          maxTokens: 256_000,
          reasoning: true,
          thinkingLevelMap: { minimal: "low", xhigh: null },
        },
      ],
    },
  });
  assert.equal(JSON.stringify(await store.providers()).includes("private-key"), false);
  assert.deepEqual(saved.providers[0], {
    provider: "acme",
    displayName: "Acme AI",
    kind: "custom",
    settingsNs: "",
    settingsPath: [],
    active: true,
    configured: true,
    authSource: "stored",
    authMethods: [{ type: "api_key", label: "API key" }],
    apiKeyConfigurable: true,
    removable: true,
    configurationDefined: true,
  });
  assert.deepEqual(await service.providerConfig({ provider: "acme" }), {
    provider: "acme",
    displayName: "Acme AI",
    baseURL: "https://api.acme.test/v1",
    api: "openai-responses",
    configurationDefined: true,
    modelsSource: "custom",
    models: [
      {
        id: "acme-large",
        name: "Acme Large",
        contextWindow: 1_000_000,
        maxTokens: 256_000,
        reasoning: true,
        thinkingLevelMap: { minimal: "low", xhigh: null },
      },
    ],
  });

  assert.deepEqual(await service.removeProvider({ provider: "acme" }), { providers: [] });
  assert.deepEqual(await store.providers(), {});
  assert.equal(refreshes.length, 2);
});

test("a deferred failed configuration cannot roll back a newer successful write", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-model-service-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new ModelConfigStore({ stateFile: path.join(directory, "models.json") });

  let markFirstRefreshStarted!: () => void;
  const firstRefreshStarted = new Promise<void>((resolve) => {
    markFirstRefreshStarted = resolve;
  });
  let releaseFirstRefresh!: () => void;
  const firstRefreshReleased = new Promise<void>((resolve) => {
    releaseFirstRefresh = resolve;
  });
  t.after(() => releaseFirstRefresh());

  let refreshCount = 0;
  const service = modelService({
    modelConfigStore: store,
    runtime: runtime({
      getProviders: () => [{ id: "acme", name: "Acme" }],
      getModels: () => [],
      refresh: async () => {
        refreshCount += 1;
        if (refreshCount === 1) {
          markFirstRefreshStarted();
          await firstRefreshReleased;
          return {
            aborted: false,
            errors: new Map([["acme", new Error("deferred refresh failure")]]),
          };
        }
        return { aborted: false, errors: new Map() };
      },
    }),
  });

  const olderRequest = service.configureProvider({
    provider: "acme",
    configuration: {
      displayName: "Older",
      baseURL: "https://older.example.test/v1",
      api: "openai-completions",
    },
  });
  await firstRefreshStarted;

  await service.configureProvider({
    provider: "acme",
    configuration: {
      displayName: "Newer",
      baseURL: "https://newer.example.test/v1",
      api: "openai-responses",
    },
  });
  releaseFirstRefresh();

  await assert.rejects(
    olderRequest,
    (error: unknown) =>
      error instanceof ModelServiceError && error.code === "model-provider-configuration-failed",
  );
  assert.equal(refreshCount, 3);
  assert.deepEqual(await store.providers(), {
    acme: {
      displayName: "Newer",
      baseURL: "https://newer.example.test/v1",
      api: "openai-responses",
    },
  });
});

test("returns adapter defaults without turning them into a custom override", async () => {
  const service = modelService({ runtime: runtime() });
  assert.deepEqual(await service.providerConfig({ provider: "openai" }), {
    provider: "openai",
    displayName: "OpenAI",
    defaultBaseURL: "https://api.openai.com/v1",
    configurationDefined: false,
    modelsSource: "adapter",
    models: [
      {
        id: "gpt-reasoning",
        name: "GPT Reasoning",
        contextWindow: 200_000,
        maxTokens: 32_000,
        reasoning: true,
        thinkingLevelMap: { minimal: null, max: null },
      },
    ],
  });
});

test("restores an internal provider's adapter model catalog", async () => {
  const store = memoryModelConfigStore({
    openai: {
      baseURL: "https://api.openai.test/v1",
      api: "openai-responses",
      models: [{ id: "custom-gpt" }],
    },
  });
  let catalog = [{ ...models[0], id: "custom-gpt", name: "custom-gpt" }];
  const service = modelService({
    modelConfigStore: store,
    runtime: runtime({
      getModels: (provider) => catalog.filter((model) => !provider || model.provider === provider),
      refresh: async () => {
        const stored = (await store.providers()).openai;
        catalog = stored?.models
          ? stored.models.map((model) => ({
              ...models[0],
              id: model.id,
              name: model.name ?? model.id,
            }))
          : models.filter(({ provider }) => provider === "openai");
        return { aborted: false, errors: new Map() };
      },
    }),
  });

  await service.configureProvider({
    provider: "openai",
    configuration: {
      baseURL: "https://api.openai.test/v1",
      api: "openai-responses",
    },
  });

  assert.deepEqual(await service.providerConfig({ provider: "openai" }), {
    provider: "openai",
    displayName: "OpenAI",
    defaultBaseURL: "https://api.openai.com/v1",
    baseURL: "https://api.openai.test/v1",
    api: "openai-responses",
    configurationDefined: true,
    modelsSource: "adapter",
    models: [
      {
        id: "gpt-reasoning",
        name: "GPT Reasoning",
        contextWindow: 200_000,
        maxTokens: 32_000,
        reasoning: true,
        thinkingLevelMap: { minimal: null, max: null },
      },
    ],
  });

  await service.removeProvider({ provider: "openai" });
  assert.deepEqual(await store.providers(), {});
  assert.deepEqual(await service.providerConfig({ provider: "openai" }), {
    provider: "openai",
    displayName: "OpenAI",
    defaultBaseURL: "https://api.openai.com/v1",
    configurationDefined: false,
    modelsSource: "adapter",
    models: [
      {
        id: "gpt-reasoning",
        name: "GPT Reasoning",
        contextWindow: 200_000,
        maxTokens: 32_000,
        reasoning: true,
        thinkingLevelMap: { minimal: null, max: null },
      },
    ],
  });
});

test("allows a custom provider without a model catalog", async () => {
  const store = memoryModelConfigStore();
  let routes: ModelRuntimeProvider[] = [];
  const customRuntime = runtime({
    getProviders: () => routes,
    getModels: () => [],
    refresh: async () => {
      const stored = (await store.providers()).acme;
      routes = stored
        ? [
            {
              id: "acme",
              name: stored.displayName ?? "acme",
              baseUrl: stored.baseURL,
              auth: { apiKey: { login() {} } },
            },
          ]
        : [];
      return { aborted: false, errors: new Map() };
    },
  });
  const service = modelService({ runtime: customRuntime, modelConfigStore: store });

  await service.configureProvider({
    provider: "acme",
    configuration: {
      displayName: "Acme Gateway",
      baseURL: "https://gateway.example/v1",
      api: "openai-completions",
    },
  });

  assert.deepEqual(await service.providerConfig({ provider: "acme" }), {
    provider: "acme",
    displayName: "Acme Gateway",
    baseURL: "https://gateway.example/v1",
    api: "openai-completions",
    configurationDefined: true,
    modelsSource: "adapter",
    models: [],
  });
});

test("rolls back a custom catalog when credential setup fails", async () => {
  const store = memoryModelConfigStore();
  let routeDefined = false;
  let refreshCalls = 0;
  const service = modelService({
    modelConfigStore: store,
    runtime: runtime({
      getProviders: () =>
        routeDefined
          ? [
              {
                id: "acme",
                name: "Acme",
                auth: { apiKey: { login() {} } },
              },
            ]
          : [],
      getModels: () => [],
      refresh: async () => {
        refreshCalls += 1;
        routeDefined = (await store.providers()).acme !== undefined;
        return { aborted: false, errors: new Map() };
      },
      login: async () => {
        throw new Error("credential store unavailable");
      },
    }),
  });

  await assert.rejects(
    () =>
      service.configureProvider({
        provider: "acme",
        apiKey: "private-key",
        configuration: {
          baseURL: "https://api.acme.test/v1",
          api: "openai-completions",
          models: [{ id: "acme-large" }],
        },
      }),
    (error: unknown) =>
      error instanceof ModelServiceError && error.code === "model-provider-configuration-failed",
  );
  assert.deepEqual(await store.providers(), {});
  assert.equal(routeDefined, false);
  assert.equal(refreshCalls, 2);
});

test("rejects multi-step API-key setup and externally managed credential removal", async () => {
  const configurableProviders: ModelRuntimeProvider[] = [
    {
      id: "openai",
      name: "OpenAI",
      auth: { apiKey: { login() {} } },
    },
  ];
  const multiStep = modelService({
    runtime: runtime({
      getProviders: () => configurableProviders,
      login: async (_provider, _type, interaction) => {
        await interaction.prompt({ type: "secret" });
        await interaction.prompt({ type: "text" });
      },
    }),
  });
  await assert.rejects(
    () => multiStep.configureProvider({ provider: "openai", apiKey: "private-key" }),
    (error: unknown) =>
      error instanceof ModelServiceError && error.code === "model-provider-api-key-unsupported",
  );

  const ambient = modelService({
    runtime: runtime({
      getProviders: () => configurableProviders,
      getProviderAuthStatus: () => ({ configured: true, source: "environment" }),
      logout: async () => assert.fail("ambient auth must not be deleted"),
    }),
  });
  await assert.rejects(
    () => ambient.removeProvider({ provider: "openai" }),
    (error: unknown) =>
      error instanceof ModelServiceError && error.code === "model-provider-configuration-readonly",
  );
});

test("maps PI reasoning effort fallbacks", () => {
  assert.deepEqual(
    toModelCatalogModel({ ...models[0], thinkingLevelMap: { medium: null } }).reasoning
      ?.defaultEffort,
    "low",
  );
  assert.deepEqual(toModelCatalogModel(models[0]!).input, ["text"]);
  assert.equal(toModelCatalogModel(models[0]!).imageInput, "unknown");
  assert.deepEqual(toModelCatalogModel({ ...models[0]!, input: ["text", "image"] }).input, [
    "text",
    "image",
  ]);
  assert.equal(
    toModelCatalogModel({ ...models[0]!, input: ["text", "image"] }).imageInput,
    "supported",
  );
  assert.equal(
    toModelCatalogModel({ ...models[0]!, input: ["text", "image"] }).imageInputSource,
    "runtime",
  );
});

test("requires Workbench capability provenance before trusting stored image input", async () => {
  const visionModel = { ...models[0]!, input: ["text", "image"] as Array<"text" | "image"> };
  const runtimeWithVision = runtime({
    getAvailable: async (provider) =>
      provider === "openai" ? [visionModel] : models.filter((model) => model.provider === provider),
  });
  const legacy = modelService({
    runtime: runtimeWithVision,
    modelConfigStore: memoryModelConfigStore({
      openai: { models: [{ id: visionModel.id, input: ["text", "image"] }] },
    }),
  });
  const detected = modelService({
    runtime: runtimeWithVision,
    modelConfigStore: memoryModelConfigStore({
      openai: {
        models: [
          {
            id: visionModel.id,
            input: ["text", "image"],
            imageInputSource: "provider-api",
          },
        ],
      },
    }),
  });

  assert.deepEqual(
    (await legacy.models()).groups.find(({ id }) => id === "openai")?.models[0]?.imageInput,
    "unknown",
  );
  assert.deepEqual(
    (await detected.models()).groups.find(({ id }) => id === "openai")?.models[0]?.imageInput,
    "supported",
  );
});

test("returns per-provider and runtime catalog failures without dropping healthy groups", async () => {
  const service = modelService({
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
        models: [
          {
            id: "claude-fast",
            name: "Claude Fast",
            input: ["text"],
            imageInput: "unknown",
          },
        ],
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
  const root = await mkdtemp(path.join(tmpdir(), "workbench-model-trust-"));
  const workspacePath = path.join(root, "workspace");
  await mkdir(path.join(workspacePath, ".pi", "extensions"), { recursive: true });
  const previousTrust = process.env.PI_WORKBENCH_TRUST_PROJECT;
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(async () => {
    if (previousTrust === undefined) delete process.env.PI_WORKBENCH_TRUST_PROJECT;
    else process.env.PI_WORKBENCH_TRUST_PROJECT = previousTrust;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  });

  let resolveProjectTrust: (() => Promise<boolean>) | undefined;
  const service = modelService({
    cwd: workspacePath,
    serviceFactory: async (options) => {
      assert.equal(options.cwd, workspacePath);
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
  const service = modelService({
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
        reasoning: true,
        thinkingLevelMap: { minimal: null, max: null },
        imageInput: "unknown",
      },
    ],
  });
  assert.deepEqual(runtimeCalls, ["models:openai"]);
});

test("bypasses a custom provider's self-declared runtime input when endpoint discovery is required", async () => {
  let requests = 0;
  const service = modelService({
    runtime: runtime({
      getModels: () => [{ ...models[0]!, input: ["text", "image"] }],
    }),
    fetcher: async () => {
      requests += 1;
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "remote-model",
              architecture: { input_modalities: ["text"] },
            },
          ],
        }),
      );
    },
  });

  assert.deepEqual(
    await service.discoverModels({
      settingsNs: "custom:openai",
      provider: "openai",
      baseURL: "https://models.example.test/v1",
      api: "openai-responses",
      apiKey: "key",
      source: "endpoint",
    }),
    {
      models: [
        {
          id: "remote-model",
          input: ["text"],
          imageInput: "unsupported",
          imageInputSource: "provider-api",
        },
      ],
    },
  );
  assert.equal(requests, 1);
});

test("discovers an unknown OpenAI-compatible endpoint with a one-shot bearer key", async () => {
  const requests: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const service = modelService({
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
              architecture: { input_modalities: ["text", "image"] },
            },
            {
              id: "acme-small",
              context_window: 0,
              max_tokens: -1,
              architecture: { input_modalities: ["text"] },
            },
            { id: "acme-unknown" },
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
          input: ["text", "image"],
          imageInput: "supported",
          imageInputSource: "provider-api",
        },
        {
          id: "acme-small",
          input: ["text"],
          imageInput: "unsupported",
          imageInputSource: "provider-api",
        },
        { id: "acme-unknown", imageInput: "unknown" },
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

test("discovers and paginates Anthropic models with Anthropic authentication", async () => {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const service = modelService({
    runtime: runtime({ getProviders: () => [], getModels: () => [] }),
    fetcher: async (input, init) => {
      const url = String(input);
      requests.push({ url, headers: new Headers(init?.headers) });
      if (!url.includes("after_id=")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "claude-opus-4-6",
                display_name: "Claude Opus 4.6",
                max_input_tokens: 200_000,
                max_tokens: 32_000,
                capabilities: { image_input: { supported: true } },
              },
            ],
            has_more: true,
            last_id: "claude-opus-4-6",
          }),
        );
      }
      return new Response(
        JSON.stringify({
          data: [
            { id: "claude-opus-4-6", display_name: "Duplicate" },
            {
              id: "claude-haiku-4-5",
              display_name: "Claude Haiku 4.5",
              capabilities: { image_input: { supported: false } },
            },
          ],
          has_more: false,
          last_id: "claude-haiku-4-5",
        }),
      );
    },
  });

  assert.deepEqual(
    await service.discoverModels({
      settingsNs: "custom",
      baseURL: "https://api.anthropic.example.test",
      api: "anthropic-messages",
      apiKey: "  anthropic-key  ",
    }),
    {
      models: [
        {
          id: "claude-opus-4-6",
          name: "Claude Opus 4.6",
          contextWindow: 200_000,
          maxTokens: 32_000,
          input: ["text", "image"],
          imageInput: "supported",
          imageInputSource: "provider-api",
        },
        {
          id: "claude-haiku-4-5",
          name: "Claude Haiku 4.5",
          input: ["text"],
          imageInput: "unsupported",
          imageInputSource: "provider-api",
        },
      ],
    },
  );
  assert.deepEqual(
    requests.map(({ url }) => url),
    [
      "https://api.anthropic.example.test/v1/models?limit=1000",
      "https://api.anthropic.example.test/v1/models?limit=1000&after_id=claude-opus-4-6",
    ],
  );
  for (const { headers } of requests) {
    assert.equal(headers.get("accept"), "application/json");
    assert.equal(headers.get("anthropic-version"), "2023-06-01");
    assert.equal(headers.get("x-api-key"), "anthropic-key");
    assert.equal(headers.get("authorization"), null);
  }
});

test("does not duplicate the Anthropic v1 path", async () => {
  let requestURL = "";
  const service = modelService({
    runtime: runtime({ getProviders: () => [], getModels: () => [] }),
    fetcher: async (input) => {
      requestURL = String(input);
      return new Response(JSON.stringify({ data: [], has_more: false }));
    },
  });

  assert.deepEqual(
    await service.discoverModels({
      settingsNs: "custom",
      baseURL: "https://gateway.example.test/anthropic/v1/",
      api: "anthropic-messages",
    }),
    { models: [] },
  );
  assert.equal(requestURL, "https://gateway.example.test/anthropic/v1/models?limit=1000");
});

test("discovers and paginates Google models with API-key authentication", async () => {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const service = modelService({
    runtime: runtime({ getProviders: () => [], getModels: () => [] }),
    fetcher: async (input, init) => {
      const url = String(input);
      requests.push({ url, headers: new Headers(init?.headers) });
      if (!url.includes("pageToken=")) {
        return new Response(
          JSON.stringify({
            models: [
              {
                name: "models/gemini-3.5-flash-001",
                baseModelId: "gemini-3.5-flash",
                displayName: "Gemini 3.5 Flash",
                inputTokenLimit: 1_048_576,
                outputTokenLimit: 65_536,
                supportedGenerationMethods: ["generateContent", "countTokens"],
              },
              {
                name: "models/text-embedding-004",
                baseModelId: "text-embedding-004",
                supportedGenerationMethods: ["embedContent"],
              },
            ],
            nextPageToken: "next token",
          }),
        );
      }
      return new Response(
        JSON.stringify({
          models: [
            {
              name: "models/gemma-4-26b-a4b-it",
              displayName: "Gemma 4 26B",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
      );
    },
  });

  assert.deepEqual(
    await service.discoverModels({
      settingsNs: "google",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/",
      api: "google-generative-ai",
      apiKey: "  google-key  ",
      source: "endpoint",
    }),
    {
      models: [
        {
          id: "gemini-3.5-flash",
          name: "Gemini 3.5 Flash",
          contextWindow: 1_048_576,
          maxTokens: 65_536,
          imageInput: "unknown",
        },
        {
          id: "gemma-4-26b-a4b-it",
          name: "Gemma 4 26B",
          imageInput: "unknown",
        },
      ],
    },
  );
  assert.deepEqual(
    requests.map(({ url }) => url),
    [
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=next+token",
    ],
  );
  for (const { headers } of requests) {
    assert.equal(headers.get("accept"), "application/json");
    assert.equal(headers.get("x-goog-api-key"), "google-key");
    assert.equal(headers.get("authorization"), null);
  }
});

test("uses stored provider auth only as a request-scoped discovery fallback", async () => {
  const controller = new AbortController();
  const authorizations: Array<string | null> = [];
  const fetchSignals: Array<AbortSignal | null | undefined> = [];
  const authSignals: Array<AbortSignal | undefined> = [];
  let authCalls = 0;
  const service = modelService({
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
  assert.deepEqual(storedResult, {
    models: [{ id: "remote-model", imageInput: "unknown" }],
  });
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
  assert.deepEqual(explicitResult, {
    models: [{ id: "remote-model", imageInput: "unknown" }],
  });
  assert.equal(authCalls, 1);
  assert.deepEqual(authorizations, ["Bearer stored-private-key", "Bearer explicit-private-key"]);
});

test("cancels an in-progress model-listing body read", async () => {
  const controller = new AbortController();
  let bodyCancelled = false;
  let fetchSignal: AbortSignal | null | undefined;
  const service = modelService({
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
  const service = modelService({
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
  const service = modelService({
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
    { models: [{ id: "draft-model", imageInput: "unknown" }] },
  );
  assert.equal(authorization, null);
});

test("maps unsupported protocols and endpoint failures to credential-safe domain errors", async () => {
  let fetchCalls = 0;
  const service = modelService({
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
      api: "unsupported-api",
      apiKey: "hide",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ModelServiceError);
      assert.equal(error.code, "model-discovery-failed");
      assert.match(error.message, /has no model listing/);
      assert.deepEqual(error.details, {
        settingsNs: "custom",
        baseURL: "https://models.example.test/v1",
        reason: "unsupported-protocol",
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
      assert.deepEqual(error.details, {
        settingsNs: "custom",
        baseURL: "https://models.example.test/v1",
        reason: "authentication",
        httpStatus: 401,
      });
      assert.equal(JSON.stringify(error).includes("hide"), false);
      return true;
    },
  );
  assert.equal(fetchCalls, 1);
});

test("classifies provider HTTP and network failures for actionable test feedback", async () => {
  const failures = [
    { status: 404, reason: "endpoint-not-found" },
    { status: 429, reason: "rate-limited" },
    { status: 503, reason: "provider-unavailable" },
    { status: 400, reason: "http-error" },
  ] as const;
  const pendingStatuses = failures.map(({ status }) => status);
  const service = modelService({
    runtime: runtime({ getProviders: () => [], getModels: () => [] }),
    fetcher: async () => new Response("{}", { status: pendingStatuses.shift() ?? 500 }),
  });

  for (const expected of failures) {
    await assert.rejects(
      service.discoverModels({
        settingsNs: "custom",
        baseURL: "https://models.example.test/v1",
      }),
      (error: unknown) => {
        assert.ok(error instanceof ModelServiceError);
        assert.equal(error.details.reason, expected.reason);
        assert.equal(error.details.httpStatus, expected.status);
        return true;
      },
    );
  }

  const unreachable = modelService({
    runtime: runtime({ getProviders: () => [], getModels: () => [] }),
    fetcher: async () => {
      throw new TypeError("connection refused");
    },
  });
  await assert.rejects(
    unreachable.discoverModels({
      settingsNs: "custom",
      baseURL: "https://models.example.test/v1",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ModelServiceError);
      assert.equal(error.details.reason, "network");
      return true;
    },
  );
});

test("rejects malformed, oversized, and unusably authenticated listings", async () => {
  const responses = [
    new Response('{"models":[]}', { status: 200 }),
    new Response("{}", {
      status: 200,
      headers: { "content-length": String(4 * 1024 * 1024 + 1) },
    }),
  ];
  const service = modelService({
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
      assert.equal(error.details.reason, "invalid-response");
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
      assert.equal(error.details.reason, "invalid-api-key");
      assert.equal(JSON.stringify(error).includes("key-"), false);
      return true;
    },
  );
});
