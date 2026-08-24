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
    {
      provider: "configured-text",
      displayName: "Configured Text Provider",
      kind: "custom",
      settingsNs: "",
      settingsPath: [],
      active: true,
      configured: true,
      apiKeyConfigurable: true,
      removable: true,
      configurationDefined: true,
    },
    {
      provider: "configured-unknown",
      displayName: "Configured Unknown Provider",
      kind: "custom",
      settingsNs: "",
      settingsPath: [],
      active: true,
      configured: true,
      apiKeyConfigurable: true,
      removable: true,
      configurationDefined: true,
    },
  ],
} as const satisfies ModelProvidersValue;

const catalog = {
  groups: [
    {
      id: "configured",
      name: "Catalog Provider Name",
      models: [
        {
          id: "vision",
          name: "Vision Model",
          input: ["text", "image"],
          imageInput: "supported",
        },
        { id: "text", name: "Text Model", input: ["text"], imageInput: "unsupported" },
      ],
    },
    {
      id: "custom",
      name: "Custom Provider",
      models: [
        {
          id: "custom-vision",
          name: "Custom Vision",
          input: ["image"],
          imageInput: "supported",
        },
      ],
    },
    {
      id: "unconfigured",
      name: "Unconfigured Provider",
      models: [
        {
          id: "hidden-vision",
          name: "Hidden Vision",
          input: ["image"],
          imageInput: "supported",
        },
      ],
    },
    {
      id: "configured-text",
      name: "Configured Text Provider",
      models: [
        {
          id: "text-only",
          name: "Text Only",
          input: ["text"],
          imageInput: "unsupported",
        },
      ],
    },
    {
      id: "configured-unknown",
      name: "Configured Unknown Provider",
      models: [{ id: "unknown", name: "Unknown", imageInput: "unknown" }],
    },
  ],
  failures: [],
} as const satisfies ModelCatalogValue;

test("returns configured providers and marks whether they have image-capable models", () => {
  assert.deepEqual(configuredMultimodalModelOptions(directory, catalog), [
    {
      value: "configured",
      label: "Configured Provider",
      models: [{ value: "vision", label: "Vision Model" }],
      imageInput: "supported",
    },
    {
      value: "custom",
      label: "Custom Provider",
      models: [{ value: "custom-vision", label: "Custom Vision" }],
      imageInput: "supported",
    },
    {
      value: "configured-text",
      label: "Configured Text Provider",
      models: [],
      imageInput: "unsupported",
    },
    {
      value: "configured-unknown",
      label: "Configured Unknown Provider",
      models: [],
      imageInput: "unknown",
    },
  ]);
});
