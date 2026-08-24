import assert from "node:assert/strict";
import test from "node:test";

import type { ModelCatalogValue, ModelProvidersValue } from "@/runtime/pi/rpc-contracts";

import { configuredMultimodalModelOptions } from "./image-understanding-model-options";

const directory = {
  providers: [
    {
      provider: "configured",
      displayName: "Configured Provider",
      kind: "built-in",
      settingsNs: "llm.configured",
      settingsPath: [],
      active: true,
      configured: true,
      apiKeyConfigurable: true,
      removable: false,
      configurationDefined: false,
    },
    {
      provider: "custom",
      displayName: "Custom Provider",
      kind: "custom",
      settingsNs: "",
      settingsPath: [],
      active: true,
      configured: false,
      apiKeyConfigurable: true,
      removable: true,
      configurationDefined: true,
    },
    {
      provider: "unconfigured",
      displayName: "Unconfigured Provider",
      kind: "built-in",
      settingsNs: "llm.unconfigured",
      settingsPath: [],
      active: true,
      configured: false,
      apiKeyConfigurable: true,
      removable: false,
      configurationDefined: false,
    },
  ],
} as const satisfies ModelProvidersValue;

const catalog = {
  groups: [
    {
      id: "configured",
      name: "Catalog Provider Name",
      models: [
        { id: "vision", name: "Vision Model", input: ["text", "image"] },
        { id: "text", name: "Text Model", input: ["text"] },
      ],
    },
    {
      id: "custom",
      name: "Custom Provider",
      models: [{ id: "custom-vision", name: "Custom Vision", input: ["image"] }],
    },
    {
      id: "unconfigured",
      name: "Unconfigured Provider",
      models: [{ id: "hidden-vision", name: "Hidden Vision", input: ["image"] }],
    },
  ],
  failures: [],
} as const satisfies ModelCatalogValue;

test("returns only configured providers with image-capable models", () => {
  assert.deepEqual(configuredMultimodalModelOptions(directory, catalog), [
    {
      value: "configured",
      label: "Configured Provider",
      models: [{ value: "vision", label: "Vision Model" }],
    },
    {
      value: "custom",
      label: "Custom Provider",
      models: [{ value: "custom-vision", label: "Custom Vision" }],
    },
  ]);
});
