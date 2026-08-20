import assert from "node:assert/strict";
import test from "node:test";

import type { SelectorModel } from "./model-selector-state";

const {
  draftSelectorModels,
  filterSelectorModels,
  modelChangeSelection,
  modelSelection,
  modelSelectorId,
  resolveDraftSelectorModel,
  sessionSelectorModels,
} = (await import(
  new URL("./model-selector-state.ts", import.meta.url).href
)) as typeof import("./model-selector-state");
const { parseRememberedModelSelection, useModelSelectorStore } = (await import(
  new URL("./model-selector-store.ts", import.meta.url).href
)) as typeof import("./model-selector-store");

const searchableModels: SelectorModel[] = [
  {
    id: modelSelectorId("deepseek-my", "deepseek-v4-flash"),
    provider: "deepseek-my",
    providerName: "My DeepSeek",
    model: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
  },
  {
    id: modelSelectorId("openai", "gpt-5.6-sol"),
    provider: "openai",
    providerName: "OpenAI",
    model: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
  },
];

test("filters models by name, id, provider, and multiple terms", () => {
  assert.equal(filterSelectorModels(searchableModels, "").length, 2);
  assert.deepEqual(filterSelectorModels(searchableModels, "V4 FLASH"), [searchableModels[0]]);
  assert.deepEqual(filterSelectorModels(searchableModels, "deepseek-my v4"), [searchableModels[0]]);
  assert.deepEqual(filterSelectorModels(searchableModels, "openai sol"), [searchableModels[1]]);
  assert.deepEqual(filterSelectorModels(searchableModels, "missing"), []);
});

