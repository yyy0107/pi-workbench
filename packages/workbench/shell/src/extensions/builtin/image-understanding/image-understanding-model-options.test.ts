import assert from "node:assert/strict";
import test from "node:test";

import type { WorkbenchModelCatalog } from "@workbench/agent-runtime-contracts/runtime-capabilities";

import { configuredMultimodalModelOptions } from "./image-understanding-model-options";

const catalog = {
  groups: [
    {
      id: "configured",
      name: "Configured Provider",
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
} as const satisfies WorkbenchModelCatalog;

test("returns configured providers and marks whether they have image-capable models", () => {
  assert.deepEqual(configuredMultimodalModelOptions(catalog), [
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
