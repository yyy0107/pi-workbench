import assert from "node:assert/strict";
import test from "node:test";

import type { ConfigurableProviderView } from "@/runtime/pi/rpc-contracts";

import {
  emptyDraft,
  emptyModel,
  formatCapacity,
  normalizeContextWindowInput,
  parseCapacity,
  prepareProviderConfiguration,
  preferredAuthType,
  toModelDraft,
  toProviderDraft,
  type ProviderDraft,
} from "./model-config-draft";

const provider: ConfigurableProviderView = {
  provider: "acme",
  displayName: "Acme",
  kind: "custom",
  settingsNs: "acme",
  settingsPath: ["providers", "acme"],
  active: true,
  configured: true,
  authType: "oauth",
  authMethods: [
    { type: "api_key", label: "API key" },
    { type: "oauth", label: "Acme account" },
  ],
  apiKeyConfigurable: true,
  removable: true,
  configurationDefined: true,
};

function validCustomDraft(): ProviderDraft {
  return {
    ...emptyDraft("acme"),
    baseURL: "https://api.example.test/v1",
    modelsSource: "custom",
    models: [{ ...emptyModel(), id: "acme-model" }],
  };
}

test("formats and parses model capacity shorthand without changing accepted values", () => {
  assert.equal(formatCapacity(undefined), "");
  assert.equal(formatCapacity(0), "");
  assert.equal(formatCapacity(1_000_000), "1M");
  assert.equal(formatCapacity(256_000), "256K");
  assert.equal(formatCapacity(12_345), "12345");

  assert.equal(parseCapacity(" 1M "), 1_000_000);
  assert.equal(parseCapacity("1.5k"), 1_500);
  assert.equal(parseCapacity("4096"), 4_096);
  for (const invalid of ["", "0", "-1", "1G", "1.2345K", "words"]) {
    assert.equal(parseCapacity(invalid), undefined);
  }
});

test("normalizes context-window drafts to decimal digits", () => {
  assert.equal(normalizeContextWindowInput(""), "");
  assert.equal(normalizeContextWindowInput("204800"), "204800");
  assert.equal(normalizeContextWindowInput("200K"), "200000");
  assert.equal(normalizeContextWindowInput("1M"), "1000000");
  assert.equal(normalizeContextWindowInput("1.5K"), "1500");
  assert.equal(normalizeContextWindowInput("12invalid34"), "1234");
});

test("converts configured models and providers into editable drafts", () => {
  const model = toModelDraft(
    {
      id: "vision-model",
      name: "Vision Model",
      contextWindow: 1_000_000,
      maxTokens: 256_000,
      input: ["text", "image"],
    },
    true,
  );
  assert.equal(typeof model.key, "number");
  assert.deepEqual(
    { ...model, key: 0 },
    {
      key: 0,
      id: "vision-model",
      name: "Vision Model",
      contextWindow: "1000000",
      maxTokens: "256K",
      supportsImages: true,
      expanded: true,
    },
  );

  const draft = toProviderDraft(provider, {
    provider: "acme",
    displayName: "Acme Gateway",
    defaultBaseURL: "https://default.example.test/v1",
    baseURL: "https://custom.example.test/v1",
    api: "openai-responses",
    configurationDefined: true,
    modelsSource: "custom",
    models: [{ id: "vision-model", input: ["text", "image"] }],
  });
  assert.equal(draft.provider, "acme");
  assert.equal(draft.authType, "oauth");
  assert.equal(draft.api, "openai-responses");
  assert.equal(draft.models[0]?.supportsImages, true);
  assert.deepEqual(draft.availableModels, [{ id: "vision-model", input: ["text", "image"] }]);
});

test("prefers a supported current auth type and otherwise falls back deterministically", () => {
  assert.equal(preferredAuthType(provider), "oauth");
  assert.equal(
    preferredAuthType({ ...provider, authType: undefined, authMethods: provider.authMethods }),
    "oauth",
  );
  assert.equal(preferredAuthType({ ...provider, authType: undefined, authMethods: [] }), "api_key");
});

test("normalizes a custom provider draft into the existing configuration payload", () => {
  const draft: ProviderDraft = {
    ...validCustomDraft(),
    displayName: "  Acme Gateway  ",
    baseURL: " ",
    defaultBaseURL: " https://default.example.test/v1 ",
    api: "openai-responses",
    models: [
      {
        ...emptyModel(),
        id: " vision-model ",
        name: " Vision Model ",
        contextWindow: "1M",
        maxTokens: "256K",
        supportsImages: true,
      },
      { ...emptyModel(), id: " text-model ", supportsImages: false },
    ],
  };

  assert.deepEqual(prepareProviderConfiguration(draft), {
    ok: true,
    configuration: {
      displayName: "Acme Gateway",
      baseURL: "https://default.example.test/v1",
      api: "openai-responses",
      models: [
        {
          id: "vision-model",
          name: "Vision Model",
          contextWindow: 1_000_000,
          maxTokens: 256_000,
          input: ["text", "image"],
        },
        { id: "text-model", input: ["text"] },
      ],
    },
  });
});

test("omits model overrides when the adapter catalog is selected", () => {
  assert.deepEqual(
    prepareProviderConfiguration({
      ...validCustomDraft(),
      displayName: " ",
      modelsSource: "adapter",
    }),
    {
      ok: true,
      configuration: {
        baseURL: "https://api.example.test/v1",
        api: "openai-completions",
      },
    },
  );
});

test("reports the same validation boundaries before a provider request is built", () => {
  assert.deepEqual(prepareProviderConfiguration(emptyDraft("acme")), {
    ok: false,
    error: "apiAddressRequired",
  });
  assert.deepEqual(
    prepareProviderConfiguration({
      ...validCustomDraft(),
      models: [],
    }),
    { ok: false, error: "modelRequired" },
  );

  for (const model of [
    { ...emptyModel(), id: "" },
    { ...emptyModel(), id: "model", contextWindow: "invalid" },
    { ...emptyModel(), id: "model", maxTokens: "1.5" },
  ]) {
    assert.deepEqual(prepareProviderConfiguration({ ...validCustomDraft(), models: [model] }), {
      ok: false,
      error: "invalidModel",
    });
  }

  assert.deepEqual(
    prepareProviderConfiguration({
      ...validCustomDraft(),
      models: [
        { ...emptyModel(), id: " duplicate " },
        { ...emptyModel(), id: "duplicate" },
      ],
    }),
    { ok: false, error: "duplicateModel" },
  );
});
