import assert from "node:assert/strict";
import test from "node:test";

import { ocrCredentialWebsiteForPreset } from "./image-understanding-credential-link";

test("maps the GLM adapter to the official API key page", () => {
  assert.deepEqual(ocrCredentialWebsiteForPreset("glm-ocr"), {
    href: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
    provider: "GLM-OCR",
  });
});

test("maps every Paddle adapter to the PaddleOCR website", () => {
  for (const preset of ["paddleocr-vl-1.6", "pp-ocrv6", "pp-structure-v3"] as const) {
    assert.deepEqual(ocrCredentialWebsiteForPreset(preset), {
      href: "https://aistudio.baidu.com/paddleocr",
      provider: "PaddleOCR",
    });
  }
});

test("does not claim a vendor website for a custom adapter", () => {
  assert.equal(ocrCredentialWebsiteForPreset("custom"), undefined);
});
