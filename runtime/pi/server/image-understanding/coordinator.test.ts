import assert from "node:assert/strict";
import test from "node:test";

import type { ImageUnderstandingSettingsValue } from "../../rpc-contracts";
import { decideImageUnderstandingRoute } from "./coordinator";

const settings = {
  routing: "auto",
  engine: "ocr",
  ocrProvider: "glm-ocr",
  glm: {
    endpoint: "https://api.z.ai/api/paas/v4/layout_parsing",
    model: "glm-ocr",
    credentialConfigured: true,
  },
  paddle: {
    endpoint: "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs",
    model: "PaddleOCR-VL-1.5",
    credentialConfigured: true,
    pollIntervalMs: 3_000,
    pollTimeoutMs: 600_000,
  },
  multimodal: { provider: "vision-provider", model: "vision-model" },
} as const satisfies ImageUnderstandingSettingsValue;

test("routes no-image and native-capable auto submissions without preprocessing", () => {
  assert.deepEqual(
    decideImageUnderstandingRoute({ settings, hasImages: false, modelSupportsImages: false }),
    { kind: "none", reason: "no-images" },
  );
  assert.deepEqual(
    decideImageUnderstandingRoute({ settings, hasImages: true, modelSupportsImages: true }),
    { kind: "native", method: "native", reason: "auto-native" },
  );
});

test("preprocesses text-only auto models and every always-preprocess model", () => {
  assert.deepEqual(
    decideImageUnderstandingRoute({ settings, hasImages: true, modelSupportsImages: false }),
    {
      kind: "preprocess",
      method: "ocr",
      providerId: "glm-ocr",
      model: "glm-ocr",
      reason: "auto-text-only",
    },
  );
  assert.deepEqual(
    decideImageUnderstandingRoute({
      settings: { ...settings, routing: "always-preprocess" },
      hasImages: true,
      modelSupportsImages: true,
    }),
    {
      kind: "preprocess",
      method: "ocr",
      providerId: "glm-ocr",
      model: "glm-ocr",
      reason: "always-preprocess",
    },
  );
});

test("keeps disabled and native-only policies explicit for text-only models", () => {
  assert.deepEqual(
    decideImageUnderstandingRoute({
      settings: { ...settings, routing: "disabled" },
      hasImages: true,
      modelSupportsImages: false,
    }),
    { kind: "unsupported", reason: "recognition-disabled" },
  );
  assert.deepEqual(
    decideImageUnderstandingRoute({
      settings: { ...settings, routing: "native-only" },
      hasImages: true,
      modelSupportsImages: false,
    }),
    { kind: "unsupported", reason: "native-model-required" },
  );
});

test("routes configured multimodal preprocessing and rejects missing provider configuration", () => {
  assert.deepEqual(
    decideImageUnderstandingRoute({
      settings: { ...settings, engine: "multimodal" },
      hasImages: true,
      modelSupportsImages: false,
    }),
    {
      kind: "preprocess",
      method: "multimodal",
      providerId: "vision-provider",
      model: "vision-model",
      reason: "auto-text-only",
    },
  );
  assert.deepEqual(
    decideImageUnderstandingRoute({
      settings: { ...settings, glm: { ...settings.glm, credentialConfigured: false } },
      hasImages: true,
      modelSupportsImages: false,
    }),
    { kind: "unsupported", reason: "preprocessor-not-configured" },
  );
});
