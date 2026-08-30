import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MODEL_SERVICE = new URL("../../src/models/model-service.ts", import.meta.url);
const MODEL_PROVIDER_ROUTES = new URL(
  "../../src/transport/routes/model-provider-rpc-routes.ts",
  import.meta.url,
);
const MODEL_CONTEXT_WINDOW_ROUTES = new URL(
  "../../src/transport/routes/model-context-window-rpc-routes.ts",
  import.meta.url,
);
const RPC_ROUTE_COMPOSITION = new URL(
  "../../src/transport/rpc-route-composition.ts",
  import.meta.url,
);

const MODEL_PROVIDER_METHODS = [
  "llm.providers",
  "llm.providerConfig",
  "llm.startProviderLogin",
  "llm.providerLogin",
  "llm.respondProviderLogin",
  "llm.cancelProviderLogin",
  "llm.configureProvider",
  "llm.removeProvider",
  "llm.models",
  "llm.discoverModels",
  "llm.testModelImageInput",
] as const;
const MODEL_CONTEXT_WINDOW_METHODS = [
  "llm.modelContextWindow",
  "llm.updateModelContextWindow",
  "llm.resetModelContextWindow",
] as const;

test("model transports depend only on their narrow protocols", async () => {
  const [provider, contextWindow] = await Promise.all([
    readFile(MODEL_PROVIDER_ROUTES, "utf8"),
    readFile(MODEL_CONTEXT_WINDOW_ROUTES, "utf8"),
  ]);

  assert.match(provider, /import type \{ ModelProviderProtocol \}/);
  assert.match(contextWindow, /import type \{ ModelContextWindowProtocol \}/);
  assert.doesNotMatch(provider, /ModelContextWindowProtocol/);
  assert.doesNotMatch(contextWindow, /ModelProviderProtocol/);
  for (const source of [provider, contextWindow]) {
    assert.doesNotMatch(source, /@earendil-works\/pi-(?:ai|coding-agent)/);
    assert.doesNotMatch(source, /createAgentSessionServices|ModelRuntime|ModelConfigStore/);
    assert.doesNotMatch(source, /node:fs|node:path/);
  }
});

test("model routes preserve trust, carrier, cancellation, and refresh boundaries", async () => {
  const [provider, contextWindow] = await Promise.all([
    readFile(MODEL_PROVIDER_ROUTES, "utf8"),
    readFile(MODEL_CONTEXT_WINDOW_ROUTES, "utf8"),
  ]);

  assert.equal(provider.match(/loopbackOnly: true/g)?.length, 8);
  assert.match(provider, /RPC_REQUEST_BODY_LIMITS\.modelProviderConfiguration/);
  assert.match(provider, /Provider configuration was cancelled/);
  assert.match(provider, /Provider removal was cancelled/);
  assert.match(provider, /Model discovery was cancelled/);
  assert.match(provider, /Model image-input test was cancelled/);
  assert.match(provider, /if \(provider\.active\) notifyProviderConfigurationChanged/);
  assert.match(provider, /if \(value\.status === "complete"\)/);

  assert.equal(contextWindow.match(/loopbackOnly: true/g)?.length, 2);
  assert.match(contextWindow, /Model context-window update was cancelled/);
  assert.match(contextWindow, /Model context-window reset was cancelled/);
  assert.equal(
    contextWindow.match(/notifyProviderConfigurationChanged\(payload\.provider\)/g)?.length,
    2,
  );
});

test("ModelService implements both protocols while retaining Pi runtime and credential ownership", async () => {
  const source = await readFile(MODEL_SERVICE, "utf8");

  assert.match(source, /export interface ModelProviderProtocol/);
  assert.match(source, /export interface ModelContextWindowProtocol/);
  assert.match(
    source,
    /export class ModelService implements ModelProviderProtocol, ModelContextWindowProtocol/,
  );
  assert.match(source, /createAgentSessionServices/);
  assert.match(source, /builtinProviders/);
  assert.match(source, /ModelConfigStore/);
  assert.match(source, /runtime\?\.getAuth/);
  assert.match(source, /runtime\.login/);
  assert.doesNotMatch(source, /model-provider-rpc-routes|model-context-window-rpc-routes/);
  assert.doesNotMatch(source, /rpc-transport/);
});

test("the route composition creates model groups without retaining LLM transport details", async () => {
  const source = await readFile(RPC_ROUTE_COMPOSITION, "utf8");

  assert.match(source, /createModelProviderRpcRoutes\(dependencies\.modelProvider\)/);
  assert.match(source, /createModelContextWindowRpcRoutes\(dependencies\.modelContextWindow\)/);
  assert.match(source, /const modelService = new ModelService\(\)/);
  assert.match(source, /projectRpcDomainError/);
  for (const method of [...MODEL_PROVIDER_METHODS, ...MODEL_CONTEXT_WINDOW_METHODS]) {
    assert.ok(!source.includes(`case "${method}":`), `Router still owns model route: ${method}`);
  }
  assert.doesNotMatch(source, /const discoverModelsPayload/);
  assert.doesNotMatch(source, /const configureModelProviderPayload/);
  assert.doesNotMatch(source, /const modelContextWindowPayload/);
  assert.doesNotMatch(source, /RPC_REQUEST_BODY_LIMITS/);
});
