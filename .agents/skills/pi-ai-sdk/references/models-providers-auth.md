# Models, providers, and authentication

## Contents

- [Choose Workbench runtime or a Models collection](#choose-workbench-runtime-or-a-models-collection)
- [Build and query a collection](#build-and-query-a-collection)
- [Use model metadata correctly](#use-model-metadata-correctly)
- [Create a custom provider](#create-a-custom-provider)
- [Refresh dynamic catalogs](#refresh-dynamic-catalogs)
- [Resolve authentication](#resolve-authentication)
- [Handle errors and cancellation](#handle-errors-and-cancellation)

## Choose Workbench runtime or a Models collection

Pi AI's `Models` collection owns providers and delegates auth plus requests. In Workbench, the coding-agent `ModelRuntime` already wraps this responsibility with product configuration and persistent credentials.

Use the existing Workbench `ModelRuntime` for:

- provider settings and availability;
- `auth.json` and `models.json` behavior;
- login/logout/configuration flows;
- session model selection and requests;
- model overrides such as context windows.

Create an independent `Models` collection only for an isolated SDK consumer, custom infrastructure that has explicit ownership, or a focused test. Do not create a second collection merely to query the product's configured state.

`builtinProviders()` returns newly constructed provider definitions. Workbench currently uses it for declared metadata such as default base URLs; it is not the authenticated runtime snapshot.

## Build and query a collection

For a narrow provider set:

```ts
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";

const models = createModels();
models.setProvider(anthropicProvider());
```

For the full built-in set:

```ts
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

const models = builtinModels();
```

`providers/all` is intentionally heavy. Prefer provider-specific factories for browser bundles or focused services.

Reads such as `getProviders()`, `getModels()`, and `getModel()` are synchronous last-known snapshots. `getAvailable()` is asynchronous because it checks provider auth configuration. `refresh()` is the explicit network/cache refresh operation.

Use `getBuiltinModel()` or `getBuiltinModels()` from `providers/all` only when static generated catalog data, not runtime/auth state, is the desired source.

## Use model metadata correctly

`Model<TApi>` is plain serializable metadata. Important fields have distinct meanings:

| Field              | Meaning                                                 |
| ------------------ | ------------------------------------------------------- |
| `provider`, `id`   | Stable lookup identity                                  |
| `api`              | Wire implementation used for typed request options      |
| `baseUrl`          | Model endpoint metadata                                 |
| `reasoning`        | Whether reasoning controls apply                        |
| `thinkingLevelMap` | Model/provider-specific support and mapping             |
| `input`            | Supported input modalities such as text/image           |
| `contextWindow`    | Total context capacity metadata                         |
| `maxTokens`        | Maximum output metadata; not the context window         |
| `cost`             | Per-million-token rates used for usage cost calculation |
| `compat`           | Explicit compatibility overrides for the selected API   |

Dynamic lookups return `Model<Api>`. Narrow before passing API-specific options:

```ts
const model = models.getModel("anthropic", modelId);
if (model && hasApi(model, "anthropic-messages")) {
  return models.complete(model, context, {
    thinkingEnabled: true,
    thinkingBudgetTokens: 4096,
  });
}
```

Use `getSupportedThinkingLevels()` and `clampThinkingLevel()` instead of assuming every reasoning model supports every level. `xhigh` and `max` are opt-in model capabilities.

## Create a custom provider

Prefer a `Models` collection plus `createProvider()` over direct API dispatch when the integration needs provider-owned auth, lookup, and request routing:

```ts
import { createModels, createProvider, envApiKeyAuth, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

const model: Model<"openai-completions"> = {
  id: "local-model",
  name: "Local model",
  api: "openai-completions",
  provider: "local",
  baseUrl: "http://127.0.0.1:8080/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 16_384,
};

const provider = createProvider({
  id: "local",
  auth: { apiKey: envApiKeyAuth("Local API key", ["LOCAL_API_KEY"]) },
  models: [model],
  api: openAICompletionsApi(),
});

const models = createModels();
models.setProvider(provider);
```

Every provider must declare auth semantics, including keyless or ambient-auth providers. Use the lazy API wrapper to defer loading the vendor SDK until first use.

Direct `@earendil-works/pi-ai/api/<id>` stream calls bypass provider auth resolution. Use them only when the caller intentionally supplies complete request auth and routing.

## Refresh dynamic catalogs

Dynamic providers use `fetchModels` or implement `refreshModels`. Reads remain synchronous; call `models.refresh()` explicitly to restore or fetch:

```ts
const result = await models.refresh({
  providers: [providerId],
  allowNetwork: true,
  signal,
});

if (result.aborted) return;
for (const [id, error] of result.errors) reportProviderRefreshError(id, error);
```

Refresh is best-effort and returns per-provider errors. Use `allowNetwork: false` for cache-only restoration and `force: true` only when bypassing freshness policy is intended. Custom provider fetches must honor the supplied signal.

Use a `ModelsStore` when dynamic catalogs need persistence. Do not copy catalog data into an unrelated store when the Workbench `ModelRuntime` already owns persistence.

## Resolve authentication

Provider auth resolution order and storage are part of the SDK contract. Prefer collection methods:

- `checkAuth(providerId)` for non-refreshing configuration checks;
- `getAvailable(providerId?)` for models with configured providers;
- `getAuth(providerId | model)` to resolve request auth and refresh OAuth if necessary;
- `login(providerId, type, interaction)` to run and persist provider-owned login;
- `logout(providerId)` to delete the stored credential.

Inject a persistent `CredentialStore` when an independent collection must persist credentials. Its `modify()` operation is the serialized read-modify-write path used for OAuth refresh.

For a request, explicit `apiKey` and headers can override resolved values. When only final headers need adjustment, use `Models` request option `transformHeaders`; do not call `getAuth()` and then `stream()` because that resolves auth twice.

Workbench credentials and login prompts remain behind the existing loopback/server RPC services. Never return raw credentials or resolved auth headers to the browser.

## Handle errors and cancellation

- `models.refresh()` returns `{ aborted, errors }` instead of rejecting for individual provider failures.
- `getAuth()` can reject with `ModelsError` for real auth/OAuth failures and returns `undefined` when a provider is simply unconfigured.
- Request stream failures become terminal error events and final messages with `stopReason: "error"` or `"aborted"`.
- Always pass `AbortSignal` through provider requests, dynamic refresh, login prompts, and custom blocking work when the caller owns cancellation.
- Do not log request headers, API keys, OAuth credentials, or secret prompt answers while diagnosing failures.
