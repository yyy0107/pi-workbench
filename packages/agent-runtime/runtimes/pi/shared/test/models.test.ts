import assert from "node:assert/strict";
import test from "node:test";

import { imageInputCapability, verifiedImageInputCapability } from "../src/models";

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
