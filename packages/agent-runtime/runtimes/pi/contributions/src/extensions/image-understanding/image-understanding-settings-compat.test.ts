import assert from "node:assert/strict";
import test from "node:test";

import type { AttachmentUnderstandingSettingsValue } from "@workbench/agent-runtime-pi-protocol/rpc";

import {
  hasOcrAdapterSettings,
  ocrAdapterSettingsFromValue,
} from "./image-understanding-settings-compat";

const legacyValue = {
  routing: "always-preprocess",
  engine: "ocr",
  ocrProvider: "paddleocr",
  glm: {
    endpoint: "https://api.z.ai/api/paas/v4/layout_parsing",
    model: "glm-ocr",
    credentialConfigured: false,
  },
  paddle: {
    endpoint: "https://paddle.example/jobs",
    model: "PP-StructureV3",
    credentialConfigured: true,
    pollIntervalMs: 5_000,
    pollTimeoutMs: 700_000,
  },
  multimodal: { provider: "", model: "" },
} as unknown as AttachmentUnderstandingSettingsValue;

test("normalizes an old Host response without an ocrAdapter field", () => {
  assert.equal(hasOcrAdapterSettings(legacyValue), false);
  const adapter = ocrAdapterSettingsFromValue(legacyValue);
  assert.equal(adapter.preset, "pp-structure-v3");
  assert.equal(adapter.endpoint, "https://paddle.example/jobs");
  assert.equal(adapter.model, "PP-StructureV3");
  assert.equal(adapter.credentialConfigured, true);
  assert.equal(adapter.pollIntervalMs, 5_000);
  assert.equal(adapter.source.includes("layoutParsingResults"), true);
});

test("preserves a current Host adapter view", () => {
  const adapter = ocrAdapterSettingsFromValue(legacyValue);
  const current = { ...legacyValue, ocrAdapter: adapter };
  assert.equal(hasOcrAdapterSettings(current), true);
  assert.equal(ocrAdapterSettingsFromValue(current), adapter);
});