test("uses the session catalog and its server-provided reasoning efforts", () => {
  const models = sessionSelectorModels({
    current: { provider: "openai", model: "gpt-reasoning", reasoningEffort: "xhigh" },
    routable: true,
    failures: [],
    groups: [
      {
        id: "openai",
        name: "OpenAI",
        models: [
          {
            id: "gpt-reasoning",
            name: "GPT Reasoning",
            reasoning: {
              efforts: [
                { id: "off", name: "Off" },
                { id: "xhigh", name: "Extra high", description: "Maximum reasoning" },
              ],
              defaultEffort: "off",
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(models[0], {
    id: modelSelectorId("openai", "gpt-reasoning"),
    provider: "openai",
    providerName: "OpenAI",
    model: "gpt-reasoning",
    name: "GPT Reasoning",
    efforts: [
      { id: "off", name: "Off" },
      { id: "xhigh", name: "Extra high", description: "Maximum reasoning" },
    ],
    defaultEffort: "off",
  });
  assert.deepEqual(modelSelection(models[0]!, "xhigh"), {
    provider: "openai",
    model: "gpt-reasoning",
    reasoningEffort: "xhigh",
  });
});

test("keeps an unavailable session current model visible without making it selectable", () => {
  const [current, available] = sessionSelectorModels({
    current: { provider: "removed", model: "old-model", reasoningEffort: "medium" },
    routable: false,
    failures: [],
    groups: [
      {
        id: "openai",
        name: "OpenAI",
        models: [{ id: "gpt", name: "GPT" }],
      },
    ],
  });

  assert.deepEqual(current, {
    id: modelSelectorId("removed", "old-model"),
    provider: "removed",
    providerName: "removed",
    model: "old-model",
    name: "old-model",
    unavailable: true,
  });
  assert.equal(available?.id, modelSelectorId("openai", "gpt"));
});

test("draft catalogs use the shared protocol model groups and reasoning efforts", () => {
  const [reasoning, plain] = draftSelectorModels({
    failures: [],
    groups: [
      {
        id: "pi",
        name: "Pi",
        models: [
          {
            id: "reasoning",
            name: "Reasoning",
            description: "128000 tokens",
            reasoning: {
              efforts: [
                { id: "low", name: "Low" },
                { id: "medium", name: "Medium" },
                { id: "high", name: "High" },
              ],
              defaultEffort: "medium",
            },
          },
          {
            id: "plain",
            name: "Plain",
          },
        ],
      },
    ],
  });

  assert.equal(reasoning?.description, "128000 tokens");
  assert.deepEqual(modelSelection(reasoning!, "unsupported"), {
    provider: "pi",
    model: "reasoning",
    reasoningEffort: "medium",
  });
  assert.deepEqual(modelSelection(plain!, "high"), { provider: "pi", model: "plain" });
});

test("model changes use the target model default effort instead of carrying the current effort", () => {
  const target: SelectorModel = {
    id: modelSelectorId("opencode-go", "deepseek-v4-flash"),
    provider: "opencode-go",
    providerName: "OpenCode Go",
    model: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    efforts: [
      { id: "low", name: "Low" },
      { id: "medium", name: "Medium" },
      { id: "high", name: "High" },
    ],
    defaultEffort: "medium",
  };

  assert.deepEqual(modelSelection(target, "low"), {
    provider: "opencode-go",
    model: "deepseek-v4-flash",
    reasoningEffort: "low",
  });
  assert.deepEqual(modelChangeSelection(target), {
    provider: "opencode-go",
    model: "deepseek-v4-flash",
    reasoningEffort: "medium",
  });
});

test("new drafts prefer their own choice, then the last switched model", () => {
  assert.equal(
    resolveDraftSelectorModel(searchableModels, undefined, searchableModels[1]!.id)?.id,
    searchableModels[1]!.id,
  );
  assert.equal(
    resolveDraftSelectorModel(searchableModels, searchableModels[0]!.id, searchableModels[1]!.id)
      ?.id,
    searchableModels[0]!.id,
  );
  assert.equal(
    resolveDraftSelectorModel(searchableModels, undefined, "missing/model")?.id,
    searchableModels[0]!.id,
  );
});

test("validates the persisted last model selection", () => {
  assert.deepEqual(
    parseRememberedModelSelection(
      JSON.stringify({ modelId: "opencode-go/deepseek-v4-flash", reasoningEffort: "medium" }),
    ),
    { modelId: "opencode-go/deepseek-v4-flash", reasoningEffort: "medium" },
  );
  assert.equal(parseRememberedModelSelection(JSON.stringify({ modelId: "" })), undefined);
  assert.equal(
    parseRememberedModelSelection(
      JSON.stringify({ modelId: "provider/model", reasoningEffort: 1 }),
    ),
    undefined,
  );
  assert.equal(parseRememberedModelSelection("{"), undefined);
});

test("draft model choices are isolated by local thread id", () => {
  useModelSelectorStore.setState({ draftSelections: {}, rememberedSelection: undefined });
  const store = useModelSelectorStore.getState();
  store.setDraftSelection("draft-a", { modelId: "provider/a", reasoningEffort: "low" });
  store.setDraftSelection("draft-b", { modelId: "provider/b", reasoningEffort: "high" });

  assert.deepEqual(useModelSelectorStore.getState().draftSelections, {
    "draft-a": { modelId: "provider/a", reasoningEffort: "low" },
    "draft-b": { modelId: "provider/b", reasoningEffort: "high" },
  });

  useModelSelectorStore.getState().clearDraftSelection("draft-a");
  assert.deepEqual(useModelSelectorStore.getState().draftSelections, {
    "draft-b": { modelId: "provider/b", reasoningEffort: "high" },
  });
});

test("the last switched model is shared with subsequent drafts", () => {
  useModelSelectorStore.setState({ draftSelections: {}, rememberedSelection: undefined });
  useModelSelectorStore.getState().rememberSelection({
    modelId: "opencode-go/deepseek-v4-flash",
    reasoningEffort: "medium",
  });

  assert.deepEqual(useModelSelectorStore.getState().rememberedSelection, {
    modelId: "opencode-go/deepseek-v4-flash",
    reasoningEffort: "medium",
  });
});
