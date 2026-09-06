import assert from "node:assert/strict";
import test from "node:test";

import {
  imageInputCapability,
  supportedModelThinkingLevels,
  verifiedImageInputCapability,
} from "../src/models";

test("uses Pi thinking support defaults, explicit extended mappings, and unsupported holes", () => {
  assert.deepEqual(supportedModelThinkingLevels({ reasoning: false }), ["off"]);
  assert.deepEqual(supportedModelThinkingLevels({ reasoning: true }), [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
  ]);
  assert.deepEqual(
    supportedModelThinkingLevels({
      reasoning: true,
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: null,
        medium: null,
        xhigh: null,
        max: "maximum",
      },
    }),
    ["high", "max"],
  );
  assert.deepEqual(
    supportedModelThinkingLevels({
      reasoning: true,
      thinkingLevelMap: { xhigh: "extra_high", max: "max" },
    }),
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  );
});

test("distinguishes supported, unsupported, and unknown image input", () => {
  assert.equal(imageInputCapability(undefined), "unknown");
  assert.equal(imageInputCapability(["text"]), "unsupported");
  assert.equal(imageInputCapability(["text", "image"]), "supported");
});

test("requires a verification source before trusting model modalities", () => {
  assert.equal(verifiedImageInputCapability(["image"], undefined), "unknown");
  assert.equal(verifiedImageInputCapability(["image"], "provider-api"), "supported");
  assert.equal(verifiedImageInputCapability(["text"], "user"), "unsupported");
});
